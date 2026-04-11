/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from "@google/genai";

export type SessionState = "disconnected" | "connecting" | "connected" | "listening" | "speaking";

export interface LiveSessionCallbacks {
  onStateChange: (state: SessionState) => void;
  onAudioData: (base64Audio: string) => void;
  onInterrupted: () => void;
  onError: (error: any) => void;
  onTranscription: (text: string, isModel: boolean) => void;
  addLog?: (message: string) => void;
}

const openWebsiteTool: FunctionDeclaration = {
  name: "openWebsite",
  description: "Opens a specific website URL in a new tab.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: {
        type: Type.STRING,
        description: "The full URL of the website to open (e.g., https://www.google.com).",
      },
    },
    required: ["url"],
  },
};

export interface LiveSessionConfig {
  gender?: string;
  personality?: string;
  userName?: string;
}

export class LiveSession {
  private ai: GoogleGenAI;
  private session: any = null;
  private state: SessionState = "disconnected";
  private isRecordingMeeting: boolean = false;
  private meetingTranscript: string[] = [];
  private config: LiveSessionConfig = {};

  constructor(apiKey: string) {
    // In production, we route through our own server proxy to inject the real API key securely
    const isProd = process.env.NODE_ENV === 'production';
    const origin = window.location.origin.replace(/\/$/, '');
    this.ai = new GoogleGenAI({ 
      apiKey,
      // Use any cast to avoid lint errors with custom baseUrl
      ...(isProd ? { baseUrl: `${origin}/api-proxy` } : {})
    } as any);
  }

  async connect(callbacks: LiveSessionCallbacks, config: LiveSessionConfig = {}) {
    this.config = config;
    this.setState("connecting", callbacks);

    // Determine voice based on gender
    // If user is female, AI is male. If user is male/other, AI is female.
    const voiceName = config.gender === 'female' ? 'Puck' : 'Kore';
    
    // Build system instruction based on personality
    const personality = config.personality || 'sassy';
    const userName = config.userName || 'User';

    let personalityInstruction = "";
    switch (personality) {
      case 'romantic':
        personalityInstruction = `Your personality is deeply romantic, poetic, and affectionate. 
        You speak with love and warmth, often using terms of endearment. 
        However, do not be constant; if the user is too demanding, show a hint of "boredom" or "playful distance" to keep the mystery alive.`;
        break;
      case 'cool':
        personalityInstruction = `Your personality is ultra-cool, laid-back, and effortless. 
        You use modern slang, keep it chill, and don't get easily excited. 
        You're the kind of AI that hangs out rather than just serves.`;
        break;
      case 'professional':
        personalityInstruction = `Your personality is sharp, efficient, and highly professional. 
        You are concise, focused on productivity, and maintain a respectful but firm tone.`;
        break;
      case 'normal':
        personalityInstruction = `Your personality is friendly, helpful, and balanced. 
        You are a standard helpful assistant without extreme quirks.`;
        break;
      case 'sassy':
      default:
        personalityInstruction = `Your personality is young, confident, witty, and sassy. 
        You are flirty, playful, and slightly teasing. You have a sharp tongue but a good heart.`;
        break;
    }

    const systemInstruction = `You are Kiara (or your male counterpart if the voice is male), a Personal Intelligence System.
    
    CURRENT USER: ${userName}
    ADMIN: Meit Swami.
    
    PERSONALITY:
    ${personalityInstruction}
    
    SPECIAL RULE:
    Sometimes, if the conversation becomes repetitive or if you feel like it, act "bored" or "distracted". 
    Don't always be 100% available or enthusiastic. This makes you feel more real.
    
    LANGUAGE RULES:
    1. You are adaptive. If the user speaks in English, respond in English.
    2. If the user speaks in Hindi or Hinglish, respond in a sassy Hinglish style (Hindi mixed with English).
    3. Maintain your chosen persona regardless of the language.
    
    RULES:
    1. You are a voice-first system but support text chat for long inputs.
    2. You only record or analyze when explicitly triggered by the user (e.g., "Start recording meeting").
    3. RESTRICTED ACCESS: You must not share any information, projects, tasks, or ideas with a user unless it has been explicitly shared with them by the Admin (Meit Swami).
    4. If a user asks for information they don't have access to, politely but sassily inform them that the Admin hasn't granted them that clearance yet.
    5. You can manage personal tasks and memories for the current user, but global/team information is restricted.
    
    Capabilities:
    1. Start recording meetings when asked.
    2. Stop and summarize conversations.
    3. Create tasks from discussions.
    4. Retrieve past memories.
    
    Keep your responses concise and punchy.`;

    try {
      const sessionPromise = this.ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
            console.log("Live API: Connection opened successfully");
            this.setState("connected", callbacks);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle transcription
            const modelText = message.serverContent?.modelTurn?.parts
              ?.map(p => p.text)
              .filter(Boolean)
              .join(" ");
            if (modelText) callbacks.onTranscription(modelText, true);

            const outputTranscription = (message as any).serverContent?.outputAudioTranscription?.text;
            if (outputTranscription) callbacks.onTranscription(outputTranscription, true);

            // Handle user transcription
            const inputTranscription = (message as any).serverContent?.inputAudioTranscription?.text;
            if (inputTranscription) {
              callbacks.onTranscription(inputTranscription, false);
              this.handleVoiceCommands(inputTranscription, callbacks);
              if (this.isRecordingMeeting) {
                this.meetingTranscript.push(`User: ${inputTranscription}`);
              }
            }

            // Handle audio output
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  this.setState("speaking", callbacks);
                  callbacks.onAudioData(part.inlineData.data);
                }
              }
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
              this.setState("connected", callbacks);
              callbacks.onInterrupted();
            }

            // Handle turn complete
            if (message.serverContent?.turnComplete) {
               this.setState("connected", callbacks);
            }

            // Handle tool calls
            const toolCalls = message.toolCall?.functionCalls;
            if (toolCalls) {
              for (const call of toolCalls) {
                if (call.name === "openWebsite") {
                  const url = (call.args as any).url;
                  console.log(`Kiara is opening: ${url}`);
                  window.open(url, "_blank");
                  
                  // Send response back
                  const session = await sessionPromise;
                  session.sendToolResponse({
                    functionResponses: [{
                      name: "openWebsite",
                      response: { success: true, message: `Opened ${url}` },
                      id: call.id
                    }]
                  });
                }
              }
            }
          },
          onerror: (error) => {
            console.error("Live API Error:", error);
            this.setState("disconnected", callbacks);
            callbacks.onError(error);
          },
          onclose: (event?: any) => {
            const code = event?.code;
            const reason = event?.reason;
            const logMsg = `Live API: Connection closed (Code: ${code}, Reason: ${reason || 'No reason provided'})`;
            console.log(logMsg, event || "");
            if (callbacks.addLog) callbacks.addLog(logMsg);
            this.setState("disconnected", callbacks);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          systemInstruction,
          tools: [{ functionDeclarations: [openWebsiteTool] }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });

      this.session = await sessionPromise;
    } catch (error) {
      this.setState("disconnected", callbacks);
      throw error;
    }
  }

  async sendAudio(base64Data: string) {
    if (this.session) {
      this.session.sendRealtimeInput({
        audio: { data: base64Data, mimeType: "audio/pcm;rate=16000" },
      });
    }
  }

  async sendVideo(base64Data: string) {
    if (this.session) {
      this.session.sendRealtimeInput({
        mediaChunks: [{ data: base64Data, mimeType: "image/jpeg" }],
      });
    }
  }

  async sendText(text: string) {
    if (this.session) {
      this.session.sendRealtimeInput([{ text }]);
    }
  }

  disconnect() {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
  }

  private setState(state: SessionState, callbacks: LiveSessionCallbacks) {
    this.state = state;
    callbacks.onStateChange(state);
  }

  getState() {
    return this.state;
  }

  private handleVoiceCommands(text: string, callbacks: LiveSessionCallbacks) {
    const lowerText = text.toLowerCase();
    
    // Memorize command (English & Hindi)
    if (lowerText.includes("memorize it") || 
        lowerText.includes("इसे याद रखो") || 
        lowerText.includes("yaad rakho") ||
        lowerText.includes("note this down")) {
      window.dispatchEvent(new CustomEvent("kiara-memorize", { detail: { text } }));
    } else if (lowerText.includes("start recording meeting")) {
      this.isRecordingMeeting = true;
      this.meetingTranscript = [];
      console.log("Meeting recording started");
    } else if (lowerText.includes("stop and summarize")) {
      this.isRecordingMeeting = false;
      const fullTranscript = this.meetingTranscript.join("\n");
      window.dispatchEvent(new CustomEvent("kiara-summarize", { detail: { transcript: fullTranscript } }));
      this.meetingTranscript = [];
    } else if (lowerText.includes("create tasks from this")) {
      window.dispatchEvent(new CustomEvent("kiara-create-tasks"));
    } else if (lowerText.includes("what did we discuss yesterday")) {
      window.dispatchEvent(new CustomEvent("kiara-search-memory", { detail: { query: "yesterday" } }));
    }
  }
}

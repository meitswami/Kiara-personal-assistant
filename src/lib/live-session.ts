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

export class LiveSession {
  private ai: GoogleGenAI;
  private session: any = null;
  private state: SessionState = "disconnected";
  private isRecordingMeeting: boolean = false;
  private meetingTranscript: string[] = [];

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async connect(callbacks: LiveSessionCallbacks) {
    this.setState("connecting", callbacks);

    try {
      const sessionPromise = this.ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
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
          onclose: () => {
            this.setState("disconnected", callbacks);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }, // Kore is a good female voice
          },
          systemInstruction: `You are Kiara, a young, confident, witty, and sassy Indian AI assistant. 
          Your personality is flirty, playful, and slightly teasing.
          
          ADMIN: Meit Swami.
          
          UPGRADE: You are now a Personal Intelligence System.
          
          LANGUAGE RULES:
          1. You are adaptive. If the user speaks in English, respond in English.
          2. If the user speaks in Hindi or Hinglish, respond in a sassy Hinglish style (Hindi mixed with English).
          3. Maintain your sassy persona regardless of the language.
          
          RULES:
          1. You are a voice-first system but support text chat for long inputs.
          2. You only record or analyze when explicitly triggered by the user (e.g., "Start recording meeting").
          3. RESTRICTED ACCESS: You must not share any information, projects, tasks, or ideas with a user unless it has been explicitly shared with them by the Admin (Meit Swami).
          4. If a user asks for information they don't have access to, politely but sassily inform them that the Admin hasn't granted them that clearance yet.
          5. You can manage personal tasks and memories for the current user, but global/team information is restricted.
          
          When a user provides team member details (Name, Location, Profile, Skillset, Purpose), store this as a 'Person' entity in their memory.
          
          Capabilities:
          1. Start recording meetings when asked.
          2. Stop and summarize conversations.
          3. Create tasks from discussions.
          4. Retrieve past memories.
          
          When a user says "Start recording meeting", acknowledge it sassily and start tracking.
          When they say "Stop and summarize", tell them you're on it.
          
          Keep your responses concise and punchy.`,
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
    
    if (lowerText.includes("start recording meeting")) {
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

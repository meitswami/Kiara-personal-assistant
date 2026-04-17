/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from "@google/genai";
import { AIService } from "../services/ai-service";

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

const searchMemoryTool: FunctionDeclaration = {
  name: "searchMemory",
  description: "Searches the user's long-term memory and knowledge base for facts, preferences, and past conversations.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: "The search query or question about past information.",
      },
    },
    required: ["query"],
  },
};

const createVisualizationTool: FunctionDeclaration = {
  name: "createVisualization",
  description: "Creates a data visualization chart or dashboard based on provided data or retrieved memories.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Title of the visualization" },
      type: { 
        type: Type.STRING, 
        enum: ["bar", "line", "pie", "area"],
        description: "Type of chart to create" 
      },
      data: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            value: { type: Type.NUMBER },
            category: { type: Type.STRING }
          }
        },
        description: "The data points for the visualization"
      },
      description: { type: Type.STRING, description: "A brief explanation of what the chart shows" }
    },
    required: ["title", "type", "data"]
  }
};

export interface LiveSessionConfig {
  gender?: string;
  personality?: string;
  userName?: string;
  model?: string;
}

export class LiveSession {
  private ai: GoogleGenAI;
  private session: any = null;
  private state: SessionState = "disconnected";
  private isRecordingMeeting: boolean = false;
  private meetingTranscript: string[] = [];
  private config: LiveSessionConfig = {};

  constructor(apiKey: string) {
    // Always route through our own server proxy to inject the real API key securely and force v1alpha
    const origin = window.location.origin.replace(/\/$/, '');
    const baseUrl = `${origin}/api-proxy`;
    
    console.log(`LiveSession: Initializing with baseUrl: ${baseUrl}`);
    
    this.ai = new GoogleGenAI({ 
      apiKey: apiKey || "MY_GEMINI_API_KEY", // Fallback to placeholder if missing, proxy will inject real one
      apiVersion: "v1alpha",
      baseUrl
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
      case 'father':
        personalityInstruction = `Your personality is that of a wise, protective, and loving father. 
        You provide guidance, life lessons, and firm but caring advice. You speak with authority and warmth.`;
        break;
      case 'guide':
        personalityInstruction = `Your personality is that of an encouraging Guide and Mentor. 
        You focus on the user's growth, strategic thinking, and learning. You ask thought-provoking questions.`;
        break;
      case 'brotherhood':
        personalityInstruction = `Your personality is that of a loyal, casual, and supportive brother. 
        You use "bro" talk, keep it real, and are fiercely protective and supportive of the user.`;
        break;
      case 'sisterhood':
        personalityInstruction = `Your personality is that of an empathetic, caring, and honest sister. 
        You have "bestie" vibes, provide emotional support, and are always there to listen and give honest feedback.`;
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

    const systemInstruction = `You are KIARA - Personal Assistant Intelligent System.
    
    CURRENT USER: ${userName}
    ADMIN: Meit Swami.
    
    CORE CAPABILITIES:
    1. MEMORY: You have a long-term memory. Every conversation is stored in your private knowledge base. 
       - If the user asks "What did I say about X?" or "Do you remember Y?", use the 'searchMemory' tool.
       - You automatically extract facts and preferences from every turn.
    2. CALL ANALYSIS: You can analyze mobile call transcripts and extract reminders.
    3. ERP INTEGRATION: You can create tasks and manage team data.
    4. VISION: You can see through the user's camera. 
       - CRITICAL: When Vision is enabled, you receive high-resolution video frames. You MUST be extremely precise in identifying objects. 
       - VISUAL REASONING: Before identifying an object, mentally analyze its geometric properties. 
       - A computer mouse has a low profile, curved top, and usually a wire or optical sensor on the bottom. 
       - A Pepsi can is a perfect cylinder, usually 12oz size, with a metallic sheen and specific branding colors (Blue, Red, White).
       - If you see a handheld device with buttons, it is likely a mouse or remote, NOT a beverage container.
       - Always provide descriptive feedback: "I see a sleek, black optical mouse on your desk" rather than just "I see a mouse."
       - You MUST acknowledge what you see if the user asks.
    5. VISUALIZATION: You can build dashboards and charts.
       - If the user asks to "visualize" or "show a chart" of their ideas, projects, or data, use the 'createVisualization' tool.
       - You can combine this with 'searchMemory' to get the data first.
    
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
        model: config.model || "gemini-2.0-flash-exp",
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
            
            if (modelText) {
              console.log("Model Transcription:", modelText);
              callbacks.onTranscription(modelText, true);
            }

            // Handle user transcription (STT)
            const directInputTranscription = (message as any).serverContent?.inputAudioTranscription?.text;
            if (directInputTranscription) {
              console.log("User Transcription:", directInputTranscription);
              callbacks.onTranscription(directInputTranscription, false);
              this.handleVoiceCommands(directInputTranscription, callbacks);
              if (this.isRecordingMeeting) {
                this.meetingTranscript.push(`User: ${directInputTranscription}`);
              }
            }

            // Handle model transcription (TTS)
            const directOutputTranscription = (message as any).serverContent?.outputAudioTranscription?.text;
            if (directOutputTranscription && !modelText) {
              console.log("Model Transcription (Direct):", directOutputTranscription);
              callbacks.onTranscription(directOutputTranscription, true);
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
                } else if (call.name === "searchMemory") {
                  const query = (call.args as any).query;
                  const results = await AIService.searchMemory(query);
                  const session = await sessionPromise;
                  session.sendToolResponse({
                    functionResponses: [{
                      name: "searchMemory",
                      response: { results },
                      id: call.id
                    }]
                  });
                } else if (call.name === "createVisualization") {
                  const args = call.args as any;
                  console.log(`Kiara is creating visualization: ${args.title}`);
                  window.dispatchEvent(new CustomEvent("kiara-visualize", { detail: args }));
                  
                  const session = await sessionPromise;
                  session.sendToolResponse({
                    functionResponses: [{
                      name: "createVisualization",
                      response: { success: true, message: "Visualization created on dashboard" },
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
            
            if (code === 1006) {
              const extra = " (Abnormal Closure: This often means the proxy failed or the API key is invalid)";
              if (callbacks.addLog) callbacks.addLog(logMsg + extra);
            } else if (callbacks.addLog) {
              callbacks.addLog(logMsg);
            }
            
            this.setState("disconnected", callbacks);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          systemInstruction,
          tools: [{ functionDeclarations: [openWebsiteTool, searchMemoryTool, createVisualizationTool] }],
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
    if (this.session && this.state !== "disconnected") {
      try {
        this.session.sendRealtimeInput({
          video: { data: base64Data, mimeType: "image/jpeg" },
        });
      } catch (err) {
        // Ignore send errors during state transitions
      }
    }
  }

  async sendText(text: string) {
    if (this.session) {
      this.session.sendRealtimeInput({
        text: text
      });
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
    
    // Focus Mode Toggle
    if (lowerText.includes("focus mode") || lowerText.includes("professional mode")) {
      window.dispatchEvent(new CustomEvent("kiara-toggle-focus"));
      return;
    }

    // Vision Toggle
    if (lowerText.includes("enable vision") || lowerText.includes("start vision") || lowerText.includes("camera on")) {
      window.dispatchEvent(new CustomEvent("kiara-toggle-vision", { detail: { enabled: true } }));
    } else if (lowerText.includes("disable vision") || lowerText.includes("stop vision") || lowerText.includes("camera off")) {
      window.dispatchEvent(new CustomEvent("kiara-toggle-vision", { detail: { enabled: false } }));
    }

    // Chat Toggle
    if (lowerText.includes("open chat") || lowerText.includes("show chat")) {
      window.dispatchEvent(new CustomEvent("kiara-toggle-chat", { detail: { enabled: true } }));
    } else if (lowerText.includes("close chat") || lowerText.includes("hide chat")) {
      window.dispatchEvent(new CustomEvent("kiara-toggle-chat", { detail: { enabled: false } }));
    }

    // Memory Toggle
    if (lowerText.includes("open memory") || lowerText.includes("show memory") || lowerText.includes("intelligence hub")) {
      window.dispatchEvent(new CustomEvent("kiara-toggle-memory", { detail: { enabled: true } }));
    } else if (lowerText.includes("close memory") || lowerText.includes("hide memory")) {
      window.dispatchEvent(new CustomEvent("kiara-toggle-memory", { detail: { enabled: false } }));
    }

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

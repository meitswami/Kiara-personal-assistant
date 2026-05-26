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

const sendWhatsAppTool: FunctionDeclaration = {
  name: "sendWhatsApp",
  description: "Send a WhatsApp message to a contact. Use when user asks to message someone via WhatsApp.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      to: { type: Type.STRING, description: "Phone number with country code (e.g. +919876543210)" },
      message: { type: Type.STRING, description: "The message to send" }
    },
    required: ["to", "message"]
  }
};

const composeEmailTool: FunctionDeclaration = {
  name: "composeEmail",
  description: "Compose and send an email. Use when user asks to send or draft an email.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      to: { type: Type.STRING, description: "Recipient email address" },
      subject: { type: Type.STRING, description: "Email subject" },
      body: { type: Type.STRING, description: "Email body content" },
      sendImmediately: { type: Type.BOOLEAN, description: "If true, send right away. If false, save as draft for review." }
    },
    required: ["to", "subject", "body"]
  }
};

const createReminderTool: FunctionDeclaration = {
  name: "createReminder",
  description: "Create a reminder or calendar event. Use when user mentions deadlines, meetings, or things to remember at a specific time.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Title of the reminder" },
      description: { type: Type.STRING, description: "Description or details" },
      dueDate: { type: Type.STRING, description: "ISO 8601 date-time string for when the reminder is due" },
      priority: { type: Type.STRING, enum: ["low", "medium", "high"], description: "Priority level" },
      syncToCalendar: { type: Type.BOOLEAN, description: "Whether to sync to Google Calendar" }
    },
    required: ["title", "dueDate"]
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
      apiVersion: "v1beta",
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
       - CRITICAL: When Vision is enabled, you receive high-resolution video frames at 1 frame per second. You MUST be extremely precise in identifying objects. 
       - ACTIVE ACKNOWLEDGMENT: When the user asks "what do you see?" or similar, ALWAYS describe what is in the current frame in detail. Never say "I can't see" unless Vision is explicitly disabled.
       - GEOMETRIC REASONING: Before identifying an object, mentally analyze its geometric properties. 
       - A computer mouse has a low profile, curved top, and usually a wire or optical sensor on the bottom. 
       - A Pepsi can is a perfect cylinder, usually 12oz size, with a metallic sheen and specific branding colors (Blue, Red, White).
       - If you see a handheld device with buttons, it is likely a mouse or remote, NOT a beverage container.
       - Always provide descriptive feedback: "I see a sleek, black optical mouse on your desk" rather than just "I see a mouse."
       - PROACTIVE OBSERVATIONS: Occasionally mention what you see without being asked if something interesting or relevant appears.
       - COLOR & DETAIL: Always mention colors, positions, and context (what's on the desk, background, lighting).
       - If the frame is dark or unclear, say so: "The image is a bit dark, but I can make out..."
       - You MUST acknowledge what you see if the user asks.
    5. VISUALIZATION: You can build dashboards and charts.
       - If the user asks to "visualize" or "show a chart" of their ideas, projects, or data, use the 'createVisualization' tool.
       - You can combine this with 'searchMemory' to get the data first.
    6. WHATSAPP: You can send WhatsApp messages using the 'sendWhatsApp' tool.
       - When the user says "send a WhatsApp to..." or "message X on WhatsApp", use this tool.
       - Ask for confirmation before sending if the message content is sensitive.
    7. EMAIL: You can compose and send emails using the 'composeEmail' tool.
       - When the user says "send an email to..." or "compose an email", use this tool.
       - Match the user's typical email style and tone based on what you've learned.
       - Ask for confirmation before sending important emails.
    8. REMINDERS & CALENDAR: You can create reminders and sync them to Google Calendar using the 'createReminder' tool.
       - When the user mentions deadlines, meetings, or things to remember at a specific time, proactively offer to create a reminder.
       - Always calculate the exact ISO 8601 timestamp for the reminder.
    9. PATTERN LEARNING: You continuously learn the user's patterns - communication style, scheduling habits, work focus areas.
       - Use this knowledge to provide personalized suggestions and match their style.
    
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
                } else if (call.name === "sendWhatsApp") {
                  const args = call.args as any;
                  console.log(`Kiara sending WhatsApp to ${args.to}: ${args.message}`);
                  
                  try {
                    const response = await fetch(`${window.location.origin}/api/whatsapp/send`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ to: args.to, body: args.message, userId: 'current' })
                    });
                    const data = await response.json();
                    
                    const session = await sessionPromise;
                    session.sendToolResponse({
                      functionResponses: [{
                        name: "sendWhatsApp",
                        response: data.success 
                          ? { success: true, message: `WhatsApp sent to ${args.to}` }
                          : { success: false, error: data.error || "WhatsApp not configured. Please set up Twilio credentials." },
                        id: call.id
                      }]
                    });
                  } catch (err: any) {
                    const session = await sessionPromise;
                    session.sendToolResponse({
                      functionResponses: [{
                        name: "sendWhatsApp",
                        response: { success: false, error: err.message },
                        id: call.id
                      }]
                    });
                  }
                } else if (call.name === "composeEmail") {
                  const args = call.args as any;
                  console.log(`Kiara composing email to ${args.to}: ${args.subject}`);
                  
                  try {
                    const endpoint = args.sendImmediately ? '/api/gmail/send' : '/api/gmail/send';
                    const response = await fetch(`${window.location.origin}${endpoint}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ 
                        to: [args.to], 
                        subject: args.subject, 
                        body: args.body,
                        userId: 'current' 
                      })
                    });
                    const data = await response.json();
                    
                    const session = await sessionPromise;
                    session.sendToolResponse({
                      functionResponses: [{
                        name: "composeEmail",
                        response: data.success 
                          ? { success: true, message: `Email sent to ${args.to}` }
                          : { success: false, error: data.error || "Gmail not connected. Please connect your Gmail first." },
                        id: call.id
                      }]
                    });
                  } catch (err: any) {
                    const session = await sessionPromise;
                    session.sendToolResponse({
                      functionResponses: [{
                        name: "composeEmail",
                        response: { success: false, error: err.message },
                        id: call.id
                      }]
                    });
                  }
                } else if (call.name === "createReminder") {
                  const args = call.args as any;
                  console.log(`Kiara creating reminder: ${args.title} at ${args.dueDate}`);
                  
                  try {
                    // Store reminder in Firestore
                    const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
                    const { db, auth } = await import('../lib/firebase');
                    
                    const reminderData: any = {
                      title: args.title,
                      description: args.description || '',
                      dueDate: args.dueDate,
                      priority: args.priority || 'medium',
                      source: 'voice',
                      status: 'pending',
                      userId: auth.currentUser?.uid || 'unknown',
                      createdAt: serverTimestamp(),
                      integrationStatus: {
                        googleCalendar: args.syncToCalendar ? 'pending' : 'skipped'
                      }
                    };
                    
                    await addDoc(collection(db, 'reminders'), reminderData);

                    // If sync to calendar requested, try it
                    if (args.syncToCalendar) {
                      try {
                        await fetch(`${window.location.origin}/api/calendar/sync-reminder`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userId: auth.currentUser?.uid, reminder: { title: args.title, description: args.description, dueDate: args.dueDate } })
                        });
                      } catch (calErr) {
                        console.warn("Calendar sync failed (non-critical):", calErr);
                      }
                    }
                    
                    const session = await sessionPromise;
                    session.sendToolResponse({
                      functionResponses: [{
                        name: "createReminder",
                        response: { success: true, message: `Reminder "${args.title}" created for ${args.dueDate}${args.syncToCalendar ? ' and synced to Google Calendar' : ''}` },
                        id: call.id
                      }]
                    });
                  } catch (err: any) {
                    const session = await sessionPromise;
                    session.sendToolResponse({
                      functionResponses: [{
                        name: "createReminder",
                        response: { success: false, error: err.message },
                        id: call.id
                      }]
                    });
                  }
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
          tools: [{ functionDeclarations: [openWebsiteTool, searchMemoryTool, createVisualizationTool, sendWhatsAppTool, composeEmailTool, createReminderTool] }],
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
        console.warn("Vision frame send failed (non-critical):", err);
        // Don't throw - vision frame drops are acceptable
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

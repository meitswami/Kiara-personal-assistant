/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from "@google/genai";
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  serverTimestamp, 
  orderBy,
  limit,
  getDocFromServer,
  doc,
  updateDoc,
  setDoc
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

export interface ConversationAnalysis {
  topic: string;
  intent: "business" | "technical" | "casual" | "opportunity";
  entities: string[];
  actionItems: string[];
  opportunityScore: number;
  summary: string;
}

export interface MemoryItem {
  type: "meeting" | "idea" | "task" | "note";
  content: string;
  entities: Record<string, any>;
  actionItems: string[];
  priority: "low" | "medium" | "high";
  createdAt: any;
  userId: string;
  embedding?: number[];
}

export class AIService {
  private static ai = new GoogleGenAI({ 
    apiKey: process.env.GEMINI_API_KEY!,
    apiVersion: "v1alpha",
    // Always use the proxy to ensure v1alpha is forced and API keys are injected correctly
    baseUrl: `${window.location.origin.replace(/\/$/, '')}/api-proxy`
  } as any);

  private static isOnline() {
    return typeof navigator !== 'undefined' && navigator.onLine;
  }

  private static getLocalCacheKey() {
    return `kiara_memory_cache_${auth.currentUser?.uid}`;
  }

  private static getPendingSyncKey() {
    return `kiara_pending_sync_${auth.currentUser?.uid}`;
  }

  private static getLocalCache(): any[] {
    const data = localStorage.getItem(this.getLocalCacheKey());
    return data ? JSON.parse(data) : [];
  }

  private static setLocalCache(memories: any[]) {
    localStorage.setItem(this.getLocalCacheKey(), JSON.stringify(memories));
  }

  private static getPendingSync(): any[] {
    const data = localStorage.getItem(this.getPendingSyncKey());
    return data ? JSON.parse(data) : [];
  }

  private static setPendingSync(pending: any[]) {
    localStorage.setItem(this.getPendingSyncKey(), JSON.stringify(pending));
  }

  static async syncOfflineData(): Promise<void> {
    if (!this.isOnline() || !auth.currentUser) return;

    const pending = this.getPendingSync();
    if (pending.length === 0) return;

    console.log(`Syncing ${pending.length} offline memories...`);
    
    for (const item of pending) {
      try {
        if (item.action === 'store') {
          await this.storeMemory(item.data);
        } else if (item.action === 'memorize') {
          await this.memorizeStructured(item.data.text);
        }
      } catch (err) {
        console.error("Failed to sync item:", err);
      }
    }

    this.setPendingSync([]);
    console.log("Offline sync complete.");
  }

  static async analyzeConversation(transcript: string): Promise<ConversationAnalysis> {
    if (!this.isOnline()) {
      throw new Error("Cannot analyze conversation while offline. Analysis will resume when online.");
    }
    const response = await this.ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `Analyze this conversation transcript and extract insights in JSON format.
      Transcript: ${transcript}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            topic: { type: Type.STRING },
            intent: { type: Type.STRING, enum: ["business", "technical", "casual", "opportunity"] },
            entities: { type: Type.ARRAY, items: { type: Type.STRING } },
            actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
            opportunityScore: { type: Type.NUMBER },
            summary: { type: Type.STRING },
          },
          required: ["topic", "intent", "entities", "actionItems", "opportunityScore", "summary"],
        },
      },
    });

    return JSON.parse(response.text);
  }

  static async storeMemory(memory: Omit<MemoryItem, 'userId' | 'createdAt'>): Promise<void> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    if (!this.isOnline()) {
      const pending = this.getPendingSync();
      pending.push({ action: 'store', data: memory, timestamp: Date.now() });
      this.setPendingSync(pending);
      
      // Also update local cache for immediate search
      const cache = this.getLocalCache();
      cache.unshift({ ...memory, id: `temp_${Date.now()}`, createdAt: { toDate: () => new Date() } });
      this.setLocalCache(cache.slice(0, 100));
      return;
    }

    let embedding: number[] | undefined;
    
    if (this.isOnline() && memory.content && memory.content.trim() !== "") {
      try {
        // Generate embedding for semantic search
        const embedResult = await this.ai.models.embedContent({
          model: "text-embedding-004",
          contents: [memory.content],
        });
        embedding = embedResult.embeddings[0].values;
      } catch (err) {
        console.warn("Failed to generate embedding while offline/error:", err);
      }
    }

    await addDoc(collection(db, 'memories'), {
      ...memory,
      embedding: embedding || [],
      userId: auth.currentUser.uid,
      createdAt: serverTimestamp(),
    });
  }

  static async saveMessage(id: string, text: string, sender: 'user' | 'kiara'): Promise<void> {
    if (!auth.currentUser) return;
    
    await setDoc(doc(db, 'messages', id), {
      text,
      sender,
      userId: auth.currentUser.uid,
      timestamp: serverTimestamp(),
      isAnalyzed: false
    });
  }

  static async extractKnowledgeFromRecent(): Promise<void> {
    if (!auth.currentUser || !this.isOnline()) return;

    // Fetch last 10 unanalyzed messages
    const q = query(
      collection(db, 'messages'),
      where('userId', '==', auth.currentUser.uid),
      where('isAnalyzed', '==', false),
      orderBy('timestamp', 'desc'),
      limit(10)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return;

    const transcript = snapshot.docs
      .map(d => `${d.data().sender}: ${d.data().text}`)
      .reverse()
      .join('\n');

    const response = await this.ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `Extract any new facts, preferences, or important information from this conversation to store in long-term memory. 
      If there is nothing important, return an empty array for 'memories'.
      Transcript:
      ${transcript}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            memories: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  content: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ["meeting", "idea", "task", "note", "personal"] },
                  priority: { type: Type.STRING, enum: ["low", "medium", "high"] },
                  structuredData: { type: Type.OBJECT }
                },
                required: ["content", "type", "priority", "structuredData"]
              }
            }
          },
          required: ["memories"]
        }
      }
    });

    const { memories } = JSON.parse(response.text);
    
    for (const memory of memories) {
      // Generate embedding for each new memory
      const embedResult = await this.ai.models.embedContent({
        model: "text-embedding-004",
        contents: [memory.content],
      });
      const embedding = embedResult.embeddings[0].values;

      await addDoc(collection(db, 'memories'), {
        ...memory,
        rawText: transcript,
        embedding,
        userId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
      });
    }

    // Mark messages as analyzed
    const batch = snapshot.docs.map(d => updateDoc(d.ref, { isAnalyzed: true }));
    await Promise.all(batch);
  }

  static async searchMemory(textQuery: string): Promise<MemoryItem[]> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    let memories: any[] = [];

    if (this.isOnline()) {
      try {
        // Fetch user's memories
        const q = query(
          collection(db, 'memories'),
          where('userId', '==', auth.currentUser.uid),
          orderBy('createdAt', 'desc'),
          limit(100)
        );
        const querySnapshot = await getDocs(q);
        
        querySnapshot.forEach((doc) => {
          memories.push({ id: doc.id, ...doc.data() });
        });

        // Update local cache
        this.setLocalCache(memories);
      } catch (err) {
        console.warn("Failed to fetch memories from server, falling back to cache:", err);
        memories = this.getLocalCache();
      }
    } else {
      memories = this.getLocalCache();
    }
    
    if (!textQuery || textQuery.trim() === "") {
      return memories.slice(0, 10);
    }

    // If offline and searching, we can only do simple text matching if we don't have embeddings locally
    // or if we can't generate a new query embedding.
    if (!this.isOnline()) {
      const lowerQuery = textQuery.toLowerCase();
      return memories
        .filter(m => m.content.toLowerCase().includes(lowerQuery))
        .slice(0, 5);
    }

    // Get embedding for the query
    const embedResult = await this.ai.models.embedContent({
      model: "text-embedding-004",
      contents: [textQuery],
    });
    const queryEmbedding = embedResult.embeddings[0].values;

    // Semantic search (cosine similarity)
    const results = memories.map(m => {
      const similarity = this.cosineSimilarity(queryEmbedding, m.embedding || []);
      return { ...m, similarity };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

    return results;
  }

  static async generateTasks(analysis: ConversationAnalysis): Promise<void> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    const response = await this.ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `Based on this conversation analysis, generate a list of prioritized tasks in JSON format.
      Analysis: ${JSON.stringify(analysis)}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              priority: { type: Type.STRING, enum: ["low", "medium", "high"] },
              dueDate: { type: Type.STRING },
              description: { type: Type.STRING },
            },
            required: ["title", "priority", "description"],
          },
        },
      },
    });

    const tasks = JSON.parse(response.text);
    for (const task of tasks) {
      await addDoc(collection(db, 'tasks'), {
        ...task,
        status: 'pending',
        userId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
      });
    }
  }

  static async generateIdeas(memories: MemoryItem[]): Promise<any[]> {
    const response = await this.ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `Analyze these stored memories and generate 3 innovative project ideas or business opportunities.
      Memories: ${JSON.stringify(memories)}
      Identify missing skills or resources based on these ideas.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            ideas: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  opportunity: { type: Type.STRING },
                  missingSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["title", "description", "opportunity", "missingSkills"],
              },
            },
          },
          required: ["ideas"],
        },
      },
    });

    const data = JSON.parse(response.text);
    return data.ideas;
  }

  private static cosineSimilarity(vecA: number[], vecB: number[]) {
    if (vecA.length === 0 || vecB.length === 0) return 0;
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * (vecB[i] || 0), 0);
    const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dotProduct / (magA * magB);
  }

  static async memorizeStructured(text: string): Promise<void> {
    if (!auth.currentUser) throw new Error("User not authenticated");
    
    if (!this.isOnline()) {
      const pending = this.getPendingSync();
      pending.push({ action: 'memorize', data: { text }, timestamp: Date.now() });
      this.setPendingSync(pending);
      
      // Add a simple note to cache
      const cache = this.getLocalCache();
      cache.unshift({ 
        content: text, 
        type: 'note', 
        priority: 'medium', 
        id: `temp_${Date.now()}`, 
        createdAt: { toDate: () => new Date() } 
      });
      this.setLocalCache(cache.slice(0, 100));
      return;
    }

    const response = await this.ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `Extract the core information from this request to memorize it. 
      Provide a concise content summary and a structured JSON representation of the key facts.
      Text: "${text}"`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            content: { type: Type.STRING },
            structuredData: { type: Type.OBJECT },
            type: { type: Type.STRING, enum: ["meeting", "idea", "task", "note", "personal"] },
            priority: { type: Type.STRING, enum: ["low", "medium", "high"] },
          },
          required: ["content", "structuredData", "type", "priority"],
        },
      },
    });

    const data = JSON.parse(response.text);
    
    // Generate embedding
    const embedResult = await this.ai.models.embedContent({
      model: "text-embedding-004",
      contents: [data.content],
    });
    const embedding = embedResult.embeddings[0].values;

    await addDoc(collection(db, 'memories'), {
      ...data,
      rawText: text,
      embedding,
      userId: auth.currentUser.uid,
      createdAt: serverTimestamp(),
    });
  }

  static async analyzeCall(phoneNumber: string, transcript: string): Promise<any> {
    if (!auth.currentUser) throw new Error("User not authenticated");
    if (!this.isOnline()) {
      throw new Error("Cannot analyze call while offline. Please try again when online.");
    }

    const now = new Date().toISOString();
    const response = await this.ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `Analyze this call transcript from ${phoneNumber}. 
      Current Time: ${now}
      Extract a summary, the context/intent, and any actionable reminders or calendar events.
      For each reminder, extract the precise due date and time. 
      If the transcript says "tomorrow at 3pm", calculate the exact ISO 8601 timestamp based on the current time.
      
      Transcript: ${transcript}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            context: { type: Type.STRING },
            reminders: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  dueDate: { type: Type.STRING, description: "ISO 8601 format (e.g., 2026-04-12T15:00:00Z)" },
                  type: { type: Type.STRING, enum: ["reminder", "calendar_event", "alert"] },
                  priority: { type: Type.STRING, enum: ["low", "medium", "high"] }
                },
                required: ["title", "dueDate", "type", "priority"],
              },
            },
          },
          required: ["summary", "context", "reminders"],
        },
      },
    });

    const analysis = JSON.parse(response.text);
    
    // Store Call Log
    const logRef = await addDoc(collection(db, 'callLogs'), {
      phoneNumber,
      transcript,
      summary: analysis.summary,
      context: analysis.context,
      timestamp: serverTimestamp(),
      userId: auth.currentUser.uid,
      remindersExtracted: analysis.reminders.map((r: any) => r.title)
    });

    // Store Reminders/Calendar Events
    for (const reminder of analysis.reminders) {
      await addDoc(collection(db, 'reminders'), {
        ...reminder,
        source: 'call',
        sourceId: logRef.id,
        status: 'pending',
        userId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
        // Metadata for external integrations
        integrationStatus: {
          googleCalendar: 'pending',
          gmail: 'pending',
          msTeams: 'pending'
        }
      });
    }

    return { ...analysis, callLogId: logRef.id };
  }

  static async testConnection() {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.error("Please check your Firebase configuration.");
      }
    }
  }
}

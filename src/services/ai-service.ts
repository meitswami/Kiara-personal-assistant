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
  doc
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
    // Use any cast to avoid lint errors with custom baseUrl
    ...(process.env.NODE_ENV === 'production' ? { baseUrl: `${window.location.origin.replace(/\/$/, '')}/api-proxy` } : {})
  } as any);

  static async analyzeConversation(transcript: string): Promise<ConversationAnalysis> {
    const response = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
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

    let embedding: number[] | undefined;
    
    if (memory.content && memory.content.trim() !== "") {
      // Generate embedding for semantic search
      const embedResult = await this.ai.models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: [memory.content],
      });
      embedding = embedResult.embeddings[0].values;
    }

    await addDoc(collection(db, 'memories'), {
      ...memory,
      embedding: embedding || [],
      userId: auth.currentUser.uid,
      createdAt: serverTimestamp(),
    });
  }

  static async searchMemory(textQuery: string): Promise<MemoryItem[]> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    // Fetch user's memories
    const q = query(
      collection(db, 'memories'),
      where('userId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const querySnapshot = await getDocs(q);
    
    const memories: any[] = [];
    querySnapshot.forEach((doc) => {
      memories.push({ id: doc.id, ...doc.data() });
    });

    if (!textQuery || textQuery.trim() === "") {
      return memories.slice(0, 5);
    }

    // Get embedding for the query
    const embedResult = await this.ai.models.embedContent({
      model: "gemini-embedding-2-preview",
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
      model: "gemini-3-flash-preview",
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
      model: "gemini-3-flash-preview",
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

    const response = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
      model: "gemini-embedding-2-preview",
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

    const response = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze this call transcript from ${phoneNumber}. 
      Extract a summary, the context/intent, and any actionable reminders or calendar events.
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
                  dueDate: { type: Type.STRING, description: "ISO 8601 format" },
                },
                required: ["title", "dueDate"],
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

    // Store Reminders
    for (const reminder of analysis.reminders) {
      await addDoc(collection(db, 'reminders'), {
        ...reminder,
        source: 'call',
        sourceId: logRef.id,
        status: 'pending',
        userId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
      });
    }

    return analysis;
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

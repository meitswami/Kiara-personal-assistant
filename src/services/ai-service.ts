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
  private static ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

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

    // Generate embedding for semantic search
    const embedResult = await this.ai.models.embedContent({
      model: "gemini-embedding-2-preview",
      contents: [memory.content],
    });
    const embedding = embedResult.embeddings[0].values;

    await addDoc(collection(db, 'memories'), {
      ...memory,
      embedding,
      userId: auth.currentUser.uid,
      createdAt: serverTimestamp(),
    });
  }

  static async searchMemory(textQuery: string): Promise<MemoryItem[]> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    // Get embedding for the query
    const embedResult = await this.ai.models.embedContent({
      model: "gemini-embedding-2-preview",
      contents: [textQuery],
    });
    const queryEmbedding = embedResult.embeddings[0].values;

    // Fetch user's memories
    const q = query(
      collection(db, 'memories'),
      where('userId', '==', auth.currentUser.uid),
      limit(50)
    );
    const querySnapshot = await getDocs(q);
    
    const memories: any[] = [];
    querySnapshot.forEach((doc) => {
      memories.push({ id: doc.id, ...doc.data() });
    });

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

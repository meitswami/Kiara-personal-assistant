/**
 * Pattern Learning Engine for Kiara
 * Continuously learns user's communication style, habits, preferences, 
 * scheduling patterns, and behavioral trends over time.
 * Uses Gemini for deep pattern analysis and Firestore for persistence.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { db, auth } from '../lib/firebase';
import { 
  collection, addDoc, doc, setDoc, getDoc, getDocs, 
  query, where, orderBy, limit, serverTimestamp, updateDoc 
} from 'firebase/firestore';

export interface UserPattern {
  // Communication style
  communicationStyle: {
    tone: 'formal' | 'casual' | 'mixed' | 'professional';
    verbosity: 'concise' | 'detailed' | 'moderate';
    preferredLanguage: string;
    usesEmojis: boolean;
    commonPhrases: string[];
    greetingStyle: string;
    signoffStyle: string;
  };

  // Scheduling habits
  schedulingPatterns: {
    peakProductivityHours: number[]; // 0-23
    preferredMeetingDays: string[];
    averageResponseTime: number; // minutes
    typicalMeetingDuration: number; // minutes
    breakPatterns: string;
  };

  // Work patterns
  workPatterns: {
    topTopics: string[];
    projectFocusAreas: string[];
    decisionMakingStyle: string;
    delegationPreferences: string;
    prioritizationMethod: string;
  };

  // Behavioral traits
  behavioralTraits: {
    moodPatterns: string[];
    stressTriggers: string[];
    motivationFactors: string[];
    learningStyle: string;
    responseToFeedback: string;
  };

  // Relationship patterns
  relationships: {
    frequentContacts: Array<{ name: string; relationship: string; interactionFrequency: string }>;
    communicationPreferences: Record<string, string>; // contact -> preferred channel
  };

  // Meta
  lastUpdated: any;
  totalInteractionsAnalyzed: number;
  confidenceScore: number; // 0-1, how confident we are in these patterns
}

export interface LearningEvent {
  type: 'conversation' | 'email' | 'whatsapp' | 'calendar' | 'task' | 'memory';
  content: string;
  context?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

class PatternLearningService {
  private static ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!,
    apiVersion: "v1beta",
    baseUrl: `${window.location.origin.replace(/\/$/, '')}/api-proxy`
  } as any);

  private learningQueue: LearningEvent[] = [];
  private isProcessing: boolean = false;
  private processInterval: number | null = null;

  constructor() {
    // Process learning queue every 2 minutes
    this.processInterval = window.setInterval(() => {
      this.processQueue();
    }, 120000);

    // Also process when online status changes
    window.addEventListener('online', () => this.processQueue());
  }

  /**
   * Add a learning event to the queue
   * This is called by other services whenever the user does something
   */
  addLearningEvent(event: LearningEvent): void {
    this.learningQueue.push(event);
    
    // Auto-process if queue gets large
    if (this.learningQueue.length >= 10) {
      this.processQueue();
    }
  }

  /**
   * Track a conversation for pattern learning
   */
  trackConversation(text: string, sender: 'user' | 'kiara'): void {
    if (sender === 'user') {
      this.addLearningEvent({
        type: 'conversation',
        content: text,
        timestamp: new Date(),
        metadata: { sender }
      });
    }
  }

  /**
   * Track an email interaction
   */
  trackEmail(subject: string, body: string, direction: 'sent' | 'received'): void {
    this.addLearningEvent({
      type: 'email',
      content: `Subject: ${subject}\n${body.substring(0, 500)}`,
      context: direction,
      timestamp: new Date()
    });
  }

  /**
   * Track a WhatsApp interaction
   */
  trackWhatsApp(message: string, direction: 'sent' | 'received', contact: string): void {
    this.addLearningEvent({
      type: 'whatsapp',
      content: message,
      context: `${direction} - ${contact}`,
      timestamp: new Date()
    });
  }

  /**
   * Track a calendar/scheduling action
   */
  trackScheduling(action: string, details: string): void {
    this.addLearningEvent({
      type: 'calendar',
      content: `${action}: ${details}`,
      timestamp: new Date()
    });
  }

  /**
   * Process the learning queue - analyze accumulated events and update patterns
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.learningQueue.length === 0 || !auth.currentUser) return;
    if (!navigator.onLine) return;

    this.isProcessing = true;
    const eventsToProcess = [...this.learningQueue];
    this.learningQueue = [];

    try {
      // Get existing patterns
      const existingPatterns = await this.getPatterns();

      // Prepare learning data
      const learningData = eventsToProcess.map(e => ({
        type: e.type,
        content: e.content.substring(0, 200), // Limit content size
        context: e.context,
        time: e.timestamp.toISOString(),
        hour: e.timestamp.getHours()
      }));

      // Use AI to extract new patterns from recent events
      const response = await PatternLearningService.ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: `You are a behavioral pattern analyzer. Analyze these recent user interactions and extract/update behavioral patterns.

EXISTING PATTERNS (if any):
${existingPatterns ? JSON.stringify(existingPatterns, null, 2) : 'No existing patterns yet.'}

NEW INTERACTIONS TO ANALYZE:
${JSON.stringify(learningData)}

Instructions:
1. Identify communication style patterns (tone, verbosity, language preferences)
2. Detect scheduling habits (active hours, response patterns)
3. Note behavioral traits (mood indicators, decision-making style)
4. Track relationship patterns (who they talk to most, how they address people)
5. Identify work focus areas and priorities
6. MERGE with existing patterns (don't overwrite - evolve them)

Return ONLY the updated patterns.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              communicationStyle: {
                type: Type.OBJECT,
                properties: {
                  tone: { type: Type.STRING, enum: ['formal', 'casual', 'mixed', 'professional'] },
                  verbosity: { type: Type.STRING, enum: ['concise', 'detailed', 'moderate'] },
                  preferredLanguage: { type: Type.STRING },
                  usesEmojis: { type: Type.BOOLEAN },
                  commonPhrases: { type: Type.ARRAY, items: { type: Type.STRING } },
                  greetingStyle: { type: Type.STRING },
                  signoffStyle: { type: Type.STRING }
                }
              },
              schedulingPatterns: {
                type: Type.OBJECT,
                properties: {
                  peakProductivityHours: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                  preferredMeetingDays: { type: Type.ARRAY, items: { type: Type.STRING } },
                  averageResponseTime: { type: Type.NUMBER },
                  typicalMeetingDuration: { type: Type.NUMBER },
                  breakPatterns: { type: Type.STRING }
                }
              },
              workPatterns: {
                type: Type.OBJECT,
                properties: {
                  topTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
                  projectFocusAreas: { type: Type.ARRAY, items: { type: Type.STRING } },
                  decisionMakingStyle: { type: Type.STRING },
                  delegationPreferences: { type: Type.STRING },
                  prioritizationMethod: { type: Type.STRING }
                }
              },
              behavioralTraits: {
                type: Type.OBJECT,
                properties: {
                  moodPatterns: { type: Type.ARRAY, items: { type: Type.STRING } },
                  stressTriggers: { type: Type.ARRAY, items: { type: Type.STRING } },
                  motivationFactors: { type: Type.ARRAY, items: { type: Type.STRING } },
                  learningStyle: { type: Type.STRING },
                  responseToFeedback: { type: Type.STRING }
                }
              },
              newInsights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Any new insights discovered from this batch of interactions"
              }
            },
            required: ["communicationStyle", "schedulingPatterns", "workPatterns", "behavioralTraits"]
          }
        }
      });

      const updatedPatterns = JSON.parse(response.text);
      const { newInsights, ...patterns } = updatedPatterns;

      // Store updated patterns
      await setDoc(doc(db, 'user_patterns', auth.currentUser.uid), {
        ...patterns,
        userId: auth.currentUser.uid,
        totalInteractionsAnalyzed: (existingPatterns?.totalInteractionsAnalyzed || 0) + eventsToProcess.length,
        confidenceScore: Math.min(1, ((existingPatterns?.confidenceScore || 0) + 0.02)),
        lastUpdated: serverTimestamp()
      }, { merge: true });

      // Store new insights as memories
      if (newInsights && newInsights.length > 0) {
        for (const insight of newInsights) {
          await addDoc(collection(db, 'pattern_insights'), {
            insight,
            userId: auth.currentUser.uid,
            eventsAnalyzed: eventsToProcess.length,
            createdAt: serverTimestamp()
          });
        }
      }

      console.log(`Pattern Learning: Processed ${eventsToProcess.length} events, ${newInsights?.length || 0} new insights`);
    } catch (error) {
      console.error("Pattern learning processing failed:", error);
      // Put events back in queue for retry
      this.learningQueue = [...eventsToProcess, ...this.learningQueue];
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get current learned patterns for the user
   */
  async getPatterns(): Promise<UserPattern | null> {
    if (!auth.currentUser) return null;

    try {
      const docRef = doc(db, 'user_patterns', auth.currentUser.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as UserPattern;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get pattern insights (recent discoveries about the user)
   */
  async getInsights(maxResults: number = 10): Promise<string[]> {
    if (!auth.currentUser) return [];

    try {
      const q = query(
        collection(db, 'pattern_insights'),
        where('userId', '==', auth.currentUser.uid),
        orderBy('createdAt', 'desc'),
        limit(maxResults)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => d.data().insight);
    } catch {
      return [];
    }
  }

  /**
   * Generate a daily summary of the user's patterns
   */
  async getDailySummary(): Promise<string> {
    const patterns = await this.getPatterns();
    if (!patterns) return "I'm still learning about you. Keep talking to me!";

    try {
      const response = await PatternLearningService.ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: `Based on these learned user patterns, generate a brief, friendly daily insight/tip.

Patterns: ${JSON.stringify(patterns)}

Make it personal, useful, and concise (2-3 sentences max). 
Example: "Based on your patterns, you're most productive between 9-11 AM. Want me to block those hours for deep work today?"
`
      });

      return response.text || "I'm still learning your patterns!";
    } catch {
      return "I'm still learning your patterns!";
    }
  }

  /**
   * Get personalized suggestions based on patterns
   */
  async getSuggestions(context: string): Promise<string[]> {
    const patterns = await this.getPatterns();
    if (!patterns) return [];

    try {
      const response = await PatternLearningService.ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: `Based on these user patterns, suggest 3 actionable items for the given context.

Patterns: ${JSON.stringify(patterns)}
Context: ${context}

Return a JSON array of 3 suggestion strings.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        }
      });

      return JSON.parse(response.text);
    } catch {
      return [];
    }
  }

  /**
   * Force pattern analysis (e.g., when user explicitly asks)
   */
  async forceAnalysis(): Promise<void> {
    await this.processQueue();
  }

  /**
   * Clean up on destroy
   */
  destroy(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
    }
  }
}

// Singleton instance
export const patternLearningService = new PatternLearningService();

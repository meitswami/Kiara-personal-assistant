/**
 * Gmail Integration Service for Kiara
 * Uses Google Gmail API via OAuth2 for reading, composing, and analyzing emails
 * Server-side handles OAuth flow and token management
 */

import { db, auth } from '../lib/firebase';
import { collection, addDoc, query, where, orderBy, limit, getDocs, doc, setDoc, serverTimestamp } from 'firebase/firestore';

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  snippet: string;
  date: string;
  isRead: boolean;
  labels: string[];
  hasAttachments: boolean;
}

export interface EmailDraft {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  replyToId?: string;
}

export interface EmailPattern {
  userId: string;
  commonGreetings: string[];
  commonSignoffs: string[];
  averageResponseTime: number; // minutes
  toneProfile: 'formal' | 'casual' | 'mixed';
  frequentRecipients: Array<{ email: string; name: string; frequency: number }>;
  peakHours: number[]; // hours of day when user typically sends emails
  subjectPatterns: string[];
  lastAnalyzed: any;
}

class GmailService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${window.location.origin}/api/gmail`;
  }

  /**
   * Check if Gmail is connected (OAuth token exists)
   */
  async isConnected(): Promise<boolean> {
    if (!auth.currentUser) return false;

    try {
      const response = await fetch(`${this.baseUrl}/status?userId=${auth.currentUser.uid}`);
      const data = await response.json();
      return data.connected;
    } catch {
      return false;
    }
  }

  /**
   * Get the OAuth2 authorization URL to connect Gmail
   */
  async getAuthUrl(): Promise<string> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    const response = await fetch(`${this.baseUrl}/auth-url?userId=${auth.currentUser.uid}`);
    const data = await response.json();
    return data.url;
  }

  /**
   * Connect Gmail by initiating OAuth flow
   */
  async connect(): Promise<void> {
    const url = await this.getAuthUrl();
    // Open OAuth consent screen in a popup
    const popup = window.open(url, 'gmail-auth', 'width=500,height=700,left=200,top=100');
    
    // Listen for the popup to close (callback will handle token storage)
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });
  }

  /**
   * Disconnect Gmail (revoke tokens)
   */
  async disconnect(): Promise<void> {
    if (!auth.currentUser) return;

    await fetch(`${this.baseUrl}/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: auth.currentUser.uid })
    });
  }

  /**
   * Fetch recent emails from inbox
   */
  async getInbox(maxResults: number = 20, pageToken?: string): Promise<{ emails: EmailMessage[]; nextPageToken?: string }> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    try {
      const params = new URLSearchParams({
        userId: auth.currentUser.uid,
        maxResults: maxResults.toString()
      });
      if (pageToken) params.append('pageToken', pageToken);

      const response = await fetch(`${this.baseUrl}/inbox?${params}`);
      const data = await response.json();

      if (!data.success) throw new Error(data.error);
      return { emails: data.emails, nextPageToken: data.nextPageToken };
    } catch (error: any) {
      console.error("Failed to fetch inbox:", error);
      return { emails: [] };
    }
  }

  /**
   * Get a specific email by ID
   */
  async getEmail(emailId: string): Promise<EmailMessage | null> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    try {
      const response = await fetch(`${this.baseUrl}/message/${emailId}?userId=${auth.currentUser.uid}`);
      const data = await response.json();
      return data.success ? data.email : null;
    } catch (error) {
      console.error("Failed to fetch email:", error);
      return null;
    }
  }

  /**
   * Send an email
   */
  async sendEmail(draft: EmailDraft): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    try {
      const response = await fetch(`${this.baseUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          userId: auth.currentUser.uid
        })
      });

      const data = await response.json();

      if (data.success) {
        // Log sent email
        await addDoc(collection(db, 'email_logs'), {
          userId: auth.currentUser.uid,
          to: draft.to,
          subject: draft.subject,
          direction: 'outgoing',
          timestamp: serverTimestamp(),
          gmailMessageId: data.messageId
        });
      }

      return data;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate an AI-composed email based on instructions
   */
  async composeWithAI(instructions: string, replyTo?: EmailMessage): Promise<EmailDraft> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    try {
      const response = await fetch(`${this.baseUrl}/compose-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          instructions,
          replyTo: replyTo ? {
            from: replyTo.from,
            subject: replyTo.subject,
            body: replyTo.body,
            date: replyTo.date
          } : null
        })
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      return data.draft;
    } catch (error: any) {
      throw new Error(`AI compose failed: ${error.message}`);
    }
  }

  /**
   * Search emails
   */
  async searchEmails(query: string, maxResults: number = 10): Promise<EmailMessage[]> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    try {
      const params = new URLSearchParams({
        userId: auth.currentUser.uid,
        q: query,
        maxResults: maxResults.toString()
      });

      const response = await fetch(`${this.baseUrl}/search?${params}`);
      const data = await response.json();
      return data.success ? data.emails : [];
    } catch (error) {
      console.error("Email search failed:", error);
      return [];
    }
  }

  /**
   * Analyze email patterns for the user
   */
  async analyzePatterns(): Promise<EmailPattern | null> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    try {
      const response = await fetch(`${this.baseUrl}/analyze-patterns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: auth.currentUser.uid })
      });

      const data = await response.json();
      if (data.success) {
        // Store patterns locally for quick access
        await setDoc(doc(db, 'email_patterns', auth.currentUser.uid), {
          ...data.patterns,
          userId: auth.currentUser.uid,
          lastAnalyzed: serverTimestamp()
        }, { merge: true });

        return data.patterns;
      }
      return null;
    } catch (error) {
      console.error("Pattern analysis failed:", error);
      return null;
    }
  }

  /**
   * Get stored email patterns
   */
  async getPatterns(): Promise<EmailPattern | null> {
    if (!auth.currentUser) return null;

    try {
      const q = query(
        collection(db, 'email_patterns'),
        where('userId', '==', auth.currentUser.uid),
        limit(1)
      );
      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;
      return snapshot.docs[0].data() as EmailPattern;
    } catch {
      return null;
    }
  }

  /**
   * Mark email as read
   */
  async markAsRead(emailId: string): Promise<void> {
    if (!auth.currentUser) return;

    await fetch(`${this.baseUrl}/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: auth.currentUser.uid, emailId })
    });
  }

  /**
   * Get unread count
   */
  async getUnreadCount(): Promise<number> {
    if (!auth.currentUser) return 0;

    try {
      const response = await fetch(`${this.baseUrl}/unread-count?userId=${auth.currentUser.uid}`);
      const data = await response.json();
      return data.count || 0;
    } catch {
      return 0;
    }
  }
}

export const gmailService = new GmailService();

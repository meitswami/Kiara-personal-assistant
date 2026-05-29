/**
 * Outlook (Microsoft Graph) Integration Service for Kiara
 * Supports email (read/send/compose) and calendar events
 * Uses OAuth2 with Microsoft Identity Platform
 */

import { db, auth } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export interface OutlookEmail {
  id: string;
  conversationId: string;
  from: string;
  fromName: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  bodyPreview: string;
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  importance: 'low' | 'normal' | 'high';
  webLink: string;
}

export interface OutlookEvent {
  id: string;
  subject: string;
  bodyPreview: string;
  start: string;
  end: string;
  location?: string;
  organizer?: string;
  attendees?: Array<{ email: string; name: string; status: string }>;
  isOnlineMeeting: boolean;
  onlineMeetingUrl?: string;
  webLink: string;
}

export interface EmailDraft {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  importance?: 'low' | 'normal' | 'high';
}

class OutlookService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${window.location.origin}/api/outlook`;
  }

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

  async getStatus(): Promise<{ connected: boolean; configured: boolean; email?: string }> {
    if (!auth.currentUser) return { connected: false, configured: false };
    try {
      const response = await fetch(`${this.baseUrl}/status?userId=${auth.currentUser.uid}`);
      return await response.json();
    } catch {
      return { connected: false, configured: false };
    }
  }

  async connect(): Promise<void> {
    if (!auth.currentUser) throw new Error("User not authenticated");
    const response = await fetch(`${this.baseUrl}/auth-url?userId=${auth.currentUser.uid}`);
    const { url, error } = await response.json();
    if (error) throw new Error(error);

    const popup = window.open(url, 'outlook-auth', 'width=500,height=700,left=200,top=100');
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });
  }

  async disconnect(): Promise<void> {
    if (!auth.currentUser) return;
    await fetch(`${this.baseUrl}/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: auth.currentUser.uid })
    });
  }

  async getInbox(maxResults: number = 20): Promise<OutlookEmail[]> {
    if (!auth.currentUser) return [];
    try {
      const params = new URLSearchParams({
        userId: auth.currentUser.uid,
        maxResults: maxResults.toString()
      });
      const response = await fetch(`${this.baseUrl}/inbox?${params}`);
      const data = await response.json();
      return data.success ? data.emails : [];
    } catch {
      return [];
    }
  }

  async getEmail(id: string): Promise<OutlookEmail | null> {
    if (!auth.currentUser) return null;
    try {
      const response = await fetch(`${this.baseUrl}/message/${id}?userId=${auth.currentUser.uid}`);
      const data = await response.json();
      return data.success ? data.email : null;
    } catch {
      return null;
    }
  }

  async sendEmail(draft: EmailDraft): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!auth.currentUser) throw new Error("User not authenticated");
    try {
      const response = await fetch(`${this.baseUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, userId: auth.currentUser.uid })
      });
      return await response.json();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async searchEmails(query: string, maxResults: number = 10): Promise<OutlookEmail[]> {
    if (!auth.currentUser) return [];
    try {
      const params = new URLSearchParams({
        userId: auth.currentUser.uid,
        q: query,
        maxResults: maxResults.toString()
      });
      const response = await fetch(`${this.baseUrl}/search?${params}`);
      const data = await response.json();
      return data.success ? data.emails : [];
    } catch {
      return [];
    }
  }

  async markAsRead(emailId: string): Promise<void> {
    if (!auth.currentUser) return;
    await fetch(`${this.baseUrl}/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: auth.currentUser.uid, emailId })
    });
  }

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

  async getCalendarEvents(maxResults: number = 10): Promise<OutlookEvent[]> {
    if (!auth.currentUser) return [];
    try {
      const params = new URLSearchParams({
        userId: auth.currentUser.uid,
        maxResults: maxResults.toString()
      });
      const response = await fetch(`${this.baseUrl}/calendar/events?${params}`);
      const data = await response.json();
      return data.success ? data.events : [];
    } catch {
      return [];
    }
  }

  async createCalendarEvent(event: {
    subject: string;
    body?: string;
    start: string;
    end: string;
    location?: string;
    attendees?: string[];
  }): Promise<{ success: boolean; eventId?: string; webLink?: string; error?: string }> {
    if (!auth.currentUser) throw new Error("User not authenticated");
    try {
      const response = await fetch(`${this.baseUrl}/calendar/create-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, userId: auth.currentUser.uid })
      });
      return await response.json();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

export const outlookService = new OutlookService();

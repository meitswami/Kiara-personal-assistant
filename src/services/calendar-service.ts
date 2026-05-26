/**
 * Google Calendar Integration Service for Kiara
 * Syncs reminders and events with Google Calendar
 * Uses the same OAuth2 tokens as Gmail
 */

import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  link?: string;
}

class CalendarService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${window.location.origin}/api/calendar`;
  }

  /**
   * Sync a specific reminder to Google Calendar
   */
  async syncReminder(reminder: { id: string; title: string; description?: string; dueDate: string }): Promise<{ success: boolean; eventId?: string; eventLink?: string; error?: string }> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    try {
      const response = await fetch(`${this.baseUrl}/sync-reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          reminder
        })
      });

      return await response.json();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Sync ALL pending reminders to Google Calendar
   */
  async syncAllPendingReminders(): Promise<{ synced: number; failed: number }> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    let synced = 0;
    let failed = 0;

    try {
      const q = query(
        collection(db, 'reminders'),
        where('userId', '==', auth.currentUser.uid),
        where('integrationStatus.googleCalendar', '==', 'pending')
      );

      const snapshot = await getDocs(q);

      for (const reminderDoc of snapshot.docs) {
        const data = reminderDoc.data();
        const result = await this.syncReminder({
          id: reminderDoc.id,
          title: data.title,
          description: data.description,
          dueDate: data.dueDate
        });

        if (result.success) {
          synced++;
        } else {
          failed++;
          // Mark as failed so we don't retry indefinitely
          await updateDoc(doc(db, 'reminders', reminderDoc.id), {
            'integrationStatus.googleCalendar': 'failed',
            'integrationStatus.googleCalendarError': result.error
          });
        }
      }
    } catch (error) {
      console.error("Failed to sync reminders:", error);
    }

    return { synced, failed };
  }

  /**
   * Get upcoming events from Google Calendar
   */
  async getUpcomingEvents(maxResults: number = 10): Promise<CalendarEvent[]> {
    if (!auth.currentUser) return [];

    try {
      const params = new URLSearchParams({
        userId: auth.currentUser.uid,
        maxResults: maxResults.toString()
      });

      const response = await fetch(`${this.baseUrl}/events?${params}`);
      const data = await response.json();
      return data.success ? data.events : [];
    } catch (error) {
      console.error("Failed to fetch calendar events:", error);
      return [];
    }
  }
}

export const calendarService = new CalendarService();

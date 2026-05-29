/**
 * Telegram Bot Integration Service for Kiara
 * 
 * Features:
 * - Receives all Kiara notifications via Telegram
 * - Supports text commands to control phone remotely
 * - Forwards reminders, WhatsApp messages, emails to Telegram
 * - Handles Android phone commands (call, SMS, volume, etc.)
 * 
 * Server-side bot handles the Telegram Bot API, this client-side service
 * manages the connection state and UI.
 */

import { db, auth } from '../lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

export interface TelegramConfig {
  chatId: string;
  botUsername: string;
  isConnected: boolean;
  notifyReminders: boolean;
  notifyWhatsApp: boolean;
  notifyEmail: boolean;
  notifyCalendar: boolean;
  notifyPatternInsights: boolean;
  phoneCommandsEnabled: boolean;
}

export interface TelegramCommand {
  command: string;
  description: string;
  category: 'phone' | 'assistant' | 'settings';
}

export const TELEGRAM_COMMANDS: TelegramCommand[] = [
  // Phone commands
  { command: '/call', description: 'Make a phone call - /call +919876543210', category: 'phone' },
  { command: '/sms', description: 'Send SMS - /sms +919876543210 Hello!', category: 'phone' },
  { command: '/volume', description: 'Set volume - /volume 50 (0-100)', category: 'phone' },
  { command: '/silent', description: 'Put phone on silent mode', category: 'phone' },
  { command: '/ring', description: 'Ring the phone (find my phone)', category: 'phone' },
  { command: '/screenshot', description: 'Take a screenshot', category: 'phone' },
  { command: '/battery', description: 'Check battery level', category: 'phone' },
  { command: '/location', description: 'Get current location', category: 'phone' },
  { command: '/flashlight', description: 'Toggle flashlight on/off', category: 'phone' },
  { command: '/dnd', description: 'Toggle Do Not Disturb', category: 'phone' },
  { command: '/wifi', description: 'Toggle WiFi on/off', category: 'phone' },
  { command: '/bluetooth', description: 'Toggle Bluetooth on/off', category: 'phone' },
  { command: '/openapp', description: 'Open an app - /openapp WhatsApp', category: 'phone' },
  
  // Assistant commands
  { command: '/ask', description: 'Ask Kiara anything - /ask What did I discuss yesterday?', category: 'assistant' },
  { command: '/remember', description: 'Save to memory - /remember Meeting with Raj at 5pm', category: 'assistant' },
  { command: '/search', description: 'Search memories - /search project deadline', category: 'assistant' },
  { command: '/remind', description: 'Set reminder - /remind Call dentist tomorrow 3pm', category: 'assistant' },
  { command: '/whatsapp', description: 'Send WhatsApp - /whatsapp +91... Hello!', category: 'assistant' },
  { command: '/email', description: 'Send email - /email user@mail.com Subject | Body', category: 'assistant' },
  { command: '/status', description: 'Get system status (battery, connection, etc.)', category: 'assistant' },
  { command: '/insights', description: 'Get daily pattern insights', category: 'assistant' },
  
  // Settings commands
  { command: '/settings', description: 'View/change notification settings', category: 'settings' },
  { command: '/mute', description: 'Mute notifications for 1 hour', category: 'settings' },
  { command: '/unmute', description: 'Unmute notifications', category: 'settings' },
  { command: '/disconnect', description: 'Disconnect Telegram from Kiara', category: 'settings' },
];

class TelegramService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${window.location.origin}/api/telegram`;
  }

  /**
   * Get the connection link to start the Telegram bot
   */
  async getConnectLink(): Promise<{ url: string; botUsername: string; code: string }> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    const response = await fetch(`${this.baseUrl}/connect-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: auth.currentUser.uid })
    });

    return await response.json();
  }

  /**
   * Check if Telegram is connected for the current user
   */
  async getConfig(): Promise<TelegramConfig | null> {
    if (!auth.currentUser) return null;

    try {
      const docRef = doc(db, 'telegram_config', auth.currentUser.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as TelegramConfig;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Update Telegram notification preferences
   */
  async updateConfig(config: Partial<TelegramConfig>): Promise<void> {
    if (!auth.currentUser) return;

    await setDoc(doc(db, 'telegram_config', auth.currentUser.uid), {
      ...config,
      userId: auth.currentUser.uid,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  /**
   * Disconnect Telegram
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
   * Send a notification to the user's Telegram
   */
  async sendNotification(message: string, options?: { parse_mode?: string; reply_markup?: any }): Promise<boolean> {
    if (!auth.currentUser) return false;

    try {
      const response = await fetch(`${this.baseUrl}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          message,
          ...options
        })
      });

      const data = await response.json();
      return data.success;
    } catch {
      return false;
    }
  }

  /**
   * Send a phone command via Telegram bot -> Companion app bridge
   */
  async sendPhoneCommand(command: string, params?: Record<string, any>): Promise<{ success: boolean; result?: any; error?: string }> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    try {
      const response = await fetch(`${this.baseUrl}/phone-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          command,
          params
        })
      });

      return await response.json();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get connection status
   */
  async isConnected(): Promise<boolean> {
    const config = await this.getConfig();
    return config?.isConnected || false;
  }

  /**
   * Get the list of available commands
   */
  getCommands(): TelegramCommand[] {
    return TELEGRAM_COMMANDS;
  }

  /**
   * Format a notification for Telegram (Markdown)
   */
  static formatNotification(type: string, title: string, body: string, extras?: Record<string, string>): string {
    let emoji = '🔔';
    switch (type) {
      case 'reminder': emoji = '⏰'; break;
      case 'whatsapp': emoji = '💬'; break;
      case 'email': emoji = '📧'; break;
      case 'calendar': emoji = '📅'; break;
      case 'call': emoji = '📞'; break;
      case 'insight': emoji = '💡'; break;
      case 'memory': emoji = '🧠'; break;
      case 'task': emoji = '✅'; break;
    }

    let msg = `${emoji} *${title}*\n\n${body}`;
    
    if (extras) {
      msg += '\n\n';
      for (const [key, value] of Object.entries(extras)) {
        msg += `_${key}:_ ${value}\n`;
      }
    }

    return msg;
  }
}

export const telegramService = new TelegramService();

/**
 * Android Phone Command Bridge for Kiara
 * 
 * This service bridges Kiara (web/PWA) with the Android companion app.
 * Communication flow:
 * 1. User issues command via voice/Telegram -> Kiara server
 * 2. Server stores command in Firestore `phone_commands` collection
 * 3. Android companion app (Tasker/Automate/custom APK) polls Firestore
 * 4. Companion app executes the command on device
 * 5. Result is written back to Firestore
 * 6. Kiara reads the result and confirms to user
 * 
 * Alternatively: FCM push to companion app for instant execution
 */

import { db, auth } from '../lib/firebase';
import { 
  collection, addDoc, doc, getDoc, getDocs, 
  query, where, orderBy, limit, serverTimestamp, 
  onSnapshot, updateDoc 
} from 'firebase/firestore';

export interface PhoneCommand {
  id?: string;
  command: string;
  params: Record<string, any>;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  userId: string;
  source: 'voice' | 'telegram' | 'web';
  createdAt: any;
  executedAt?: any;
}

export interface DeviceStatus {
  battery: number;
  isCharging: boolean;
  wifiConnected: boolean;
  bluetoothEnabled: boolean;
  volume: number;
  isDND: boolean;
  lastSeen: Date;
  deviceName: string;
  androidVersion: string;
}

class AndroidBridgeService {
  private commandListener: (() => void) | null = null;

  /**
   * Send a phone command to the Android companion app
   */
  async sendCommand(command: string, params: Record<string, any> = {}, source: 'voice' | 'telegram' | 'web' = 'web'): Promise<{ commandId: string }> {
    if (!auth.currentUser) throw new Error("User not authenticated");

    const commandDoc = await addDoc(collection(db, 'phone_commands'), {
      command,
      params,
      status: 'pending',
      userId: auth.currentUser.uid,
      source,
      createdAt: serverTimestamp()
    });

    return { commandId: commandDoc.id };
  }

  /**
   * Wait for a command result (with timeout)
   */
  async waitForResult(commandId: string, timeoutMs: number = 30000): Promise<PhoneCommand> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('Command timed out. Is the companion app running?'));
      }, timeoutMs);

      const unsubscribe = onSnapshot(doc(db, 'phone_commands', commandId), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as PhoneCommand;
          if (data.status === 'completed' || data.status === 'failed') {
            clearTimeout(timeout);
            unsubscribe();
            resolve({ id: commandId, ...data });
          }
        }
      });
    });
  }

  /**
   * Make a phone call
   */
  async makeCall(phoneNumber: string): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('CALL', { phoneNumber });
    return this.waitForResult(commandId);
  }

  /**
   * Send an SMS
   */
  async sendSMS(phoneNumber: string, message: string): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('SMS', { phoneNumber, message });
    return this.waitForResult(commandId);
  }

  /**
   * Set volume (0-100)
   */
  async setVolume(level: number): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('SET_VOLUME', { level: Math.min(100, Math.max(0, level)) });
    return this.waitForResult(commandId);
  }

  /**
   * Toggle silent mode
   */
  async setSilentMode(enabled: boolean): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('SILENT_MODE', { enabled });
    return this.waitForResult(commandId);
  }

  /**
   * Ring the phone (find my phone)
   */
  async ringPhone(): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('RING_PHONE', { duration: 30 });
    return this.waitForResult(commandId);
  }

  /**
   * Take a screenshot
   */
  async takeScreenshot(): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('SCREENSHOT', {});
    return this.waitForResult(commandId, 15000);
  }

  /**
   * Get battery info
   */
  async getBattery(): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('GET_BATTERY', {});
    return this.waitForResult(commandId, 10000);
  }

  /**
   * Get location
   */
  async getLocation(): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('GET_LOCATION', {});
    return this.waitForResult(commandId, 20000);
  }

  /**
   * Toggle flashlight
   */
  async toggleFlashlight(): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('TOGGLE_FLASHLIGHT', {});
    return this.waitForResult(commandId);
  }

  /**
   * Toggle Do Not Disturb
   */
  async toggleDND(): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('TOGGLE_DND', {});
    return this.waitForResult(commandId);
  }

  /**
   * Toggle WiFi
   */
  async toggleWifi(): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('TOGGLE_WIFI', {});
    return this.waitForResult(commandId);
  }

  /**
   * Toggle Bluetooth
   */
  async toggleBluetooth(): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('TOGGLE_BLUETOOTH', {});
    return this.waitForResult(commandId);
  }

  /**
   * Open an app by name
   */
  async openApp(appName: string): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('OPEN_APP', { appName });
    return this.waitForResult(commandId);
  }

  /**
   * Play music (via default music app)
   */
  async playMusic(query?: string): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('PLAY_MUSIC', { query });
    return this.waitForResult(commandId);
  }

  /**
   * Set alarm
   */
  async setAlarm(hour: number, minute: number, label?: string): Promise<PhoneCommand> {
    const { commandId } = await this.sendCommand('SET_ALARM', { hour, minute, label });
    return this.waitForResult(commandId);
  }

  /**
   * Get device status
   */
  async getDeviceStatus(): Promise<DeviceStatus | null> {
    if (!auth.currentUser) return null;

    try {
      const docRef = doc(db, 'device_status', auth.currentUser.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as DeviceStatus;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if companion app is online (seen in last 5 minutes)
   */
  async isCompanionOnline(): Promise<boolean> {
    const status = await this.getDeviceStatus();
    if (!status) return false;
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    return new Date(status.lastSeen) > fiveMinAgo;
  }

  /**
   * Get recent commands history
   */
  async getCommandHistory(maxResults: number = 20): Promise<PhoneCommand[]> {
    if (!auth.currentUser) return [];

    try {
      const q = query(
        collection(db, 'phone_commands'),
        where('userId', '==', auth.currentUser.uid),
        orderBy('createdAt', 'desc'),
        limit(maxResults)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PhoneCommand));
    } catch {
      return [];
    }
  }

  /**
   * Listen for command status changes in real-time
   */
  listenForUpdates(callback: (command: PhoneCommand) => void): () => void {
    if (!auth.currentUser) return () => {};

    const q = query(
      collection(db, 'phone_commands'),
      where('userId', '==', auth.currentUser.uid),
      where('status', 'in', ['executing', 'completed', 'failed']),
      orderBy('createdAt', 'desc'),
      limit(5)
    );

    return onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'modified') {
          callback({ id: change.doc.id, ...change.doc.data() } as PhoneCommand);
        }
      });
    });
  }
}

export const androidBridgeService = new AndroidBridgeService();

/**
 * Push Notification Service for Kiara PWA
 * Handles subscription, permission requests, and notification triggers
 */

import { db, auth } from '../lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

class PushNotificationService {
  private swRegistration: ServiceWorkerRegistration | null = null;
  private subscription: PushSubscription | null = null;

  /**
   * Initialize service worker and check notification permission
   */
  async initialize(): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push notifications not supported');
      return false;
    }

    try {
      this.swRegistration = await navigator.serviceWorker.register('/sw.js');
      console.log('[Push] Service Worker registered');

      // Listen for messages from SW
      navigator.serviceWorker.addEventListener('message', this.handleSWMessage.bind(this));

      // Check if already subscribed
      this.subscription = await this.swRegistration.pushManager.getSubscription();
      if (this.subscription) {
        console.log('[Push] Already subscribed');
      }

      return true;
    } catch (error) {
      console.error('[Push] Failed to initialize:', error);
      return false;
    }
  }

  /**
   * Request notification permission and subscribe
   */
  async subscribe(): Promise<boolean> {
    if (!this.swRegistration) {
      await this.initialize();
    }
    if (!this.swRegistration) return false;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('[Push] Permission denied');
        return false;
      }

      // Get VAPID public key from server
      const response = await fetch('/api/push/vapid-key');
      const { publicKey } = await response.json();

      if (!publicKey) {
        console.error('[Push] No VAPID key from server');
        return false;
      }

      // Subscribe to push
      this.subscription = await this.swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(publicKey)
      });

      // Send subscription to server
      await this.saveSubscription(this.subscription);

      console.log('[Push] Subscribed successfully');
      return true;
    } catch (error) {
      console.error('[Push] Subscription failed:', error);
      return false;
    }
  }

  /**
   * Unsubscribe from push notifications
   */
  async unsubscribe(): Promise<void> {
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;

      // Remove from server
      if (auth.currentUser) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: auth.currentUser.uid })
        });
      }
    }
  }

  /**
   * Check if currently subscribed
   */
  isSubscribed(): boolean {
    return !!this.subscription;
  }

  /**
   * Check if notifications are supported and permitted
   */
  getPermissionState(): NotificationPermission | 'unsupported' {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }

  /**
   * Show a local notification (doesn't go through push server)
   */
  async showLocalNotification(title: string, options?: NotificationOptions): Promise<void> {
    if (!this.swRegistration) return;
    if (Notification.permission !== 'granted') return;

    await this.swRegistration.showNotification(title, {
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      vibrate: [200, 100, 200],
      ...options
    });
  }

  /**
   * Send subscription to server for storage
   */
  private async saveSubscription(subscription: PushSubscription): Promise<void> {
    if (!auth.currentUser) return;

    const subData = subscription.toJSON();

    // Save to Firestore for this user
    await setDoc(doc(db, 'push_subscriptions', auth.currentUser.uid), {
      endpoint: subData.endpoint,
      keys: subData.keys,
      userId: auth.currentUser.uid,
      userAgent: navigator.userAgent,
      createdAt: serverTimestamp(),
      platform: this.detectPlatform()
    });

    // Also send to server
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: subData,
        userId: auth.currentUser.uid
      })
    });
  }

  /**
   * Handle messages from service worker
   */
  private handleSWMessage(event: MessageEvent): void {
    const { type, data } = event.data || {};

    switch (type) {
      case 'NOTIFICATION_CLICK':
        // Handle notification click actions
        window.dispatchEvent(new CustomEvent('kiara-notification-click', { detail: data }));
        break;
      case 'SYNC_OFFLINE_DATA':
        // Trigger offline data sync
        window.dispatchEvent(new CustomEvent('kiara-sync-offline'));
        break;
      case 'SYNC_MESSAGES':
        window.dispatchEvent(new CustomEvent('kiara-sync-messages'));
        break;
      case 'CHECK_REMINDERS':
        window.dispatchEvent(new CustomEvent('kiara-check-reminders'));
        break;
    }
  }

  /**
   * Detect platform for subscription metadata
   */
  private detectPlatform(): string {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    if (/windows/i.test(ua)) return 'windows';
    if (/mac/i.test(ua)) return 'macos';
    if (/linux/i.test(ua)) return 'linux';
    return 'unknown';
  }

  /**
   * Convert VAPID key from base64url to Uint8Array
   */
  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

export const pushNotificationService = new PushNotificationService();

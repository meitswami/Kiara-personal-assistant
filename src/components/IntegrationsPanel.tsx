/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Mail, Calendar, MessageSquare, Smartphone, Send, Inbox,
  Check, AlertCircle, Loader2, Plug, Plus, RefreshCw, ExternalLink,
  Link2, Bell, Phone
} from 'lucide-react';
import { gmailService } from '../services/gmail-service';
import { outlookService } from '../services/outlook-service';
import { calendarService } from '../services/calendar-service';
import { whatsappService } from '../services/whatsapp-service';
import { telegramService } from '../services/telegram-service';
import { pushNotificationService } from '../services/push-notification-service';
import { androidBridgeService } from '../services/android-bridge-service';
import { EmailComposer } from './EmailComposer';
import { InboxView } from './InboxView';
import { CalendarView } from './CalendarView';

type TabKey = 'email' | 'calendar' | 'messaging' | 'phone' | 'notifications';

interface IntegrationStatus {
  gmail: { connected: boolean; configured: boolean; loading: boolean };
  outlook: { connected: boolean; configured: boolean; email?: string; loading: boolean };
  whatsapp: { connected: boolean; configured: boolean; phoneNumber?: string; loading: boolean };
  telegram: { connected: boolean; loading: boolean };
  pushNotif: { permitted: boolean; subscribed: boolean; loading: boolean };
  androidBridge: { online: boolean; loading: boolean };
}

export const IntegrationsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<TabKey>('email');
  const [showComposer, setShowComposer] = useState<'gmail' | 'outlook' | null>(null);
  const [showInbox, setShowInbox] = useState<'gmail' | 'outlook' | null>(null);
  const [showCalendar, setShowCalendar] = useState<'google' | 'outlook' | 'all' | null>(null);
  const [telegramConnect, setTelegramConnect] = useState<{ url: string; code: string } | null>(null);

  const [status, setStatus] = useState<IntegrationStatus>({
    gmail: { connected: false, configured: false, loading: true },
    outlook: { connected: false, configured: false, loading: true },
    whatsapp: { connected: false, configured: false, loading: true },
    telegram: { connected: false, loading: true },
    pushNotif: { permitted: false, subscribed: false, loading: true },
    androidBridge: { online: false, loading: true }
  });

  const refreshStatus = async () => {
    setStatus(prev => ({
      ...prev,
      gmail: { ...prev.gmail, loading: true },
      outlook: { ...prev.outlook, loading: true },
      whatsapp: { ...prev.whatsapp, loading: true },
      telegram: { ...prev.telegram, loading: true },
      pushNotif: { ...prev.pushNotif, loading: true },
      androidBridge: { ...prev.androidBridge, loading: true }
    }));

    try {
      const [gmailStatus, outlookStatus, whatsappStatus, telegramConfig, androidOnline] = await Promise.all([
        fetchGmailStatus(),
        outlookService.getStatus(),
        fetchWhatsAppStatus(),
        telegramService.getConfig(),
        androidBridgeService.isCompanionOnline().catch(() => false)
      ]);

      const pushPermission = pushNotificationService.getPermissionState();

      setStatus({
        gmail: { connected: gmailStatus.connected, configured: gmailStatus.configured, loading: false },
        outlook: { connected: outlookStatus.connected, configured: outlookStatus.configured, email: outlookStatus.email, loading: false },
        whatsapp: { connected: whatsappStatus.connected, configured: whatsappStatus.twilioConfigured, phoneNumber: whatsappStatus.phoneNumber, loading: false },
        telegram: { connected: telegramConfig?.isConnected || false, loading: false },
        pushNotif: { permitted: pushPermission === 'granted', subscribed: pushNotificationService.isSubscribed(), loading: false },
        androidBridge: { online: androidOnline, loading: false }
      });
    } catch (err) {
      console.error('Failed to load integration status:', err);
    }
  };

  const fetchGmailStatus = async () => {
    try {
      const userId = (await import('../lib/firebase')).auth.currentUser?.uid;
      if (!userId) return { connected: false, configured: false };
      const response = await fetch(`/api/gmail/status?userId=${userId}`);
      return await response.json();
    } catch {
      return { connected: false, configured: false };
    }
  };

  const fetchWhatsAppStatus = async () => {
    try {
      const userId = (await import('../lib/firebase')).auth.currentUser?.uid;
      if (!userId) return { connected: false, twilioConfigured: false };
      const response = await fetch(`/api/whatsapp/status?userId=${userId}`);
      return await response.json();
    } catch {
      return { connected: false, twilioConfigured: false };
    }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const handleGmailConnect = async () => {
    try {
      await gmailService.connect();
      setTimeout(refreshStatus, 1000);
    } catch (err: any) {
      alert(`Gmail connection failed: ${err.message}`);
    }
  };

  const handleGmailDisconnect = async () => {
    if (!confirm('Disconnect Gmail? Your stored emails and patterns will remain.')) return;
    await gmailService.disconnect();
    refreshStatus();
  };

  const handleOutlookConnect = async () => {
    try {
      await outlookService.connect();
      setTimeout(refreshStatus, 1000);
    } catch (err: any) {
      alert(`Outlook connection failed: ${err.message}`);
    }
  };

  const handleOutlookDisconnect = async () => {
    if (!confirm('Disconnect Outlook?')) return;
    await outlookService.disconnect();
    refreshStatus();
  };

  const handleTelegramConnect = async () => {
    try {
      const data = await telegramService.getConnectLink();
      setTelegramConnect({ url: data.url, code: data.code });
    } catch (err: any) {
      alert(`Telegram connect failed: ${err.message}`);
    }
  };

  const handleTelegramDisconnect = async () => {
    if (!confirm('Disconnect Telegram?')) return;
    await telegramService.disconnect();
    refreshStatus();
  };

  const handleWhatsAppRegister = async () => {
    const phone = prompt('Enter your WhatsApp number with country code (e.g. +919876543210):');
    if (!phone) return;
    await whatsappService.registerNumber(phone);
    refreshStatus();
  };

  const handleEnablePush = async () => {
    const success = await pushNotificationService.subscribe();
    if (success) {
      await pushNotificationService.showLocalNotification('Kiara Notifications Enabled', {
        body: 'You will now receive notifications for reminders, messages, and more.'
      });
    }
    refreshStatus();
  };

  const tabs: Array<{ key: TabKey; label: string; icon: any }> = [
    { key: 'email', label: 'Email', icon: Mail },
    { key: 'calendar', label: 'Calendar', icon: Calendar },
    { key: 'messaging', label: 'Messaging', icon: MessageSquare },
    { key: 'phone', label: 'Phone', icon: Smartphone },
    { key: 'notifications', label: 'Notifications', icon: Bell }
  ];

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-5xl max-h-[90vh] bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden flex flex-col shadow-2xl"
        >
          {/* Header */}
          <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-pink-500/20">
                <Plug className="w-6 h-6 text-pink-500" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight">Integrations</h2>
                <p className="text-xs text-gray-500">Connect Kiara with your services</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={refreshStatus}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                title="Refresh status"
              >
                <RefreshCw className="w-4 h-4 text-gray-400" />
              </button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/10 px-6 overflow-x-auto scrollbar-hide">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`py-4 px-5 text-sm font-medium transition-colors relative flex items-center gap-2 whitespace-nowrap ${
                    activeTab === tab.key ? 'text-pink-500' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {activeTab === tab.key && (
                    <motion.div
                      layoutId="integration-tab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-pink-500"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'email' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Gmail */}
                <IntegrationCard
                  name="Gmail"
                  description="Read inbox, compose & send emails, AI-powered drafts based on your style"
                  icon={<GmailIcon />}
                  connected={status.gmail.connected}
                  configured={status.gmail.configured}
                  loading={status.gmail.loading}
                  onConnect={handleGmailConnect}
                  onDisconnect={handleGmailDisconnect}
                  actions={status.gmail.connected ? [
                    { label: 'Inbox', icon: Inbox, onClick: () => setShowInbox('gmail') },
                    { label: 'Compose', icon: Send, onClick: () => setShowComposer('gmail') }
                  ] : []}
                />

                {/* Outlook */}
                <IntegrationCard
                  name="Outlook"
                  description="Microsoft Outlook email and calendar via Microsoft Graph API"
                  icon={<OutlookIcon />}
                  connected={status.outlook.connected}
                  configured={status.outlook.configured}
                  loading={status.outlook.loading}
                  details={status.outlook.email}
                  onConnect={handleOutlookConnect}
                  onDisconnect={handleOutlookDisconnect}
                  actions={status.outlook.connected ? [
                    { label: 'Inbox', icon: Inbox, onClick: () => setShowInbox('outlook') },
                    { label: 'Compose', icon: Send, onClick: () => setShowComposer('outlook') }
                  ] : []}
                />
              </div>
            )}

            {activeTab === 'calendar' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <IntegrationCard
                    name="Google Calendar"
                    description="Sync reminders, view upcoming events. Linked with your Gmail account."
                    icon={<GoogleCalendarIcon />}
                    connected={status.gmail.connected}
                    configured={status.gmail.configured}
                    loading={status.gmail.loading}
                    onConnect={handleGmailConnect}
                    onDisconnect={handleGmailDisconnect}
                    note={status.gmail.connected ? undefined : "Connect Gmail first to enable Calendar"}
                    actions={status.gmail.connected ? [
                      { label: 'View Events', icon: Calendar, onClick: () => setShowCalendar('google') }
                    ] : []}
                  />

                  <IntegrationCard
                    name="Outlook Calendar"
                    description="Microsoft 365 calendar events and meeting management"
                    icon={<OutlookCalendarIcon />}
                    connected={status.outlook.connected}
                    configured={status.outlook.configured}
                    loading={status.outlook.loading}
                    onConnect={handleOutlookConnect}
                    onDisconnect={handleOutlookDisconnect}
                    note={status.outlook.connected ? undefined : "Connect Outlook first"}
                    actions={status.outlook.connected ? [
                      { label: 'View Events', icon: Calendar, onClick: () => setShowCalendar('outlook') }
                    ] : []}
                  />
                </div>

                {(status.gmail.connected || status.outlook.connected) && (
                  <div className="bg-gradient-to-r from-pink-500/10 to-blue-500/10 border border-white/10 p-5 rounded-2xl">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="font-bold text-sm mb-1 flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-pink-500" />
                          Unified Calendar View
                        </h3>
                        <p className="text-xs text-gray-400">
                          See all events from Google Calendar and Outlook in one place
                        </p>
                      </div>
                      <button
                        onClick={() => setShowCalendar('all')}
                        className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-sm font-bold transition-colors flex items-center gap-2"
                      >
                        <Calendar className="w-4 h-4" />
                        Open
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'messaging' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <IntegrationCard
                  name="WhatsApp"
                  description="Send/receive messages via Twilio WhatsApp Business API"
                  icon={<WhatsAppIcon />}
                  connected={status.whatsapp.connected}
                  configured={status.whatsapp.configured}
                  loading={status.whatsapp.loading}
                  details={status.whatsapp.phoneNumber}
                  onConnect={handleWhatsAppRegister}
                  note={!status.whatsapp.configured ? "Server needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN" : undefined}
                />

                <IntegrationCard
                  name="Telegram"
                  description="Forward all notifications and control your phone via Telegram bot"
                  icon={<TelegramIcon />}
                  connected={status.telegram.connected}
                  configured={true}
                  loading={status.telegram.loading}
                  onConnect={handleTelegramConnect}
                  onDisconnect={handleTelegramDisconnect}
                />
              </div>
            )}

            {activeTab === 'phone' && (
              <div className="space-y-4">
                <IntegrationCard
                  name="Android Companion"
                  description="Control your Android phone remotely - calls, SMS, volume, location, and more"
                  icon={<AndroidIcon />}
                  connected={status.androidBridge.online}
                  configured={true}
                  loading={status.androidBridge.loading}
                  details={status.androidBridge.online ? "Companion app online" : "Companion app offline"}
                  customConnect={
                    <div className="text-xs text-gray-400 space-y-2 mt-3">
                      <p className="font-bold text-gray-300">Setup Instructions:</p>
                      <ol className="list-decimal list-inside space-y-1 ml-2">
                        <li>Install Tasker, Automate, or build a custom Android app</li>
                        <li>Configure it to read your Firebase project's `phone_commands` collection</li>
                        <li>Filter by your userId, execute commands, write back results</li>
                        <li>Update `device_status/{'{'}userId{'}'}` periodically (every 1-5 min)</li>
                      </ol>
                    </div>
                  }
                />

                <div className="bg-blue-500/5 border border-blue-500/20 p-4 rounded-2xl">
                  <h4 className="text-sm font-bold mb-2 flex items-center gap-2">
                    <Phone className="w-4 h-4 text-blue-400" />
                    Available Phone Commands
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px] text-gray-400">
                    {[
                      'Make calls', 'Send SMS', 'Set volume', 'Toggle WiFi',
                      'Toggle Bluetooth', 'Toggle DND', 'Take screenshot', 'Get battery',
                      'Get location', 'Toggle flashlight', 'Open apps', 'Set alarms',
                      'Play music', 'Find phone', 'Silent mode'
                    ].map(cmd => (
                      <div key={cmd} className="flex items-center gap-1">
                        <Check className="w-3 h-3 text-green-500" /> {cmd}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-4">
                <IntegrationCard
                  name="Push Notifications"
                  description="Get browser notifications for reminders, messages, and important events"
                  icon={<Bell className="w-8 h-8 text-pink-500" />}
                  connected={status.pushNotif.subscribed}
                  configured={true}
                  loading={status.pushNotif.loading}
                  details={status.pushNotif.permitted ? "Permission granted" : "Permission needed"}
                  onConnect={handleEnablePush}
                />

                <div className="bg-yellow-500/5 border border-yellow-500/20 p-4 rounded-2xl">
                  <h4 className="text-sm font-bold mb-2 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-yellow-400" />
                    Pro Tip
                  </h4>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Install Kiara as a PWA on your phone for the best notification experience. 
                    Open in Chrome/Edge → Menu → "Add to Home Screen".
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 bg-white/[0.02] border-t border-white/10 flex items-center justify-between">
            <p className="text-[10px] text-gray-500">
              Connected services are encrypted and stored privately
            </p>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              All systems operational
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Telegram Connect Modal */}
      <AnimatePresence>
        {telegramConnect && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[130] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <TelegramIcon /> Connect Telegram
                </h3>
                <button onClick={() => { setTelegramConnect(null); refreshStatus(); }}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-gray-300">
                  Click the link below to start the Telegram bot. You'll receive a confirmation message when connected.
                </p>
                <a
                  href={telegramConnect.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-3 bg-blue-500 hover:bg-blue-600 text-white text-center rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open Telegram Bot
                </a>
                <div className="bg-white/5 p-3 rounded-xl">
                  <p className="text-[10px] text-gray-500 mb-1">Connection code (auto-applied):</p>
                  <code className="text-xs text-pink-400 font-mono break-all">{telegramConnect.code}</code>
                </div>
                <p className="text-xs text-gray-500">
                  Once connected, you can use commands like /call, /sms, /remind, /ask in Telegram.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Email Composer Modal */}
      <AnimatePresence>
        {showComposer && (
          <EmailComposer
            provider={showComposer}
            onClose={() => setShowComposer(null)}
          />
        )}
      </AnimatePresence>

      {/* Inbox Modal */}
      <AnimatePresence>
        {showInbox && (
          <InboxView
            provider={showInbox}
            onClose={() => setShowInbox(null)}
            onCompose={() => { setShowInbox(null); setShowComposer(showInbox); }}
          />
        )}
      </AnimatePresence>

      {/* Calendar Modal */}
      <AnimatePresence>
        {showCalendar && (
          <CalendarView
            source={showCalendar}
            onClose={() => setShowCalendar(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
};

// Reusable Integration Card
const IntegrationCard: React.FC<{
  name: string;
  description: string;
  icon: React.ReactNode;
  connected: boolean;
  configured: boolean;
  loading: boolean;
  details?: string;
  note?: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  actions?: Array<{ label: string; icon: any; onClick: () => void }>;
  customConnect?: React.ReactNode;
}> = ({ name, description, icon, connected, configured, loading, details, note, onConnect, onDisconnect, actions, customConnect }) => {
  return (
    <div className={`p-5 rounded-2xl bg-white/5 border transition-all ${
      connected ? 'border-green-500/30' : 'border-white/10 hover:border-white/20'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-white/5">
            {icon}
          </div>
          <div>
            <h3 className="font-bold text-sm">{name}</h3>
            <div className="flex items-center gap-1 mt-0.5">
              {loading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-gray-500" />
                  <span className="text-[10px] text-gray-500">Checking...</span>
                </>
              ) : connected ? (
                <>
                  <Check className="w-3 h-3 text-green-500" />
                  <span className="text-[10px] text-green-500 font-bold">Connected</span>
                </>
              ) : !configured ? (
                <>
                  <AlertCircle className="w-3 h-3 text-yellow-500" />
                  <span className="text-[10px] text-yellow-500">Not configured</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-gray-500" />
                  <span className="text-[10px] text-gray-500">Disconnected</span>
                </>
              )}
            </div>
            {details && (
              <p className="text-[10px] text-gray-400 mt-0.5">{details}</p>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed mb-3">
        {description}
      </p>

      {note && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 p-2 rounded-lg mb-3">
          <p className="text-[10px] text-yellow-400">{note}</p>
        </div>
      )}

      {customConnect}

      <div className="flex items-center gap-2 mt-3">
        {!connected && configured && onConnect && (
          <button
            onClick={onConnect}
            disabled={loading}
            className="flex-1 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Link2 className="w-3.5 h-3.5" />
            Connect
          </button>
        )}
        {connected && actions && actions.map(action => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              onClick={action.onClick}
              className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5 border border-white/10"
            >
              <Icon className="w-3.5 h-3.5" />
              {action.label}
            </button>
          );
        })}
        {connected && onDisconnect && (
          <button
            onClick={onDisconnect}
            className="px-3 py-2 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-xl text-xs font-medium transition-colors border border-white/10"
            title="Disconnect"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

// Brand Icons (simple SVGs to avoid external dependencies)
const GmailIcon = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none">
    <path d="M22 6l-10 7L2 6" stroke="#EA4335" strokeWidth="2" strokeLinecap="round" />
    <rect x="2" y="6" width="20" height="12" rx="2" stroke="#EA4335" strokeWidth="2" fill="none" />
  </svg>
);

const OutlookIcon = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="#0078D4">
    <path d="M7 7h10v10H7z" fill="white" />
    <path d="M2 4v16h20V4H2zm18 14H4V6h16v12z" />
    <circle cx="12" cy="12" r="3" fill="#0078D4" />
  </svg>
);

const GoogleCalendarIcon = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="#4285F4">
    <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z" />
    <text x="12" y="17" textAnchor="middle" fill="#4285F4" fontSize="8" fontWeight="bold">G</text>
  </svg>
);

const OutlookCalendarIcon = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="#0078D4">
    <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z" />
    <text x="12" y="17" textAnchor="middle" fill="#0078D4" fontSize="8" fontWeight="bold">O</text>
  </svg>
);

const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="#25D366">
    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
  </svg>
);

const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="#0088cc">
    <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
  </svg>
);

const AndroidIcon = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="#3DDC84">
    <path d="M17.523 15.341c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9zm-11.046 0c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9zm11.367-6.183l1.795-3.111c.094-.18.034-.404-.146-.494-.17-.094-.394-.034-.494.146l-1.815 3.146c-1.398-.628-2.97-.99-4.74-.99-1.77 0-3.342.362-4.74.99L5.929 5.7c-.094-.18-.314-.246-.494-.146-.18.094-.246.314-.146.494l1.795 3.111C4.087 10.795 2.34 13.62 2 16.85h20c-.34-3.23-2.087-6.054-5.156-7.692z" />
  </svg>
);

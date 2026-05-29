/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  X, Mail, Search, Send, RefreshCw, Loader2, ArrowLeft, Reply,
  Star, Archive, Trash2, Paperclip, Sparkles, ExternalLink, Inbox
} from 'lucide-react';
import { gmailService } from '../services/gmail-service';
import { outlookService } from '../services/outlook-service';
import type { EmailMessage } from '../services/gmail-service';
import type { OutlookEmail } from '../services/outlook-service';

interface InboxViewProps {
  provider: 'gmail' | 'outlook';
  onClose: () => void;
  onCompose: () => void;
}

type UnifiedEmail = {
  id: string;
  from: string;
  fromName?: string;
  subject: string;
  snippet: string;
  body: string;
  date: string;
  isRead: boolean;
  hasAttachments: boolean;
};

export const InboxView: React.FC<InboxViewProps> = ({ provider, onClose, onCompose }) => {
  const [emails, setEmails] = useState<UnifiedEmail[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<UnifiedEmail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);

  const providerName = provider === 'gmail' ? 'Gmail' : 'Outlook';
  const accentColor = provider === 'gmail' ? '#EA4335' : '#0078D4';

  const normalizeGmail = (email: EmailMessage): UnifiedEmail => {
    const fromMatch = email.from.match(/^"?([^"<]+?)"?\s*<(.+?)>$/);
    return {
      id: email.id,
      from: fromMatch ? fromMatch[2] : email.from,
      fromName: fromMatch ? fromMatch[1].trim() : undefined,
      subject: email.subject || '(No Subject)',
      snippet: email.snippet,
      body: email.body,
      date: email.date,
      isRead: email.isRead,
      hasAttachments: email.hasAttachments
    };
  };

  const normalizeOutlook = (email: OutlookEmail): UnifiedEmail => ({
    id: email.id,
    from: email.from,
    fromName: email.fromName,
    subject: email.subject,
    snippet: email.bodyPreview,
    body: email.body,
    date: email.receivedDateTime,
    isRead: email.isRead,
    hasAttachments: email.hasAttachments
  });

  const loadInbox = async () => {
    setLoading(true);
    try {
      if (provider === 'gmail') {
        const result = await gmailService.getInbox(30);
        setEmails(result.emails.map(normalizeGmail));
      } else {
        const result = await outlookService.getInbox(30);
        setEmails(result.map(normalizeOutlook));
      }
    } catch (err) {
      console.error('Failed to load inbox:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadInbox();
      return;
    }
    setLoading(true);
    try {
      if (provider === 'gmail') {
        const results = await gmailService.searchEmails(searchQuery);
        setEmails(results.map(normalizeGmail));
      } else {
        const results = await outlookService.searchEmails(searchQuery);
        setEmails(results.map(normalizeOutlook));
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadInbox(); }, [provider]);

  const handleSelectEmail = async (email: UnifiedEmail) => {
    setSelectedEmail(email);
    setAiSummary(null);
    setShowReply(false);

    // Mark as read
    if (!email.isRead) {
      try {
        if (provider === 'gmail') {
          await gmailService.markAsRead(email.id);
        } else {
          await outlookService.markAsRead(email.id);
        }
        setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: true } : e));
      } catch {}
    }
  };

  const handleAISummarize = async () => {
    if (!selectedEmail) return;
    setGeneratingSummary(true);
    try {
      // Use compose-ai endpoint as a generic AI endpoint  
      const response = await gmailService.composeWithAI(
        `Summarize this email in 2-3 bullet points and extract any action items. 
        Email from ${selectedEmail.fromName || selectedEmail.from}:
        Subject: ${selectedEmail.subject}
        Body: ${stripHtml(selectedEmail.body).substring(0, 2000)}
        
        Return JSON with field 'body' containing the summary as plain text with bullet points.`
      );
      setAiSummary(response.body);
    } catch (err: any) {
      setAiSummary(`Could not generate summary: ${err.message}`);
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleAIReply = async () => {
    if (!selectedEmail) return;
    setSendingReply(true);
    try {
      const response = await gmailService.composeWithAI(
        `Generate a polite reply to this email. Match the tone of the sender.
        From: ${selectedEmail.fromName || selectedEmail.from}
        Subject: ${selectedEmail.subject}
        Body: ${stripHtml(selectedEmail.body).substring(0, 1500)}
        
        Return JSON with field 'body' containing only the reply body (HTML formatted).`
      );
      setReplyText(response.body);
      setShowReply(true);
    } catch (err) {
      console.error('AI reply failed:', err);
    } finally {
      setSendingReply(false);
    }
  };

  const handleSendReply = async () => {
    if (!selectedEmail || !replyText.trim()) return;
    setSendingReply(true);
    try {
      const subject = selectedEmail.subject.startsWith('Re: ') 
        ? selectedEmail.subject 
        : `Re: ${selectedEmail.subject}`;
      
      let result;
      if (provider === 'gmail') {
        result = await gmailService.sendEmail({
          to: [selectedEmail.from],
          subject,
          body: replyText
        });
      } else {
        result = await outlookService.sendEmail({
          to: [selectedEmail.from],
          subject,
          body: replyText,
          isHtml: true
        });
      }

      if (result.success) {
        setShowReply(false);
        setReplyText('');
        alert('Reply sent!');
      } else {
        alert(`Failed: ${result.error}`);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSendingReply(false);
    }
  };

  const formatDate = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const isThisYear = d.getFullYear() === now.getFullYear();

    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isThisYear) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
  };

  const stripHtml = (html: string): string => {
    if (!html) return '';
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return temp.textContent || temp.innerText || '';
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[140] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-6xl h-[90vh] bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            {selectedEmail && (
              <button
                onClick={() => { setSelectedEmail(null); setShowReply(false); }}
                className="p-1.5 hover:bg-white/10 rounded-full transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="p-2 rounded-xl" style={{ backgroundColor: `${accentColor}20` }}>
              <Inbox className="w-5 h-5" style={{ color: accentColor }} />
            </div>
            <div>
              <h3 className="text-lg font-bold">{providerName} Inbox</h3>
              <p className="text-xs text-gray-500">
                {loading ? 'Loading...' : `${emails.length} emails`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setRefreshing(true); loadInbox().finally(() => setRefreshing(false)); }}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 text-gray-400 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onCompose}
              className="px-3 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" /> Compose
            </button>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        {!selectedEmail ? (
          <>
            {/* Search */}
            <div className="px-4 py-3 border-b border-white/5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Search emails..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-pink-500/50 transition-colors"
                />
              </div>
            </div>

            {/* Email List */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
                </div>
              ) : emails.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center px-4">
                  <Mail className="w-12 h-12 text-gray-700 mb-3" />
                  <p className="text-sm text-gray-500">No emails found</p>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {emails.map(email => (
                    <button
                      key={email.id}
                      onClick={() => handleSelectEmail(email)}
                      className={`w-full px-4 py-3 hover:bg-white/5 transition-colors text-left flex items-start gap-3 ${
                        !email.isRead ? 'bg-pink-500/5' : ''
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        !email.isRead ? 'bg-pink-500 text-white' : 'bg-white/10 text-gray-400'
                      }`}>
                        {(email.fromName || email.from).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <h4 className={`text-sm truncate ${!email.isRead ? 'font-bold' : 'font-medium'}`}>
                            {email.fromName || email.from}
                          </h4>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {email.hasAttachments && <Paperclip className="w-3 h-3 text-gray-500" />}
                            <span className="text-[10px] text-gray-500">{formatDate(email.date)}</span>
                          </div>
                        </div>
                        <p className={`text-xs truncate mb-1 ${!email.isRead ? 'text-white' : 'text-gray-400'}`}>
                          {email.subject}
                        </p>
                        <p className="text-[11px] text-gray-500 truncate">
                          {email.snippet}
                        </p>
                      </div>
                      {!email.isRead && (
                        <div className="w-2 h-2 rounded-full bg-pink-500 mt-2 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          /* Email Detail View */
          <div className="flex-1 overflow-y-auto">
            <div className="p-6 border-b border-white/10">
              <h2 className="text-xl font-bold mb-3">{selectedEmail.subject}</h2>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500/30 to-blue-500/30 flex items-center justify-center text-sm font-bold">
                    {(selectedEmail.fromName || selectedEmail.from).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{selectedEmail.fromName || selectedEmail.from}</p>
                    <p className="text-xs text-gray-500">{selectedEmail.from}</p>
                  </div>
                </div>
                <span className="text-xs text-gray-500">
                  {new Date(selectedEmail.date).toLocaleString()}
                </span>
              </div>

              {/* AI Summary */}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={handleAISummarize}
                  disabled={generatingSummary}
                  className="px-3 py-1.5 bg-pink-500/10 hover:bg-pink-500/20 text-pink-400 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 border border-pink-500/30 disabled:opacity-50"
                >
                  {generatingSummary ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Summarizing...</>
                  ) : (
                    <><Sparkles className="w-3 h-3" /> AI Summary</>
                  )}
                </button>
                <button
                  onClick={handleAIReply}
                  disabled={sendingReply}
                  className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 border border-blue-500/30 disabled:opacity-50"
                >
                  <Sparkles className="w-3 h-3" /> AI Reply
                </button>
                <button
                  onClick={() => { setShowReply(true); setReplyText(''); }}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 border border-white/10"
                >
                  <Reply className="w-3 h-3" /> Reply
                </button>
              </div>

              {aiSummary && (
                <div className="mt-3 bg-pink-500/5 border border-pink-500/20 p-3 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                    <span className="text-xs font-bold text-pink-400">AI Summary</span>
                  </div>
                  <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">{aiSummary}</p>
                </div>
              )}
            </div>

            {/* Email Body */}
            <div className="p-6 prose prose-invert max-w-none">
              {selectedEmail.body.includes('<') ? (
                <div
                  className="text-sm text-gray-300 leading-relaxed"
                  style={{ wordBreak: 'break-word' }}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedEmail.body) }}
                />
              ) : (
                <pre className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap font-sans">
                  {selectedEmail.body}
                </pre>
              )}
            </div>

            {/* Reply Box */}
            {showReply && (
              <div className="border-t border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Reply className="w-4 h-4 text-pink-500" />
                  <span className="text-sm font-bold">Reply to {selectedEmail.fromName || selectedEmail.from}</span>
                </div>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type your reply..."
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-pink-500/50 transition-colors resize-none h-32"
                  disabled={sendingReply}
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={handleSendReply}
                    disabled={sendingReply || !replyText.trim()}
                    className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {sendingReply ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending...</>
                    ) : (
                      <><Send className="w-3.5 h-3.5" /> Send</>
                    )}
                  </button>
                  <button
                    onClick={() => { setShowReply(false); setReplyText(''); }}
                    className="px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

// Basic HTML sanitization (removes script tags, event handlers)
function sanitizeHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

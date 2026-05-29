/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Send, Sparkles, Loader2, Mail, Plus, Minus, Bold, Italic, Wand2, Save } from 'lucide-react';
import { gmailService } from '../services/gmail-service';
import { outlookService } from '../services/outlook-service';

interface EmailComposerProps {
  provider: 'gmail' | 'outlook';
  onClose: () => void;
  initialDraft?: {
    to?: string;
    subject?: string;
    body?: string;
    replyToId?: string;
  };
}

export const EmailComposer: React.FC<EmailComposerProps> = ({ provider, onClose, initialDraft }) => {
  const [to, setTo] = useState(initialDraft?.to || '');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(initialDraft?.subject || '');
  const [body, setBody] = useState(initialDraft?.body || '');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [aiInstructions, setAiInstructions] = useState('');
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [importance, setImportance] = useState<'low' | 'normal' | 'high'>('normal');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const providerName = provider === 'gmail' ? 'Gmail' : 'Outlook';
  const accentColor = provider === 'gmail' ? '#EA4335' : '#0078D4';

  const handleAICompose = async () => {
    if (!aiInstructions.trim()) {
      setError('Please describe what you want to say');
      return;
    }

    setIsComposing(true);
    setError(null);

    try {
      // Use Gmail's compose-ai (works for both since it uses Gemini)
      const draft = await gmailService.composeWithAI(aiInstructions);
      
      if (draft.to && draft.to.length > 0 && !to) {
        setTo(draft.to.join(', '));
      }
      if (draft.subject && !subject) {
        setSubject(draft.subject);
      }
      if (draft.body) {
        setBody(draft.body);
      }
      
      setShowAiPanel(false);
      setAiInstructions('');
    } catch (err: any) {
      setError(`AI compose failed: ${err.message}`);
    } finally {
      setIsComposing(false);
    }
  };

  const handleSend = async () => {
    if (!to.trim()) { setError('Please enter at least one recipient'); return; }
    if (!subject.trim()) { setError('Please enter a subject'); return; }
    if (!body.trim()) { setError('Please enter a message'); return; }

    setIsSending(true);
    setError(null);

    const toList = to.split(',').map(s => s.trim()).filter(Boolean);
    const ccList = cc.split(',').map(s => s.trim()).filter(Boolean);
    const bccList = bcc.split(',').map(s => s.trim()).filter(Boolean);

    try {
      let result;
      if (provider === 'gmail') {
        result = await gmailService.sendEmail({
          to: toList,
          cc: ccList.length > 0 ? ccList : undefined,
          subject,
          body,
          replyToId: initialDraft?.replyToId
        });
      } else {
        result = await outlookService.sendEmail({
          to: toList,
          cc: ccList.length > 0 ? ccList : undefined,
          bcc: bccList.length > 0 ? bccList : undefined,
          subject,
          body,
          isHtml: true,
          importance
        });
      }

      if (result.success) {
        setSuccess(true);
        setTimeout(onClose, 1500);
      } else {
        setError(result.error || 'Failed to send email');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSending(false);
    }
  };

  const handleEnhanceWithAI = async (action: 'improve' | 'shorten' | 'formalize' | 'casual') => {
    if (!body.trim()) { setError('Write something first to enhance'); return; }

    setIsComposing(true);
    setError(null);

    try {
      const prompts: Record<string, string> = {
        improve: `Improve this email - make it clearer, more professional, fix grammar:\n\n${body}\n\nReturn JSON with field 'body' (HTML formatted)`,
        shorten: `Make this email shorter and more concise while keeping the key message:\n\n${body}\n\nReturn JSON with field 'body' (HTML formatted)`,
        formalize: `Make this email more formal and professional:\n\n${body}\n\nReturn JSON with field 'body' (HTML formatted)`,
        casual: `Make this email more casual and friendly:\n\n${body}\n\nReturn JSON with field 'body' (HTML formatted)`
      };

      const draft = await gmailService.composeWithAI(prompts[action]);
      if (draft.body) setBody(draft.body);
    } catch (err: any) {
      setError(`AI enhancement failed: ${err.message}`);
    } finally {
      setIsComposing(false);
    }
  };

  // Clear error when user types
  useEffect(() => {
    if (error) setError(null);
  }, [to, subject, body]);

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
        className="w-full max-w-3xl max-h-[90vh] bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl" style={{ backgroundColor: `${accentColor}20` }}>
              <Mail className="w-5 h-5" style={{ color: accentColor }} />
            </div>
            <div>
              <h3 className="text-lg font-bold">New Email</h3>
              <p className="text-xs text-gray-500">Sending via {providerName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAiPanel(!showAiPanel)}
              className={`p-2 rounded-xl transition-all flex items-center gap-1.5 ${
                showAiPanel ? 'bg-pink-500/20 text-pink-400' : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
              title="AI Compose"
            >
              <Sparkles className="w-4 h-4" />
              <span className="text-xs font-bold">AI</span>
            </button>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* AI Panel */}
        {showAiPanel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-white/10 bg-pink-500/5"
          >
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs">
                <Wand2 className="w-3.5 h-3.5 text-pink-400" />
                <span className="font-bold text-pink-400">AI Compose</span>
                <span className="text-gray-500">— Describe what you want to say, Kiara will draft it</span>
              </div>
              <textarea
                value={aiInstructions}
                onChange={(e) => setAiInstructions(e.target.value)}
                placeholder="e.g. Write a polite email to Raj at raj@example.com asking him to confirm the meeting tomorrow at 5pm. Mention I'll bring the project deck."
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-pink-500/50 transition-colors resize-none h-20"
                disabled={isComposing}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAICompose}
                  disabled={isComposing || !aiInstructions.trim()}
                  className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isComposing ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Composing...</>
                  ) : (
                    <><Sparkles className="w-3.5 h-3.5" /> Generate</>
                  )}
                </button>
                {body && (
                  <>
                    <button
                      onClick={() => handleEnhanceWithAI('improve')}
                      disabled={isComposing}
                      className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50 border border-white/10"
                    >
                      Improve
                    </button>
                    <button
                      onClick={() => handleEnhanceWithAI('shorten')}
                      disabled={isComposing}
                      className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50 border border-white/10"
                    >
                      Shorten
                    </button>
                    <button
                      onClick={() => handleEnhanceWithAI('formalize')}
                      disabled={isComposing}
                      className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50 border border-white/10"
                    >
                      Formalize
                    </button>
                    <button
                      onClick={() => handleEnhanceWithAI('casual')}
                      disabled={isComposing}
                      className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50 border border-white/10"
                    >
                      Casual
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* Compose Form */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {/* To */}
          <div className="flex items-center gap-3 border-b border-white/5 pb-3">
            <label className="w-12 text-xs text-gray-500 font-medium">To</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com (separate multiple with commas)"
              className="flex-1 bg-transparent text-sm text-white placeholder:text-gray-600 focus:outline-none"
              disabled={isSending}
            />
            {!showCcBcc && (
              <button
                onClick={() => setShowCcBcc(true)}
                className="text-[10px] text-gray-500 hover:text-pink-400 font-bold uppercase tracking-wider"
              >
                Cc/Bcc
              </button>
            )}
          </div>

          {showCcBcc && (
            <>
              <div className="flex items-center gap-3 border-b border-white/5 pb-3">
                <label className="w-12 text-xs text-gray-500 font-medium">Cc</label>
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="cc@example.com"
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-gray-600 focus:outline-none"
                  disabled={isSending}
                />
              </div>
              {provider === 'outlook' && (
                <div className="flex items-center gap-3 border-b border-white/5 pb-3">
                  <label className="w-12 text-xs text-gray-500 font-medium">Bcc</label>
                  <input
                    type="text"
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="bcc@example.com"
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-gray-600 focus:outline-none"
                    disabled={isSending}
                  />
                </div>
              )}
            </>
          )}

          {/* Subject */}
          <div className="flex items-center gap-3 border-b border-white/5 pb-3">
            <label className="w-12 text-xs text-gray-500 font-medium">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
              className="flex-1 bg-transparent text-sm text-white placeholder:text-gray-600 focus:outline-none font-medium"
              disabled={isSending}
            />
            {provider === 'outlook' && (
              <select
                value={importance}
                onChange={(e) => setImportance(e.target.value as any)}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-gray-400 focus:outline-none"
                disabled={isSending}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            )}
          </div>

          {/* Body */}
          <div className="pt-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type your message..."
              className="w-full bg-transparent text-sm text-white placeholder:text-gray-600 focus:outline-none resize-none min-h-[300px] leading-relaxed"
              disabled={isSending}
              dir="auto"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-xl">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-green-500/10 border border-green-500/30 p-3 rounded-xl">
              <p className="text-xs text-green-400">Email sent successfully!</p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-between">
          <div className="text-[10px] text-gray-500">
            {body.length > 0 && `${body.split(/\s+/).filter(Boolean).length} words`}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs text-gray-400 hover:text-white transition-colors"
              disabled={isSending}
            >
              Discard
            </button>
            <button
              onClick={handleSend}
              disabled={isSending || success}
              className="px-5 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-sm font-bold transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {isSending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
              ) : success ? (
                <><Send className="w-4 h-4" /> Sent!</>
              ) : (
                <><Send className="w-4 h-4" /> Send</>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

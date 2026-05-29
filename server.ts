import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import { createProxyMiddleware } from 'http-proxy-middleware';
import dotenv from 'dotenv';

// Load environment variables from .env if it exists
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase config manually to avoid 'assert' syntax issues in some Node environments
const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf8")
);

// Initialize Firebase Admin (using client config for project ID)
// Note: In a real production env, you'd use a service account.
// Here we assume the environment has default credentials or we use the project ID.
const adminApp = initializeApp({
  projectId: firebaseConfig.projectId,
});
const db = getFirestore(adminApp);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Key Middleware
  const validateApiKey = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.headers['x-api-key'] as string;
    const secret = req.headers['x-api-secret'] as string;

    if (!key || !secret) {
      return res.status(401).json({ error: "Missing API Key or Secret" });
    }

    try {
      const keysRef = db.collection('api_keys');
      const snapshot = await keysRef.where('key', '==', key).where('secret', '==', secret).get();

      if (snapshot.empty) {
        return res.status(401).json({ error: "Invalid API Key or Secret" });
      }

      next();
    } catch (error) {
      console.error("Auth Error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };

  // ERP Endpoints
  app.get("/api/erp/tasks", validateApiKey, async (req, res) => {
    try {
      const snapshot = await db.collection('tasks').get();
      const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.get("/api/erp/team", validateApiKey, async (req, res) => {
    try {
      const snapshot = await db.collection('users').get();
      const team = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(team);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch team" });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      env: process.env.NODE_ENV,
      hasKey: !!process.env.GEMINI_API_KEY,
      keyPrefix: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 4) : 'none',
      time: new Date().toISOString()
    });
  });

  // ============ WhatsApp Integration (Twilio) ============
  
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

  // Send WhatsApp message
  app.post("/api/whatsapp/send", async (req, res) => {
    const { to, body, mediaUrl, userId } = req.body;

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return res.status(503).json({ success: false, error: "WhatsApp integration not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN." });
    }

    if (!to || !body) {
      return res.status(400).json({ success: false, error: "Missing 'to' or 'body' in request" });
    }

    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const params = new URLSearchParams();
      params.append('To', to.startsWith('whatsapp:') ? to : `whatsapp:${to}`);
      params.append('From', TWILIO_WHATSAPP_NUMBER);
      params.append('Body', body);
      if (mediaUrl) params.append('MediaUrl', mediaUrl);

      const response = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      const data = await response.json();

      if (data.sid) {
        res.json({ success: true, messageId: data.sid });
      } else {
        res.status(400).json({ success: false, error: data.message || "Failed to send message" });
      }
    } catch (error: any) {
      console.error("WhatsApp send error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Smart Reply - AI generates a contextual response and sends it
  app.post("/api/whatsapp/smart-reply", async (req, res) => {
    const { to, incomingMessage, context, userId } = req.body;

    if (!realApiKey) {
      return res.status(503).json({ success: false, error: "AI service not configured" });
    }

    try {
      // Generate smart reply using Gemini
      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${realApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `You are Kiara, a personal AI assistant. Generate a contextual WhatsApp reply.
            
Incoming message: "${incomingMessage}"
${context ? `Context: ${context}` : ''}

Rules:
- Keep it conversational and natural
- Match the tone of the incoming message
- Be concise (WhatsApp style)
- If the message requires action, acknowledge it

Reply:` }] }]
          })
        }
      );

      const aiData = await aiResponse.json();
      const reply = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "Got it! I'll get back to you.";

      // Send the reply via WhatsApp if Twilio is configured
      if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
        const params = new URLSearchParams();
        params.append('To', to.startsWith('whatsapp:') ? to : `whatsapp:${to}`);
        params.append('From', TWILIO_WHATSAPP_NUMBER);
        params.append('Body', reply);

        await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });
      }

      // Store in Firestore
      await db.collection('whatsapp_messages').add({
        from: 'kiara',
        to,
        body: reply,
        direction: 'outgoing',
        status: 'sent',
        timestamp: new Date(),
        userId,
        isProcessed: true
      });

      res.json({ success: true, reply });
    } catch (error: any) {
      console.error("Smart reply error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Webhook for incoming WhatsApp messages (Twilio calls this URL)
  app.post("/api/whatsapp/webhook", async (req, res) => {
    const { From, Body, MessageSid, MediaUrl0, MediaContentType0 } = req.body;

    console.log(`WhatsApp Webhook: Message from ${From}: ${Body}`);

    try {
      // Find the user associated with this phone number
      const usersRef = db.collection('users');
      const snapshot = await usersRef.where('whatsapp', '==', From?.replace('whatsapp:', '')).get();

      let userId = 'unknown';
      if (!snapshot.empty) {
        userId = snapshot.docs[0].id;
      }

      // Store incoming message
      await db.collection('whatsapp_messages').add({
        from: From,
        to: TWILIO_WHATSAPP_NUMBER,
        body: Body,
        direction: 'incoming',
        status: 'delivered',
        mediaUrl: MediaUrl0 || null,
        mediaType: MediaContentType0 || null,
        timestamp: new Date(),
        userId,
        isProcessed: false,
        twilioSid: MessageSid
      });

      // Update contact last message
      const contactId = `${userId}_${From?.replace('whatsapp:', '')}`;
      await db.collection('whatsapp_contacts').doc(contactId).set({
        phoneNumber: From?.replace('whatsapp:', ''),
        name: From?.replace('whatsapp:', ''),
        lastMessage: Body,
        lastMessageTime: new Date(),
        unreadCount: 1, // Firestore increment would be better
        userId
      }, { merge: true });

      // Respond with empty TwiML (acknowledge receipt)
      res.type('text/xml').send('<Response></Response>');
    } catch (error) {
      console.error("Webhook processing error:", error);
      res.type('text/xml').send('<Response></Response>');
    }
  });

  // Register WhatsApp number
  app.post("/api/whatsapp/register", async (req, res) => {
    const { phoneNumber, userId } = req.body;

    try {
      await db.collection('users').doc(userId).update({
        whatsapp: phoneNumber.replace(/[^0-9+]/g, '')
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // WhatsApp connection status
  app.get("/api/whatsapp/status", async (req, res) => {
    const userId = req.query.userId as string;
    
    if (!userId) {
      return res.json({ connected: false, error: "No userId provided" });
    }

    try {
      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.data();
      
      res.json({
        connected: !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && userData?.whatsapp),
        phoneNumber: userData?.whatsapp || null,
        twilioConfigured: !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
      });
    } catch (error: any) {
      res.json({ connected: false, error: error.message });
    }
  });

  // ============ Gmail Integration (Google OAuth2) ============

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/gmail/callback`;

  const GMAIL_SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
  ];

  // Get OAuth URL for Gmail connection
  app.get("/api/gmail/auth-url", (req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(503).json({ error: "Gmail integration not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." });
    }

    const userId = req.query.userId as string;
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: GMAIL_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: userId // Pass userId to identify user in callback
    });

    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  });

  // OAuth callback - exchanges code for tokens
  app.get("/api/gmail/callback", async (req, res) => {
    const { code, state: userId } = req.query;

    if (!code || !userId) {
      return res.status(400).send("Missing authorization code or user ID");
    }

    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: code as string,
          client_id: GOOGLE_CLIENT_ID!,
          client_secret: GOOGLE_CLIENT_SECRET!,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code'
        }).toString()
      });

      const tokens = await tokenResponse.json();

      if (tokens.error) {
        return res.status(400).send(`OAuth Error: ${tokens.error_description}`);
      }

      // Store tokens securely in Firestore
      await db.collection('gmail_tokens').doc(userId as string).set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in * 1000),
        scope: tokens.scope,
        updatedAt: new Date()
      });

      res.send(`<html><body><h2>Gmail Connected Successfully!</h2><p>You can close this window.</p><script>window.close();</script></body></html>`);
    } catch (error: any) {
      res.status(500).send(`Failed to connect Gmail: ${error.message}`);
    }
  });

  // Helper: Get valid access token (refresh if expired)
  async function getGmailAccessToken(userId: string): Promise<string | null> {
    try {
      const tokenDoc = await db.collection('gmail_tokens').doc(userId).get();
      if (!tokenDoc.exists) return null;

      const tokenData = tokenDoc.data()!;
      
      // Check if token is expired (with 5 min buffer)
      if (Date.now() > tokenData.expiresAt - 300000) {
        // Refresh token
        const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID!,
            client_secret: GOOGLE_CLIENT_SECRET!,
            refresh_token: tokenData.refreshToken,
            grant_type: 'refresh_token'
          }).toString()
        });

        const newTokens = await refreshResponse.json();
        if (newTokens.error) return null;

        await db.collection('gmail_tokens').doc(userId).update({
          accessToken: newTokens.access_token,
          expiresAt: Date.now() + (newTokens.expires_in * 1000),
          updatedAt: new Date()
        });

        return newTokens.access_token;
      }

      return tokenData.accessToken;
    } catch {
      return null;
    }
  }

  // Gmail connection status
  app.get("/api/gmail/status", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.json({ connected: false });

    const token = await getGmailAccessToken(userId);
    res.json({ connected: !!token, configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
  });

  // Disconnect Gmail
  app.post("/api/gmail/disconnect", async (req, res) => {
    const { userId } = req.body;
    try {
      await db.collection('gmail_tokens').doc(userId).delete();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Fetch inbox
  app.get("/api/gmail/inbox", async (req, res) => {
    const { userId, maxResults, pageToken } = req.query;
    const token = await getGmailAccessToken(userId as string);
    if (!token) return res.status(401).json({ success: false, error: "Gmail not connected" });

    try {
      const params = new URLSearchParams({
        maxResults: (maxResults as string) || '20',
        labelIds: 'INBOX'
      });
      if (pageToken) params.append('pageToken', pageToken as string);

      const listResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const listData = await listResponse.json();

      if (!listData.messages) {
        return res.json({ success: true, emails: [], nextPageToken: null });
      }

      // Fetch full details for each message (batch, max 10)
      const emails = await Promise.all(
        listData.messages.slice(0, 10).map(async (msg: any) => {
          const msgResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const msgData = await msgResponse.json();
          return parseGmailMessage(msgData);
        })
      );

      res.json({ success: true, emails, nextPageToken: listData.nextPageToken });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get single email
  app.get("/api/gmail/message/:id", async (req, res) => {
    const { userId } = req.query;
    const token = await getGmailAccessToken(userId as string);
    if (!token) return res.status(401).json({ success: false, error: "Gmail not connected" });

    try {
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      res.json({ success: true, email: parseGmailMessage(data) });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Send email
  app.post("/api/gmail/send", async (req, res) => {
    const { userId, to, cc, subject, body, replyToId } = req.body;
    const token = await getGmailAccessToken(userId);
    if (!token) return res.status(401).json({ success: false, error: "Gmail not connected" });

    try {
      const toHeader = Array.isArray(to) ? to.join(', ') : to;
      let rawEmail = `To: ${toHeader}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\n`;
      if (cc && cc.length > 0) rawEmail += `Cc: ${cc.join(', ')}\r\n`;
      rawEmail += `\r\n${body}`;

      const encodedEmail = Buffer.from(rawEmail).toString('base64url');

      const sendBody: any = { raw: encodedEmail };
      if (replyToId) sendBody.threadId = replyToId;

      const response = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(sendBody)
        }
      );

      const data = await response.json();
      if (data.id) {
        res.json({ success: true, messageId: data.id });
      } else {
        res.status(400).json({ success: false, error: data.error?.message || "Send failed" });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // AI-composed email
  app.post("/api/gmail/compose-ai", async (req, res) => {
    const { userId, instructions, replyTo } = req.body;

    if (!realApiKey) {
      return res.status(503).json({ success: false, error: "AI service not configured" });
    }

    try {
      // Get user's email patterns for personalization
      const patternsDoc = await db.collection('email_patterns').doc(userId).get();
      const patterns = patternsDoc.exists ? patternsDoc.data() : null;

      const prompt = `You are Kiara, a personal AI assistant composing an email on behalf of the user.

${patterns ? `User's email style:
- Tone: ${patterns.toneProfile || 'professional'}
- Common greetings: ${patterns.commonGreetings?.join(', ') || 'Hi'}
- Common sign-offs: ${patterns.commonSignoffs?.join(', ') || 'Best regards'}
` : ''}

Instructions from user: "${instructions}"

${replyTo ? `This is a reply to:
From: ${replyTo.from}
Subject: ${replyTo.subject}
Date: ${replyTo.date}
Body: ${replyTo.body?.substring(0, 500)}
` : ''}

Generate the email in JSON format with fields: to (array of emails), subject, body (HTML formatted).
Match the user's typical writing style if patterns are available.`;

      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${realApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        }
      );

      const aiData = await aiResponse.json();
      const draftText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
      const draft = JSON.parse(draftText);

      res.json({ success: true, draft });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Search emails
  app.get("/api/gmail/search", async (req, res) => {
    const { userId, q, maxResults } = req.query;
    const token = await getGmailAccessToken(userId as string);
    if (!token) return res.status(401).json({ success: false, error: "Gmail not connected" });

    try {
      const params = new URLSearchParams({
        q: q as string,
        maxResults: (maxResults as string) || '10'
      });

      const listResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const listData = await listResponse.json();

      if (!listData.messages) {
        return res.json({ success: true, emails: [] });
      }

      const emails = await Promise.all(
        listData.messages.slice(0, 10).map(async (msg: any) => {
          const msgResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const msgData = await msgResponse.json();
          return parseGmailMessage(msgData);
        })
      );

      res.json({ success: true, emails });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Mark as read
  app.post("/api/gmail/mark-read", async (req, res) => {
    const { userId, emailId } = req.body;
    const token = await getGmailAccessToken(userId);
    if (!token) return res.status(401).json({ success: false, error: "Gmail not connected" });

    try {
      await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}/modify`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
        }
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Unread count
  app.get("/api/gmail/unread-count", async (req, res) => {
    const { userId } = req.query;
    const token = await getGmailAccessToken(userId as string);
    if (!token) return res.json({ count: 0 });

    try {
      const response = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      res.json({ count: data.messagesUnread || 0 });
    } catch {
      res.json({ count: 0 });
    }
  });

  // Analyze email patterns
  app.post("/api/gmail/analyze-patterns", async (req, res) => {
    const { userId } = req.body;
    const token = await getGmailAccessToken(userId);
    if (!token) return res.status(401).json({ success: false, error: "Gmail not connected" });
    if (!realApiKey) return res.status(503).json({ success: false, error: "AI service not configured" });

    try {
      // Fetch last 30 sent emails for pattern analysis
      const sentResponse = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=30&labelIds=SENT',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const sentData = await sentResponse.json();

      if (!sentData.messages || sentData.messages.length === 0) {
        return res.json({ success: true, patterns: { toneProfile: 'mixed', commonGreetings: [], commonSignoffs: [] } });
      }

      // Fetch details of sent emails
      const sentEmails = await Promise.all(
        sentData.messages.slice(0, 15).map(async (msg: any) => {
          const msgResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          return await msgResponse.json();
        })
      );

      const emailBodies = sentEmails.map((e: any) => {
        const body = getEmailBody(e);
        const headers = e.payload?.headers || [];
        const to = headers.find((h: any) => h.name === 'To')?.value || '';
        const date = headers.find((h: any) => h.name === 'Date')?.value || '';
        return { body: body?.substring(0, 300), to, date };
      });

      // Use AI to analyze patterns
      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${realApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Analyze these sent emails and extract the user's communication patterns.
            
Emails: ${JSON.stringify(emailBodies)}

Return JSON with:
- toneProfile: "formal", "casual", or "mixed"
- commonGreetings: array of greetings used (e.g. "Hi", "Hey", "Dear")
- commonSignoffs: array of sign-offs used (e.g. "Best", "Thanks", "Regards")
- communicationStyle: brief description of their style
- topicsOfInterest: array of main topics they discuss
- preferredLanguage: primary language used
- peakHours: array of hours (0-23) when they typically send emails` }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        }
      );

      const aiData = await aiResponse.json();
      const patterns = JSON.parse(aiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}');

      // Store patterns
      await db.collection('email_patterns').doc(userId).set({
        ...patterns,
        userId,
        emailsAnalyzed: emailBodies.length,
        lastAnalyzed: new Date()
      }, { merge: true });

      res.json({ success: true, patterns });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Helper: Parse Gmail API message into our format
  function parseGmailMessage(msg: any) {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    return {
      id: msg.id,
      threadId: msg.threadId,
      from: getHeader('From'),
      to: getHeader('To').split(',').map((e: string) => e.trim()),
      cc: getHeader('Cc') ? getHeader('Cc').split(',').map((e: string) => e.trim()) : [],
      subject: getHeader('Subject'),
      body: getEmailBody(msg) || '',
      snippet: msg.snippet || '',
      date: getHeader('Date'),
      isRead: !msg.labelIds?.includes('UNREAD'),
      labels: msg.labelIds || [],
      hasAttachments: !!(msg.payload?.parts?.some((p: any) => p.filename && p.filename.length > 0))
    };
  }

  // Helper: Extract email body from Gmail message
  function getEmailBody(msg: any): string {
    const payload = msg.payload;
    if (!payload) return '';

    // Simple text body
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    }

    // Multipart - find text/plain or text/html
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64url').toString('utf-8');
        }
        if (part.mimeType === 'text/html' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64url').toString('utf-8');
        }
        // Nested multipart
        if (part.parts) {
          for (const subpart of part.parts) {
            if (subpart.body?.data) {
              return Buffer.from(subpart.body.data, 'base64url').toString('utf-8');
            }
          }
        }
      }
    }

    return '';
  }

  // ============ Google Calendar Integration ============

  // Sync reminders to Google Calendar
  app.post("/api/calendar/sync-reminder", async (req, res) => {
    const { userId, reminder } = req.body;
    const token = await getGmailAccessToken(userId); // Same OAuth tokens cover Calendar if scope included
    if (!token) return res.status(401).json({ success: false, error: "Google not connected" });

    try {
      const event = {
        summary: reminder.title,
        description: reminder.description || '',
        start: {
          dateTime: reminder.dueDate,
          timeZone: 'Asia/Kolkata'
        },
        end: {
          dateTime: new Date(new Date(reminder.dueDate).getTime() + 30 * 60000).toISOString(), // 30 min duration
          timeZone: 'Asia/Kolkata'
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 10 },
            { method: 'email', minutes: 30 }
          ]
        }
      };

      const response = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(event)
        }
      );

      const data = await response.json();
      if (data.id) {
        // Update reminder with calendar event ID
        if (reminder.id) {
          await db.collection('reminders').doc(reminder.id).update({
            'integrationStatus.googleCalendar': 'synced',
            googleCalendarEventId: data.id
          });
        }
        res.json({ success: true, eventId: data.id, eventLink: data.htmlLink });
      } else {
        res.status(400).json({ success: false, error: data.error?.message || "Failed to create event" });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get upcoming calendar events
  app.get("/api/calendar/events", async (req, res) => {
    const { userId, maxResults } = req.query;
    const token = await getGmailAccessToken(userId as string);
    if (!token) return res.status(401).json({ success: false, error: "Google not connected" });

    try {
      const params = new URLSearchParams({
        timeMin: new Date().toISOString(),
        maxResults: (maxResults as string) || '10',
        singleEvents: 'true',
        orderBy: 'startTime'
      });

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = await response.json();
      res.json({
        success: true,
        events: (data.items || []).map((e: any) => ({
          id: e.id,
          title: e.summary,
          description: e.description,
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          link: e.htmlLink
        }))
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ Push Notifications (Web Push / VAPID) ============

  // Generate VAPID keys: npx web-push generate-vapid-keys
  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:meit2swami@gmail.com';

  // Get VAPID public key for client subscription
  app.get("/api/push/vapid-key", (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
  });

  // Subscribe to push notifications
  app.post("/api/push/subscribe", async (req, res) => {
    const { subscription, userId } = req.body;
    if (!subscription || !userId) {
      return res.status(400).json({ error: "Missing subscription or userId" });
    }

    try {
      await db.collection('push_subscriptions').doc(userId).set({
        ...subscription,
        userId,
        createdAt: new Date(),
        platform: req.headers['user-agent']
      }, { merge: true });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Unsubscribe
  app.post("/api/push/unsubscribe", async (req, res) => {
    const { userId } = req.body;
    try {
      await db.collection('push_subscriptions').doc(userId).delete();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Send push notification to a user (internal API)
  app.post("/api/push/send", async (req, res) => {
    const { userId, title, body, data, tag } = req.body;

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return res.status(503).json({ success: false, error: "Push notifications not configured. Generate VAPID keys." });
    }

    try {
      const subDoc = await db.collection('push_subscriptions').doc(userId).get();
      if (!subDoc.exists) {
        return res.status(404).json({ success: false, error: "User not subscribed to push" });
      }

      const subscription = subDoc.data();

      // Use web-push library (dynamic import for ESM)
      const webpush = await import('web-push');
      webpush.default.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

      await webpush.default.sendNotification(
        { endpoint: subscription!.endpoint, keys: subscription!.keys },
        JSON.stringify({ title, body, tag, data, icon: '/icons/icon-192x192.png' })
      );

      res.json({ success: true });
    } catch (error: any) {
      console.error("Push send error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ Telegram Bot Integration ============

  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  // Generate a connect link for user to link their Telegram
  app.post("/api/telegram/connect-link", async (req, res) => {
    const { userId } = req.body;
    if (!TELEGRAM_BOT_TOKEN) {
      return res.status(503).json({ error: "Telegram bot not configured. Set TELEGRAM_BOT_TOKEN." });
    }

    // Generate a unique connection code
    const code = `kiara_${userId.substring(0, 8)}_${Date.now().toString(36)}`;
    
    // Store the pending connection
    await db.collection('telegram_pending').doc(code).set({
      userId,
      code,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 min expiry
    });

    // Get bot username
    let botUsername = 'KiaraAssistantBot';
    try {
      const meResponse = await fetch(`${TELEGRAM_API}/getMe`);
      const meData = await meResponse.json();
      if (meData.ok) botUsername = meData.result.username;
    } catch {}

    res.json({
      url: `https://t.me/${botUsername}?start=${code}`,
      botUsername,
      code
    });
  });

  // Telegram webhook (receives messages from Telegram)
  app.post("/api/telegram/webhook", async (req, res) => {
    const update = req.body;

    try {
      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text || '';

        // Handle /start command with connection code
        if (text.startsWith('/start kiara_')) {
          const code = text.replace('/start ', '');
          const pendingDoc = await db.collection('telegram_pending').doc(code).get();
          
          if (pendingDoc.exists) {
            const { userId } = pendingDoc.data()!;
            
            // Save Telegram config
            await db.collection('telegram_config').doc(userId).set({
              chatId: chatId.toString(),
              botUsername: msg.from?.username || '',
              isConnected: true,
              notifyReminders: true,
              notifyWhatsApp: true,
              notifyEmail: true,
              notifyCalendar: true,
              notifyPatternInsights: true,
              phoneCommandsEnabled: true,
              telegramUserId: msg.from?.id,
              telegramFirstName: msg.from?.first_name,
              connectedAt: new Date()
            });

            // Clean up pending
            await db.collection('telegram_pending').doc(code).delete();

            // Send welcome message
            await sendTelegramMessage(chatId, `🎉 *Kiara Connected!*\n\nHey ${msg.from?.first_name}! I'm now linked to your Kiara assistant.\n\n*What I can do:*\n📱 Control your phone remotely\n⏰ Forward reminders\n💬 Forward WhatsApp messages\n📧 Forward email notifications\n🧠 Answer questions from your memory\n\nType /help to see all commands.`);
          } else {
            await sendTelegramMessage(chatId, '❌ Invalid or expired connection code. Please generate a new link from Kiara settings.');
          }
          res.sendStatus(200);
          return;
        }

        // Find user by chatId
        const configSnapshot = await db.collection('telegram_config').where('chatId', '==', chatId.toString()).get();
        if (configSnapshot.empty) {
          await sendTelegramMessage(chatId, '⚠️ Not connected. Please connect via the Kiara app settings first.');
          res.sendStatus(200);
          return;
        }

        const userId = configSnapshot.docs[0].id;
        const config = configSnapshot.docs[0].data();

        // Route commands
        if (text.startsWith('/')) {
          await handleTelegramCommand(chatId, userId, text, config);
        } else {
          // Treat as a question to Kiara
          await handleTelegramAsk(chatId, userId, text);
        }
      }
    } catch (error) {
      console.error("Telegram webhook error:", error);
    }

    res.sendStatus(200);
  });

  // Send notification to user's Telegram
  app.post("/api/telegram/notify", async (req, res) => {
    const { userId, message, parse_mode } = req.body;

    try {
      const configDoc = await db.collection('telegram_config').doc(userId).get();
      if (!configDoc.exists || !configDoc.data()?.isConnected) {
        return res.json({ success: false, error: "Telegram not connected" });
      }

      const chatId = configDoc.data()!.chatId;
      await sendTelegramMessage(chatId, message, parse_mode || 'Markdown');
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Phone command via Telegram
  app.post("/api/telegram/phone-command", async (req, res) => {
    const { userId, command, params } = req.body;

    try {
      // Store command in Firestore for companion app to pick up
      const cmdRef = await db.collection('phone_commands').add({
        command,
        params: params || {},
        status: 'pending',
        userId,
        source: 'telegram',
        createdAt: new Date()
      });

      // Also send notification to companion app via FCM if configured
      // (FCM setup would be separate)

      res.json({ success: true, commandId: cmdRef.id });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Disconnect Telegram
  app.post("/api/telegram/disconnect", async (req, res) => {
    const { userId } = req.body;
    try {
      const configDoc = await db.collection('telegram_config').doc(userId).get();
      if (configDoc.exists) {
        const chatId = configDoc.data()!.chatId;
        await sendTelegramMessage(chatId, '👋 Kiara has been disconnected from this Telegram account. You can reconnect anytime from the app.');
      }
      await db.collection('telegram_config').doc(userId).update({ isConnected: false });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Set Telegram webhook URL (call this once during setup)
  app.post("/api/telegram/set-webhook", async (req, res) => {
    if (!TELEGRAM_BOT_TOKEN) {
      return res.status(503).json({ error: "Bot token not configured" });
    }

    const webhookUrl = `${process.env.APP_URL || req.protocol + '://' + req.get('host')}/api/telegram/webhook`;
    
    try {
      const response = await fetch(`${TELEGRAM_API}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl })
      });
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Helper: Send Telegram message
  async function sendTelegramMessage(chatId: string | number, text: string, parseMode: string = 'Markdown'): Promise<void> {
    if (!TELEGRAM_BOT_TOKEN) return;

    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true
      })
    });
  }

  // Helper: Handle Telegram commands
  async function handleTelegramCommand(chatId: string | number, userId: string, text: string, config: any): Promise<void> {
    const parts = text.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/help':
        await sendTelegramMessage(chatId, `📋 *Kiara Commands*\n\n*Phone Control:*\n/call +91... - Make a call\n/sms +91... message - Send SMS\n/volume 50 - Set volume (0-100)\n/silent - Silent mode\n/ring - Find my phone\n/battery - Check battery\n/location - Get location\n/flashlight - Toggle flashlight\n/dnd - Do Not Disturb\n/wifi - Toggle WiFi\n/bluetooth - Toggle BT\n/openapp AppName - Open app\n\n*Assistant:*\n/ask question - Ask Kiara\n/remember text - Save to memory\n/search query - Search memories\n/remind text - Set reminder\n/whatsapp +91... msg - Send WhatsApp\n/email addr Subject | Body - Send email\n/status - System status\n/insights - Pattern insights\n\n*Settings:*\n/settings - View settings\n/mute - Mute 1hr\n/unmute - Unmute\n/disconnect - Disconnect`);
        break;

      case '/call':
        if (!args) { await sendTelegramMessage(chatId, '❌ Usage: /call +919876543210'); return; }
        await db.collection('phone_commands').add({ command: 'CALL', params: { phoneNumber: args }, status: 'pending', userId, source: 'telegram', createdAt: new Date() });
        await sendTelegramMessage(chatId, `📞 Calling ${args}...`);
        break;

      case '/sms': {
        const smsMatch = args.match(/^(\+?\d+)\s+(.+)$/);
        if (!smsMatch) { await sendTelegramMessage(chatId, '❌ Usage: /sms +919876543210 Hello!'); return; }
        await db.collection('phone_commands').add({ command: 'SMS', params: { phoneNumber: smsMatch[1], message: smsMatch[2] }, status: 'pending', userId, source: 'telegram', createdAt: new Date() });
        await sendTelegramMessage(chatId, `📱 SMS sent to ${smsMatch[1]}`);
        break;
      }

      case '/volume':
        const vol = parseInt(args);
        if (isNaN(vol)) { await sendTelegramMessage(chatId, '❌ Usage: /volume 50'); return; }
        await db.collection('phone_commands').add({ command: 'SET_VOLUME', params: { level: vol }, status: 'pending', userId, source: 'telegram', createdAt: new Date() });
        await sendTelegramMessage(chatId, `🔊 Volume set to ${vol}%`);
        break;

      case '/silent':
        await db.collection('phone_commands').add({ command: 'SILENT_MODE', params: { enabled: true }, status: 'pending', userId, source: 'telegram', createdAt: new Date() });
        await sendTelegramMessage(chatId, '🔇 Silent mode enabled');
        break;

      case '/ring':
        await db.collection('phone_commands').add({ command: 'RING_PHONE', params: { duration: 30 }, status: 'pending', userId, source: 'telegram', createdAt: new Date() });
        await sendTelegramMessage(chatId, '🔔 Ringing your phone...');
        break;

      case '/battery':
        await db.collection('phone_commands').add({ command: 'GET_BATTERY', params: {}, status: 'pending', userId, source: 'telegram', createdAt: new Date() });
        await sendTelegramMessage(chatId, '🔋 Checking battery...');
        break;

      case '/location':
        await db.collection('phone_commands').add({ command: 'GET_LOCATION', params: {}, status: 'pending', userId, source: 'telegram', createdAt: new Date() });
        await sendTelegramMessage(chatId, '📍 Getting location...');
        break;

      case '/flashlight':
        await db.collection('phone_commands').add({ command: 'TOGGLE_FLASHLIGHT', params: {}, status: 'pending', userId, source: 'telegram', createdAt: new Date() });
        await sendTelegramMessage(chatId, '🔦 Toggling flashlight...');
        break;

      case '/dnd':
        await db.collection('phone_commands').add({ command: 'TOGGLE_DND', params: {}, status: 'pending', userId, source: 'telegram', createdAt: new Date() });
        await sendTelegramMessage(chatId, '🌙 Toggling Do Not Disturb...');
        break;

      case '/wifi':
        await db.collection('phone_commands').add({ command: 'TOGGLE_WIFI', params: {}, status: 'pending', userId, source: 'telegram', createdAt: new Date() });
        await sendTelegramMessage(chatId, '📶 Toggling WiFi...');
        break;

      case '/bluetooth':
        await db.collection('phone_commands').add({ command: 'TOGGLE_BLUETOOTH', params: {}, status: 'pending', userId, source: 'telegram', createdAt: new Date() });
        await sendTelegramMessage(chatId, '🔵 Toggling Bluetooth...');
        break;

      case '/openapp':
        if (!args) { await sendTelegramMessage(chatId, '❌ Usage: /openapp WhatsApp'); return; }
        await db.collection('phone_commands').add({ command: 'OPEN_APP', params: { appName: args }, status: 'pending', userId, source: 'telegram', createdAt: new Date() });
        await sendTelegramMessage(chatId, `📱 Opening ${args}...`);
        break;

      case '/ask':
        if (!args) { await sendTelegramMessage(chatId, '❌ Usage: /ask What meetings do I have?'); return; }
        await handleTelegramAsk(chatId, userId, args);
        break;

      case '/remember':
        if (!args) { await sendTelegramMessage(chatId, '❌ Usage: /remember Important fact to save'); return; }
        await db.collection('memories').add({
          content: args,
          type: 'note',
          priority: 'medium',
          structuredData: {},
          rawText: args,
          userId,
          source: 'telegram',
          createdAt: new Date()
        });
        await sendTelegramMessage(chatId, `🧠 Memorized: "${args}"`);
        break;

      case '/status':
        const statusDoc = await db.collection('device_status').doc(userId).get();
        if (statusDoc.exists) {
          const s = statusDoc.data()!;
          await sendTelegramMessage(chatId, `📊 *Device Status*\n\n🔋 Battery: ${s.battery}%${s.isCharging ? ' ⚡' : ''}\n📶 WiFi: ${s.wifiConnected ? '✅' : '❌'}\n🔵 BT: ${s.bluetoothEnabled ? '✅' : '❌'}\n🔊 Volume: ${s.volume}%\n🌙 DND: ${s.isDND ? '✅' : '❌'}\n📱 ${s.deviceName}\n🕐 Last seen: ${new Date(s.lastSeen).toLocaleString()}`);
        } else {
          await sendTelegramMessage(chatId, '❌ No device status. Is the companion app running?');
        }
        break;

      case '/settings':
        await sendTelegramMessage(chatId, `⚙️ *Notification Settings*\n\n⏰ Reminders: ${config.notifyReminders ? '✅' : '❌'}\n💬 WhatsApp: ${config.notifyWhatsApp ? '✅' : '❌'}\n📧 Email: ${config.notifyEmail ? '✅' : '❌'}\n📅 Calendar: ${config.notifyCalendar ? '✅' : '❌'}\n💡 Insights: ${config.notifyPatternInsights ? '✅' : '❌'}\n📱 Phone Cmds: ${config.phoneCommandsEnabled ? '✅' : '❌'}\n\nUse /mute or /unmute to control.`);
        break;

      case '/mute':
        await db.collection('telegram_config').doc(userId).update({ mutedUntil: new Date(Date.now() + 60 * 60 * 1000) });
        await sendTelegramMessage(chatId, '🔇 Notifications muted for 1 hour.');
        break;

      case '/unmute':
        await db.collection('telegram_config').doc(userId).update({ mutedUntil: null });
        await sendTelegramMessage(chatId, '🔔 Notifications unmuted.');
        break;

      case '/disconnect':
        await db.collection('telegram_config').doc(userId).update({ isConnected: false });
        await sendTelegramMessage(chatId, '👋 Disconnected. Reconnect anytime from Kiara.');
        break;

      default:
        await sendTelegramMessage(chatId, `❓ Unknown command. Type /help to see available commands.`);
    }
  }

  // Helper: Handle free-text questions via AI
  async function handleTelegramAsk(chatId: string | number, userId: string, question: string): Promise<void> {
    if (!realApiKey) {
      await sendTelegramMessage(chatId, '❌ AI not configured.');
      return;
    }

    try {
      await sendTelegramMessage(chatId, '🤔 Thinking...');

      // Get user's memories for context
      const memoriesSnapshot = await db.collection('memories')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();

      const context = memoriesSnapshot.docs.map(d => d.data().content).join('\n');

      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${realApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `You are Kiara, a personal AI assistant responding via Telegram. Be concise but helpful.

User's Memory Context:
${context || 'No memories yet.'}

User Question: ${question}

Answer concisely:` }] }]
          })
        }
      );

      const aiData = await aiResponse.json();
      const answer = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't process that. Try again?";

      await sendTelegramMessage(chatId, `💬 ${answer}`);
    } catch (error) {
      await sendTelegramMessage(chatId, '❌ Error processing your question. Please try again.');
    }
  }

  // ============ Outlook (Microsoft Graph) Integration ============

  const OUTLOOK_CLIENT_ID = process.env.OUTLOOK_CLIENT_ID;
  const OUTLOOK_CLIENT_SECRET = process.env.OUTLOOK_CLIENT_SECRET;
  const OUTLOOK_REDIRECT_URI = process.env.OUTLOOK_REDIRECT_URI || `http://localhost:${PORT}/api/outlook/callback`;
  const OUTLOOK_TENANT = process.env.OUTLOOK_TENANT || 'common';

  const OUTLOOK_SCOPES = [
    'offline_access',
    'User.Read',
    'Mail.Read',
    'Mail.Send',
    'Mail.ReadWrite',
    'Calendars.ReadWrite',
  ];

  // Get OAuth URL for Outlook connection
  app.get("/api/outlook/auth-url", (req, res) => {
    if (!OUTLOOK_CLIENT_ID || !OUTLOOK_CLIENT_SECRET) {
      return res.status(503).json({
        error: "Outlook integration not configured. Set OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET."
      });
    }

    const userId = req.query.userId as string;
    const params = new URLSearchParams({
      client_id: OUTLOOK_CLIENT_ID,
      response_type: 'code',
      redirect_uri: OUTLOOK_REDIRECT_URI,
      response_mode: 'query',
      scope: OUTLOOK_SCOPES.join(' '),
      state: userId,
      prompt: 'consent'
    });

    res.json({
      url: `https://login.microsoftonline.com/${OUTLOOK_TENANT}/oauth2/v2.0/authorize?${params}`
    });
  });

  // OAuth callback - exchanges code for tokens
  app.get("/api/outlook/callback", async (req, res) => {
    const { code, state: userId, error: oauthError, error_description } = req.query;

    if (oauthError) {
      return res.status(400).send(`<html><body><h2>Outlook OAuth Error</h2><p>${oauthError}: ${error_description}</p><script>setTimeout(() => window.close(), 5000);</script></body></html>`);
    }
    if (!code || !userId) {
      return res.status(400).send("Missing authorization code or user ID");
    }

    try {
      const tokenResponse = await fetch(`https://login.microsoftonline.com/${OUTLOOK_TENANT}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: code as string,
          client_id: OUTLOOK_CLIENT_ID!,
          client_secret: OUTLOOK_CLIENT_SECRET!,
          redirect_uri: OUTLOOK_REDIRECT_URI,
          grant_type: 'authorization_code',
          scope: OUTLOOK_SCOPES.join(' ')
        }).toString()
      });

      const tokens = await tokenResponse.json();

      if (tokens.error) {
        return res.status(400).send(`OAuth Error: ${tokens.error_description}`);
      }

      // Fetch user profile to get email address
      const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const profile = await profileResponse.json();

      // Store tokens
      await db.collection('outlook_tokens').doc(userId as string).set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in * 1000),
        scope: tokens.scope,
        email: profile.mail || profile.userPrincipalName,
        displayName: profile.displayName,
        updatedAt: new Date()
      });

      res.send(`<html><body style="font-family: system-ui; padding: 40px; text-align: center; background: #050505; color: white;">
        <h2 style="color: #ec4899;">Outlook Connected!</h2>
        <p>Connected as: ${profile.displayName} (${profile.mail || profile.userPrincipalName})</p>
        <p>You can close this window.</p>
        <script>setTimeout(() => window.close(), 2000);</script>
      </body></html>`);
    } catch (error: any) {
      res.status(500).send(`Failed to connect Outlook: ${error.message}`);
    }
  });

  // Helper: Get valid access token (refresh if expired)
  async function getOutlookAccessToken(userId: string): Promise<string | null> {
    try {
      const tokenDoc = await db.collection('outlook_tokens').doc(userId).get();
      if (!tokenDoc.exists) return null;

      const tokenData = tokenDoc.data()!;

      if (Date.now() > tokenData.expiresAt - 300000) {
        // Refresh token
        const refreshResponse = await fetch(`https://login.microsoftonline.com/${OUTLOOK_TENANT}/oauth2/v2.0/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: OUTLOOK_CLIENT_ID!,
            client_secret: OUTLOOK_CLIENT_SECRET!,
            refresh_token: tokenData.refreshToken,
            grant_type: 'refresh_token',
            scope: OUTLOOK_SCOPES.join(' ')
          }).toString()
        });

        const newTokens = await refreshResponse.json();
        if (newTokens.error) return null;

        await db.collection('outlook_tokens').doc(userId).update({
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token || tokenData.refreshToken,
          expiresAt: Date.now() + (newTokens.expires_in * 1000),
          updatedAt: new Date()
        });

        return newTokens.access_token;
      }

      return tokenData.accessToken;
    } catch {
      return null;
    }
  }

  // Outlook connection status
  app.get("/api/outlook/status", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.json({ connected: false });

    const token = await getOutlookAccessToken(userId);
    let email: string | undefined;
    if (token) {
      try {
        const tokenDoc = await db.collection('outlook_tokens').doc(userId).get();
        email = tokenDoc.data()?.email;
      } catch {}
    }
    res.json({
      connected: !!token,
      configured: !!(OUTLOOK_CLIENT_ID && OUTLOOK_CLIENT_SECRET),
      email
    });
  });

  // Disconnect Outlook
  app.post("/api/outlook/disconnect", async (req, res) => {
    const { userId } = req.body;
    try {
      await db.collection('outlook_tokens').doc(userId).delete();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Helper: Parse Outlook email from Graph API
  function parseOutlookEmail(msg: any): any {
    return {
      id: msg.id,
      conversationId: msg.conversationId,
      from: msg.from?.emailAddress?.address || '',
      fromName: msg.from?.emailAddress?.name || '',
      to: (msg.toRecipients || []).map((r: any) => r.emailAddress.address),
      cc: (msg.ccRecipients || []).map((r: any) => r.emailAddress.address),
      subject: msg.subject || '(No Subject)',
      body: msg.body?.content || '',
      bodyPreview: msg.bodyPreview || '',
      receivedDateTime: msg.receivedDateTime,
      isRead: msg.isRead,
      hasAttachments: msg.hasAttachments || false,
      importance: msg.importance || 'normal',
      webLink: msg.webLink || ''
    };
  }

  // Fetch inbox
  app.get("/api/outlook/inbox", async (req, res) => {
    const { userId, maxResults } = req.query;
    const token = await getOutlookAccessToken(userId as string);
    if (!token) return res.status(401).json({ success: false, error: "Outlook not connected" });

    try {
      const top = parseInt((maxResults as string) || '20');
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime desc`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      const emails = (data.value || []).map(parseOutlookEmail);
      res.json({ success: true, emails });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get single email
  app.get("/api/outlook/message/:id", async (req, res) => {
    const { userId } = req.query;
    const token = await getOutlookAccessToken(userId as string);
    if (!token) return res.status(401).json({ success: false, error: "Outlook not connected" });

    try {
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      res.json({ success: true, email: parseOutlookEmail(data) });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Send email
  app.post("/api/outlook/send", async (req, res) => {
    const { userId, to, cc, bcc, subject, body, isHtml, importance } = req.body;
    const token = await getOutlookAccessToken(userId);
    if (!token) return res.status(401).json({ success: false, error: "Outlook not connected" });

    try {
      const message = {
        subject,
        body: {
          contentType: isHtml === false ? 'Text' : 'HTML',
          content: body
        },
        toRecipients: (Array.isArray(to) ? to : [to]).map((email: string) => ({
          emailAddress: { address: email }
        })),
        ccRecipients: (cc || []).map((email: string) => ({
          emailAddress: { address: email }
        })),
        bccRecipients: (bcc || []).map((email: string) => ({
          emailAddress: { address: email }
        })),
        importance: importance || 'normal'
      };

      const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message, saveToSentItems: true })
      });

      if (response.status === 202) {
        res.json({ success: true });
      } else {
        const data = await response.json();
        res.status(400).json({ success: false, error: data.error?.message || "Send failed" });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Search emails
  app.get("/api/outlook/search", async (req, res) => {
    const { userId, q, maxResults } = req.query;
    const token = await getOutlookAccessToken(userId as string);
    if (!token) return res.status(401).json({ success: false, error: "Outlook not connected" });

    try {
      const top = parseInt((maxResults as string) || '10');
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages?$search="${encodeURIComponent(q as string)}"&$top=${top}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      const emails = (data.value || []).map(parseOutlookEmail);
      res.json({ success: true, emails });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Mark as read
  app.post("/api/outlook/mark-read", async (req, res) => {
    const { userId, emailId } = req.body;
    const token = await getOutlookAccessToken(userId);
    if (!token) return res.status(401).json({ success: false, error: "Outlook not connected" });

    try {
      await fetch(`https://graph.microsoft.com/v1.0/me/messages/${emailId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ isRead: true })
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Unread count
  app.get("/api/outlook/unread-count", async (req, res) => {
    const { userId } = req.query;
    const token = await getOutlookAccessToken(userId as string);
    if (!token) return res.json({ count: 0 });

    try {
      const response = await fetch(
        'https://graph.microsoft.com/v1.0/me/mailFolders/inbox',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      res.json({ count: data.unreadItemCount || 0 });
    } catch {
      res.json({ count: 0 });
    }
  });

  // Get calendar events
  app.get("/api/outlook/calendar/events", async (req, res) => {
    const { userId, maxResults } = req.query;
    const token = await getOutlookAccessToken(userId as string);
    if (!token) return res.status(401).json({ success: false, error: "Outlook not connected" });

    try {
      const top = parseInt((maxResults as string) || '10');
      const startDateTime = new Date().toISOString();
      const endDateTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${startDateTime}&endDateTime=${endDateTime}&$top=${top}&$orderby=start/dateTime`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();

      const events = (data.value || []).map((e: any) => ({
        id: e.id,
        subject: e.subject || '(No Subject)',
        bodyPreview: e.bodyPreview || '',
        start: e.start?.dateTime,
        end: e.end?.dateTime,
        location: e.location?.displayName,
        organizer: e.organizer?.emailAddress?.name,
        attendees: (e.attendees || []).map((a: any) => ({
          email: a.emailAddress.address,
          name: a.emailAddress.name,
          status: a.status?.response
        })),
        isOnlineMeeting: e.isOnlineMeeting || false,
        onlineMeetingUrl: e.onlineMeeting?.joinUrl,
        webLink: e.webLink
      }));

      res.json({ success: true, events });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Create calendar event
  app.post("/api/outlook/calendar/create-event", async (req, res) => {
    const { userId, subject, body, start, end, location, attendees } = req.body;
    const token = await getOutlookAccessToken(userId);
    if (!token) return res.status(401).json({ success: false, error: "Outlook not connected" });

    try {
      const event: any = {
        subject,
        body: { contentType: 'HTML', content: body || '' },
        start: { dateTime: start, timeZone: 'UTC' },
        end: { dateTime: end, timeZone: 'UTC' },
      };
      if (location) event.location = { displayName: location };
      if (attendees && attendees.length > 0) {
        event.attendees = attendees.map((email: string) => ({
          emailAddress: { address: email },
          type: 'required'
        }));
      }

      const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      });

      const data = await response.json();
      if (data.id) {
        res.json({ success: true, eventId: data.id, webLink: data.webLink });
      } else {
        res.status(400).json({ success: false, error: data.error?.message || "Failed to create event" });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Intelligence Engine API Proxy
  // This handles requests from the frontend that are routed through /api-proxy
  // It injects the real API_KEY from the server environment
  console.log("Server: Initializing Intelligence Engine API Proxy...");
  const realApiKey = process.env.GEMINI_API_KEY;
  console.log("Server: GEMINI_API_KEY status:", realApiKey ? "Set (starts with " + realApiKey.substring(0, 4) + ")" : "NOT SET");

  const proxyMiddleware = createProxyMiddleware({
    target: 'https://generativelanguage.googleapis.com',
    changeOrigin: true,
    ws: true,
    pathRewrite: (path) => {
      // Remove the prefix
      let newPath = path.replace(/^\/api-proxy/, '');
      
      // Ensure service names are formatted correctly
      // We don't force v1alpha anymore as gemini-2.0-flash is stable on v1beta
      
      if (newPath.includes('/ws/')) {
        // For WebSocket paths, the version is usually in the service name, not the path prefix
        // e.g. /ws/google.ai.generativelanguage.v1beta.GenerativeService/BidiGenerateContent
        // We just need to make sure we don't have a version prefix (v1, v1beta, v1alpha) in the path
        newPath = newPath.replace(/^\/v1beta\//, '/');
        newPath = newPath.replace(/^\/v1alpha\//, '/');
        newPath = newPath.replace(/^\/v1\//, '/');
      } else {
        // For REST paths, ensure a version prefix exists, defaulting to v1beta
        if (!newPath.match(/^\/v1/)) {
          newPath = '/v1beta' + (newPath.startsWith('/') ? newPath : '/' + newPath);
        }
      }
      
      console.log(`Proxy: Rewriting ${path} -> ${newPath}`);
      return newPath;
    },
    on: {
      proxyReq: (proxyReq, req) => {
        console.log(`Proxy (HTTP): Request to ${proxyReq.path}`);
        // Inject API key into the path for regular HTTP requests
        const url = new URL(proxyReq.path, 'https://generativelanguage.googleapis.com');
        const key = url.searchParams.get('key');
        if (key === 'MY_GEMINI_API_KEY' || !key || key === 'undefined' || key === '' || key === 'null') {
          if (realApiKey) {
            url.searchParams.set('key', realApiKey);
            proxyReq.path = url.pathname + url.search;
            console.log(`Proxy (HTTP): Injected key for ${url.pathname}`);
          } else {
            console.error(`Proxy (HTTP): FAILED to inject key for ${url.pathname} - GEMINI_API_KEY is missing!`);
          }
        }
      },
      proxyReqWs: (proxyReq, req, socket, options, head) => {
        console.log(`Proxy (WS): Incoming path: ${proxyReq.path}`);
        // Inject API key into the path for WebSocket requests
        const url = new URL(proxyReq.path, 'https://generativelanguage.googleapis.com');
        const key = url.searchParams.get('key');
        if (key === 'MY_GEMINI_API_KEY' || !key || key === 'undefined' || key === '' || key === 'null') {
          if (realApiKey) {
            url.searchParams.set('key', realApiKey);
            proxyReq.path = url.pathname + url.search;
            console.log(`Proxy (WS): Rewritten path: ${proxyReq.path}`);
          } else {
            console.error(`Proxy (WS): FAILED to inject key - GEMINI_API_KEY is missing!`);
          }
        }
      },
      error: (err, req, res) => {
        console.error('Proxy Error:', err);
      }
    },
  });

  app.use('/api-proxy', proxyMiddleware);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Handle WebSocket upgrade for the proxy
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.includes('/api-proxy')) {
      const originalUrl = req.url;
      // Manually apply path rewrite for the upgrade request to ensure v1alpha is used
      // This is critical because some proxy middleware implementations don't apply 
      // pathRewrite to the upgrade request correctly.
      let newUrl = req.url.replace(/^\/api-proxy/, '');
      
      // Handle gemini-2.0 models and bidiGenerateContent versioning
      if (newUrl.includes('gemini-2.0') || newUrl.includes('bidiGenerateContent')) {
        if (newUrl.includes('/ws/')) {
          newUrl = newUrl.replace(/^\/v1beta\//, '/');
          newUrl = newUrl.replace(/^\/v1alpha\//, '/');
          newUrl = newUrl.replace(/^\/v1\//, '/');
        } else {
          if (!newUrl.match(/^\/v1/)) {
            newUrl = '/v1beta' + (newUrl.startsWith('/') ? newUrl : '/' + newUrl);
          }
        }
      } else if (!newUrl.match(/^\/v1/)) {
        // Default to v1beta if no version is present
        newUrl = '/v1beta' + (newUrl.startsWith('/') ? newUrl : '/' + newUrl);
      }
      
      req.url = newUrl;
      console.log(`Proxy (WS Upgrade): Rewriting ${originalUrl} -> ${req.url}`);
      (proxyMiddleware as any).upgrade(req, socket, head);
    }
  });
}

startServer();

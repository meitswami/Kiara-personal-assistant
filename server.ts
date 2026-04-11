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
    res.json({ status: "ok" });
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
    pathRewrite: {
      '^/api-proxy': '', 
    },
    on: {
      proxyReq: (proxyReq, req) => {
        // Inject API key into the path for regular HTTP requests
        const url = new URL(proxyReq.path, 'https://generativelanguage.googleapis.com');
        const key = url.searchParams.get('key');
        if (key === 'MY_GEMINI_API_KEY' || !key || key === 'undefined' || key === '') {
          if (realApiKey) {
            url.searchParams.set('key', realApiKey);
            proxyReq.path = url.pathname + url.search;
            console.log(`Proxy (HTTP): Injected key for ${url.pathname}`);
          }
        }
      },
      proxyReqWs: (proxyReq, req, socket, options, head) => {
        // Inject API key into the path for WebSocket requests
        const url = new URL(proxyReq.path, 'https://generativelanguage.googleapis.com');
        const key = url.searchParams.get('key');
        if (key === 'MY_GEMINI_API_KEY' || !key || key === 'undefined' || key === '') {
          if (realApiKey) {
            url.searchParams.set('key', realApiKey);
            proxyReq.path = url.pathname + url.search;
            console.log(`Proxy (WS): Injected key for ${url.pathname}`);
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
      console.log(`Proxy (WS Upgrade): Handling upgrade for ${req.url}`);
      (proxyMiddleware as any).upgrade(req, socket, head);
    }
  });
}

startServer();

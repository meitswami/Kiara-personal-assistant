import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

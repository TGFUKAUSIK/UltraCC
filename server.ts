import express from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();


async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Server health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', app: 'UltraCC', system: 'Operating System Engine Active' });
  });

  // AI Academic Advisor & Bunk Reasoning endpoint
  app.post('/api/ai/advisor', async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(400).json({
          error: 'GEMINI_API_KEY environment variable is missing. Please set it in Settings > Secrets.',
        });
      }

      const { prompt, context } = req.body;

      const ai = new GoogleGenAI({ apiKey });

      const systemInstruction = `You are UltraCC's Intelligent Academic Strategist for VIT Chennai students.
You understand the FFCS credit system, A1+TA1/B1+TB1 slot structures, CAT1 (50 marks scaled to 15), CAT2 (50 marks scaled to 15), Digital Assignments (10 marks), Quiz/Surprise Test (10 marks), FAT (100 marks scaled to 40 or 50), and the strict 75% attendance rule.
Always give direct, actionable, student-first advice. Keep responses structured with concise bullet points, bold emphasis, and empathetic practical guidance. Never encourage reckless attendance loss, but calculate precise safe bunks.`;

      const userMessage = context
        ? `Student Context:\n${JSON.stringify(context, null, 2)}\n\nUser Question/Request:\n${prompt}`
        : prompt;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: userMessage,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      return res.json({ advice: response.text });
    } catch (err: any) {
      console.error('Error calling Gemini API:', err);
      return res.status(500).json({ error: err?.message || 'Failed to generate academic advice' });
    }
  });

  // NOTE: There is deliberately NO VTOP proxy endpoint here. VTOP credentials,
  // cookies, CAPTCHA and session tokens never touch this server — they stay in
  // the browser extension. The only AI integration is /api/ai/advisor, which
  // receives sanitized, minimum-necessary academic context.

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        // Local scratch databases churn constantly (WAL/SHM sidecars are written
        // every few seconds), so keep them out of the dependency graph — a watch
        // event there would otherwise trigger a full page reload mid-session.
        watch: { ignored: ['**/*.db-wal', '**/*.db-shm', '**/.supabase/**'] },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`UltraCC Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});

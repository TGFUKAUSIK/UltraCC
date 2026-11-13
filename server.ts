import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Server health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', app: 'UltraCC', system: 'Operating System Engine Active' });
  });

  // NOTE: There is deliberately NO VTOP proxy endpoint here, and no AI proxy
  // either. VTOP credentials, cookies, CAPTCHA and session tokens never touch
  // this server — they stay in the browser. The AI advisor calls Gemini from
  // the student's browser with the key they saved in Settings, so this process
  // holds no shared credential that a static token could pretend to protect.

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

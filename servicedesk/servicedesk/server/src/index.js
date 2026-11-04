import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { requireAuth, requireStaff } from './auth.js';
import authRoutes from './routes/auth.js';
import ticketRoutes, { attachments, lookups } from './routes/tickets.js';
import assetRoutes from './routes/assets.js';
import kbRoutes from './routes/kb.js';
import dashboardRoutes from './routes/dashboard.js';
import adminRoutes from './routes/admin.js';
import { startJobs } from './services/jobs.js';
import { startEmailPolling } from './services/emailIngest.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/tickets', requireAuth, ticketRoutes);
  app.use('/api/attachments', requireAuth, attachments);
  app.use('/api/lookups', requireAuth, lookups);
  app.use('/api/kb', requireAuth, kbRoutes);
  app.use('/api/assets', requireAuth, requireStaff, assetRoutes);
  app.use('/api/dashboard', requireAuth, requireStaff, dashboardRoutes);
  app.use('/api/admin', requireAuth, requireStaff, adminRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built web app (web/dist) with SPA fallback
  const dist = process.env.WEB_DIST || path.resolve(here, '../../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Errors
  app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Files must be smaller than ${config.maxAttachmentMb} MB` });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server. Check the server log.' : err.message });
  });
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  await migrate();
  fs.mkdirSync(config.uploadDir, { recursive: true });
  buildApp().listen(config.port, () => console.log(`[server] ServiceDesk listening on :${config.port}`));
  startJobs();
  startEmailPolling();
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { config, supabaseConfigured } from './config.js';
import { errorHandler } from './middleware/error.js';
import { publicRouter } from './routes/public.js';
import { userRouter } from './routes/user.js';
import { productivityRouter } from './routes/productivity.js';
import { startScheduler, refreshAll } from './services/ingest.js';

const app = express();

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(
  cors({
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    credentials: true,
  }),
);

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, supabase: supabaseConfigured, time: new Date().toISOString() }),
);

// Manual re-scrape trigger. Guarded by ADMIN_KEY if set; disabled otherwise.
app.post('/api/admin/refresh', (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.header('x-admin-key') !== key) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  void refreshAll();
  res.json({ ok: true, message: 'Refresh triggered' });
});

app.use('/api', publicRouter);
app.use('/api/me', userRouter);
app.use('/api/me', productivityRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[roznama-api] listening on http://localhost:${config.port}`);
  if (!supabaseConfigured) {
    console.warn('[roznama-api] Supabase not configured — user/auth routes will 500 until .env is set.');
  }
  startScheduler();
});

import express from 'express';
import { DEMO_PROMPT } from '../src/demoContent';
import { ReviewService, ReviewError } from './reviewService';

export function createApp(service: ReviewService, mode: 'mock' | 'gemini') {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!['127.0.0.1', 'localhost', '::1'].includes(req.hostname)) return res.status(403).json({ error: 'This demo accepts loopback hosts only.' });
    const origin = req.get('origin');
    if (origin && !['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173'].includes(origin)) return res.status(403).json({ error: 'Unexpected request origin.' });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/config', (_req, res) => res.json({ mode, prompt: DEMO_PROMPT }));
  const handle = (fn: (req: express.Request) => unknown) => async (req: express.Request, res: express.Response) => {
    try { res.json(await fn(req)); }
    catch (error) { res.status(error instanceof ReviewError ? error.status : 503).json({ error: error instanceof ReviewError ? error.message : 'The analysis provider is unavailable. Check server configuration; no credentials are returned to the browser.' }); }
  };
  app.post('/api/submissions', handle(req => service.create(req.body?.response)));
  app.get('/api/submissions/:id', handle(req => service.get(req.params.id)));
  app.post('/api/submissions/:id/analyze', handle(req => service.analyze(req.params.id)));
  app.patch('/api/submissions/:id/suggestions/:suggestionId', handle(req => service.decide(req.params.id, req.params.suggestionId, req.body?.decision, req.body?.revision)));
  app.post('/api/submissions/:id/publish', handle(req => service.publish(req.params.id, req.body?.scores, req.body?.notes, req.body?.verified)));
  app.get('/api/submissions/:id/report', handle(req => service.report(req.params.id)));
  app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(400).json({ error: 'Invalid request body.' }));
  return app;
}

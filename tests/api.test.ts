import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { ReviewService } from '../server/reviewService';
import { GeminiWritingReviewProvider } from '../src/lib/ai/geminiWritingReviewProvider';
import { DefaultWritingScoringStore } from '../src/lib/ai/writingScoringStore';
import { DemoScoringProvider, DemoFeedbackProvider } from '../server/mockProvider';
import { DEMO_RESPONSE } from '../src/demoContent';

let server: Server; let base: string;
beforeAll(async () => {
  const store = new DefaultWritingScoringStore(); store.clearAll();
  const service = new ReviewService(new GeminiWritingReviewProvider({ scoringProvider: new DemoScoringProvider(), feedbackProvider: new DemoFeedbackProvider(), scoringStore: store }));
  server = createApp(service, 'mock').listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe('Local API boundary', () => {
  it('exposes only public configuration and no private environment values', async () => {
    const result = await (await fetch(base + '/api/config')).json();
    expect(Object.keys(result).sort()).toEqual(['mode', 'prompt']);
    expect(result.mode).toBe('mock');
  });
  it('performs a complete synthetic submit/analyze/review/publish/report round trip', async () => {
    const call = async (path: string, body?: unknown, method = 'POST') => {
      const response = await fetch(base + path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      expect(response.ok).toBe(true); return response.json();
    };
    const item = await call('/api/submissions', { response: DEMO_RESPONSE });
    const review = await call(`/api/submissions/${item.id}/analyze`, {});
    for (const suggestion of review.analysis.annotations) await call(`/api/submissions/${item.id}/suggestions/${suggestion.id}`, { decision: 'ACCEPTED' }, 'PATCH');
    await call(`/api/submissions/${item.id}/publish`, { scores: { task: 6, cc: 6, lr: 6, gra: 6 }, notes: 'Synthetic verification completed for this local demonstration.', verified: true });
    const report = await call(`/api/submissions/${item.id}/report`);
    expect(report.response).toBe(DEMO_RESPONSE);
    expect(report.annotations).toHaveLength(3);
  });
  it('rejects requests from unexpected browser origins', async () => {
    const result = await fetch(base + '/api/config', { headers: { Origin: 'https://untrusted.example' } });
    expect(result.status).toBe(403);
  });
  it('rejects non-loopback hosts and malformed JSON', async () => {
    const hostStatus = await new Promise<number>(resolve => {
      const request = httpRequest(base + '/api/config', { headers: { Host: 'untrusted.example' } }, response => {
        response.resume(); resolve(response.statusCode!);
      });
      request.end();
    });
    expect(hostStatus).toBe(403);
    expect((await fetch(base + '/api/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' })).status).toBe(400);
  });
});

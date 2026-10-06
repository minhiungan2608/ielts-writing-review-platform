import { beforeEach, describe, expect, it } from 'vitest';
import { ReviewService } from '../server/reviewService';
import { GeminiWritingReviewProvider } from '../src/lib/ai/geminiWritingReviewProvider';
import { DefaultWritingScoringStore } from '../src/lib/ai/writingScoringStore';
import { DemoScoringProvider, DemoFeedbackProvider } from '../server/mockProvider';
import { DEMO_RESPONSE } from '../src/demoContent';

let service: ReviewService;
beforeEach(() => {
  const store = new DefaultWritingScoringStore(); store.clearAll();
  service = new ReviewService(new GeminiWritingReviewProvider({ scoringProvider: new DemoScoringProvider(), feedbackProvider: new DemoFeedbackProvider(), scoringStore: store }));
});
async function reviewed() {
  const item = service.create(DEMO_RESPONSE);
  const review = await service.analyze(item.id);
  for (const suggestion of review.analysis!.annotations) service.decide(item.id, suggestion.id, 'ACCEPTED');
  return item.id;
}
const scores = { task: 6.5, cc: 6, lr: 6.5, gra: 6 };
const notes = 'Synthetic reviewer note: practise subject–verb agreement and avoid double comparatives.';

describe('Human verification and snapshot publication', () => {
  it('blocks publication before analysis', () => {
    expect(() => service.publish(service.create(DEMO_RESPONSE).id, scores, notes, true)).toThrow('Complete analysis');
  });
  it('blocks publication with pending suggestions', async () => {
    const item = service.create(DEMO_RESPONSE); await service.analyze(item.id);
    expect(() => service.publish(item.id, scores, notes, true)).toThrow('Resolve every suggestion');
  });
  it('requires an explicit human verification and a note', async () => {
    const id = await reviewed();
    expect(() => service.publish(id, scores, notes, false)).toThrow('Verify');
    expect(() => service.publish(id, scores, 'short', true)).toThrow('Verify');
  });
  it('supports edits/rejections, separates reviewer estimates, and preserves the original essay', async () => {
    const item = service.create(DEMO_RESPONSE); const analysis = await service.analyze(item.id);
    const [first, second, third] = analysis.analysis!.annotations;
    service.decide(item.id, first.id, 'EDITED', 'libraries is');
    service.decide(item.id, second.id, 'ACCEPTED');
    service.decide(item.id, third.id, 'REJECTED');
    const published = service.publish(item.id, scores, notes, true);
    expect(published.report!.annotations).toHaveLength(2);
    expect(published.report!.finalBand).toBe(6.5);
    expect(published.analysis!.overall_band).toBe(6);
    expect(published.report!.response).toBe(DEMO_RESPONSE);
  });
  it('returns detached snapshots and prevents all edits after publication', async () => {
    const id = await reviewed(); service.publish(id, scores, notes, true);
    const report = service.report(id); report.notes = 'Mutated caller copy';
    expect(service.report(id).notes).toBe(notes);
    await expect(service.analyze(id)).rejects.toThrow('immutable');
    expect(() => service.decide(id, report.annotations[0].id, 'REJECTED')).toThrow('immutable');
    expect(() => service.publish(id, scores, notes, true)).toThrow('immutable');
  });
  it('rejects invalid input, unknown identifiers, and invalid reviewer scores', async () => {
    expect(() => service.create('short')).toThrow();
    expect(() => service.get('unknown-synthetic-id')).toThrow('not found');
    const id = await reviewed();
    expect(() => service.publish(id, { ...scores, gra: 9.5 }, notes, true)).toThrow('half-band');
    expect(() => service.publish(id, { ...scores, cc: 6.2 }, notes, true)).toThrow('half-band');
    expect(() => service.decide(id, service.get(id).analysis!.annotations[0].id, 'EDITED', '')).toThrow('revision');
  });
  it('does not publish an unfinished report through the report endpoint', () => {
    expect(() => service.report(service.create(DEMO_RESPONSE).id)).toThrow('not been published');
  });
});

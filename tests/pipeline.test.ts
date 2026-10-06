import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoScoringProvider, DemoFeedbackProvider } from '../server/mockProvider';
import { GeminiWritingReviewProvider } from '../src/lib/ai/geminiWritingReviewProvider';
import { DefaultWritingScoringStore } from '../src/lib/ai/writingScoringStore';
import { DEMO_PROMPT, DEMO_RESPONSE } from '../src/demoContent';
import { assertScoresImmutable, parseAndValidateStage1Scoring, parseAndValidateStage2Feedback, validateAndRecoverOffsets } from '../src/lib/ai/writingReviewSchemas';
import { GeminiWritingScoringProvider } from '../src/lib/ai/geminiWritingScoringProvider';

function pipeline() {
  const scoring = new DemoScoringProvider();
  const feedback = new DemoFeedbackProvider();
  const store = new DefaultWritingScoringStore();
  const provider = new GeminiWritingReviewProvider({ scoringProvider: scoring, feedbackProvider: feedback, scoringStore: store, model: 'synthetic-demo' });
  return { scoring, feedback, store, provider };
}
const input = { submissionId: 'synthetic-submission', taskType: 'TASK_2' as const, promptText: DEMO_PROMPT, studentResponse: DEMO_RESPONSE };
beforeEach(() => { new DefaultWritingScoringStore().clearAll(); vi.restoreAllMocks(); });

describe('Retained two-stage engineering', () => {
  it('anchors synthetic suggestions to unchanged text and freezes criterion estimates', async () => {
    const { provider } = pipeline();
    const result = await provider.reviewSubmission(input);
    expect(result.annotations).toHaveLength(3);
    for (const annotation of result.annotations) expect(input.studentResponse.slice(annotation.start_offset, annotation.end_offset)).toBe(annotation.original_text);
    expect(Object.isFrozen(result.criterionAssessment.gra)).toBe(true);
    expect(result.criterionAssessment.gra.estimated_band).toBe(6);
  });
  it('reuses scoring for identical content while retrying feedback', async () => {
    const { provider, scoring, feedback } = pipeline();
    const score = vi.spyOn(scoring, 'scoreSubmission');
    const generate = vi.spyOn(feedback, 'generateFeedback');
    await provider.reviewSubmission(input);
    const second = await provider.reviewSubmission({ ...input, action: 'RETRY_FEEDBACK' });
    expect(score).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(second.scoring_reused).toBe(true);
  });
  it('does not reuse scoring when the essay changes', async () => {
    const { provider, scoring } = pipeline();
    const score = vi.spyOn(scoring, 'scoreSubmission');
    await provider.reviewSubmission(input);
    await provider.reviewSubmission({ ...input, studentResponse: DEMO_RESPONSE + ' This final sentence is also synthetic.' });
    expect(score).toHaveBeenCalledTimes(2);
  });
  it('retains successful scoring when feedback fails', async () => {
    const { provider, feedback } = pipeline();
    vi.spyOn(feedback, 'generateFeedback').mockRejectedValue(new Error('Synthetic provider failure'));
    const result = await provider.reviewSubmission(input);
    expect(result.feedback_unavailable).toBe(true);
    expect(result.overall_band).toBe(6);
    expect(result.annotations).toEqual([]);
  });
  it('detects attempts to mutate scores between stages', async () => {
    const { scoring } = pipeline();
    const first = (await scoring.scoreSubmission(input)).criterionAssessment;
    const changed = structuredClone(first); changed.gra.estimated_band = 8;
    expect(() => assertScoresImmutable(first, changed)).toThrow('SCORE_IMMUTABILITY_VIOLATION');
  });
});

describe('Structured output validation', () => {
  it('rejects malformed model JSON', () => {
    expect(() => parseAndValidateStage1Scoring({ rawJson: 'not json', taskType: 'TASK_2', providerName: 'mock', modelName: 'synthetic-demo' })).toThrow();
  });
  it('drops invented feedback that cannot be anchored', () => {
    const parsed = parseAndValidateStage2Feedback({ rawJson: { annotations: [{ start_offset: 0, end_offset: 18, original_text: 'invented sentence', criterion: 'GRA', nature: 'GRAMMAR', severity: 'MINOR', issue: 'Synthetic invalid annotation', explanation: 'This text is absent.', suggested_revision: 'Different invented text', confidence: 'HIGH' }], summary: { strengths: [], priorities: [], overall_comment: 'Synthetic validation case.' } }, taskType: 'TASK_2', studentResponse: DEMO_RESPONSE, submissionId: 'synthetic-submission', providerName: 'mock', modelName: 'synthetic-demo' });
    expect(parsed.annotations).toEqual([]);
  });
  it('does not assign an ambiguous repeated anchor to an arbitrary occurrence', () => {
    expect(validateAndRecoverOffsets({ start_offset: 99, end_offset: 110, original_text: 'quiet room', criterion: 'GRA', nature: 'GRAMMAR', severity: 'MINOR', issue: 'Synthetic ambiguity case', explanation: 'Do not choose an arbitrary repeated anchor.', suggested_revision: 'calm room', confidence: 'HIGH' }, 'A quiet room. A quiet room.')).toBeNull();
  });
  it('rejects missing private credentials before attempting network access', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(new GeminiWritingScoringProvider({ apiKey: '' }).scoreSubmission(input)).rejects.toThrow('not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

import { randomUUID } from 'node:crypto';
import type { AISuggestionDecision, WritingAIReviewResult, WritingAISuggestion, WritingTaskType } from '../src/types';
import type { WritingReviewProvider } from '../src/lib/ai/writingReviewProvider';
import { calculateIELTSOverallBand } from '../src/lib/bandScores';
import { DEMO_PROMPT } from '../src/demoContent';

export type FinalScores = { task: number; cc: number; lr: number; gra: number };
export interface PublishedReport {
  publishedAt: string; response: string; notes: string; finalScores: FinalScores;
  finalBand: number; aiEstimate: number; annotations: WritingAISuggestion[];
}
export interface DemoSubmission {
  id: string; taskType: WritingTaskType; prompt: string; response: string;
  status: 'SUBMITTED' | 'REVIEWING' | 'PUBLISHED'; analysis?: WritingAIReviewResult; report?: PublishedReport;
}
export class ReviewError extends Error {
  constructor(message: string, public status: number = 400) { super(message); }
}
const copy = <T>(value: T): T => structuredClone(value);

export class ReviewService {
  private records = new Map<string, DemoSubmission>();
  private analyzing = new Set<string>();
  constructor(private provider: WritingReviewProvider) {}
  create(response: unknown): DemoSubmission {
    if (typeof response !== 'string' || response.trim().length < 20 || response.length > 5000) throw new ReviewError('Use 20–5,000 characters of synthetic writing.');
    const item: DemoSubmission = { id: randomUUID(), taskType: 'TASK_2', prompt: DEMO_PROMPT, response: response.trim(), status: 'SUBMITTED' };
    this.records.set(item.id, item);
    return copy(item);
  }
  get(id: string): DemoSubmission {
    const item = this.records.get(id);
    if (!item) throw new ReviewError('Submission not found.', 404);
    return copy(item);
  }
  private editable(id: string): DemoSubmission {
    const item = this.records.get(id);
    if (!item) throw new ReviewError('Submission not found.', 404);
    if (item.status === 'PUBLISHED') throw new ReviewError('The published snapshot is immutable. Create a new submission.', 409);
    if (this.analyzing.has(id)) throw new ReviewError('Analysis is already running.', 409);
    return item;
  }
  async analyze(id: string): Promise<DemoSubmission> {
    const item = this.editable(id);
    if (item.analysis && !item.analysis.feedback_unavailable) return copy(item);
    this.analyzing.add(id);
    try {
      item.analysis = await this.provider.reviewSubmission({ submissionId: id, taskType: item.taskType, promptText: item.prompt, studentResponse: item.response, action: item.analysis ? 'RETRY_FEEDBACK' : 'INITIAL_REVIEW' });
      item.status = 'REVIEWING';
      return copy(item);
    } finally { this.analyzing.delete(id); }
  }
  decide(id: string, suggestionId: string, decision: unknown, revision?: unknown): DemoSubmission {
    const item = this.editable(id);
    const suggestion = item.analysis?.annotations.find(a => a.id === suggestionId);
    if (!suggestion) throw new ReviewError('Suggestion not found.', 404);
    if (!['ACCEPTED', 'EDITED', 'REJECTED'].includes(String(decision))) throw new ReviewError('Choose accept, edit, or reject.');
    if (decision === 'EDITED') {
      if (typeof revision !== 'string' || !revision.trim() || revision.length > 1000) throw new ReviewError('An edited suggestion needs a revision of 1–1,000 characters.');
      suggestion.suggested_revision = revision.trim();
    }
    suggestion.decision = decision as AISuggestionDecision;
    return copy(item);
  }
  publish(id: string, scores: unknown, notes: unknown, verified: unknown): DemoSubmission {
    const item = this.editable(id);
    if (!item.analysis || item.analysis.feedback_unavailable) throw new ReviewError('Complete analysis before publication.', 409);
    if (item.analysis.annotations.some(a => a.decision === 'PENDING')) throw new ReviewError('Resolve every suggestion before publication.', 409);
    if (verified !== true || typeof notes !== 'string' || notes.trim().length < 10 || notes.length > 2000) throw new ReviewError('Verify the review and write a note of 10–2,000 characters.');
    const candidate = scores as Partial<FinalScores> | null;
    if (!candidate || ['task', 'cc', 'lr', 'gra'].some(k => {
      const value = candidate[k as keyof FinalScores];
      return typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 9 || value * 2 !== Math.floor(value * 2);
    })) throw new ReviewError('Reviewer estimates must be half-band numbers from 0 to 9.');
    const finalScores = { task: candidate.task!, cc: candidate.cc!, lr: candidate.lr!, gra: candidate.gra! };
    const finalBand = calculateIELTSOverallBand({ task_criterion_score: finalScores.task, cc_score: finalScores.cc, lr_score: finalScores.lr, gra_score: finalScores.gra })!;
    item.report = copy({ publishedAt: new Date().toISOString(), response: item.response, notes: notes.trim(), finalScores, finalBand, aiEstimate: item.analysis.overall_band ?? 0, annotations: item.analysis.annotations.filter(a => a.decision === 'ACCEPTED' || a.decision === 'EDITED') });
    item.status = 'PUBLISHED';
    return copy(item);
  }
  report(id: string): PublishedReport {
    const item = this.get(id);
    if (!item.report) throw new ReviewError('The report has not been published.', 404);
    return item.report;
  }
}

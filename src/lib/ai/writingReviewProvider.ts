import {
  WritingAIReviewInput,
  WritingAIReviewResult,
  WritingAICriterionAssessment,
  WritingAISuggestion,
  WritingAISummary,
  WritingTaskType,
} from '../../types';

// ====================================================================
// STAGE 1: SCORING PROVIDER CONTRACTS
// ====================================================================

export interface WritingAIScoringInput {
  submissionId: string;
  taskType: WritingTaskType;
  promptText: string;
  studentResponse: string;
}

export interface WritingAIScoringResult {
  criterionAssessment: WritingAICriterionAssessment;
  overall_band: number;
  metadata?: {
    provider: string;
    model: string;
    latency_ms: number;
    prompt_hash: string;
    generated_at?: string;
    scoring_reused?: boolean;
  };
}

export interface WritingScoringProvider {
  /**
   * Stage 1: Draft criterion assessment.
   * Produces draft estimates without private corpus context.
   */
  scoreSubmission(input: WritingAIScoringInput): Promise<WritingAIScoringResult>;
}

// ====================================================================
// STAGE 2: FEEDBACK PROVIDER CONTRACTS
// ====================================================================

export interface WritingAIFeedbackInput {
  submissionId: string;
  taskType: WritingTaskType;
  promptText: string;
  studentResponse: string;
  frozenCriterionAssessment: WritingAICriterionAssessment;
  overallBand: number;
  teacherContext?: string;
  retrievalMetadata?: {
    retrieval_used: boolean;
    retrieved_corrections_count: number;
    retrieved_principles_count: number;
  };
}

export interface WritingAIFeedbackResult {
  annotations: WritingAISuggestion[];
  summary: WritingAISummary;
  feedback_unavailable?: boolean;
  metadata?: {
    provider: string;
    model: string;
    latency_ms: number;
    prompt_hash: string;
    retrieval_used: boolean;
    retrieved_corrections_count: number;
    retrieved_principles_count: number;
    feedback_unavailable?: boolean;
  };
}

export interface WritingFeedbackProvider {
  /**
   * Stage 2: Pedagogical Feedback Generation.
   * Generates localized corrections and summary using frozen scores and optional teacher context.
   */
  generateFeedback(input: WritingAIFeedbackInput): Promise<WritingAIFeedbackResult>;
}

// ====================================================================
// ORCHESTRATED REVIEW PROVIDER CONTRACT (Backwards Compatible)
// ====================================================================

export interface WritingReviewProvider {
  /**
   * Reviews an IELTS writing submission using an AI model provider.
   * In Phase 4, orchestrates Stage 1 (Scoring) and Stage 2 (Feedback) with score immutability.
   */
  reviewSubmission(input: WritingAIReviewInput): Promise<WritingAIReviewResult>;
}

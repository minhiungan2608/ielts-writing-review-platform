// Writing-domain contracts retained from the original application. No account records.
export type WritingTaskType = 'TASK_1' | 'TASK_2';

export type WritingPromptStatus = 'ACTIVE' | 'ARCHIVED';

export type WritingSubmissionStatus = 'SUBMITTED' | 'REVIEWING' | 'PUBLISHED';

export interface WritingPrompt {
  id: string;
  task_type: WritingTaskType;
  category: string;
  title: string;
  prompt_text: string;
  image_url?: string | null;
  source?: string | null;
  status: WritingPromptStatus;
  created_at: string;
  metadata?: Record<string, any>;
}

export interface WritingSubmission {
  id: string;
  prompt_id: string;
  student_id: string;
  student_name: string;
  task_type: WritingTaskType;
  original_response: string;
  word_count: number;
  started_at: string;
  submitted_at: string;
  elapsed_seconds: number;
  status: WritingSubmissionStatus;
  parent_submission_id?: string | null;
  revision_number?: number;
  is_latest_revision?: boolean;
  superseded_by?: string | null;
  edited_at?: string | null;
  hidden_from_student?: boolean;
}

// ====================================================================
// IELTS WRITING MODULE TYPES (Phase 2 - Admin Review Workflow)
// ====================================================================

export type WritingReviewStatus = 'DRAFT' | 'READY_FOR_PUBLISH';

export type WritingCriterion =
  | 'TA'   // Task Achievement (Task 1)
  | 'TR'   // Task Response (Task 2)
  | 'CC'   // Coherence & Cohesion
  | 'LR'   // Lexical Resource
  | 'GRA'; // Grammatical Range & Accuracy

export type WritingAnnotationNature =
  | 'GRAMMAR'
  | 'VOCABULARY'
  | 'COHESION'
  | 'TASK_RESPONSE'
  | 'TASK_ACHIEVEMENT'
  | 'STYLE'
  | 'OTHER';

export type WritingAnnotationSeverity = 'MINOR' | 'MODERATE' | 'MAJOR';

export type WritingAnnotationDecision = 'ACTIVE' | 'RESOLVED';

export type WritingAnnotationSource = 'MANUAL' | 'AI_ACCEPTED' | 'AI_EDITED';

export interface WritingReview {
  id: string;
  submission_id: string;
  reviewer_id: string;
  status: WritingReviewStatus;

  task_criterion_score: number | null; // TA for Task 1, TR for Task 2
  cc_score: number | null;
  lr_score: number | null;
  gra_score: number | null;

  overall_band: number | null;

  strengths: string;
  priorities: string;
  overall_feedback: string;

  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface WritingAnnotation {
  id: string;
  review_id: string;
  submission_id: string;

  start_offset: number;
  end_offset: number;
  original_text: string;

  criterion: WritingCriterion;
  nature: WritingAnnotationNature;
  severity: WritingAnnotationSeverity;

  issue: string;
  explanation: string;
  suggested_revision: string;

  decision: WritingAnnotationDecision;
  source?: WritingAnnotationSource;

  created_at: string;
  updated_at: string;
}

export interface WritingQueueItem {
  submission_id: string;
  prompt_id: string;
  prompt_title: string;
  student_id: string;
  student_name: string;
  task_type: WritingTaskType;
  word_count: number;
  elapsed_seconds: number;
  submitted_at: string;
  submission_status: WritingSubmissionStatus;
  review_status?: WritingReviewStatus | null;
  review_id?: string | null;
  overall_band?: number | null;
  revision_number?: number | null;
  parent_submission_id?: string | null;
}

// ====================================================================
// IELTS WRITING MODULE TYPES (Phase 3 - AI Review Assistant)
// ====================================================================

export type AISuggestionDecision = 'PENDING' | 'ACCEPTED' | 'EDITED' | 'REJECTED';

export type WritingAISuggestionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface WritingAISuggestion {
  id: string;
  review_id: string;
  submission_id: string;

  start_offset: number;
  end_offset: number;
  original_text: string;

  criterion: WritingCriterion;
  nature: WritingAnnotationNature;
  severity: WritingAnnotationSeverity;

  issue: string;
  explanation: string;
  suggested_revision: string;

  confidence: WritingAISuggestionConfidence;
  decision: AISuggestionDecision;

  created_at: string;
  updated_at?: string;
  provider?: string;
  model?: string;
}

export interface WritingAICriterionAssessment {
  task_criterion: {
    criterion: 'TA' | 'TR';
    estimated_band: number;
    reason: string;
  };
  cc: {
    criterion: 'CC';
    estimated_band: number;
    reason: string;
  };
  lr: {
    criterion: 'LR';
    estimated_band: number;
    reason: string;
  };
  gra: {
    criterion: 'GRA';
    estimated_band: number;
    reason: string;
  };
}

export interface WritingAISummary {
  strengths: string[];
  priorities: string[];
  overall_comment: string;
  feedback_unavailable?: boolean;
}

export type WritingAIReviewAction = 'INITIAL_REVIEW' | 'RETRY_FEEDBACK' | 'FORCE_RESCORE';

export interface WritingAIReviewInput {
  submissionId: string;
  taskType: WritingTaskType;
  promptText: string;
  studentResponse: string;
  forceRescore?: boolean;
  action?: WritingAIReviewAction;
}

export interface WritingAIReviewResult {
  annotations: WritingAISuggestion[];
  criterionAssessment: WritingAICriterionAssessment;
  overall_band?: number;
  scoring_stage?: {
    provider: string;
    model: string;
    prompt_hash: string;
    generated_at?: string;
    reused: boolean;
  };
  summary: WritingAISummary;
  feedback_unavailable?: boolean;
  scoring_reused?: boolean;
  rawProviderMetadata?: unknown;
}

export interface WritingAIReviewState {
  exists: boolean;
  submissionId: string;
  criterionAssessment?: WritingAICriterionAssessment | null;
  overall_band?: number | null;
  task_type?: WritingTaskType;
  scoring_stage?: {
    provider: string;
    model: string;
    prompt_hash: string;
    scoring_prompt_hash?: string;
    generated_at: string;
    reused: boolean;
  } | null;
  annotations?: WritingAISuggestion[];
  summary?: WritingAISummary | null;
  feedback_unavailable?: boolean;
  scoring_reused?: boolean;
}

// ====================================================================
// PHASE 4: VERIFIED PUBLICATION SNAPSHOT & STUDENT REPORT TYPES
// ====================================================================

export interface WritingVerifiedSnapshot {
  id: string;
  submission_id: string;
  review_id: string;
  task_type: WritingTaskType;
  task_criterion_score: number | null;
  cc_score: number | null;
  lr_score: number | null;
  gra_score: number | null;
  overall_band: number | null;
  strengths: string;
  priorities: string;
  overall_feedback: string;
  published_at: string;
  published_by: string;
  created_at: string;
}

export interface WritingVerifiedAnnotation {
  id: string;
  snapshot_id: string;
  submission_id: string;
  start_offset: number;
  end_offset: number;
  original_text: string;
  criterion: WritingCriterion;
  nature: WritingAnnotationNature;
  severity: WritingAnnotationSeverity;
  issue: string;
  explanation: string;
  suggested_revision: string;
  created_at: string;
}

export interface StudentWritingReportBundle {
  submission: {
    id: string;
    prompt_id: string;
    task_type: WritingTaskType;
    original_response: string;
    word_count: number;
    elapsed_seconds: number;
    submitted_at: string;
    status: WritingSubmissionStatus;
  };
  prompt: {
    id?: string;
    title: string;
    prompt_text: string;
    image_url?: string | null;
    category: string;
  } | null;
  verifiedSnapshot: {
    task_criterion_score: number | null;
    cc_score: number | null;
    lr_score: number | null;
    gra_score: number | null;
    overall_band: number | null;
    strengths: string;
    priorities: string;
    overall_feedback: string;
    published_at: string;
  } | null;
  verifiedAnnotations: WritingVerifiedAnnotation[];
  isPublished: boolean;
}

export interface PublishWritingReviewResult {
  success: boolean;
  snapshot?: WritingVerifiedSnapshot;
  annotationsCount?: number;
  error?: string;
}

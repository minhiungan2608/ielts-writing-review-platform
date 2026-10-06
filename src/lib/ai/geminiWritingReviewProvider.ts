import {
  WritingReviewProvider,
  WritingScoringProvider,
  WritingFeedbackProvider,
  WritingAIFeedbackResult,
  WritingAIScoringResult,
} from './writingReviewProvider';
import {
  WritingAIReviewInput,
  WritingAIReviewResult,
  WritingAICriterionAssessment,
} from '../../types';
import { assertScoresImmutable, computePromptHash } from './writingReviewSchemas';
import { GeminiWritingScoringProvider } from './geminiWritingScoringProvider';
import { GeminiWritingFeedbackProvider } from './geminiWritingFeedbackProvider';
import {
  WritingScoringStore,
  defaultWritingScoringStore,
  isScoringArtifactValid,
} from './writingScoringStore';

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
  scoringProvider?: WritingScoringProvider;
  feedbackProvider?: WritingFeedbackProvider;
  enableTeacherContext?: boolean;
  scoringStore?: WritingScoringStore;
}

export class GeminiWritingReviewProvider implements WritingReviewProvider {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private timeoutMs: number;
  private scoringProvider: WritingScoringProvider;
  private feedbackProvider: WritingFeedbackProvider;
  private enableTeacherContext: boolean;
  private scoringStore: WritingScoringStore;

  constructor(options?: GeminiProviderOptions) {
    this.apiKey =
      options?.apiKey ||
      (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY ? process.env.GEMINI_API_KEY : '');
    this.model = options?.model || 'gemini-2.5-flash';
    this.temperature = options?.temperature ?? 0.2;
    this.timeoutMs = options?.timeoutMs ?? 30000;
    this.enableTeacherContext = false;
    this.scoringStore = options?.scoringStore || defaultWritingScoringStore;

    this.scoringProvider =
      options?.scoringProvider ||
      new GeminiWritingScoringProvider({
        apiKey: this.apiKey,
        model: this.model,
        temperature: this.temperature,
        timeoutMs: this.timeoutMs,
      });

    this.feedbackProvider =
      options?.feedbackProvider ||
      new GeminiWritingFeedbackProvider({
        apiKey: this.apiKey,
        model: this.model,
        temperature: this.temperature,
        timeoutMs: this.timeoutMs,
      });
  }

  async reviewSubmission(input: WritingAIReviewInput): Promise<WritingAIReviewResult> {
    // ====================================================================
    // STAGE 1: DRAFT CRITERION ESTIMATES (OR PERSISTED REUSE)
    // ====================================================================
    let scoringReused = false;
    let stage1Result: WritingAIScoringResult;

    const currentPromptHash = computePromptHash(input.promptText);
    const currentResponseHash = computePromptHash(input.studentResponse);

    const isForceRescore = input.action === 'FORCE_RESCORE' || Boolean(input.forceRescore);
    const allowReuse = !isForceRescore;
    if (isForceRescore) {
      await this.scoringStore.clear(input.submissionId, {
        promptHash: currentPromptHash,
        responseHash: currentResponseHash,
      });
    }
    const cachedArtifact = allowReuse
      ? await this.scoringStore.get(input.submissionId, {
          promptHash: currentPromptHash,
          responseHash: currentResponseHash,
        })
      : null;
    const isArtifactValid = cachedArtifact
      ? isScoringArtifactValid({
          artifact: cachedArtifact,
          promptText: input.promptText,
          studentResponse: input.studentResponse,
        })
      : false;

    if (isArtifactValid && cachedArtifact) {
      scoringReused = true;
      stage1Result = {
        criterionAssessment: cachedArtifact.criterionAssessment,
        overall_band: cachedArtifact.overall_band,
        metadata: {
          provider: cachedArtifact.scoring_stage.provider,
          model: cachedArtifact.scoring_stage.model,
          latency_ms: 0,
          prompt_hash: cachedArtifact.scoring_stage.prompt_hash,
          generated_at: cachedArtifact.scoring_stage.generated_at,
          scoring_reused: true,
        },
      };
    } else {
      // If Stage 1 fails, the entire review must fail honestly without fabricated scores.
      // (Failed attempts do not persist corrupt or incomplete scoring artifacts)
      stage1Result = await this.scoringProvider.scoreSubmission({
        submissionId: input.submissionId,
        taskType: input.taskType,
        promptText: input.promptText,
        studentResponse: input.studentResponse,
      });

      // Persist frozen scoring artifact immediately upon successful Stage 1 scoring
      // (First Writer Wins: Adopt canonical artifact returned by save)
      const canonicalArtifact = await this.scoringStore.save({
        submission_id: input.submissionId,
        task_type: input.taskType,
        prompt_hash: currentPromptHash,
        response_hash: currentResponseHash,
        criterionAssessment: stage1Result.criterionAssessment,
        overall_band: stage1Result.overall_band,
        scoring_stage: {
          provider: stage1Result.metadata?.provider || 'gemini',
          model: stage1Result.metadata?.model || this.model,
          prompt_hash: stage1Result.metadata?.prompt_hash ?? '',
          generated_at: stage1Result.metadata?.generated_at || new Date().toISOString(),
        },
      });

      if (canonicalArtifact) {
        stage1Result = {
          criterionAssessment: canonicalArtifact.criterionAssessment,
          overall_band: canonicalArtifact.overall_band,
          metadata: {
            provider: canonicalArtifact.scoring_stage.provider,
            model: canonicalArtifact.scoring_stage.model,
            latency_ms: stage1Result.metadata?.latency_ms ?? 0,
            prompt_hash: canonicalArtifact.scoring_stage.prompt_hash,
            generated_at: canonicalArtifact.scoring_stage.generated_at,
            scoring_reused: Boolean(cachedArtifact) || (canonicalArtifact.overall_band !== stage1Result.overall_band),
          },
        };
      }
    }

    // Deep-freeze Stage 1 scores to guarantee immutability
    const frozenScores: WritingAICriterionAssessment = Object.freeze({
      task_criterion: Object.freeze({ ...stage1Result.criterionAssessment.task_criterion }),
      cc: Object.freeze({ ...stage1Result.criterionAssessment.cc }),
      lr: Object.freeze({ ...stage1Result.criterionAssessment.lr }),
      gra: Object.freeze({ ...stage1Result.criterionAssessment.gra }),
    });

    // ====================================================================
    // OPTIONAL TEACHER CORPUS RETRIEVAL (PEDAGOGICAL GUIDANCE ONLY)
    // ====================================================================
    let teacherContext: string | undefined;
    let retrievalMetadata = {
      retrieval_used: false,
      retrieved_corrections_count: 0,
      retrieved_principles_count: 0,
    };

    // ====================================================================
    // STAGE 2: PEDAGOGICAL FEEDBACK (ANNOTATIONS & SUMMARY)
    // ====================================================================
    let feedbackResult: WritingAIFeedbackResult;
    let feedbackFailed = false;
    let feedbackError: string | undefined;

    try {
      feedbackResult = await this.feedbackProvider.generateFeedback({
        submissionId: input.submissionId,
        taskType: input.taskType,
        promptText: input.promptText,
        studentResponse: input.studentResponse,
        frozenCriterionAssessment: frozenScores,
        overallBand: stage1Result.overall_band,
        teacherContext,
        retrievalMetadata,
      });
    } catch (fbErr: any) {
      // Stage 2 resilience:
      // Do NOT fail the review if Stage 1 succeeded!
      // Fall back gracefully to Stage 1 scores + empty annotations.
      console.warn(
        'Stage 2 feedback generation failed, degrading gracefully with preserved Stage 1 scores:',
        'Provider failure details are kept out of client reports.'
      );
      feedbackFailed = true;
      feedbackError = 'Feedback provider failed; frozen scoring was retained.';

      feedbackResult = {
        annotations: [],
        summary: {
          strengths: [],
          priorities: [],
          overall_comment:
            'Detailed feedback is temporarily unavailable. The scoring result was preserved successfully.',
          feedback_unavailable: true,
        },
        feedback_unavailable: true,
        metadata: {
          provider: 'gemini',
          model: this.model,
          latency_ms: 0,
          prompt_hash: 'degraded_fallback',
          retrieval_used: false,
          retrieved_corrections_count: 0,
          retrieved_principles_count: 0,
          feedback_unavailable: true,
        },
      };
    }

    // ====================================================================
    // HARD INVARIANT: SCORE IMMUTABILITY CHECK
    // ====================================================================
    assertScoresImmutable(frozenScores, stage1Result.criterionAssessment);

    return {
      annotations: feedbackResult.annotations,
      criterionAssessment: frozenScores,
      overall_band: stage1Result.overall_band,
      scoring_stage: {
        provider: stage1Result.metadata?.provider || 'gemini',
        model: stage1Result.metadata?.model || this.model,
        prompt_hash: stage1Result.metadata?.prompt_hash ?? '',
        generated_at: stage1Result.metadata?.generated_at,
        reused: scoringReused,
      },
      summary: feedbackResult.summary,
      feedback_unavailable: feedbackFailed,
      scoring_reused: scoringReused,
      rawProviderMetadata: {
        pipeline: 'two-stage-writing-review-v1',
        overall_band: stage1Result.overall_band,
        feedback_unavailable: feedbackFailed,
        scoring_reused: scoringReused,
        scoring_stage: {
          status: 'SUCCESS',
          reused: scoringReused,
          provider: stage1Result.metadata?.provider || 'gemini',
          model: stage1Result.metadata?.model || this.model,
          latency_ms: stage1Result.metadata?.latency_ms ?? 0,
          prompt_hash: stage1Result.metadata?.prompt_hash ?? '',
          generated_at: stage1Result.metadata?.generated_at,
        },
        feedback_stage: {
          status: feedbackFailed ? 'DEGRADED' : 'SUCCESS',
          feedback_unavailable: feedbackFailed,
          provider: feedbackFailed ? 'gemini' : (feedbackResult.metadata?.provider || 'gemini'),
          model: feedbackFailed ? this.model : (feedbackResult.metadata?.model || this.model),
          latency_ms: feedbackResult.metadata?.latency_ms ?? 0,
          prompt_hash: feedbackResult.metadata?.prompt_hash ?? '',
          retrieval_used: feedbackFailed ? false : retrievalMetadata.retrieval_used,
          retrieved_corrections_count: feedbackFailed ? 0 : retrievalMetadata.retrieved_corrections_count,
          retrieved_principles_count: feedbackFailed ? 0 : retrievalMetadata.retrieved_principles_count,
          error: feedbackError,
        },
      },
    };
  }
}

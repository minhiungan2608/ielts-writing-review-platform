import type { WritingAIScoringInput, WritingAIScoringResult, WritingAIFeedbackInput, WritingAIFeedbackResult, WritingScoringProvider, WritingFeedbackProvider } from '../src/lib/ai/writingReviewProvider';
import { parseAndValidateStage2Feedback } from '../src/lib/ai/writingReviewSchemas';

export class DemoScoringProvider implements WritingScoringProvider {
  async scoreSubmission(input: WritingAIScoringInput): Promise<WritingAIScoringResult> {
    const reason = 'Illustrative mock estimate for demonstrating the review workflow; not an evaluation of ability.';
    return {
      criterionAssessment: {
        task_criterion: { criterion: input.taskType === 'TASK_1' ? 'TA' : 'TR', estimated_band: 6, reason },
        cc: { criterion: 'CC', estimated_band: 6, reason },
        lr: { criterion: 'LR', estimated_band: 6, reason },
        gra: { criterion: 'GRA', estimated_band: 6, reason },
      },
      overall_band: 6,
      metadata: { provider: 'mock', model: 'synthetic-demo', latency_ms: 0, prompt_hash: 'demo-scoring' },
    };
  }
}

export class DemoFeedbackProvider implements WritingFeedbackProvider {
  async generateFeedback(input: WritingAIFeedbackInput): Promise<WritingAIFeedbackResult> {
    const examples = [
      ['libraries are', 'libraries is', 'Agreement with the subject', 'The subject of this sentence is the singular activity of adding corners.'],
      ['each library have', 'each library has', 'Subject–verb agreement', 'Use a singular verb after each library.'],
      ['A more quieter', 'A quieter', 'Double comparative', 'Quieter already expresses comparison.'],
    ];
    const annotations = examples.filter(([anchor]) => input.studentResponse.includes(anchor)).map(([anchor, revision, issue, explanation]) => ({
      start_offset: input.studentResponse.indexOf(anchor), end_offset: input.studentResponse.indexOf(anchor) + anchor.length,
      original_text: anchor, criterion: 'GRA', nature: 'GRAMMAR', severity: 'MINOR',
      issue, explanation, suggested_revision: revision, confidence: 'HIGH',
    }));
    const result = parseAndValidateStage2Feedback({
      rawJson: { annotations, summary: { strengths: ['The synthetic sample presents a benefit, a concern, and a recommendation.'], priorities: ['Review the highlighted agreement and comparative forms.'], overall_comment: 'Deterministic mock suggestions for exploring the human review process.' } },
      taskType: input.taskType, studentResponse: input.studentResponse,
      submissionId: input.submissionId, providerName: 'mock', modelName: 'synthetic-demo',
    });
    return { ...result, metadata: { provider: 'mock', model: 'synthetic-demo', latency_ms: 0, prompt_hash: 'demo-feedback', retrieval_used: false, retrieved_corrections_count: 0, retrieved_principles_count: 0 } };
  }
}

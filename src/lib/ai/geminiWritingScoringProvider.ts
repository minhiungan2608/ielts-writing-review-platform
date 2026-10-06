import {
  WritingAIScoringInput,
  WritingAIScoringResult,
  WritingScoringProvider,
} from './writingReviewProvider';
import {
  buildStage1ScoringSystemPrompt,
  buildStage1ScoringUserPrompt,
  computePromptHash,
  parseAndValidateStage1Scoring,
  STAGE_1_SCORING_JSON_SCHEMA,
} from './writingReviewSchemas';
import { GeminiProviderOptions } from './geminiWritingReviewProvider';

export class GeminiWritingScoringProvider implements WritingScoringProvider {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private timeoutMs: number;

  constructor(options?: GeminiProviderOptions) {
    this.apiKey =
      options?.apiKey ||
      (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY ? process.env.GEMINI_API_KEY : '');
    this.model = options?.model || 'gemini-2.5-flash';
    this.temperature = options?.temperature ?? 0.2;
    this.timeoutMs = options?.timeoutMs ?? 30000;
  }

  async scoreSubmission(input: WritingAIScoringInput): Promise<WritingAIScoringResult> {
    if (!this.apiKey) {
      throw new Error(
        'Gemini API key is not configured on the server. Please set GEMINI_API_KEY in server environment.'
      );
    }

    const systemPrompt = buildStage1ScoringSystemPrompt(input.taskType);
    const userPrompt = buildStage1ScoringUserPrompt({
      taskType: input.taskType,
      promptText: input.promptText,
      studentResponse: input.studentResponse,
    });
    const promptHash = computePromptHash(`${systemPrompt}\n${userPrompt}`);

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

    const requestBody = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: this.temperature,
        response_mime_type: 'application/json',
        response_schema: STAGE_1_SCORING_JSON_SCHEMA,
      },
    };

    const maxRetries = 3;
    let response: Response | null = null;
    let lastError: any = null;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          break;
        }

        if (response.status === 503 || response.status === 429) {
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
            continue;
          }
        }
        break;
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;
        if (err.name === 'AbortError') {
          throw new Error(`Gemini Stage 1 scoring request timed out after ${this.timeoutMs}ms.`);
        }
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
          continue;
        }
        throw new Error(`Network failure communicating with Gemini Stage 1 provider: request failed`);
      }
    }

    const latencyMs = Date.now() - startTime;

    if (!response || !response.ok) {
      if (!response && lastError) {
        throw new Error(`Network failure communicating with Gemini Stage 1 provider: ${lastError.message}`);
      }

      let errorBody = '';
      try {
        errorBody = await response!.text();
      } catch {
        // ignore
      }

      if (response?.status === 429) {
        throw new Error('Gemini API rate limit exceeded during Stage 1 scoring.');
      }
      if (response?.status === 401 || response?.status === 403) {
        throw new Error('Gemini API authentication failed during Stage 1 scoring. Verify server credentials.');
      }
      throw new Error(`Gemini Stage 1 scoring error (${response?.status}): request rejected`);
    }

    const responseJson = await response.json();
    const rawCandidateText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawCandidateText) {
      throw new Error('Gemini Stage 1 returned an empty response with no content candidates.');
    }

    const validated = parseAndValidateStage1Scoring({
      rawJson: rawCandidateText,
      taskType: input.taskType,
      providerName: 'gemini',
      modelName: this.model,
    });

    return {
      criterionAssessment: validated.criterionAssessment,
      overall_band: validated.overall_band,
      metadata: {
        provider: 'gemini',
        model: this.model,
        latency_ms: latencyMs,
        prompt_hash: promptHash,
        generated_at: new Date().toISOString(),
      },
    };
  }
}

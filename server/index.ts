import dotenv from 'dotenv';
import { GeminiWritingReviewProvider } from '../src/lib/ai/geminiWritingReviewProvider';
import { DefaultWritingScoringStore } from '../src/lib/ai/writingScoringStore';
import { DemoScoringProvider, DemoFeedbackProvider } from './mockProvider';
import { ReviewService } from './reviewService';
import { createApp } from './app';

dotenv.config({ path: '.env.local', quiet: true });
if (process.env.NODE_ENV === 'production') throw new Error('This unauthenticated local demo is not a production service.');
const configured = process.env.AI_PROVIDER?.trim() || 'mock';
if (!['mock', 'gemini'].includes(configured)) throw new Error('AI_PROVIDER must be mock or gemini.');
const mode = configured as 'mock' | 'gemini';
if (mode === 'gemini' && (!process.env.GEMINI_API_KEY?.trim() || !process.env.GEMINI_MODEL?.trim())) throw new Error('Gemini mode requires server-side GEMINI_API_KEY and GEMINI_MODEL.');
const provider = new GeminiWritingReviewProvider({
  apiKey: mode === 'gemini' ? process.env.GEMINI_API_KEY : undefined,
  model: mode === 'gemini' ? process.env.GEMINI_MODEL : 'synthetic-demo',
  scoringStore: new DefaultWritingScoringStore(),
  scoringProvider: mode === 'mock' ? new DemoScoringProvider() : undefined,
  feedbackProvider: mode === 'mock' ? new DemoFeedbackProvider() : undefined,
});
createApp(new ReviewService(provider), mode).listen(3001, '127.0.0.1', () => console.log(`Local review API: http://127.0.0.1:3001 (${mode})`));

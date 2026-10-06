import {
  WritingAICriterionAssessment,
  WritingTaskType,
} from '../../types';
import { computePromptHash } from './writingReviewSchemas';

export interface FrozenScoringArtifact {
  submission_id: string;
  task_type: WritingTaskType;
  prompt_hash: string;
  response_hash: string;
  criterionAssessment: WritingAICriterionAssessment;
  overall_band: number;
  scoring_stage: {
    provider: string;
    model: string;
    prompt_hash: string;
    generated_at: string;
  };
}

export interface WritingScoringStore {
  get(
    submissionId: string,
    expectedHashes?: { promptHash?: string; responseHash?: string }
  ): FrozenScoringArtifact | null | Promise<FrozenScoringArtifact | null>;
  save(
    artifact: FrozenScoringArtifact
  ): FrozenScoringArtifact | Promise<FrozenScoringArtifact>;
  clear(
    submissionId: string,
    expectedHashes?: { promptHash?: string; responseHash?: string }
  ): void | Promise<void>;
  clearAll?(): void | Promise<void>;
}

const SCORING_ARTIFACTS_CACHE_KEY = 'ielts_myth_writing_ai_scoring_artifacts';

/**
 * In-memory map for fast Node / dev / unit-test execution.
 */
const inMemoryStore = new Map<string, FrozenScoringArtifact>();

function makeArtifactCompositeKey(
  submissionId: string,
  promptHash?: string,
  responseHash?: string
): string {
  if (promptHash && responseHash) {
    return `${submissionId}::${promptHash}::${responseHash}`;
  }
  return submissionId;
}

function getLocalStorageArtifacts(): Record<string, FrozenScoringArtifact> {
  if (typeof localStorage === 'undefined' || typeof localStorage?.getItem !== 'function') return {};
  try {
    const raw = localStorage.getItem(SCORING_ARTIFACTS_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalStorageArtifacts(records: Record<string, FrozenScoringArtifact>): void {
  if (typeof localStorage === 'undefined' || typeof localStorage?.setItem !== 'function') return;
  try {
    localStorage.setItem(SCORING_ARTIFACTS_CACHE_KEY, JSON.stringify(records));
  } catch (err) {
    console.warn('Failed to persist scoring artifacts to localStorage:', err);
  }
}

/**
 * Development & test implementation of WritingScoringStore combining in-memory and local storage mirrors.
 * Explicitly marked test/dev only; production path requires a separate production persistence adapter.
 */
export class DefaultWritingScoringStore implements WritingScoringStore {
  readonly isDevOnly: boolean = true;

  constructor(options?: { allowInProduction?: boolean }) {
    if (
      !options?.allowInProduction &&
      typeof process !== 'undefined' &&
      process.env?.NODE_ENV === 'production' &&
      !process.env?.VITEST &&
      !process.env?.JEST_WORKER_ID
    ) {
      throw new Error(
        'DefaultWritingScoringStore is restricted to test and development environments only. Use a separate production persistence adapter in production.'
      );
    }
  }

  get(
    submissionId: string,
    expectedHashes?: { promptHash?: string; responseHash?: string }
  ): FrozenScoringArtifact | null {
    if (!submissionId) return null;

    // 1. Exact composite key lookup if both hashes provided
    if (expectedHashes?.promptHash && expectedHashes?.responseHash) {
      const targetKey = makeArtifactCompositeKey(
        submissionId,
        expectedHashes.promptHash,
        expectedHashes.responseHash
      );
      if (inMemoryStore.has(targetKey)) {
        return inMemoryStore.get(targetKey)!;
      }
      const localRecords = getLocalStorageArtifacts();
      if (localRecords[targetKey]) {
        inMemoryStore.set(targetKey, localRecords[targetKey]);
        return localRecords[targetKey];
      }
    }

    // 2. Iterate store to find matching artifacts for this submissionId
    let foundArtifact: FrozenScoringArtifact | null = null;
    for (const [key, item] of inMemoryStore.entries()) {
      if (
        item.submission_id === submissionId ||
        key === submissionId ||
        key.startsWith(`${submissionId}::`)
      ) {
        if (expectedHashes?.promptHash && item.prompt_hash !== expectedHashes.promptHash) {
          continue;
        }
        if (expectedHashes?.responseHash && item.response_hash !== expectedHashes.responseHash) {
          continue;
        }
        foundArtifact = item;
      }
    }

    if (foundArtifact) return foundArtifact;

    // 3. Check localStorage mirror
    const localRecords = getLocalStorageArtifacts();
    for (const [key, item] of Object.entries(localRecords)) {
      if (
        item.submission_id === submissionId ||
        key === submissionId ||
        key.startsWith(`${submissionId}::`)
      ) {
        if (expectedHashes?.promptHash && item.prompt_hash !== expectedHashes.promptHash) {
          continue;
        }
        if (expectedHashes?.responseHash && item.response_hash !== expectedHashes.responseHash) {
          continue;
        }
        inMemoryStore.set(key, item);
        foundArtifact = item;
      }
    }

    return foundArtifact;
  }

  save(artifact: FrozenScoringArtifact): FrozenScoringArtifact {
    if (!artifact?.submission_id) return artifact;

    const key = makeArtifactCompositeKey(
      artifact.submission_id,
      artifact.prompt_hash,
      artifact.response_hash
    );

    // FIRST WRITER WINS: If an artifact already exists for (submission_id, prompt_hash, response_hash),
    // ordinary save MUST NOT overwrite it. Return existing canonical artifact!
    const existing = this.get(artifact.submission_id, {
      promptHash: artifact.prompt_hash,
      responseHash: artifact.response_hash,
    });
    if (existing) {
      return existing;
    }

    // Deep freeze artifact to ensure immutability
    const frozenArtifact: FrozenScoringArtifact = Object.freeze({
      ...artifact,
      criterionAssessment: Object.freeze({
        task_criterion: Object.freeze({ ...artifact.criterionAssessment.task_criterion }),
        cc: Object.freeze({ ...artifact.criterionAssessment.cc }),
        lr: Object.freeze({ ...artifact.criterionAssessment.lr }),
        gra: Object.freeze({ ...artifact.criterionAssessment.gra }),
      }),
      scoring_stage: Object.freeze({ ...artifact.scoring_stage }),
    });

    inMemoryStore.set(key, frozenArtifact);

    const localRecords = getLocalStorageArtifacts();
    localRecords[key] = frozenArtifact;
    saveLocalStorageArtifacts(localRecords);

    return frozenArtifact;
  }

  clear(
    submissionId: string,
    expectedHashes?: { promptHash?: string; responseHash?: string }
  ): void {
    if (!submissionId) return;

    const localRecords = getLocalStorageArtifacts();

    if (expectedHashes?.promptHash && expectedHashes?.responseHash) {
      // Scoped deletion: only delete the targeted hash identity!
      const targetKey = makeArtifactCompositeKey(
        submissionId,
        expectedHashes.promptHash,
        expectedHashes.responseHash
      );
      inMemoryStore.delete(targetKey);
      delete localRecords[targetKey];

      // Also clean up any legacy un-keyed record if hashes match
      if (inMemoryStore.has(submissionId)) {
        const item = inMemoryStore.get(submissionId)!;
        if (
          item.prompt_hash === expectedHashes.promptHash &&
          item.response_hash === expectedHashes.responseHash
        ) {
          inMemoryStore.delete(submissionId);
          delete localRecords[submissionId];
        }
      }
    } else {
      // Broad deletion: clear all entries for this submissionId
      for (const [key, item] of Array.from(inMemoryStore.entries())) {
        if (
          item.submission_id === submissionId ||
          key === submissionId ||
          key.startsWith(`${submissionId}::`)
        ) {
          inMemoryStore.delete(key);
          delete localRecords[key];
        }
      }
    }

    saveLocalStorageArtifacts(localRecords);
  }

  clearAll(): void {
    inMemoryStore.clear();
    if (typeof localStorage !== 'undefined' && typeof localStorage?.removeItem === 'function') {
      try {
        localStorage.removeItem(SCORING_ARTIFACTS_CACHE_KEY);
      } catch {
        // ignore
      }
    }
  }
}

export const defaultWritingScoringStore = new DefaultWritingScoringStore();

/**
 * Production-ready durable server-side scoring store backed by Supabase / PostgreSQL table
 * public.writing_ai_scoring_artifacts.
 */
export function isScoringArtifactValid(params: {
  artifact: FrozenScoringArtifact | null;
  promptText: string;
  studentResponse: string;
}): boolean {
  const { artifact, promptText, studentResponse } = params;
  if (!artifact) return false;

  const currentPromptHash = computePromptHash(promptText);
  const currentResponseHash = computePromptHash(studentResponse);

  return (
    artifact.prompt_hash === currentPromptHash &&
    artifact.response_hash === currentResponseHash
  );
}

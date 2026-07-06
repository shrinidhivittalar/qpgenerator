import { schemaMap, QuestionType } from './schemaMap.js';
import { classifyDifficulty } from '../ai/difficultyClassifier.js';
import { Strategy } from '../ai/strategyPicker.js';

export { QuestionType };

export interface QuestionBlock {
  questionType: string;
  questions:    object[];
  totalMarks:   number;
  status:       'success' | 'failed';
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function extractPrimaryText(type: QuestionType, data: any): string {
  if (type === 'assertionReason') return (data.assertion ?? '') as string;
  return (data.question?.text ?? '') as string;
}

function isTooSimilar(a: string, b: string, threshold = 0.8): boolean {
  const tokenize = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return false;
  const intersection = [...setA].filter(w => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union > threshold;
}

type DifficultyLevel = 'easy' | 'moderate' | 'hard';

// GEN-16, EC-GEN-10: each question validated independently — one bad item never
// invalidates the whole batch. Invalid questions are dropped and counted for
// shortfall math in the retry loop.
export async function validateQuestionBlock(
  type:              QuestionType,
  rawQuestions:      unknown[],
  exemplarTexts:     string[] = [],
  requestedDifficulty?: DifficultyLevel,
  strategyContext?:  { strategy: Strategy; baseQuestion: string | null },
): Promise<{ valid: object[]; invalidCount: number }> {
  const schema = schemaMap[type];
  const valid: object[] = [];
  let invalidCount = 0;

  for (const q of rawQuestions) {
    const result = schema.safeParse(q);
    if (!result.success) { invalidCount++; continue; }

    const primaryText = extractPrimaryText(type, result.data);

    if (strategyContext?.strategy === 'rephrase' || strategyContext?.strategy === 'variant') {
      // Being similar to the base is expected — only reject if the model
      // returned an essentially verbatim copy (threshold raised to 0.92).
      if (strategyContext.baseQuestion && isTooSimilar(primaryText, strategyContext.baseQuestion, 0.92)) {
        invalidCount++; continue;
      }
    } else if (strategyContext?.strategy === 'reuse') {
      // Intentionally identical — skip similarity checking entirely.
    } else {
      // 'fresh' or no strategy context: original behaviour — reject if too
      // similar to any style exemplar using the standard 0.8 threshold.
      const tooSimilar = exemplarTexts.some(ex => isTooSimilar(primaryText, ex));
      if (tooSimilar) { invalidCount++; continue; }
    }

    if (requestedDifficulty) {
      const detected = await classifyDifficulty(primaryText, type, result.data);
      if (detected !== requestedDifficulty) { invalidCount++; continue; }
    }

    valid.push(result.data);
  }

  return { valid, invalidCount };
}

// ADR-004, EC-ID-01, EC-ID-02: called ONCE after all types have settled —
// never per-type. Mutates in place. Sequential integers starting at 1 in
// block-declaration order.
export function assignGlobalIds(blocks: { questionType: string; questions: object[] }[]): void {
  let counter = 1;
  for (const block of blocks) {
    for (const q of block.questions) {
      (q as Record<string, unknown>).id = counter++;
    }
  }
}

// Stub — full validation is Day 5 (EXP-02 through EXP-05).
// Throws ValidationError so the export route can return 400 without
// touching the partial data.
export function validateExportSet(blocks: QuestionBlock[]): void {
  const successBlocks = blocks.filter(b => b.status === 'success');
  if (successBlocks.length === 0) {
    throw new ValidationError('No generated questions to export.');
  }
  // TODO Day 5: totalMarks sum check, ID uniqueness check, explanation presence check
}

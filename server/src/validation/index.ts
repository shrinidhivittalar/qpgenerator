import { schemaMap, QuestionType } from './schemaMap.js';

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

// GEN-16, EC-GEN-10: each question validated independently — one bad item never
// invalidates the whole batch. Invalid questions are dropped and counted for
// shortfall math in the retry loop.
export function validateQuestionBlock(
  type: QuestionType,
  rawQuestions: unknown[],
): { valid: object[]; invalidCount: number } {
  const schema = schemaMap[type];
  const valid: object[] = [];
  let invalidCount = 0;

  for (const q of rawQuestions) {
    const result = schema.safeParse(q);
    if (result.success) valid.push(result.data as object);
    else invalidCount++;
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

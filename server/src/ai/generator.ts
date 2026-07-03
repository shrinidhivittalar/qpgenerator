import { validateQuestionBlock, assignGlobalIds, QuestionBlock } from '../validation/index.js';
import { QuestionType } from '../validation/schemaMap.js';

export type GenerateFn = (
  sourceText:       string,
  type:             QuestionType,
  count:            number,
  marksPerQuestion: number,
  dedupeHint?:      string,
) => Promise<unknown[]>;

export type RunTypeLoopResult =
  | { status: 'success'; questions: object[] }
  | { status: 'failed'; requested: number; received: number; error: string };

const MAX_ATTEMPTS = 3;

export async function runTypeLoop(
  sourceText:       string,
  type:             QuestionType,
  targetCount:      number,
  marksPerQuestion: number,
  generateFn:       GenerateFn,
): Promise<RunTypeLoopResult> {
  let collected: object[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const shortfall = targetCount - collected.length;

    let raw: unknown[];
    try {
      raw = await generateFn(
        sourceText,
        type,
        shortfall,
        marksPerQuestion,
        attempt > 1 ? 'Avoid duplicating previously generated questions.' : undefined,
      );
    } catch {
      // EC-GEN-08: thrown error (network, invalid JSON) = 0 received this round
      raw = [];
    }

    const { valid } = validateQuestionBlock(type, raw);
    collected = collected.concat(valid);

    if (collected.length >= targetCount) {
      collected = collected.slice(0, targetCount); // GEN-04, EC-GEN-05: trim excess
      return { status: 'success', questions: recalculateMarks(collected, marksPerQuestion) };
    }
  }

  return {
    status:    'failed',
    requested: targetCount,
    received:  collected.length,
    error:     collected.length === 0
      ? `Could not generate any ${type} questions from the source content.`
      : `Insufficient source content to generate ${targetCount} ${type} questions.`,
  };
}

// marks are server-assigned from typeConfig — the AI's value is never trusted
function recalculateMarks(questions: object[], marksPerQuestion: number): object[] {
  return questions.map(q => ({ ...q, marks: marksPerQuestion }));
}

export interface GenerationError {
  type:      string;
  requested: number;
  received:  number;
  error:     string;
}

export interface TypeConfig {
  type:             QuestionType;
  count:            number;
  marksPerQuestion: number;
}

// Note: if ALL counts are 0 the route layer should reject before calling
// generateSet — that boundary is enforced at the API level (Day 3), not here.
export async function generateSet(
  sourceText:  string,
  typeConfig:  TypeConfig[],
  generateFn:  GenerateFn,
): Promise<{ blocks: QuestionBlock[]; errors: GenerationError[] }> {
  // GEN-09, EC-GEN-01: types with count 0 are silently skipped
  const activeTypes = typeConfig.filter(tc => tc.count > 0);

  // ADR-003: Promise.allSettled so one type's unexpected throw never
  // cancels the others
  const settled = await Promise.allSettled(
    activeTypes.map(tc =>
      runTypeLoop(sourceText, tc.type, tc.count, tc.marksPerQuestion, generateFn)
        .then(result => ({ type: tc.type, result })),
    ),
  );

  const blocks: QuestionBlock[] = [];
  const errors: GenerationError[] = [];

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      // runTypeLoop should never reject (catches internally), but if it
      // somehow does, skip it — don't crash the entire generateSet call
      continue;
    }
    const { type, result } = outcome.value;
    if (result.status === 'success') {
      blocks.push({
        questionType: type,
        totalMarks:   result.questions.reduce((sum, q) => sum + (q as Record<string, unknown>).marks as number, 0),
        status:       'success',
        questions:    result.questions,
      });
    } else {
      errors.push({
        type,
        requested: result.requested,
        received:  result.received,
        error:     result.error,
      });
    }
  }

  // ADR-004: single ID-assignment pass after all types complete
  assignGlobalIds(blocks);
  return { blocks, errors };
}

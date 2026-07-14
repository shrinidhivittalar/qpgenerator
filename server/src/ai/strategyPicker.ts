import { QuestionType } from '../validation/schemaMap.js';
import { getHistoricalCandidate } from './historicalRetrieval.js';

// Draw probabilities for historical bank vs. fresh generation.
// Low path applies when the bank has fewer than MIN_EXEMPLARS_FOR_HIGH_DRAW
// questions of the requested type — not enough signal to trust heavily.
// High path applies once the bank is well stocked; named constants so the
// thresholds are visible and adjustable without a code hunt.
const MIN_EXEMPLARS_FOR_HIGH_DRAW      = 5;
const HISTORICAL_DRAW_PROBABILITY_LOW  = 0.30;
const HISTORICAL_DRAW_PROBABILITY_HIGH = 0.55;

export type Strategy = 'fresh' | 'rephrase' | 'variant' | 'reuse';

export async function pickStrategy(
  teacherId:     string,
  chapterId:     string | null,
  type:          QuestionType,
  exemplarCount: number = 0,
): Promise<{ strategy: Strategy; baseQuestion: string | null }> {
  const prob = exemplarCount >= MIN_EXEMPLARS_FOR_HIGH_DRAW
    ? HISTORICAL_DRAW_PROBABILITY_HIGH
    : HISTORICAL_DRAW_PROBABILITY_LOW;

  if (Math.random() >= prob) {
    return { strategy: 'fresh', baseQuestion: null };
  }

  const candidate = await getHistoricalCandidate(teacherId, chapterId, type);
  if (!candidate) {
    return { strategy: 'fresh', baseQuestion: null };
  }

  const currentYear = new Date().getFullYear();
  // null sourceYear → treat as age 0 (recent bucket) so we never reuse a
  // question whose vintage we can't verify.  This is the safe default
  // described in the historical-retrieval design doc.
  const age = candidate.sourceYear != null ? currentYear - candidate.sourceYear : 0;

  let strategy: Strategy;
  if (age <= 2) {
    strategy = 'rephrase';
  } else if (age <= 5) {
    strategy = Math.random() < 0.5 ? 'rephrase' : 'variant';
  } else {
    const r = Math.random();
    strategy = r < 0.34 ? 'rephrase' : r < 0.67 ? 'variant' : 'reuse';
  }

  return { strategy, baseQuestion: candidate.rawText };
}

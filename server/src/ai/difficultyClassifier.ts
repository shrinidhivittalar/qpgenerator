import Groq from 'groq-sdk';
import { BLOOM_VERBS } from './difficulty.js';
import { withRetry, withTimeout } from '../lib/retry.js';
import { logger } from '../lib/logger.js';

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}
const CLASSIFIER_MODEL = process.env.GROQ_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct';

// type is string (not QuestionType) so future types like 'caseStudy' don't
// require changes to the enum — this module is classification-only, no schema deps.
export function heuristicDifficulty(
  primaryText: string,
  type: string,
  data: any,
): { level: 'easy' | 'moderate' | 'hard' | null; confidence: 'high' | 'low' } {
  const text = primaryText.toLowerCase();

  const hasHardVerb     = BLOOM_VERBS.hard.some(v => text.includes(v));
  const hasModerateVerb = BLOOM_VERBS.moderate.some(v => text.includes(v));
  const hasEasyVerb     = BLOOM_VERBS.easy.some(v => text.includes(v));

  // Broader easy-stem patterns that Bloom verbs alone miss:
  //   "which of the following best describes / correctly states / represents…"
  //   "true or false:" / fill-blank statements with no numeric signals
  const hasEasyPattern = /which of the following\b|true or false/i.test(text);

  const numberCount = (text.match(/\d+(\.\d+)?/g) ?? []).length;

  // Multi-step calc signal: 3+ numbers AND any of: explicit operator context,
  // compute/calculate keyword, common formula terms, or unit-labelled values
  // (e.g. "100 lux", "30 min", "520nm") where the numbers serve as inputs.
  const hasCalcKeyword    = /\bcalculate\b|\bcompute\b|\bfind the\b|\bdetermine the\b/.test(text);
  const hasFormulaPattern = /[=/*+-]\s*\(|precision|recall|accuracy|ratio of/.test(text);
  const hasUnitValues     = /\d+\s*(nm|lux|hz|khz|mhz|ms|sec|min|hours?|kg|g|mg|km|m|cm|mm|j|kj|kpa|pa|mol|rpm|°c|°f|k)\b/.test(text);
  const multiStepCalc     = numberCount >= 3 && (hasFormulaPattern || hasCalcKeyword || hasUnitValues);

  if (type === 'caseStudy') {
    const subCount = (data.subQuestions?.length ?? 0) as number;
    if (subCount >= 3 || multiStepCalc) return { level: 'hard', confidence: 'high' };
  }

  if (multiStepCalc || (hasHardVerb && !hasEasyVerb)) {
    return { level: 'hard', confidence: 'high' };
  }
  if ((hasEasyVerb || hasEasyPattern) && !hasModerateVerb && !hasHardVerb && numberCount <= 1) {
    return { level: 'easy', confidence: 'high' };
  }
  if (hasModerateVerb || numberCount === 1 || numberCount === 2) {
    return { level: 'moderate', confidence: 'high' };
  }
  return { level: null, confidence: 'low' };
}

export async function classifyDifficulty(
  primaryText: string,
  type: string,
  data: any,
): Promise<'easy' | 'moderate' | 'hard'> {
  const heuristic = heuristicDifficulty(primaryText, type, data);

  if (heuristic.confidence === 'high' && heuristic.level) {
    logger.info('difficulty_classified', { path: 'heuristic', difficulty: heuristic.level, type });
    return heuristic.level;
  }

  logger.info('difficulty_classified', { path: 'llm_fallback', type });

  const response = await withRetry(
    () => withTimeout(
      () => getGroq().chat.completions.create({
        model: CLASSIFIER_MODEL,
        messages: [
          {
            role: 'system',
            content: `Classify this exam question's cognitive demand as exactly one word: easy, moderate, or hard. easy = direct single-fact recall. moderate = applying one concept to a new situation, one reasoning step. hard = combining 2+ concepts, multi-step calculation, or evaluative justification. Respond with ONLY the one word.`,
          },
          { role: 'user', content: primaryText },
        ],
        temperature: 0,
      }),
      15_000,
      'difficultyClassifier',
    ),
    2,
  );

  const word = (response.choices[0]?.message?.content ?? '').trim().toLowerCase();
  const VALID = ['easy', 'moderate', 'hard'] as const;
  const difficulty = VALID.includes(word as any) ? (word as 'easy' | 'moderate' | 'hard') : 'moderate';
  logger.info('difficulty_classified', { path: 'llm_fallback', difficulty, type });
  return difficulty;
}

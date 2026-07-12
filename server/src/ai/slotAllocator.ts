import { QuestionType } from '../validation/schemaMap.js';
import { allocateByWeight } from '../lib/allocation.js';

// Types that need a larger excerpt window to find enough content.
// mapSkill needs many distinct geographical places, which requires more context
// than a single-concept MCQ or short-answer question.
const WINDOW_SIZE: Partial<Record<QuestionType, number>> = {
  mapSkill:   5000,
  longAnswer: 3000,
};

export type Slot = {
  chapterId:        string | null;
  chapterName:      string;
  type:             QuestionType;
  difficulty:       'easy' | 'moderate' | 'hard';
  marksPerQuestion: number;
  sourceExcerpt:    string; // '' sentinel means no chapter configured —
                             // caller should use the full QuestionSet sourceText
};

type Difficulty = 'easy' | 'moderate' | 'hard';

// Collapses the 4-tier difficulty table (1/2/3/5-mark) into 3 tiers —
// the 5-mark "hard + cross-chapter" tier is folded into 'hard' for now;
// true cross-chapter synthesis is a Phase 2 refinement.
const DIFFICULTY_DISTRIBUTION: Record<Difficulty, number> = {
  easy:     0.35,
  moderate: 0.40,
  hard:     0.25,
};

export type ChapterInput = {
  id:                string;
  name:              string;
  weightPercent:     number;
  sourceText:        string;
  highValueSnippets: string[];
};

export async function allocateSlots(
  type:              QuestionType,
  count:             number,
  marksPerQuestion:  number,
  chapters:          ChapterInput[],
  explicitDifficulty?: Difficulty,
  typeIndex:         number = 0,
): Promise<Slot[]> {
  if (chapters.length === 0) {
    return allocateWithoutChapters(type, count, marksPerQuestion, explicitDifficulty);
  }

  // Rotate the chapter list by typeIndex positions so each type draws from
  // different chapters when counts are small. Without rotation, all types
  // get allocated to the same first N chapters (largest-remainder is
  // deterministic for equal weights), producing questions on the same topic.
  const rotateBy = chapters.length > 1 ? typeIndex % chapters.length : 0;
  const rotated  = [...chapters.slice(rotateBy), ...chapters.slice(0, rotateBy)];

  const weights          = rotated.map(c => c.weightPercent);
  const perChapterCounts = allocateByWeight(count, weights);

  const slots: Slot[] = [];
  for (let i = 0; i < rotated.length; i++) {
    const chapter      = rotated[i];
    const chapterCount = perChapterCounts[i];
    if (chapterCount === 0) continue;

    const difficulties: Difficulty[] = explicitDifficulty
      ? Array<Difficulty>(chapterCount).fill(explicitDifficulty)
      : expandDistribution(chapterCount, DIFFICULTY_DISTRIBUTION);

    const windowSize = WINDOW_SIZE[type] ?? 2000;
    for (let j = 0; j < chapterCount; j++) {
      slots.push({
        chapterId:        chapter.id,
        chapterName:      chapter.name,
        type,
        difficulty:       difficulties[j],
        marksPerQuestion,
        sourceExcerpt:    pickExcerpt(chapter.sourceText, chapter.highValueSnippets, j, windowSize, chapterCount),
      });
    }
  }

  return shuffle(slots);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function expandDistribution(count: number, dist: Record<Difficulty, number>): Difficulty[] {
  const counts = allocateByWeight(count, [dist.easy, dist.moderate, dist.hard]);
  return [
    ...Array<Difficulty>(counts[0]).fill('easy'),
    ...Array<Difficulty>(counts[1]).fill('moderate'),
    ...Array<Difficulty>(counts[2]).fill('hard'),
  ];
}

export function pickExcerpt(
  fullText:          string,
  highValueSnippets: string[],
  slotIndex:         number,
  windowSize:        number = 2000,
  totalSlots:        number = 1,
): string {
  if (highValueSnippets.length > 0) {
    const snippet = highValueSnippets[slotIndex % highValueSnippets.length];
    const idx     = fullText.indexOf(snippet);
    if (idx !== -1) {
      const start = Math.max(0, idx - 500);
      const end   = Math.min(fullText.length, idx + snippet.length + 500);
      return fullText.slice(start, end);
    }
    // Snippet text not found verbatim in fullText — fall through to window below
  }

  if (fullText.length <= windowSize) return fullText;

  // Divide the text into equal segments so each slot sees a different section.
  // This prevents multiple slots from all hitting the same worked example.
  const maxStart   = fullText.length - windowSize;
  const segmentStep = Math.floor(maxStart / Math.max(totalSlots, 1));
  const step        = Math.max(segmentStep, Math.floor(windowSize * 0.5));
  const start       = Math.min(slotIndex * step, maxStart);
  return fullText.slice(start, start + windowSize);
}

function allocateWithoutChapters(
  type:              QuestionType,
  count:             number,
  marksPerQuestion:  number,
  explicitDifficulty?: Difficulty,
): Promise<Slot[]> {
  const difficulties: Difficulty[] = explicitDifficulty
    ? Array<Difficulty>(count).fill(explicitDifficulty)
    : expandDistribution(count, DIFFICULTY_DISTRIBUTION);

  const slots: Slot[] = Array.from({ length: count }, (_, j) => ({
    chapterId:        null,
    chapterName:      '',
    type,
    difficulty:       difficulties[j],
    marksPerQuestion,
    sourceExcerpt:    '', // sentinel — caller uses full QuestionSet sourceText
  }));

  return Promise.resolve(slots);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

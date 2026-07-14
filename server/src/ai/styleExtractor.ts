import Groq from 'groq-sdk';
import { withRetry, withTimeout } from '../lib/retry.js';
import { BankStyleGuide } from '../models/BankStyleGuide.js';
import { logger } from '../lib/logger.js';

export interface StyleGuide {
  examBoard:      string;
  subject:        string;
  commandWords:   string[];
  marksFormat:    Record<string, string>;
  toneDescriptor: string;
  preferPatterns: string[];
  avoidPatterns:  string[];
  bloomsSummary:  string;
  answerStyle:    string;
}

const EXTRACT_PROMPT = `You are an expert exam analyst. Analyze the provided past paper questions and extract the style signature of this exam board or institution.

Return ONLY a raw JSON object — no markdown, no commentary:
{
  "examBoard": "detected board name (CBSE / VTU / ICSE / Karnataka State Board / IIT-JEE / NEET / etc.) or 'Unknown'",
  "subject": "detected subject (Mathematics / Physics / Analog Electronics / History / etc.) or 'Unknown'",
  "commandWords": ["exact command verbs used, e.g. Prove, Find, Calculate, State, Explain, Derive, Show that, Compare, Differentiate"],
  "marksFormat": {
    "1": "how 1-mark questions are typically structured and phrased",
    "2": "how 2-mark questions are typically structured and phrased",
    "5": "how 5-mark questions are typically structured and phrased",
    "10": "how 10-mark questions are typically structured and phrased (omit if not present)"
  },
  "toneDescriptor": "one precise sentence on the register and formality — e.g. 'Highly formal, impersonal, no conversational language, technical vocabulary expected'",
  "preferPatterns": ["sentence starter patterns that appear frequently, e.g. 'With the help of a neat diagram, explain...', 'Derive an expression for...', 'State and prove...'"],
  "avoidPatterns": ["patterns that never appear in this style, e.g. 'What is the meaning of...', 'Can you explain...', 'Tell me about...'"],
  "bloomsSummary": "one sentence on cognitive level distribution — e.g. '70% application and analysis; recall questions appear only at 1-mark level'",
  "answerStyle": "what a model answer looks like — expected length, format, level of working shown, diagrams expected or not"
}

Extract only what is actually present in the questions. Do not assume board conventions not visible in the text.`;

const SYNTHESIZE_PROMPT = `You are an expert exam analyst reviewing style extracts from multiple years of past papers from the same exam board and subject.

Your task: produce ONE consolidated StyleGuide that captures ONLY the patterns that are consistent across years. Patterns that appear in only one year are year-specific anomalies — exclude them.

Consistency rules:
- "commandWords": include a verb only if it appears in at least half the years provided
- "preferPatterns": include a sentence pattern only if it appears across multiple years
- "avoidPatterns": include a pattern only if it is absent in all years (genuinely never used)
- "marksFormat": for each mark level, write the description that holds consistently; omit mark levels whose structure varies erratically across years
- "toneDescriptor": one sentence capturing what is stable in register and formality across all years
- "bloomsSummary": one sentence on the cognitive-level distribution that holds year over year
- "answerStyle": the answer format requirements that are consistent across all years
- "examBoard" / "subject": use the most specific value confirmed across years

Return ONLY a raw JSON object with exactly this shape — no markdown, no commentary:
{
  "examBoard": string,
  "subject": string,
  "commandWords": [string],
  "marksFormat": { "<mark>": string },
  "toneDescriptor": string,
  "preferPatterns": [string],
  "avoidPatterns": [string],
  "bloomsSummary": string,
  "answerStyle": string
}`;

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

function parseJson(raw: string): StyleGuide | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned) as StyleGuide; } catch { /* fall through */ }
  const first = raw.indexOf('{');
  const last  = raw.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)) as StyleGuide; } catch { /* fall through */ }
  }
  return null;
}

export async function extractStyleGuide(
  questions: { questionType: string; rawText: string }[],
): Promise<StyleGuide | null> {
  if (questions.length === 0) return null;

  const sample       = questions.slice(0, 100);
  const questionList = sample
    .map((q, i) => `${i + 1}. [${q.questionType}] ${q.rawText}`)
    .join('\n\n');

  try {
    const response = await withRetry(
      () => withTimeout(
        () => getGroq().chat.completions.create({
          model: process.env.GROQ_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            { role: 'system', content: EXTRACT_PROMPT },
            { role: 'user',   content: `QUESTIONS:\n${questionList}` },
          ],
          temperature: 0.1,
        }),
        30_000,
        'styleExtractor',
      ),
      3,
    );

    const raw = response.choices[0]?.message?.content ?? '';
    return parseJson(raw);
  } catch (err) {
    logger.warn('style_extract_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function saveStyleGuide(
  teacherId:     string,
  bankId:        string,
  styleGuide:    StyleGuide,
  questionCount: number,
): Promise<void> {
  await BankStyleGuide.findOneAndUpdate(
    { teacherId, bankId },
    { teacherId, bankId, styleGuide, questionCount },
    { upsert: true, new: true },
  );
}

export async function getStyleGuide(
  teacherId: string,
  bankId:    string | undefined,
): Promise<StyleGuide | null> {
  if (!teacherId || !bankId) return null;
  const doc = await BankStyleGuide.findOne({ teacherId, bankId }).lean();
  return doc ? (doc.styleGuide as StyleGuide) : null;
}

// ── Multi-paper synthesis ─────────────────────────────────────────────────────

// Merges per-year StyleGuide summaries into a single consolidated guide that
// retains only patterns consistent across years. Private — called by
// runBankStyleExtraction when ≥2 distinct years are present.
async function synthesizeStyleGuides(
  guides: Array<{ year: string; guide: StyleGuide }>,
): Promise<StyleGuide | null> {
  const summaries = guides
    .sort((a, b) => a.year.localeCompare(b.year))
    .map(({ year, guide }) =>
      `YEAR ${year}:\n` +
      `Board: ${guide.examBoard} | Subject: ${guide.subject}\n` +
      `Command words: ${guide.commandWords.join(', ')}\n` +
      `Tone: ${guide.toneDescriptor}\n` +
      `Prefer: ${guide.preferPatterns.join(' | ')}\n` +
      `Avoid: ${guide.avoidPatterns.join(' | ')}\n` +
      `Blooms: ${guide.bloomsSummary}\n` +
      `Answer style: ${guide.answerStyle}\n` +
      `Marks format: ${JSON.stringify(guide.marksFormat)}`,
    )
    .join('\n\n---\n\n');

  try {
    const response = await withRetry(
      () => withTimeout(
        () => getGroq().chat.completions.create({
          model: process.env.GROQ_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            { role: 'system', content: SYNTHESIZE_PROMPT },
            { role: 'user',   content: `PER-YEAR STYLE SUMMARIES (${guides.length} years):\n\n${summaries}` },
          ],
          temperature: 0.1,
        }),
        30_000,
        'synthesizeStyleGuides',
      ),
      3,
    );
    const raw = response.choices[0]?.message?.content ?? '';
    return parseJson(raw);
  } catch (err) {
    logger.warn('style_synthesize_failed', {
      error: err instanceof Error ? err.message : String(err),
      yearCount: guides.length,
    });
    return null;
  }
}

// Public entry point for the referenceBank upload handler.
// Groups docs by sourceYear. When ≥2 distinct years are present it runs a
// per-year extraction pass (parallel, ≤40 questions each) then synthesises.
// Falls back to single-pass extraction when there is only one year or all
// sourceYear values are null.
export async function runBankStyleExtraction(
  docs: Array<{ questionType: string; rawText: string; sourceYear: number | null }>,
): Promise<StyleGuide | null> {
  if (docs.length === 0) return null;

  // Group by sourceYear — null values land in 'unknown'
  const byYear = new Map<string, typeof docs>();
  for (const doc of docs) {
    const key = doc.sourceYear != null ? String(doc.sourceYear) : 'unknown';
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key)!.push(doc);
  }

  const knownYears = [...byYear.keys()].filter(k => k !== 'unknown');

  // Single year (or all unknown) — current single-pass behaviour, full sample
  if (knownYears.length <= 1) {
    return extractStyleGuide(docs);
  }

  // Multiple distinct years: extract per-year in parallel, then synthesize.
  // Limit each year to 40 questions so token cost stays flat as the bank grows.
  const perYearSettled = await Promise.allSettled(
    knownYears.map(year =>
      extractStyleGuide(byYear.get(year)!.slice(0, 40))
        .then(guide => ({ year, guide })),
    ),
  );

  const guides: Array<{ year: string; guide: StyleGuide }> = [];
  for (const r of perYearSettled) {
    if (r.status === 'fulfilled' && r.value.guide) {
      guides.push({ year: r.value.year, guide: r.value.guide });
    }
  }

  if (guides.length === 0) return null;
  // Only one year's extraction succeeded — skip synthesis, return what we have
  if (guides.length === 1) return guides[0].guide;

  logger.info('style_synthesis_start', { yearCount: guides.length, years: guides.map(g => g.year) });
  return synthesizeStyleGuides(guides);
}

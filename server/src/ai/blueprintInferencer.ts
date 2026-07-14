import Groq from 'groq-sdk';
import { z } from 'zod';
import { withRetry, withTimeout } from '../lib/retry.js';
import { parseAiJsonArray } from './generator.js';
import {
  ExamBlueprint,
  ExamBlueprintSchema,
  blueprintToTypeConfig,
  buildFallbackBlueprint,
} from '../validation/schemas/examBlueprint.js';
import { TypeConfigZodSchema } from '../validation/schemas/typeConfig.js';
import { schemaMap } from '../validation/schemaMap.js';

export interface BlueprintMetadata {
  name?:     string;
  subject?:  string;
  standard?: string;
  examType?: string;
}

const SUPPORTED_TYPES = Object.keys(schemaMap) as string[];

// Maps LLM-invented type names to the nearest supported type.
// Add entries here as new hallucinations are discovered.
const TYPE_ALIASES: Record<string, string> = {
  caseStudy:       'longAnswer',
  case_study:      'longAnswer',
  caseBased:       'longAnswer',
  openEnded:       'longAnswer',
  essay:           'longAnswer',
  descriptive:     'longAnswer',
  shortNote:       'shortAnswer',
  oneWord:         'fillInBlanks',
  objective:       'multipleChoice',
  diagram:         'figureBased',
  mapBased:        'mapSkill',
};

function remapType(t: string): string {
  if (SUPPORTED_TYPES.includes(t)) return t;
  return TYPE_ALIASES[t] ?? TYPE_ALIASES[
    // try camelCase → lower conversion match
    Object.keys(TYPE_ALIASES).find(k => k.toLowerCase() === t.toLowerCase()) ?? ''
  ] ?? 'shortAnswer';
}

const BLUEPRINT_PROMPT = `You are an experienced academic paper-setter and assessment blueprint analyst.

Read the uploaded paper pattern, syllabus, marking scheme, sample paper, or institutional instructions.
Infer a production-ready exam blueprint from the document. Do not assume CBSE unless the document itself indicates it.

Return ONLY one raw JSON object matching this shape:
{
  "title": string,
  "examBoard": string,
  "institutionType": string,
  "subject": string,
  "standard": string,
  "examType": string,
  "durationMinutes": number,
  "totalMarks": number,
  "tone": "formal-board-exam" | "neutral" | "conversational",
  "difficultyDefault": "easy" | "moderate" | "hard",
  "chapters": [
    {
      "title": string,
      "aliases": [string],
      "estimatedWeight": number,
      "learningOutcomes": [string],
      "sourceEvidence": [string]
    }
  ],
  "sections": [
    {
      "name": string,
      "instructions": string,
      "questionType": string,
      "count": number,
      "marksPerQuestion": number,
      "totalMarks": number,
      "choicePattern": string,
      "difficultyMix": { "easy": number, "moderate": number, "hard": number },
      "bloomsDistribution": { "remember": number, "understand": number, "apply": number, "analyze": number },
      "expectedAnswerStyle": string,
      "sourceEvidence": [string]
    }
  ],
  "globalInstructions": [string],
  "constraints": [string],
  "inferredFrom": [string]
}

Question type mapping:
- multipleChoice: MCQ, choose the correct/best option, objective questions with one correct answer
- multiSelect: choose all correct, multiple response, select all that apply
- fillInBlanks: fill blanks, complete sentence, one-word/very-short objective blanks
- trueFalse: true/false, correct/incorrect claims
- matchTheFollowing: match columns, pair terms, match items
- reordering: arrange, sequence, reorder steps
- sorting: classify, categorize, group into categories
- assertionReason: assertion-reason, statement/reason objective item
- shortAnswer: short answer, very short answer, 2-5 mark explanatory written answer (up to ~4 sentences)
- longAnswer: long answer, essay, detailed answer, 4–10 mark extended written response (paragraph or more)
- mapSkill: locate on map, mark on map, outline map, geographical identification, map-based questions
- figureBased: diagram-based, figure-based, image-based, picture-based questions; questions that refer to a labelled diagram, chart, or image provided alongside the question

Rules:
- Use only supported questionType values from the mapping above.
- Split mixed sections into multiple sections when their type or marks differ.
- If a document says "answer any N out of M", use count N and preserve the choice rule in choicePattern.
- totalMarks must equal the sum of section totalMarks.
- If the document lacks a value, infer conservatively and cite that uncertainty in constraints.
- sourceEvidence should contain short snippets or labels from the uploaded text that justify the inference.
- The blueprint should reflect the uploaded document, not generic CBSE conventions.`;

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

function parseJsonObject(raw: string): unknown {
  // Try direct / code-fenced JSON first
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }

  // AI sometimes wraps JSON in prose ("Here is the blueprint: {...} Note: …").
  // Extract the outermost { … } block.
  const firstBrace = raw.indexOf('{');
  const lastBrace  = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch { /* fall through */ }
  }

  return null;
}

function normalizeBlueprint(raw: unknown, metadata: BlueprintMetadata, rawText: string): ExamBlueprint {
  // Remap unknown questionType values before Zod validation so hallucinated
  // types like 'caseStudy' never reach the generation route.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.sections)) {
      obj.sections = (obj.sections as Record<string, unknown>[]).map(s => ({
        ...s,
        questionType: typeof s.questionType === 'string' ? remapType(s.questionType) : s.questionType,
      }));
    }
  }

  const objectResult = ExamBlueprintSchema.safeParse(raw);
  if (objectResult.success) {
    return objectResult.data;
  }

  const legacyArray = Array.isArray(raw) ? raw : parseAiJsonArray(typeof raw === 'string' ? raw : '');
  const legacyResult = z.array(TypeConfigZodSchema).safeParse(legacyArray);
  if (legacyResult.success && legacyResult.data.length > 0) {
    const filtered = legacyResult.data.filter(tc => SUPPORTED_TYPES.includes(tc.type as typeof SUPPORTED_TYPES[number]));
    if (filtered.length > 0) {
      return buildFallbackBlueprint({
        ...metadata,
        parsedConfig: filtered,
        rawText,
      });
    }
  }

  throw new Error('BLUEPRINT_PARSE_FAILED');
}

export async function inferExamBlueprint(
  rawText: string,
  metadata: BlueprintMetadata = {},
): Promise<ExamBlueprint> {
  const metadataText = [
    metadata.name ? `Name: ${metadata.name}` : '',
    metadata.subject ? `Subject: ${metadata.subject}` : '',
    metadata.standard ? `Standard: ${metadata.standard}` : '',
    metadata.examType ? `Exam type: ${metadata.examType}` : '',
  ].filter(Boolean).join('\n');

  const response = await withRetry(
    () => withTimeout(
      () => getGroq().chat.completions.create({
        model: process.env.GROQ_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          { role: 'system', content: BLUEPRINT_PROMPT },
          { role: 'user', content: `${metadataText}\n\nDOCUMENT TEXT:\n${rawText.slice(0, 40000)}` },
        ],
        temperature: 0.2,
      }),
      30_000,
      'blueprintInferencer',
    ),
    3,
  );

  const content = response.choices[0]?.message?.content ?? '';
  return normalizeBlueprint(parseJsonObject(content) ?? content, metadata, rawText);
}

export function typeConfigFromBlueprint(blueprint: ExamBlueprint) {
  return blueprintToTypeConfig(blueprint);
}

export function supportedBlueprintTypes(): string[] {
  return [...SUPPORTED_TYPES];
}

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

export interface BlueprintMetadata {
  name?:     string;
  subject?:  string;
  standard?: string;
  examType?: string;
}

const SUPPORTED_TYPES = [
  'fillInBlanks',
  'multipleChoice',
  'multiSelect',
  'matchTheFollowing',
  'reordering',
  'sorting',
  'trueFalse',
  'assertionReason',
  'shortAnswer',
] as const;

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
- shortAnswer: short answer, very short answer, 2-5 mark explanatory written answer

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
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeBlueprint(raw: unknown, metadata: BlueprintMetadata, rawText: string): ExamBlueprint {
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
        model: process.env.GROQ_MODEL ?? 'llama-4-maverick-17b-128e-instruct',
        messages: [
          { role: 'system', content: BLUEPRINT_PROMPT },
          { role: 'user', content: `${metadataText}\n\nDOCUMENT TEXT:\n${rawText.slice(0, 12000)}` },
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

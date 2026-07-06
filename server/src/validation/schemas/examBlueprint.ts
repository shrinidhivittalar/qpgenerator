import { z } from 'zod';
import { DifficultyLevel, ToneOption } from './typeConfig.js';

export const BloomsDistributionSchema = z.object({
  remember:   z.number().min(0).max(100).default(30),
  understand: z.number().min(0).max(100).default(30),
  apply:      z.number().min(0).max(100).default(25),
  analyze:    z.number().min(0).max(100).default(15),
}).strip();

export const DifficultyMixSchema = z.object({
  easy:     z.number().min(0).max(100).default(30),
  moderate: z.number().min(0).max(100).default(50),
  hard:     z.number().min(0).max(100).default(20),
}).strip();

export const BlueprintChapterSchema = z.object({
  title:            z.string().min(1),
  aliases:          z.array(z.string()).default([]),
  estimatedWeight:  z.number().min(0).max(100).optional(),
  learningOutcomes: z.array(z.string()).default([]),
  sourceEvidence:   z.array(z.string()).default([]),
}).strip();

export const BlueprintSectionSchema = z.object({
  name:               z.string().min(1),
  instructions:       z.string().default(''),
  questionType:       z.string().min(1),
  count:              z.number().int().positive(),
  marksPerQuestion:   z.number().positive(),
  totalMarks:         z.number().positive(),
  choicePattern:      z.string().default(''),
  difficultyMix:      DifficultyMixSchema.default({ easy: 30, moderate: 50, hard: 20 }),
  bloomsDistribution: BloomsDistributionSchema.default({ remember: 30, understand: 30, apply: 25, analyze: 15 }),
  expectedAnswerStyle:z.string().default(''),
  sourceEvidence:     z.array(z.string()).default([]),
}).strip();

export const ExamBlueprintSchema = z.object({
  title:              z.string().min(1).default('Inferred Question Paper Blueprint'),
  examBoard:          z.string().default('inferred'),
  institutionType:    z.string().default('inferred'),
  subject:            z.string().default('inferred'),
  standard:           z.string().default('inferred'),
  examType:           z.string().default(''),
  durationMinutes:    z.number().int().positive().optional(),
  totalMarks:         z.number().positive(),
  tone:               ToneOption.default('formal-board-exam'),
  difficultyDefault:  DifficultyLevel.default('moderate'),
  chapters:           z.array(BlueprintChapterSchema).default([]),
  sections:           z.array(BlueprintSectionSchema).min(1),
  globalInstructions: z.array(z.string()).default([]),
  constraints:        z.array(z.string()).default([]),
  inferredFrom:       z.array(z.string()).default([]),
}).strip();

export type ExamBlueprint = z.infer<typeof ExamBlueprintSchema>;
export type BlueprintSection = z.infer<typeof BlueprintSectionSchema>;

export function blueprintToTypeConfig(blueprint: ExamBlueprint) {
  const merged = new Map<string, { type: string; count: number; marksPerQuestion: number }>();

  for (const section of blueprint.sections) {
    const existing = merged.get(section.questionType);
    if (existing && existing.marksPerQuestion === section.marksPerQuestion) {
      existing.count += section.count;
    } else if (existing) {
      merged.set(`${section.questionType}:${section.marksPerQuestion}`, {
        type: section.questionType,
        count: section.count,
        marksPerQuestion: section.marksPerQuestion,
      });
    } else {
      merged.set(section.questionType, {
        type: section.questionType,
        count: section.count,
        marksPerQuestion: section.marksPerQuestion,
      });
    }
  }

  return Array.from(merged.values()).map(v => ({
    type: v.type,
    count: v.count,
    marksPerQuestion: v.marksPerQuestion,
  }));
}

export function buildFallbackBlueprint(input: {
  name?: string;
  subject?: string;
  standard?: string;
  examType?: string;
  parsedConfig: Array<{ type: string; count: number; marksPerQuestion: number }>;
  rawText?: string;
}): ExamBlueprint {
  const sections = input.parsedConfig.map((tc, index) => ({
    name: `Section ${String.fromCharCode(65 + index)}`,
    instructions: '',
    questionType: tc.type,
    count: tc.count,
    marksPerQuestion: tc.marksPerQuestion,
    totalMarks: tc.count * tc.marksPerQuestion,
    choicePattern: '',
    difficultyMix: { easy: 30, moderate: 50, hard: 20 },
    bloomsDistribution: { remember: 30, understand: 30, apply: 25, analyze: 15 },
    expectedAnswerStyle: '',
    sourceEvidence: [],
  }));

  return ExamBlueprintSchema.parse({
    title: input.name?.trim() || 'Inferred Question Paper Blueprint',
    examBoard: 'inferred',
    institutionType: 'inferred',
    subject: input.subject?.trim() || 'inferred',
    standard: input.standard?.trim() || 'inferred',
    examType: input.examType?.trim() || '',
    totalMarks: sections.reduce((sum, s) => sum + s.totalMarks, 0),
    tone: 'formal-board-exam',
    difficultyDefault: 'moderate',
    chapters: [],
    sections,
    globalInstructions: [],
    constraints: [],
    inferredFrom: input.rawText ? ['scheme-document'] : [],
  });
}

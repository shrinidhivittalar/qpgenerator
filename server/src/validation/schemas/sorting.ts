import { z } from 'zod';
import { baseQuestionSchema } from './base.js';

export const SortingSchema = baseQuestionSchema.extend({
  categories:    z.array(z.string()),
  items:         z.array(z.string()),
  correctAnswer: z.record(z.string(), z.array(z.string())),
  // EC-GEN-19: no cross-check that correctAnswer keys exist in categories — intentional
});

export type SortingQuestion = z.infer<typeof SortingSchema>;

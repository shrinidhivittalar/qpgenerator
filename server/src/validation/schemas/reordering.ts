import { z } from 'zod';
import { baseQuestionSchema } from './base.js';

export const ReorderingSchema = baseQuestionSchema.extend({
  items:         z.array(z.string()),
  correctAnswer: z.array(z.string()),
});

export type ReorderingQuestion = z.infer<typeof ReorderingSchema>;

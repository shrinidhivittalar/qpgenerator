import { z } from 'zod';
import { baseQuestionSchema } from './base.js';

export const FillInBlanksSchema = baseQuestionSchema.extend({
  correctAnswer: z.string(),
  alternatives:  z.array(z.string()),
});

export type FillInBlanksQuestion = z.infer<typeof FillInBlanksSchema>;

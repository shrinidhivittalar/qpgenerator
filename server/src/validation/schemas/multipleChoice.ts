import { z } from 'zod';
import { baseQuestionSchema, optionSchema } from './base.js';

// EC-GEN-15: fewer than 2 options fails validation
export const MultipleChoiceSchema = baseQuestionSchema.extend({
  options:       z.array(optionSchema).min(2),
  correctAnswer: z.string(),
  // EC-GEN-16: no cross-check that correctAnswer matches an option's text — intentional
});

export type MultipleChoiceQuestion = z.infer<typeof MultipleChoiceSchema>;

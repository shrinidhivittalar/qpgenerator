import { z } from 'zod';
import { baseQuestionSchema, optionSchema } from './base.js';

// EC-GEN-17: empty correctAnswer array fails validation
export const MultiSelectSchema = baseQuestionSchema.extend({
  options:       z.array(optionSchema),
  correctAnswer: z.array(z.string()).min(1),
});

export type MultiSelectQuestion = z.infer<typeof MultiSelectSchema>;

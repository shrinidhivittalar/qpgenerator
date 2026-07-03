import { z } from 'zod';
import { baseQuestionSchema } from './base.js';

// EC-GEN-20: z.boolean() does NOT coerce — string "true" will fail.
// Never use z.coerce.boolean() here.
export const TrueFalseSchema = baseQuestionSchema.extend({
  correctAnswer: z.boolean(),
});

export type TrueFalseQuestion = z.infer<typeof TrueFalseSchema>;

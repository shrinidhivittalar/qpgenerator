import { z } from 'zod';
import { baseQuestionSchema } from './base.js';

export const ShortAnswerSchema = baseQuestionSchema.extend({
  wordLimit: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().positive(),
  }).refine(v => v.max >= v.min, { message: 'wordLimit.max must be greater than or equal to min' }),
  modelAnswer: z.string().min(1),
  markingScheme: z.array(z.object({
    point: z.string().min(1),
    marks: z.number().positive(),
  }).strip()).min(1),
}).strip();

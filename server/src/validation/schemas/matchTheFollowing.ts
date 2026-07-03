import { z } from 'zod';
import { baseQuestionSchema } from './base.js';

export const MatchTheFollowingSchema = baseQuestionSchema.extend({
  leftItems:     z.array(z.string()),
  rightItems:    z.array(z.string()),
  correctAnswer: z.array(z.object({ left: z.string(), right: z.string() })),
  // EC-GEN-18: no length-equality constraint between leftItems/rightItems — intentional
});

export type MatchTheFollowingQuestion = z.infer<typeof MatchTheFollowingSchema>;

import { z } from 'zod';

const ASSERTION_OPTIONS = [
  'Both (A) and (R) are true and (R) is the correct explanation of (A).',
  'Both (A) and (R) are true, but (R) is not the correct explanation of (A).',
  '(A) is true, but (R) is false.',
  '(A) is false, but (R) is true.',
] as const;

export const AssertionReasonSchema = z.object({
  id:            z.number().optional(),
  marks:         z.number().positive(),
  explanation:   z.string().min(1),
  assertion:     z.string().min(1),
  reason:        z.string().min(1),
  options:       z.tuple([
    z.literal(ASSERTION_OPTIONS[0]),
    z.literal(ASSERTION_OPTIONS[1]),
    z.literal(ASSERTION_OPTIONS[2]),
    z.literal(ASSERTION_OPTIONS[3]),
  ]),
  correctAnswer: z.enum(ASSERTION_OPTIONS),
}).strip();

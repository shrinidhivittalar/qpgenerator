import { z } from 'zod';

// The question field and option fields share the same shape
export const contentFieldSchema = z.object({
  hide_text: z.boolean(),
  text:      z.string(),
  read_text: z.boolean(),
  image:     z.string(),
});

// Alias used by multipleChoice and multiSelect
export const optionSchema = contentFieldSchema;

export const baseQuestionSchema = z.object({
  id:          z.number(),
  marks:       z.number().positive(),
  explanation: z.string().min(1),
  question:    contentFieldSchema,
});

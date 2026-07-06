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
  // id is assigned server-side by assignGlobalIds() after generation — raw AI
  // output never carries it. Optional here so validation accepts untagged output;
  // the export validator enforces presence after IDs are written.
  id:          z.number().optional(),
  marks:       z.number().positive(),
  explanation: z.string().min(1),
  question:    contentFieldSchema,
});

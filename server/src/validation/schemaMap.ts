import { z } from 'zod';
import { FillInBlanksSchema }      from './schemas/fillInBlanks.js';
import { MultipleChoiceSchema }    from './schemas/multipleChoice.js';
import { MultiSelectSchema }       from './schemas/multiSelect.js';
import { MatchTheFollowingSchema } from './schemas/matchTheFollowing.js';
import { ReorderingSchema }        from './schemas/reordering.js';
import { SortingSchema }           from './schemas/sorting.js';
import { TrueFalseSchema }         from './schemas/trueFalse.js';
import { AssertionReasonSchema }   from './schemas/assertionReason.js';
import { ShortAnswerSchema }       from './schemas/shortAnswer.js';

export type QuestionType =
  | 'fillInBlanks'
  | 'multipleChoice'
  | 'multiSelect'
  | 'matchTheFollowing'
  | 'reordering'
  | 'sorting'
  | 'trueFalse'
  | 'assertionReason'
  | 'shortAnswer';

export const schemaMap: Record<QuestionType, z.ZodTypeAny> = {
  fillInBlanks:      FillInBlanksSchema,
  multipleChoice:    MultipleChoiceSchema,
  multiSelect:       MultiSelectSchema,
  matchTheFollowing: MatchTheFollowingSchema,
  reordering:        ReorderingSchema,
  sorting:           SortingSchema,
  trueFalse:         TrueFalseSchema,
  assertionReason:   AssertionReasonSchema,
  shortAnswer:       ShortAnswerSchema,
};

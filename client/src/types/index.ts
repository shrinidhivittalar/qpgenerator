export type Role = 'teacher' | 'hod' | 'principal' | 'student';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  department?: string | null;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
  role: Role;
  department?: string;
}

export type QuestionType =
  | 'fillInBlanks'
  | 'multipleChoice'
  | 'multiSelect'
  | 'matchTheFollowing'
  | 'reordering'
  | 'sorting'
  | 'trueFalse'
  | 'assertionReason'
  | 'shortAnswer'
  | 'longAnswer';

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  fillInBlanks:      'Fill in the Blanks',
  multipleChoice:    'Multiple Choice',
  multiSelect:       'Multi-Select',
  matchTheFollowing: 'Match the Following',
  reordering:        'Reordering',
  sorting:           'Sorting',
  trueFalse:         'True / False',
  assertionReason:   'Assertion / Reason',
  shortAnswer:       'Short Answer',
  longAnswer:        'Long Answer',
};

export const ALL_QUESTION_TYPES: QuestionType[] = [
  'fillInBlanks', 'multipleChoice', 'multiSelect',
  'matchTheFollowing', 'reordering', 'sorting', 'trueFalse',
  'assertionReason', 'shortAnswer', 'longAnswer',
];

// ── Question Bank ─────────────────────────────────────────────────────────────

export interface BankQuestion {
  _id:          string;
  questionType: QuestionType;
  rawText:      string;
  subject:      string | null;
  sourceYear:   number | null;
  confidence:   number;
  status:       'accepted' | 'needs_review' | 'rejected';
  createdAt:    string;
}

export interface ReferenceBank {
  id:   string;
  name: string;
}

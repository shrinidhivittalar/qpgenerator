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
  | 'longAnswer'
  | 'mapSkill'
  | 'figureBased';

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
  mapSkill:          'Map Skill',
  figureBased:       'Figure Based',
};

export const ALL_QUESTION_TYPES: QuestionType[] = [
  'fillInBlanks', 'multipleChoice', 'multiSelect',
  'matchTheFollowing', 'reordering', 'sorting', 'trueFalse',
  'assertionReason', 'shortAnswer', 'longAnswer', 'mapSkill',
  'figureBased',
];

// ── Paper Structure types (hierarchical paper format) ─────────────────────────

export interface PaperWordLimit {
  min: number;
  max: number;
}

export interface PaperQuestion {
  number:       number;
  type:         QuestionType;
  marks:        number;
  wordLimit?:   PaperWordLimit;
  unitRef?:     string;
  chapterId?:   string;
  subPartCount?: number;
  generated?:   unknown | null;
  error?:       string;
}

export interface PaperSection {
  label:          string;
  title?:         string;
  instructions?:  string;
  totalToAttempt?: number;
  totalMarks:     number;
  questions:      PaperQuestion[];
}

export interface PaperStructure {
  title:               string;
  totalMarks:          number;
  duration?:           string;
  generalInstructions: string[];
  sections:            PaperSection[];
}

export type DifficultyLevel = 'easy' | 'moderate' | 'hard';
export type ToneOption     = 'formal-board-exam' | 'neutral' | 'conversational';

export interface TypeConfig {
  type:             QuestionType;
  count:            number;
  marksPerQuestion: number;
  difficulty?:      DifficultyLevel;
  mapItems?:        string[];
}

export interface ReferenceBank {
  id:   string;
  name: string;
}

export interface Scheme {
  schemeId:       string;
  name:           string;
  subject:        string;
  standard:       string;
  examType:       string | null;
  fileType:       'pdf' | 'docx';
  parsedConfig:   TypeConfig[];
  examBlueprint?: ExamBlueprint | null;
  paperStructure?: PaperStructure | null;
  updatedAt:      string;
}

export interface QuestionBlockResult {
  questionType: string;
  totalMarks:   number;
  status:       'success' | 'failed';
  questions:    unknown[];
}

export interface GenerationError {
  type:      string;
  requested: number;
  received:  number;
  error:     string;
}

export type TypeResultStatus = 'idle' | 'generating' | 'success' | 'failed';

export interface TypeResult {
  status:       TypeResultStatus;
  questions?:   unknown[];
  totalMarks?:  number;
  received?:    number;
  requested?:   number;
  error?:       string;
}

export interface ChapterInfo {
  _id:               string;
  chapterName:       string;
  chapterNumber:     number;
  weightPercent:     number;
  subject:           string;
  figurePageCount:   number;
}

export interface BlueprintChapter {
  title: string;
  aliases: string[];
  estimatedWeight?: number;
  learningOutcomes: string[];
  sourceEvidence: string[];
}

export interface BlueprintSection {
  name: string;
  instructions: string;
  questionType: QuestionType | string;
  count: number;
  marksPerQuestion: number;
  totalMarks: number;
  choicePattern: string;
  difficultyMix: { easy: number; moderate: number; hard: number };
  bloomsDistribution: { remember: number; understand: number; apply: number; analyze: number };
  expectedAnswerStyle: string;
  sourceEvidence: string[];
}

export interface ExamBlueprint {
  title: string;
  examBoard: string;
  institutionType: string;
  subject: string;
  standard: string;
  examType: string;
  durationMinutes?: number;
  totalMarks: number;
  tone: ToneOption;
  difficultyDefault: DifficultyLevel;
  chapters: BlueprintChapter[];
  sections: BlueprintSection[];
  globalInstructions: string[];
  constraints: string[];
  inferredFrom: string[];
}

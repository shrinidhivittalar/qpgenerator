export type QuestionType =
  | 'mcq'
  | 'figure_based'
  | 'table_based'
  | 'text'
  | 'multi_part'
  | 'custom'
  | 'analogy'
  | 'grammar'
  | 'comprehension'
  | 'essay'
  | 'letter'

export interface PaperSection {
  id:          string
  title:       string
  instruction: string
  marksPerQ:   number
}

export interface ImageEntry {
  fid:    string
  file:   string
  width:  number
  height: number
}

export interface TableEntry {
  tid:     string
  qid:     string
  headers: string[]
  rows:    Record<string, string>[]
}

export interface BankQuestion {
  qid:        string
  number:     number
  text:       string
  type:       QuestionType
  options:    string[] | null   // MCQ options A/B/C/D
  has_figure: boolean
  has_table:  boolean
  images:     ImageEntry[]
  tables:     TableEntry[]
  source:      string
  chapter:     string | null
  chapter_num: number | null
  section:     string | null   // 'exercises' | 'in_text' | null
  marks?:      number          // pre-set mark value from question bank
  difficulty?: string | null   // 'Easy' | 'Average' | 'Difficult'
}

export interface PaperItem extends BankQuestion {
  uid:          string   // unique slot ID in this paper
  subject:      string
  marks:        number
  sectionId:    string | null
  isRephrased:  boolean
  originalText: string
}

// ── Paper configuration ───────────────────────────────────────────────────────
// This is the single source of truth for all presentational metadata about a
// generated paper. Fields are kept additive so future capabilities (logo, QR,
// watermark, multi-template) can be introduced without breaking existing data.

export interface PaperConfiguration {
  // ── School identity ──────────────────────────────────────────────────────
  schoolName:      string
  schoolLogoUrl?:  string          // future: base64 or hosted URL

  // ── Exam identity ────────────────────────────────────────────────────────
  examName:        string          // e.g. "Annual Examination 2024-25"
  academicYear?:   string          // e.g. "2024-25"
  boardName?:      string          // e.g. "Karnataka State Board", "CBSE"
  examCode?:       string          // future: e.g. "QP-2024-MTH-001"

  // ── Paper classification ─────────────────────────────────────────────────
  className:       string          // e.g. "10"
  subject:         string          // e.g. "Mathematics"
  section?:        string          // e.g. "A"
  chapters?:       string          // e.g. "Ch 1–5"
  difficulty?:     string          // Easy / Medium / Hard / Mixed
  date?:           string          // e.g. "15 March 2025"

  // ── Logistics ────────────────────────────────────────────────────────────
  duration:        string          // e.g. "3 Hours"
  totalMarks:      number          // declared maximum marks (0 = auto from paper)
  totalQuestions?: number          // declared total (0/undefined = auto from paper)

  // ── Content ──────────────────────────────────────────────────────────────
  instructions?:   string[]        // general instructions; each entry = one item
  footerText?:     string          // e.g. "Prepared by: Mathematics Dept"

  // ── Future rendering hints ───────────────────────────────────────────────
  headerTemplate?: 'standard' | 'minimal' | 'board_style'
  isConfidential?: boolean         // future: overlay "CONFIDENTIAL" watermark
  qrCodeData?:     string          // future: URL/text to encode in QR
  signatures?:     { label: string; name?: string }[]  // future: signature blocks
}

export const DEFAULT_PAPER_CONFIG: PaperConfiguration = {
  schoolName:   '',
  examName:     '',
  className:    '',
  subject:      '',
  duration:     '',
  totalMarks:   0,
}

export interface PaperTab {
  id:       string
  title:    string
  items:    PaperItem[]
  sections: PaperSection[]
  config:   PaperConfiguration
}

// Raw question returned by /api/upload before user review
export interface RawQuestion {
  number:  number
  text:    string
  type:    'mcq' | 'figure_based' | 'text' | 'table_based'
  options: string[] | null
  images:  { fid: string; file: string }[]
  tables:  { tid: string; headers: string[]; rows: Record<string, string>[] }[]
}

export interface UploadParseResult {
  upload_id: string
  name:      string
  raw:       RawQuestion[]
  warnings:  string[]
}

export const MARKS_DEFAULT: Record<string, number> = {
  mcq:          1,
  figure_based: 2,
  table_based:  3,
  text:         2,
  multi_part:   3,
  custom:       2,
  analogy:      1,
  grammar:      2,
  comprehension: 4,
  essay:        5,
  letter:       5,
}

export const TYPE_LABELS: Record<string, string> = {
  mcq:          'MCQ',
  figure_based: 'Figure',
  table_based:  'Table',
  text:         'Text',
  multi_part:   'Multi-part',
  custom:       'Custom',
  analogy:      'Analogy',
  grammar:      'Grammar',
  comprehension: 'Comprehension',
  essay:        'Essay',
  letter:       'Letter',
}

export const TYPE_COLORS: Record<string, string> = {
  mcq:          'bg-blue-100 text-blue-700',
  figure_based: 'bg-amber-100 text-amber-700',
  table_based:  'bg-purple-100 text-purple-700',
  text:         'bg-gray-100 text-gray-600',
  multi_part:   'bg-orange-100 text-orange-700',
  custom:       'bg-green-100 text-green-700',
  analogy:      'bg-teal-100 text-teal-700',
  grammar:      'bg-cyan-100 text-cyan-700',
  comprehension: 'bg-rose-100 text-rose-700',
  essay:        'bg-violet-100 text-violet-700',
  letter:       'bg-pink-100 text-pink-700',
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface PaperValidationError {
  code:    string
  message: string
}

export function validatePaper(
  config:   PaperConfiguration,
  sections: PaperSection[],
  items:    PaperItem[],
): PaperValidationError[] {
  const errors: PaperValidationError[] = []

  if (!config.subject?.trim())   errors.push({ code: 'no_subject',   message: 'Subject is required.' })
  if (!config.className?.trim()) errors.push({ code: 'no_class',     message: 'Class is required.' })
  if (!config.duration?.trim())  errors.push({ code: 'no_duration',  message: 'Duration is required.' })

  const computedTotal = items.reduce((s, i) => s + i.marks, 0)
  if (items.length === 0) errors.push({ code: 'no_questions', message: 'Paper has no questions.' })
  if (computedTotal === 0 && items.length > 0) errors.push({ code: 'no_marks', message: 'Total marks is zero — set marks on your questions.' })

  for (const item of items) {
    if (!item.text?.trim()) {
      errors.push({ code: 'empty_text', message: `A question has no text (${item.qid}).` })
    }
  }

  for (const sec of sections) {
    const secItems = items.filter(i => i.sectionId === sec.id)
    if (secItems.length === 0) {
      errors.push({ code: `empty_section_${sec.id}`, message: `Section "${sec.title}" has no questions.` })
    }
    const m = sec.instruction.match(/answer any\s+(\d+)/i)
    if (m) {
      const required = parseInt(m[1])
      if (secItems.length < required) {
        errors.push({
          code: `insufficient_${sec.id}`,
          message: `Section "${sec.title}" says "Answer any ${required}" but has only ${secItems.length} question${secItems.length !== 1 ? 's' : ''}.`,
        })
      }
    }
  }

  return errors
}

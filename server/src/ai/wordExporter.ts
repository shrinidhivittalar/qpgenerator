import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from 'docx';
import type { PaperStructure, PaperQuestion } from '../types/paperStructure.js';

type DocChild = Paragraph | Table;

// ─── Constants ────────────────────────────────────────────────────────────────

const FONT       = 'Times New Roman';
const SZ_TITLE   = 28;   // 14 pt
const SZ_BODY    = 22;   // 11 pt
const SZ_SMALL   = 18;   // 9 pt
const INDENT_Q   = convertInchesToTwip(0.4);
const INDENT_OPT = convertInchesToTwip(0.7);

const BORDER_SINGLE = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
const BORDER_NONE   = { style: BorderStyle.NONE,   size: 0, color: 'FFFFFF' };
const BOX_BORDERS   = { top: BORDER_SINGLE, bottom: BORDER_SINGLE, left: BORDER_SINGLE, right: BORDER_SINGLE };
const NO_BORDERS    = { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE, insideH: BORDER_NONE, insideV: BORDER_NONE };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function r(
  text: string,
  opts: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {},
): TextRun {
  return new TextRun({ text, font: FONT, size: SZ_BODY, ...opts });
}

function marksRun(marks: number): TextRun {
  return r(`  [${marks} Mark${marks !== 1 ? 's' : ''}]`, { bold: true });
}

function sp(after: number, before = 0) {
  return { after, before };
}

function blankLine(): Paragraph {
  return new Paragraph({ children: [], spacing: sp(80) });
}

// Single full-width table cell — used for bordered/shaded blocks
function wrapInBox(children: Paragraph[], shade?: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: BOX_BORDERS as any,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children,
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            ...(shade ? { shading: { type: ShadingType.SOLID, color: shade } } : {}),
          }),
        ],
      }),
    ],
  });
}

// ─── Header block ─────────────────────────────────────────────────────────────
// Two-row bordered table:
//   Row 1: full-width cell with exam title (light-shaded)
//   Row 2: two cells — time (left) | marks (right)

function buildHeader(structure: PaperStructure): Table {
  const titleRow = new TableRow({
    children: [
      new TableCell({
        columnSpan: 2,
        children: [
          new Paragraph({
            children: [r(structure.title, { bold: true, size: SZ_TITLE })],
            alignment: AlignmentType.CENTER,
            spacing: sp(80, 80),
          }),
        ],
        shading:  { type: ShadingType.SOLID, color: 'E8EAF6' },
        margins:  { top: 120, bottom: 120, left: 180, right: 180 },
        borders:  { ...BOX_BORDERS, bottom: BORDER_SINGLE } as any,
      }),
    ],
  });

  const metaParts: string[] = [];
  if (structure.duration)   metaParts.push(`Time Allowed: ${structure.duration}`);
  if (structure.totalMarks) metaParts.push(`Maximum Marks: ${structure.totalMarks}`);

  const metaRow = new TableRow({
    children: metaParts.length === 2
      ? [
          new TableCell({
            children: [new Paragraph({ children: [r(metaParts[0], { bold: true })], spacing: sp(60, 60) })],
            width:   { size: 50, type: WidthType.PERCENTAGE },
            margins: { left: 180, right: 180 },
            borders: { ...BOX_BORDERS, right: BORDER_SINGLE } as any,
          }),
          new TableCell({
            children: [new Paragraph({ children: [r(metaParts[1], { bold: true })], alignment: AlignmentType.RIGHT, spacing: sp(60, 60) })],
            width:   { size: 50, type: WidthType.PERCENTAGE },
            margins: { left: 180, right: 180 },
            borders: BOX_BORDERS as any,
          }),
        ]
      : [
          new TableCell({
            columnSpan: 2,
            children:  [new Paragraph({ children: [r(metaParts[0] ?? '', { bold: true })], alignment: AlignmentType.CENTER, spacing: sp(60, 60) })],
            margins:   { left: 180 },
            borders:   BOX_BORDERS as any,
          }),
        ],
  });

  return new Table({
    width:   { size: 100, type: WidthType.PERCENTAGE },
    borders: BOX_BORDERS as any,
    rows:    [titleRow, metaRow],
  });
}

// ─── Instructions box ─────────────────────────────────────────────────────────

function buildInstructionsBox(instructions: string[]): Table {
  const paras = [
    new Paragraph({ children: [r('General Instructions:', { bold: true })], spacing: sp(60, 60) }),
    ...instructions.map((instr, i) =>
      new Paragraph({
        children: [r(`${i + 1}.  ${instr}`)],
        indent:   { left: convertInchesToTwip(0.2) },
        spacing:  sp(40),
      }),
    ),
    blankLine(),
  ];
  return wrapInBox(paras, 'F5F5F5');
}

// ─── Section header row ───────────────────────────────────────────────────────

function buildSectionHeader(section: { label: string; title?: string; instructions?: string; totalToAttempt?: number; totalMarks?: number; questions: unknown[] }): Table {
  const lines: Paragraph[] = [];

  lines.push(new Paragraph({
    children: [r(section.label, { bold: true, size: 24 })],
    alignment: AlignmentType.CENTER,
    spacing: sp(60, 80),
  }));

  if (section.title) {
    lines.push(new Paragraph({
      children: [r(section.title, { bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: sp(40),
    }));
  }

  const infoRuns: TextRun[] = [];
  if (section.instructions) {
    infoRuns.push(r(section.instructions + '     '));
  } else if (section.totalToAttempt != null && section.totalToAttempt < (section.questions as unknown[]).length) {
    infoRuns.push(r(`Attempt any ${section.totalToAttempt} out of ${(section.questions as unknown[]).length}     `));
  }
  if (section.totalMarks) infoRuns.push(r(`[${section.totalMarks} Marks]`, { bold: true }));

  if (infoRuns.length) {
    lines.push(new Paragraph({
      children: infoRuns,
      alignment: AlignmentType.CENTER,
      spacing: sp(60),
    }));
  }

  return wrapInBox(lines, 'EEEEEE');
}

// ─── Per-type: student-facing question ────────────────────────────────────────

function renderQuestion(q: PaperQuestion, num: number): DocChild[] {
  const gen  = q.generated as Record<string, unknown> | null;
  const out: DocChild[] = [];

  if (!gen) {
    out.push(new Paragraph({
      children: [r(`Q${num}.  `, { bold: true }), r('[Question not generated]', { italics: true, color: '999999' })],
      spacing:  sp(180),
    }));
    return out;
  }

  const type  = q.type;
  const qText = ((gen.question as Record<string, unknown> | undefined)?.text as string | undefined) ?? '';

  switch (type) {

    case 'multipleChoice':
    case 'multiSelect': {
      out.push(new Paragraph({
        children: [r(`Q${num}.  `, { bold: true }), r(qText), marksRun(q.marks)],
        spacing:  sp(80),
      }));
      const opts = (gen.options as Array<Record<string, unknown>> | undefined) ?? [];
      opts.forEach((opt, i) => {
        out.push(new Paragraph({
          children: [r(`(${String.fromCharCode(65 + i)})  ${(opt.text as string) ?? ''}`)],
          indent:  { left: INDENT_OPT },
          spacing: sp(40),
        }));
      });
      if (type === 'multiSelect') {
        out.push(new Paragraph({
          children: [r('(Select all correct options.)', { italics: true, size: SZ_SMALL, color: '444444' })],
          indent:  { left: INDENT_OPT },
          spacing: sp(160),
        }));
      } else {
        out.push(blankLine());
      }
      break;
    }

    case 'trueFalse':
      out.push(new Paragraph({
        children: [r(`Q${num}.  `, { bold: true }), r(qText), r('  [True / False]', { italics: true }), marksRun(q.marks)],
        spacing: sp(200),
      }));
      break;

    case 'fillInBlanks':
      out.push(new Paragraph({
        children: [r(`Q${num}.  `, { bold: true }), r(qText), marksRun(q.marks)],
        spacing: sp(200),
      }));
      break;

    case 'assertionReason': {
      out.push(new Paragraph({
        children: [r(`Q${num}.  `, { bold: true }), marksRun(q.marks)],
        spacing: sp(80),
      }));
      out.push(new Paragraph({
        children: [r('Assertion (A):  ', { bold: true }), r((gen.assertion as string) ?? '')],
        indent:  { left: INDENT_Q },
        spacing: sp(60),
      }));
      out.push(new Paragraph({
        children: [r('Reason (R):  ', { bold: true }), r((gen.reason as string) ?? '')],
        indent:  { left: INDENT_Q },
        spacing: sp(80),
      }));
      out.push(new Paragraph({
        children: [r('In the light of the above statements, choose the correct answer from the options given below:', { italics: true })],
        indent:  { left: INDENT_Q },
        spacing: sp(50),
      }));
      const arOpts = (gen.options as string[] | undefined) ?? [];
      arOpts.forEach((opt, i) => {
        out.push(new Paragraph({
          children: [r(`(${String.fromCharCode(65 + i)})  ${opt}`)],
          indent:  { left: INDENT_OPT },
          spacing: sp(40),
        }));
      });
      out.push(blankLine());
      break;
    }

    case 'matchTheFollowing': {
      out.push(new Paragraph({
        children: [r(`Q${num}.  `, { bold: true }), r(qText || 'Match the following:'), marksRun(q.marks)],
        spacing: sp(80),
      }));
      const lefts  = (gen.leftItems  as string[] | undefined) ?? [];
      const rights = (gen.rightItems as string[] | undefined) ?? [];
      const maxLen = Math.max(lefts.length, rights.length);

      const tableRows: TableRow[] = [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [r('Column A', { bold: true })], spacing: sp(40, 40) })], width: { size: 48, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.SOLID, color: 'F0F0F0' } }),
            new TableCell({ children: [new Paragraph({ children: [r('Column B', { bold: true })], spacing: sp(40, 40) })], width: { size: 52, type: WidthType.PERCENTAGE }, shading: { type: ShadingType.SOLID, color: 'F0F0F0' } }),
          ],
        }),
      ];
      for (let i = 0; i < maxLen; i++) {
        const lbl = String.fromCharCode(97 + i);
        tableRows.push(new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [r(lefts[i]  ? `${i + 1}.  ${lefts[i]}`  : '')], spacing: sp(40, 40) })], width: { size: 48, type: WidthType.PERCENTAGE } }),
            new TableCell({ children: [new Paragraph({ children: [r(rights[i] ? `(${lbl})  ${rights[i]}` : '')], spacing: sp(40, 40) })], width: { size: 52, type: WidthType.PERCENTAGE } }),
          ],
        }));
      }
      out.push(new Table({
        rows:  tableRows,
        width: { size: 85, type: WidthType.PERCENTAGE },
        margins: { left: INDENT_Q },
      }));
      out.push(blankLine());
      break;
    }

    case 'reordering': {
      out.push(new Paragraph({
        children: [r(`Q${num}.  `, { bold: true }), r(qText || 'Arrange the following in the correct order:'), marksRun(q.marks)],
        spacing: sp(80),
      }));
      const items = (gen.items as string[] | undefined) ?? [];
      items.forEach((item, i) => {
        out.push(new Paragraph({
          children: [r(`(${String.fromCharCode(97 + i)})  ${item}`)],
          indent:  { left: INDENT_OPT },
          spacing: sp(40),
        }));
      });
      out.push(blankLine());
      break;
    }

    case 'sorting': {
      out.push(new Paragraph({
        children: [r(`Q${num}.  `, { bold: true }), r(qText || 'Sort the following into the correct categories:'), marksRun(q.marks)],
        spacing: sp(60),
      }));
      const cats  = (gen.categories as string[] | undefined) ?? [];
      const items = (gen.items      as string[] | undefined) ?? [];
      out.push(new Paragraph({
        children: [r(`Categories:  ${cats.join('  |  ')}`, { italics: true })],
        indent:  { left: INDENT_Q },
        spacing: sp(40),
      }));
      out.push(new Paragraph({
        children: [r(`Items:  ${items.join(',  ')}`)],
        indent:  { left: INDENT_Q },
        spacing: sp(200),
      }));
      break;
    }

    case 'shortAnswer': {
      const wl = gen.wordLimit as { min?: number; max?: number } | undefined;
      out.push(new Paragraph({
        children: [r(`Q${num}.  `, { bold: true }), r(qText), marksRun(q.marks)],
        spacing: sp(wl ? 40 : 200),
      }));
      if (wl) {
        out.push(new Paragraph({
          children: [r(`(Answer in ${wl.min ?? ''}–${wl.max ?? ''} words)`, { italics: true, size: SZ_SMALL, color: '444444' })],
          indent:  { left: INDENT_Q },
          spacing: sp(200),
        }));
      }
      break;
    }

    case 'longAnswer': {
      const preamble = (gen.preamble as string) ?? '';
      const parts    = (gen.parts as Array<{ label: string; marks: number; question: string }> | undefined) ?? [];
      out.push(new Paragraph({
        children: [r(`Q${num}.  `, { bold: true }), r(preamble), marksRun(q.marks)],
        spacing: sp(80),
      }));
      parts.forEach(pt => {
        out.push(new Paragraph({
          children: [
            r(`(${pt.label})  ${pt.question}  `),
            r(`[${pt.marks} Mark${pt.marks !== 1 ? 's' : ''}]`, { bold: true }),
          ],
          indent:  { left: INDENT_Q },
          spacing: sp(80),
        }));
      });
      out.push(blankLine());
      break;
    }
  }

  return out;
}

// ─── Per-type: answer key ─────────────────────────────────────────────────────

function renderAnswer(q: PaperQuestion, num: number): DocChild[] {
  const gen = q.generated as Record<string, unknown> | null;
  const out: DocChild[] = [];
  const prefix = r(`Q${num}.  `, { bold: true });

  if (!gen) {
    out.push(new Paragraph({
      children: [prefix, r('[Not generated — fill in manually]', { italics: true, color: 'CC0000' })],
      spacing: sp(80),
    }));
    return out;
  }

  switch (q.type) {

    case 'multipleChoice':
    case 'multiSelect': {
      const ca  = gen.correctAnswer as string | string[];
      const ans = Array.isArray(ca) ? ca.join(';  ') : (ca ?? '');
      out.push(new Paragraph({ children: [prefix, r(ans)], spacing: sp(80) }));
      break;
    }

    case 'trueFalse':
      out.push(new Paragraph({ children: [prefix, r(gen.correctAnswer ? 'True' : 'False')], spacing: sp(80) }));
      break;

    case 'fillInBlanks':
      out.push(new Paragraph({ children: [prefix, r((gen.correctAnswer as string) ?? '')], spacing: sp(80) }));
      break;

    case 'assertionReason':
      out.push(new Paragraph({ children: [prefix, r((gen.correctAnswer as string) ?? '')], spacing: sp(80) }));
      break;

    case 'matchTheFollowing': {
      const pairs = (gen.correctAnswer as Array<{ left: string; right: string }> | undefined) ?? [];
      out.push(new Paragraph({ children: [prefix], spacing: sp(40) }));
      pairs.forEach((p, i) => {
        out.push(new Paragraph({
          children: [r(`${i + 1}.  ${p.left}  →  ${p.right}`)],
          indent:  { left: INDENT_Q },
          spacing: sp(30),
        }));
      });
      out.push(blankLine());
      break;
    }

    case 'reordering': {
      const order = (gen.correctAnswer as string[] | undefined) ?? [];
      out.push(new Paragraph({ children: [prefix, r(order.join('  →  '))], spacing: sp(80) }));
      break;
    }

    case 'sorting': {
      const ans  = (gen.correctAnswer as Record<string, string[]> | undefined) ?? {};
      const text = Object.entries(ans).map(([cat, items]) => `${cat}: ${items.join(', ')}`).join(';  ');
      out.push(new Paragraph({ children: [prefix, r(text)], spacing: sp(80) }));
      break;
    }

    case 'shortAnswer': {
      out.push(new Paragraph({ children: [prefix], spacing: sp(40) }));
      if (gen.modelAnswer) {
        out.push(new Paragraph({
          children: [r('Model Answer:  ', { bold: true }), r((gen.modelAnswer as string) ?? '')],
          indent:  { left: INDENT_Q },
          spacing: sp(40),
        }));
      }
      const scheme = (gen.markingScheme as Array<{ point: string; marks: number }> | undefined) ?? [];
      if (scheme.length) {
        out.push(new Paragraph({
          children: [r('Marking Scheme:', { bold: true })],
          indent:  { left: INDENT_Q },
          spacing: sp(20),
        }));
        scheme.forEach(pt => {
          out.push(new Paragraph({
            children: [r(`•  ${pt.point}  [${pt.marks}m]`)],
            indent:  { left: convertInchesToTwip(0.65) },
            spacing: sp(20),
          }));
        });
      }
      if (gen.explanation) {
        out.push(new Paragraph({
          children: [r((gen.explanation as string) ?? '', { italics: true, color: '555555', size: SZ_SMALL })],
          indent:  { left: INDENT_Q },
          spacing: sp(120),
        }));
      } else {
        out.push(blankLine());
      }
      break;
    }

    case 'longAnswer': {
      out.push(new Paragraph({ children: [prefix], spacing: sp(40) }));
      const parts = (gen.parts as Array<{ label: string; modelAnswer: string }> | undefined) ?? [];
      parts.forEach(pt => {
        out.push(new Paragraph({
          children: [r(`(${pt.label})  `, { bold: true }), r(pt.modelAnswer ?? '')],
          indent:  { left: INDENT_Q },
          spacing: sp(60),
        }));
      });
      if (gen.explanation) {
        out.push(new Paragraph({
          children: [r((gen.explanation as string) ?? '', { italics: true, color: '555555', size: SZ_SMALL })],
          indent:  { left: INDENT_Q },
          spacing: sp(120),
        }));
      } else {
        out.push(blankLine());
      }
      break;
    }
  }

  return out;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function buildQuestionPaperDoc(structure: PaperStructure): Promise<Buffer> {
  const children: DocChild[] = [];

  // Header
  children.push(buildHeader(structure));
  children.push(blankLine());

  // General instructions
  if (structure.generalInstructions?.length) {
    children.push(buildInstructionsBox(structure.generalInstructions));
    children.push(blankLine());
  }

  // Sections — question paper (no answers)
  for (const section of structure.sections) {
    children.push(buildSectionHeader(section));
    children.push(blankLine());

    section.questions.forEach((q, qi) => {
      children.push(...renderQuestion(q, qi + 1));
    });

    children.push(new Paragraph({ children: [], spacing: sp(300) }));
  }

  // ── Answer key — new page ──────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [r('ANSWER KEY / MARKING SCHEME', { bold: true, size: SZ_TITLE })],
    alignment: AlignmentType.CENTER,
    spacing:   sp(200, 160),
    pageBreakBefore: true,
  }));

  for (const section of structure.sections) {
    children.push(new Paragraph({
      children: [r(section.label, { bold: true })],
      spacing:  sp(80, 100),
    }));
    section.questions.forEach((q, qi) => {
      children.push(...renderAnswer(q, qi + 1));
    });
    children.push(blankLine());
  }

  // ── Document ──────────────────────────────────────────────────────────────
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left:   convertInchesToTwip(1.25),
            right:  convertInchesToTwip(1),
          },
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'Page ', font: FONT, size: SZ_SMALL }),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SZ_SMALL }),
                new TextRun({ text: ' of ', font: FONT, size: SZ_SMALL }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SZ_SMALL }),
              ],
              alignment: AlignmentType.CENTER,
            }),
          ],
        }),
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

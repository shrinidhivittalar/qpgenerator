import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from 'docx';
import type { PaperStructure, PaperSection, PaperQuestion } from '../types/paperStructure.js';

type DocChild = Paragraph | Table;

const HALF_INCH  = convertInchesToTwip(0.4);
const THREE_QRTR = convertInchesToTwip(0.65);

function run(text: string, opts: {
  bold?: boolean; italics?: boolean; size?: number; color?: string;
} = {}): TextRun {
  return new TextRun({ text, ...opts });
}

function marksRun(marks: number): TextRun {
  return run(`  [${marks} Mark${marks !== 1 ? 's' : ''}]`, { bold: true });
}

function sp(after: number): { after: number } {
  return { after };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-type: student-facing question (no answers)
// ─────────────────────────────────────────────────────────────────────────────

function renderQuestion(q: PaperQuestion, num: number): DocChild[] {
  const gen  = q.generated as Record<string, unknown> | null;
  const out: DocChild[] = [];

  if (!gen) {
    out.push(new Paragraph({
      children: [run(`Q${num}. [Question not generated]`, { italics: true, color: '999999' })],
      spacing: sp(160),
    }));
    return out;
  }

  const type  = q.type;
  const qText = ((gen.question as Record<string, unknown> | undefined)?.text as string | undefined) ?? '';

  switch (type) {

    case 'multipleChoice':
    case 'multiSelect': {
      out.push(new Paragraph({
        children: [run(`Q${num}. `, { bold: true }), run(qText), marksRun(q.marks)],
        spacing: sp(80),
      }));
      const opts = (gen.options as Array<Record<string, unknown>> | undefined) ?? [];
      opts.forEach((opt, i) => {
        out.push(new Paragraph({
          children: [run(`(${String.fromCharCode(65 + i)}) ${(opt.text as string) ?? ''}`)],
          indent: { left: HALF_INCH },
          spacing: sp(40),
        }));
      });
      if (type === 'multiSelect') {
        out.push(new Paragraph({
          children: [run('(Select all that apply)', { italics: true, size: 18, color: '555555' })],
          indent: { left: HALF_INCH },
          spacing: sp(160),
        }));
      } else {
        out.push(new Paragraph({ children: [], spacing: sp(140) }));
      }
      break;
    }

    case 'trueFalse':
      out.push(new Paragraph({
        children: [
          run(`Q${num}. `, { bold: true }),
          run(qText),
          run('  [True / False]', { italics: true }),
          marksRun(q.marks),
        ],
        spacing: sp(200),
      }));
      break;

    case 'fillInBlanks':
      out.push(new Paragraph({
        children: [run(`Q${num}. `, { bold: true }), run(qText), marksRun(q.marks)],
        spacing: sp(200),
      }));
      break;

    case 'assertionReason': {
      out.push(new Paragraph({
        children: [run(`Q${num}. `, { bold: true }), marksRun(q.marks)],
        spacing: sp(80),
      }));
      out.push(new Paragraph({
        children: [run('Assertion (A): ', { bold: true }), run((gen.assertion as string) ?? '')],
        indent: { left: HALF_INCH },
        spacing: sp(60),
      }));
      out.push(new Paragraph({
        children: [run('Reason (R): ', { bold: true }), run((gen.reason as string) ?? '')],
        indent: { left: HALF_INCH },
        spacing: sp(80),
      }));
      out.push(new Paragraph({
        children: [run('Choose the correct option:', { italics: true })],
        indent: { left: HALF_INCH },
        spacing: sp(40),
      }));
      const arOpts = (gen.options as string[] | undefined) ?? [];
      arOpts.forEach((opt, i) => {
        out.push(new Paragraph({
          children: [run(`(${String.fromCharCode(65 + i)}) ${opt}`)],
          indent: { left: THREE_QRTR },
          spacing: sp(40),
        }));
      });
      out.push(new Paragraph({ children: [], spacing: sp(120) }));
      break;
    }

    case 'matchTheFollowing': {
      out.push(new Paragraph({
        children: [run(`Q${num}. `, { bold: true }), run(qText || 'Match the following:'), marksRun(q.marks)],
        spacing: sp(80),
      }));
      const lefts  = (gen.leftItems  as string[] | undefined) ?? [];
      const rights = (gen.rightItems as string[] | undefined) ?? [];
      const maxLen = Math.max(lefts.length, rights.length);
      const rows: TableRow[] = [
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [run('Column A', { bold: true })] })],
              width: { size: 45, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph({ children: [run('Column B', { bold: true })] })],
              width: { size: 55, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
      ];
      for (let i = 0; i < maxLen; i++) {
        const lbl = String.fromCharCode(97 + i);
        rows.push(new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [run(lefts[i]  ? `${i + 1}. ${lefts[i]}`  : '')] })] }),
            new TableCell({ children: [new Paragraph({ children: [run(rights[i] ? `(${lbl}) ${rights[i]}` : '')] })] }),
          ],
        }));
      }
      out.push(new Table({ rows, width: { size: 85, type: WidthType.PERCENTAGE } }));
      out.push(new Paragraph({ children: [], spacing: sp(180) }));
      break;
    }

    case 'reordering': {
      out.push(new Paragraph({
        children: [
          run(`Q${num}. `, { bold: true }),
          run(qText || 'Arrange the following in the correct order:'),
          marksRun(q.marks),
        ],
        spacing: sp(80),
      }));
      const items = (gen.items as string[] | undefined) ?? [];
      items.forEach((item, i) => {
        out.push(new Paragraph({
          children: [run(`(${String.fromCharCode(97 + i)}) ${item}`)],
          indent: { left: HALF_INCH },
          spacing: sp(40),
        }));
      });
      out.push(new Paragraph({ children: [], spacing: sp(120) }));
      break;
    }

    case 'sorting': {
      out.push(new Paragraph({
        children: [
          run(`Q${num}. `, { bold: true }),
          run(qText || 'Sort the following into the correct categories:'),
          marksRun(q.marks),
        ],
        spacing: sp(60),
      }));
      const cats  = (gen.categories as string[] | undefined) ?? [];
      const items = (gen.items      as string[] | undefined) ?? [];
      out.push(new Paragraph({
        children: [run(`Categories: ${cats.join(' | ')}`, { italics: true })],
        indent: { left: HALF_INCH },
        spacing: sp(40),
      }));
      out.push(new Paragraph({
        children: [run(`Items: ${items.join(', ')}`)],
        indent: { left: HALF_INCH },
        spacing: sp(200),
      }));
      break;
    }

    case 'shortAnswer': {
      const wl = gen.wordLimit as { min?: number; max?: number } | undefined;
      out.push(new Paragraph({
        children: [run(`Q${num}. `, { bold: true }), run(qText), marksRun(q.marks)],
        spacing: sp(wl ? 40 : 200),
      }));
      if (wl) {
        out.push(new Paragraph({
          children: [run(`(Answer in ${wl.min ?? ''}–${wl.max ?? ''} words)`, { italics: true, size: 18, color: '555555' })],
          indent: { left: HALF_INCH },
          spacing: sp(200),
        }));
      }
      break;
    }

    case 'longAnswer': {
      const preamble = (gen.preamble as string) ?? '';
      const parts    = (gen.parts as Array<{ label: string; marks: number; question: string }> | undefined) ?? [];
      out.push(new Paragraph({
        children: [run(`Q${num}. `, { bold: true }), run(preamble), marksRun(q.marks)],
        spacing: sp(80),
      }));
      parts.forEach(pt => {
        out.push(new Paragraph({
          children: [
            run(`(${pt.label}) ${pt.question}  `, {}),
            run(`[${pt.marks} Mark${pt.marks !== 1 ? 's' : ''}]`, { bold: true }),
          ],
          indent: { left: HALF_INCH },
          spacing: sp(80),
        }));
      });
      out.push(new Paragraph({ children: [], spacing: sp(120) }));
      break;
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-type: teacher-facing answer key / marking scheme
// ─────────────────────────────────────────────────────────────────────────────

function renderAnswer(q: PaperQuestion, num: number): DocChild[] {
  const gen = q.generated as Record<string, unknown> | null;
  const out: DocChild[] = [];
  if (!gen) {
    out.push(new Paragraph({
      children: [
        run(`Q${num}. `, { bold: true }),
        run('[Not generated — slot failed during AI generation]', { italics: true, color: 'CC0000' }),
      ],
      spacing: sp(80),
    }));
    return out;
  }

  const prefix = run(`Q${num}. `, { bold: true });

  switch (q.type) {

    case 'multipleChoice':
    case 'multiSelect': {
      const ca  = gen.correctAnswer as string | string[];
      const ans = Array.isArray(ca) ? ca.join(', ') : (ca ?? '');
      out.push(new Paragraph({ children: [prefix, run(ans)], spacing: sp(80) }));
      break;
    }

    case 'trueFalse':
      out.push(new Paragraph({ children: [prefix, run(gen.correctAnswer ? 'True' : 'False')], spacing: sp(80) }));
      break;

    case 'fillInBlanks':
      out.push(new Paragraph({ children: [prefix, run((gen.correctAnswer as string) ?? '')], spacing: sp(80) }));
      break;

    case 'assertionReason':
      out.push(new Paragraph({ children: [prefix, run((gen.correctAnswer as string) ?? '')], spacing: sp(80) }));
      break;

    case 'matchTheFollowing': {
      const pairs = (gen.correctAnswer as Array<{ left: string; right: string }> | undefined) ?? [];
      out.push(new Paragraph({ children: [prefix], spacing: sp(40) }));
      pairs.forEach((p, i) => {
        out.push(new Paragraph({
          children: [run(`${i + 1}. ${p.left}  →  ${p.right}`)],
          indent: { left: HALF_INCH },
          spacing: sp(30),
        }));
      });
      out.push(new Paragraph({ children: [], spacing: sp(80) }));
      break;
    }

    case 'reordering': {
      const order = (gen.correctAnswer as string[] | undefined) ?? [];
      out.push(new Paragraph({ children: [prefix, run(order.join(' → '))], spacing: sp(80) }));
      break;
    }

    case 'sorting': {
      const ans  = (gen.correctAnswer as Record<string, string[]> | undefined) ?? {};
      const text = Object.entries(ans).map(([cat, items]) => `${cat}: ${items.join(', ')}`).join(';  ');
      out.push(new Paragraph({ children: [prefix, run(text)], spacing: sp(80) }));
      break;
    }

    case 'shortAnswer': {
      out.push(new Paragraph({ children: [prefix], spacing: sp(40) }));
      if (gen.modelAnswer) {
        out.push(new Paragraph({
          children: [run('Model Answer: ', { bold: true }), run((gen.modelAnswer as string) ?? '')],
          indent: { left: HALF_INCH },
          spacing: sp(40),
        }));
      }
      const scheme = (gen.markingScheme as Array<{ point: string; marks: number }> | undefined) ?? [];
      if (scheme.length > 0) {
        out.push(new Paragraph({
          children: [run('Marking Scheme:', { bold: true })],
          indent: { left: HALF_INCH },
          spacing: sp(20),
        }));
        scheme.forEach(pt => {
          out.push(new Paragraph({
            children: [run(`• ${pt.point}  [${pt.marks}m]`)],
            indent: { left: THREE_QRTR },
            spacing: sp(20),
          }));
        });
      }
      if (gen.explanation) {
        out.push(new Paragraph({
          children: [run((gen.explanation as string) ?? '', { italics: true, color: '555555', size: 18 })],
          indent: { left: HALF_INCH },
          spacing: sp(120),
        }));
      } else {
        out.push(new Paragraph({ children: [], spacing: sp(100) }));
      }
      break;
    }

    case 'longAnswer': {
      out.push(new Paragraph({ children: [prefix], spacing: sp(40) }));
      const parts = (gen.parts as Array<{ label: string; marks: number; modelAnswer: string }> | undefined) ?? [];
      parts.forEach(pt => {
        out.push(new Paragraph({
          children: [run(`(${pt.label}) `, { bold: true }), run(pt.modelAnswer ?? '')],
          indent: { left: HALF_INCH },
          spacing: sp(60),
        }));
      });
      if (gen.explanation) {
        out.push(new Paragraph({
          children: [run((gen.explanation as string) ?? '', { italics: true, color: '555555', size: 18 })],
          indent: { left: HALF_INCH },
          spacing: sp(120),
        }));
      } else {
        out.push(new Paragraph({ children: [], spacing: sp(100) }));
      }
      break;
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export async function buildQuestionPaperDoc(structure: PaperStructure): Promise<Buffer> {
  const children: DocChild[] = [];

  // Title
  children.push(new Paragraph({
    children: [run(structure.title, { bold: true, size: 32 })],
    alignment: AlignmentType.CENTER,
    spacing: sp(120),
  }));

  // Marks + Duration
  const meta: string[] = [];
  if (structure.totalMarks) meta.push(`Maximum Marks: ${structure.totalMarks}`);
  if (structure.duration)   meta.push(`Duration: ${structure.duration}`);
  if (meta.length) {
    children.push(new Paragraph({
      children: [run(meta.join('          '), { bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: sp(160),
    }));
  }

  // General instructions
  if (structure.generalInstructions?.length) {
    children.push(new Paragraph({
      children: [run('General Instructions:', { bold: true })],
      spacing: sp(60),
    }));
    structure.generalInstructions.forEach((instr, i) => {
      children.push(new Paragraph({
        children: [run(`${i + 1}. ${instr}`)],
        indent: { left: convertInchesToTwip(0.3) },
        spacing: sp(40),
      }));
    });
    children.push(new Paragraph({ children: [], spacing: sp(200) }));
  }

  // Sections — question paper (no answers)
  for (const section of structure.sections) {
    children.push(new Paragraph({
      children: [run(section.label, { bold: true, size: 28 })],
      alignment: AlignmentType.CENTER,
      spacing: sp(60),
    }));

    if (section.title) {
      children.push(new Paragraph({
        children: [run(section.title, { bold: true })],
        alignment: AlignmentType.CENTER,
        spacing: sp(40),
      }));
    }

    // Attempt instruction + marks line
    const infoRuns: TextRun[] = [];
    if (section.instructions) {
      infoRuns.push(run(section.instructions + '     '));
    } else if (section.totalToAttempt != null && section.totalToAttempt < section.questions.length) {
      infoRuns.push(run(`Attempt any ${section.totalToAttempt} of ${section.questions.length}     `));
    }
    if (section.totalMarks) {
      infoRuns.push(run(`[${section.totalMarks} Marks]`, { bold: true }));
    }
    if (infoRuns.length) {
      children.push(new Paragraph({
        children: infoRuns,
        alignment: AlignmentType.CENTER,
        spacing: sp(200),
      }));
    } else {
      children.push(new Paragraph({ children: [], spacing: sp(120) }));
    }

    section.questions.forEach((q, qi) => {
      children.push(...renderQuestion(q, qi + 1));
    });

    children.push(new Paragraph({ children: [], spacing: sp(280) }));
  }

  // Answer key — starts on a new page
  children.push(new Paragraph({
    children: [run('ANSWER KEY / MARKING SCHEME', { bold: true, size: 28 })],
    alignment: AlignmentType.CENTER,
    spacing: sp(200),
    pageBreakBefore: true,
  }));

  for (const section of structure.sections) {
    children.push(new Paragraph({
      children: [run(section.label, { bold: true })],
      spacing: sp(80),
    }));
    section.questions.forEach((q, qi) => {
      children.push(...renderAnswer(q, qi + 1));
    });
    children.push(new Paragraph({ children: [], spacing: sp(180) }));
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}

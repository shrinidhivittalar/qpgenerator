/**
 * Zero-dependency export test.
 * Calls buildQuestionBlocksDoc directly with mock questions — no server, no DB, no API.
 *
 * Usage (from server/ directory):
 *   npx tsx src/test/testExport.ts
 *
 * Output: server/src/test/test_export.docx
 * Open that file in Word and verify it is not corrupted.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildQuestionBlocksDoc } from '../ai/wordExporter.js';

const MOCK_BLOCKS = [
  {
    questionType: 'multipleChoice',
    totalMarks: 4,
    questions: [
      {
        id: 1, marks: 2,
        question: { hide_text: false, text: 'Which of the following best describes $\\frac{a}{b}$?', read_text: false, image: '' },
        options: [
          { hide_text: false, text: 'A ratio of $a$ to $b$', read_text: false, image: '' },
          { hide_text: false, text: 'A product of $a$ and $b$', read_text: false, image: '' },
          { hide_text: false, text: 'The difference $a - b$', read_text: false, image: '' },
          { hide_text: false, text: 'The square root $\\sqrt{ab}$', read_text: false, image: '' },
        ],
        correctAnswer: 'A ratio of $a$ to $b$',
        explanation: 'A fraction $\\frac{a}{b}$ represents the ratio of $a$ to $b$. A product would be written as $a \\times b$.',
      },
      {
        id: 2, marks: 2,
        question: { hide_text: false, text: 'If $\\sin\\theta = \\frac{1}{2}$, then $\\theta$ equals:', read_text: false, image: '' },
        options: [
          { hide_text: false, text: '$30°$', read_text: false, image: '' },
          { hide_text: false, text: '$45°$', read_text: false, image: '' },
          { hide_text: false, text: '$60°$', read_text: false, image: '' },
          { hide_text: false, text: '$90°$', read_text: false, image: '' },
        ],
        correctAnswer: '$30°$',
        explanation: '$\\sin 30° = \\frac{1}{2}$ by standard trigonometric values. $\\sin 45° = \\frac{\\sqrt{2}}{2}$ and $\\sin 60° = \\frac{\\sqrt{3}}{2}$.',
      },
    ],
  },
  {
    questionType: 'fillInBlanks',
    totalMarks: 2,
    questions: [
      {
        id: 3, marks: 2,
        question: { hide_text: false, text: 'The value of $\\pi$ is approximately _____', read_text: false, image: '' },
        correctAnswer: '3.14159',
        alternatives: ['22/7', '3.14'],
        explanation: '$\\pi \\approx 3.14159$ is the ratio of a circle\'s circumference to its diameter.',
      },
    ],
  },
  {
    questionType: 'shortAnswer',
    totalMarks: 3,
    questions: [
      {
        id: 4, marks: 3,
        question: { hide_text: false, text: 'State the Pythagorean theorem and verify it for a triangle with sides $a = 3$, $b = 4$, $c = 5$.', read_text: false, image: '' },
        wordLimit: { min: 30, max: 60 },
        modelAnswer: 'The Pythagorean theorem states that $a^2 + b^2 = c^2$ for a right-angled triangle. Verification: $3^2 + 4^2 = 9 + 16 = 25 = 5^2$. Hence proved.',
        markingScheme: [
          { point: 'Correct statement of the theorem', marks: 1 },
          { point: 'Correct substitution of values', marks: 1 },
          { point: 'Correct conclusion', marks: 1 },
        ],
        explanation: 'Students often forget to square both sides. The verification must show $a^2 + b^2 = c^2$ explicitly.',
      },
    ],
  },
  {
    questionType: 'trueFalse',
    totalMarks: 2,
    questions: [
      {
        id: 5, marks: 1,
        question: { hide_text: false, text: 'The equation $x^2 + 1 = 0$ has real solutions.', read_text: false, image: '' },
        correctAnswer: false,
        explanation: '$x^2 + 1 = 0$ gives $x^2 = -1$, which has no real solutions since $x^2 \\geq 0$ for all real $x$.',
      },
      {
        id: 6, marks: 1,
        question: { hide_text: false, text: 'The sum of angles in a triangle is $180°$.', read_text: false, image: '' },
        correctAnswer: true,
        explanation: 'By the angle sum property of triangles, all interior angles sum to exactly $180°$.',
      },
    ],
  },
  {
    questionType: 'assertionReason',
    totalMarks: 2,
    questions: [
      {
        id: 7, marks: 2,
        assertion: 'The product of two irrational numbers is always irrational.',
        reason: '$\\sqrt{2} \\times \\sqrt{2} = 2$, which is rational.',
        options: [
          'Both A and R are correct, and R is the correct explanation of A',
          'Both A and R are correct, but R is not the correct explanation of A',
          'A is correct, but R is incorrect',
          'A is incorrect, but R is correct',
        ],
        correctAnswer: 'A is incorrect, but R is correct',
        explanation: 'The assertion is false because $\\sqrt{2} \\times \\sqrt{2} = 2$ (rational). The reason correctly provides the counterexample.',
      },
    ],
  },
];

async function main() {
  console.log('Building export document with mock questions...');

  try {
    const buffer = await buildQuestionBlocksDoc('Test Export — Math & Formatting', MOCK_BLOCKS as any);
    const outPath = join(__dirname, 'test_export.docx');
    writeFileSync(outPath, buffer);
    console.log(`✓ Written to ${outPath}`);
    console.log('Open in Word — if it opens without any corruption dialog, the export is working.');
  } catch (err) {
    console.error('✗ Export failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();

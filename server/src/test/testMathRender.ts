import { renderTextWithMath } from '../ai/latexToDocx.js';
import { Paragraph, Document, Packer } from 'docx';
import { writeFileSync } from 'fs';

const testCases = [
  'The roots are $\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$',
  'If $\\sin\\theta = \\frac{3}{5}$, find $\\cos\\theta$',
  '$n$-th term: $a_n = a_1 + (n-1)d$',
  'Prove that $\\sqrt{2}$ is irrational.',
  'Area $= \\pi r^2$',
  '$x^{n+1} - x^n = x^n(x-1)$',
  '$\\sqrt[3]{27} = 3$',
  '$\\frac{d}{dx}(x^n) = nx^{n-1}$',
];

console.log('Testing renderTextWithMath:\n');
for (const tc of testCases) {
  const parts = renderTextWithMath(tc);
  const types = parts.map(p => p.constructor.name).join(', ');
  console.log('In: ', tc);
  console.log('Out:', types);
  console.log();
}

const doc = new Document({
  sections: [{ children: testCases.map(tc => new Paragraph({ children: renderTextWithMath(tc) })) }],
});
Packer.toBuffer(doc).then(buf => {
  const outPath = 'src/test/math_render_test.docx';
  writeFileSync(outPath, buf);
  console.log(`Written: ${outPath}  (${buf.byteLength} bytes)`);
});

import { vi, describe, it, expect, afterEach } from 'vitest';
import { buildPrompt } from '../prompts.js';
import * as exemplarRetrieval from '../exemplarRetrieval.js';

vi.mock('../exemplarRetrieval.js', () => ({
  getExemplars: vi.fn(),
}));

afterEach(() => {
  vi.mocked(exemplarRetrieval.getExemplars).mockReset();
});

// Shared base context used across all tests
const BASE_CTX = {
  teacherId:  'teacher-1',
  difficulty: 'moderate' as const,
  tone:       'neutral'  as const,
};

describe('buildPrompt — strategy=reuse', () => {
  it('includes the base question verbatim and the "changing nothing" instruction', async () => {
    vi.mocked(exemplarRetrieval.getExemplars).mockResolvedValue([]);
    const baseQ = 'State and explain Newton\'s second law of motion.';

    const { system } = await buildPrompt(
      'multipleChoice', 'Some source content.', 3, 1,
      { ...BASE_CTX, strategy: 'reuse', baseQuestion: baseQ },
    );

    expect(system).toContain(baseQ);
    expect(system).toContain('changing nothing about its content, wording, or answer');
  });
});

describe('buildPrompt — strategy=fresh', () => {
  it('adds no strategy instruction block (clean no-op, backward-compatible)', async () => {
    vi.mocked(exemplarRetrieval.getExemplars).mockResolvedValue([]);

    const { system } = await buildPrompt(
      'multipleChoice', 'Some source content.', 3, 1, BASE_CTX,
    );

    expect(system).not.toContain('appeared in a previous exam');
    expect(system).not.toContain('from a different angle');
    expect(system).not.toContain('changing nothing');
  });
});

describe('buildPrompt — strategy=rephrase', () => {
  it('includes the base question and the "rephrase" instruction', async () => {
    vi.mocked(exemplarRetrieval.getExemplars).mockResolvedValue([]);
    const baseQ = 'Define osmosis.';

    const { system } = await buildPrompt(
      'multipleChoice', 'Some source content.', 3, 1,
      { ...BASE_CTX, strategy: 'rephrase', baseQuestion: baseQ },
    );

    expect(system).toContain(baseQ);
    expect(system).toContain('appeared in a previous exam');
    expect(system).toContain('Do NOT change what concept is being tested');
  });
});

describe('buildPrompt — strategy=variant', () => {
  it('includes the base question and the "different angle" instruction', async () => {
    vi.mocked(exemplarRetrieval.getExemplars).mockResolvedValue([]);
    const baseQ = 'Explain the process of mitosis.';

    const { system } = await buildPrompt(
      'multipleChoice', 'Some source content.', 3, 1,
      { ...BASE_CTX, strategy: 'variant', baseQuestion: baseQ },
    );

    expect(system).toContain(baseQ);
    expect(system).toContain('from a different angle');
  });
});

describe('buildPrompt — chapterName', () => {
  it('prepends chapter context to the user message when chapterName is provided', async () => {
    vi.mocked(exemplarRetrieval.getExemplars).mockResolvedValue([]);

    const { user } = await buildPrompt(
      'multipleChoice', 'Some source content.', 3, 1,
      { ...BASE_CTX, chapterName: 'Chapter 3: Laws of Motion' },
    );

    expect(user).toContain('Chapter 3: Laws of Motion');
    expect(user).toContain('SOURCE TEXT:');
    expect(user.indexOf('Chapter 3')).toBeLessThan(user.indexOf('SOURCE TEXT:'));
  });

  it('omits chapter prefix when chapterName is absent (no-chapters backward-compat path)', async () => {
    vi.mocked(exemplarRetrieval.getExemplars).mockResolvedValue([]);

    const { user } = await buildPrompt(
      'multipleChoice', 'Some source content.', 3, 1, BASE_CTX,
    );

    expect(user).not.toContain('chapter');
    expect(user.startsWith('SOURCE TEXT:')).toBe(true);
  });
});

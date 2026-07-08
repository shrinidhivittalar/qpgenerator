import { useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import type { TypeConfig, TypeResult, QuestionType, DifficultyLevel, ToneOption, PaperStructure } from '../types';

export interface GenerationState {
  setId:                  string | null;
  fileName:               string | null;
  wordCount:              number | null;
  previewText:            string | null;
  typeConfig:             TypeConfig[];
  activeSchemeId:         string | null;
  // Paper mode — populated when the scheme has a parsed paperStructure
  activePaperStructure:   PaperStructure | null;
  filledPaperStructure:   PaperStructure | null;
  isPaperGenerating:      boolean;
  paperGenerateError:     string | null;
  paperStats:             { totalSlots: number; filledSlots: number; failedSlots: number } | null;
  difficultyDefault: DifficultyLevel;
  tone:              ToneOption;
  bankId:            string | null;
  results:           Record<QuestionType, TypeResult>;
  isGenerating:      boolean;
  isRegenerating:    Partial<Record<QuestionType, boolean>>;
  exportError:       string | null;
}

const emptyResults = (): Record<QuestionType, TypeResult> => ({
  fillInBlanks:      { status: 'idle' },
  multipleChoice:    { status: 'idle' },
  multiSelect:       { status: 'idle' },
  matchTheFollowing: { status: 'idle' },
  reordering:        { status: 'idle' },
  sorting:           { status: 'idle' },
  trueFalse:         { status: 'idle' },
  assertionReason:   { status: 'idle' },
  shortAnswer:       { status: 'idle' },
  longAnswer:        { status: 'idle' },
});

export function useGeneration() {
  const [state, setState] = useState<GenerationState>({
    setId:                  null,
    fileName:               null,
    wordCount:              null,
    previewText:            null,
    typeConfig:             [],
    activeSchemeId:         null,
    activePaperStructure:   null,
    filledPaperStructure:   null,
    isPaperGenerating:      false,
    paperGenerateError:     null,
    paperStats:             null,
    difficultyDefault:      'moderate',
    tone:                   'formal-board-exam',
    bankId:                 null,
    results:                emptyResults(),
    isGenerating:           false,
    isRegenerating:         {},
    exportError:            null,
  });

  const createSet = useCallback(async (): Promise<void> => {
    const res = await apiFetch('/api/sets/create', { method: 'POST' });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      throw new Error(body.error ?? 'Failed to initialise session.');
    }
    const data = await res.json() as { setId: string; fileName: string; wordCount: number; previewText: string };
    setState(s => ({
      ...s,
      setId:       data.setId,
      fileName:    data.fileName,
      wordCount:   data.wordCount,
      previewText: data.previewText,
    }));
  }, []);

  const uploadFile = useCallback(async (file: File): Promise<void> => {
    const form = new FormData();
    form.append('file', file);

    const res = await apiFetch('/api/source/upload', { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      throw new Error(body.error ?? 'Upload failed.');
    }
    const data = await res.json() as {
      setId: string; fileName: string; wordCount: number; previewText: string;
    };

    setState(s => ({
      ...s,
      setId:                data.setId,
      fileName:             data.fileName,
      wordCount:            data.wordCount,
      previewText:          data.previewText,
      activeSchemeId:       null,
      activePaperStructure: null,
      filledPaperStructure: null,
      paperStats:           null,
      paperGenerateError:   null,
      results:              emptyResults(),
      isRegenerating:       {},
    }));
  }, []);

  const setTypeConfig = useCallback((config: TypeConfig[]) => {
    setState(s => ({ ...s, typeConfig: config }));
  }, []);

  const applyScheme = useCallback((
    parsedConfig:   TypeConfig[],
    schemeId:       string | null = null,
    paperStructure: PaperStructure | null = null,
  ) => {
    const merged = new Map<string, TypeConfig>();
    for (const tc of parsedConfig) {
      const existing = merged.get(tc.type);
      if (existing) { existing.count += tc.count; } else { merged.set(tc.type, { ...tc }); }
    }
    setState(s => ({
      ...s,
      typeConfig:           Array.from(merged.values()),
      activeSchemeId:       schemeId,
      activePaperStructure: paperStructure,
      filledPaperStructure: null,
      paperStats:           null,
      paperGenerateError:   null,
    }));
  }, []);

  const setIntent = useCallback((
    updates: Partial<{ difficultyDefault: DifficultyLevel; tone: ToneOption; bankId: string | null }>,
  ) => {
    setState(s => ({ ...s, ...updates }));
  }, []);

  const generate = useCallback(async (chapterIds: string[] = []): Promise<void> => {
    setState(s => {
      const results = { ...s.results };
      for (const tc of s.typeConfig) {
        if (tc.count > 0) results[tc.type] = { status: 'generating' };
      }
      return { ...s, isGenerating: true, exportError: null, results };
    });

    try {
      let { setId, typeConfig, activeSchemeId, difficultyDefault, tone, bankId } = state;

      // Lazily create the server-side session if not yet initialised.
      if (!setId) {
        const cr = await apiFetch('/api/sets/create', { method: 'POST' });
        if (!cr.ok) throw new Error('Failed to initialise session.');
        const cd = await cr.json() as { setId: string };
        setId = cd.setId;
        setState(s => ({ ...s, setId }));
      }

      const res = await apiFetch(`/api/sets/${setId}/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          typeConfig, difficultyDefault, tone,
          ...(activeSchemeId        ? { schemeId: activeSchemeId } : {}),
          ...(bankId                ? { bankId }                   : {}),
          ...(chapterIds.length > 0 ? { chapterIds }               : {}),
        }),
      });

      const body = await res.json() as {
        questionBlocks?:   Array<{ questionType: string; totalMarks: number; status: string; questions: unknown[] }>;
        generationErrors?: Array<{ type: string; requested: number; received: number; error: string }>;
        error?:            string;
      };

      if (!res.ok) throw new Error(body.error ?? `Generation failed (${res.status})`);

      setState(s => {
        const results = { ...s.results };
        for (const block of body.questionBlocks ?? []) {
          const type = block.questionType as QuestionType;
          results[type] = { status: 'success', questions: block.questions, totalMarks: block.totalMarks, received: block.questions.length };
        }
        for (const err of body.generationErrors ?? []) {
          const type = err.type as QuestionType;
          results[type] = { status: 'failed', requested: err.requested, received: err.received, error: err.error };
        }
        return { ...s, isGenerating: false, results };
      });
    } catch (err) {
      setState(s => {
        const results = { ...s.results };
        for (const type of Object.keys(results) as QuestionType[]) {
          if (results[type].status === 'generating') results[type] = { status: 'idle' };
        }
        return { ...s, isGenerating: false, exportError: err instanceof Error ? err.message : 'Generation failed.' };
      });
    }
  }, [state.setId, state.typeConfig, state.activeSchemeId, state.difficultyDefault, state.tone, state.bankId]);

  // Edit a single question inline. Throws on validation / network failure.
  const editQuestion = useCallback(async (
    type:       QuestionType,
    questionId: number,
    updated:    object,
  ): Promise<void> => {
    const res = await apiFetch(`/api/sets/${state.setId}/questions/${questionId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(updated),
    });

    if (!res.ok) {
      const body = await res.json() as { error?: string };
      throw new Error(body.error ?? 'Failed to save question.');
    }

    const body = await res.json() as { question: object };

    setState(s => {
      const typeResult = s.results[type];
      if (typeResult.status !== 'success' || !typeResult.questions) return s;
      return {
        ...s,
        results: {
          ...s.results,
          [type]: {
            ...typeResult,
            questions: typeResult.questions.map((q: any) =>
              q.id === questionId ? body.question : q,
            ),
          },
        },
      };
    });
  }, [state.setId]);

  // Regenerate a single type using the same sources as the original generation.
  // Returns { success, error? }. On success all blocks are updated (IDs change globally).
  const regenerateType = useCallback(async (
    type: QuestionType,
  ): Promise<{ success: boolean; error?: string }> => {
    setState(s => ({ ...s, isRegenerating: { ...s.isRegenerating, [type]: true } }));

    try {
      const res = await apiFetch(`/api/sets/${state.setId}/regenerate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type }),
      });

      const body = await res.json() as {
        questionBlocks?: Array<{ questionType: string; totalMarks: number; questions: unknown[] }>;
        success?:        boolean;
        error?:          string;
        requested?:      number;
        received?:       number;
      };

      if (!res.ok) {
        setState(s => ({ ...s, isRegenerating: { ...s.isRegenerating, [type]: false } }));
        return { success: false, error: body.error ?? 'Regeneration failed.' };
      }

      // Update ALL blocks from the response (global IDs were reassigned)
      setState(s => {
        const results = { ...s.results };
        for (const block of body.questionBlocks ?? []) {
          const qType = block.questionType as QuestionType;
          results[qType] = {
            status:     'success',
            questions:  block.questions,
            totalMarks: block.totalMarks,
            received:   block.questions.length,
          };
        }
        // If regeneration itself failed, mark that type accordingly
        if (body.success === false) {
          results[type] = {
            status:    'failed',
            requested: body.requested,
            received:  body.received,
            error:     body.error,
          };
        }
        return { ...s, results, isRegenerating: { ...s.isRegenerating, [type]: false } };
      });

      return { success: body.success !== false };
    } catch {
      setState(s => ({ ...s, isRegenerating: { ...s.isRegenerating, [type]: false } }));
      return { success: false, error: 'Regeneration failed.' };
    }
  }, [state.setId]);

  const generatePaper = useCallback(async (chapterIds: string[]): Promise<void> => {
    setState(s => ({
      ...s,
      isPaperGenerating:    true,
      paperGenerateError:   null,
      filledPaperStructure: null,
      paperStats:           null,
    }));

    try {
      let { setId, activePaperStructure, tone } = state;

      if (!setId) {
        const cr = await apiFetch('/api/sets/create', { method: 'POST' });
        if (!cr.ok) throw new Error('Failed to initialise session.');
        const cd = await cr.json() as { setId: string };
        setId = cd.setId;
        setState(s => ({ ...s, setId }));
      }

      const res = await apiFetch(`/api/sets/${setId}/generate-paper`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ paperStructure: activePaperStructure, chapterIds, tone }),
      });

      const body = await res.json() as {
        paperStructure?: PaperStructure;
        totalSlots?:     number;
        filledSlots?:    number;
        failedSlots?:    number;
        tokensEstimate?: number;
        error?:          string;
      };

      if (!res.ok) throw new Error(body.error ?? `Paper generation failed (${res.status})`);

      setState(s => ({
        ...s,
        isPaperGenerating:    false,
        filledPaperStructure: body.paperStructure ?? null,
        paperStats: {
          totalSlots:  body.totalSlots  ?? 0,
          filledSlots: body.filledSlots ?? 0,
          failedSlots: body.failedSlots ?? 0,
        },
      }));
    } catch (err) {
      setState(s => ({
        ...s,
        isPaperGenerating:  false,
        paperGenerateError: err instanceof Error ? err.message : 'Paper generation failed.',
      }));
    }
  }, [state.setId, state.activePaperStructure, state.tone]);

  const reset = useCallback(() => {
    setState({
      setId:                  null,
      fileName:               null,
      wordCount:              null,
      previewText:            null,
      typeConfig:             [],
      activeSchemeId:         null,
      activePaperStructure:   null,
      filledPaperStructure:   null,
      isPaperGenerating:      false,
      paperGenerateError:     null,
      paperStats:             null,
      difficultyDefault:      'moderate',
      tone:                   'formal-board-exam',
      bankId:                 null,
      results:                emptyResults(),
      isGenerating:           false,
      isRegenerating:         {},
      exportError:            null,
    });
  }, []);

  return {
    state,
    createSet,
    uploadFile,
    setTypeConfig,
    setIntent,
    applyScheme,
    generate,
    generatePaper,
    editQuestion,
    regenerateType,
    reset,
  };
}

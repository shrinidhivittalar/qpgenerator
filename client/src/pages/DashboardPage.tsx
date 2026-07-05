import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useGeneration } from '../hooks/useGeneration';
import { apiFetch } from '../lib/api';
import UploadPanel from '../components/UploadPanel';
import SchemePicker from '../components/SchemePicker';
import TypeConfigurator from '../components/TypeConfigurator';
import GenerationProgress from '../components/GenerationProgress';
import QuestionBlock from '../components/QuestionBlock';
import type { Scheme, TypeConfig } from '../types';

// ── Textbook-section local types ──────────────────────────────────────────────
type TbPhase = 'idle' | 'uploading' | 'review' | 'confirming' | 'done';
type DetectionMethod = 'bookmark' | 'heuristic' | 'llm';

interface DraftChapterRow {
  tempId:          string;
  title:           string;
  chapterNumber:   number;
  weightPercent:   string;   // kept as string so inputs stay controlled
  mergeWithNext:   boolean;
  removed:         boolean;
  preview:         string;
  wordCount:       number;
  detectionMethod: DetectionMethod;
}

// ── Pure helpers (no component state) ────────────────────────────────────────

function computeMergeTargets(rows: DraftChapterRow[]): Set<string> {
  const active  = rows.filter(r => !r.removed);
  const targets = new Set<string>();
  let i = 0;
  while (i < active.length) {
    while (i < active.length - 1 && active[i].mergeWithNext) {
      targets.add(active[i + 1].tempId);
      i++;
    }
    i++;
  }
  return targets;
}

function buildConfirmPayload(rows: DraftChapterRow[]) {
  const excludedTempIds = rows.filter(r => r.removed).map(r => r.tempId);
  const active = rows.filter(r => !r.removed);
  const chapters: Array<{
    tempId: string; title: string; chapterNumber: number;
    weightPercent: number; mergeWithTempIds?: string[];
  }> = [];
  let i = 0;
  while (i < active.length) {
    const primary    = active[i];
    const mergeWith: string[] = [];
    while (i < active.length - 1 && active[i].mergeWithNext) {
      i++;
      mergeWith.push(active[i].tempId);
    }
    chapters.push({
      tempId:        primary.tempId,
      title:         primary.title,
      chapterNumber: primary.chapterNumber,
      weightPercent: parseFloat(primary.weightPercent) || 0,
      ...(mergeWith.length > 0 && { mergeWithTempIds: mergeWith }),
    });
    i++;
  }
  return { chapters, excludedTempIds };
}

const METHOD_LABELS: Record<DetectionMethod, string> = {
  bookmark:  'detected via bookmarks',
  heuristic: 'detected via heading pattern',
  llm:       'detected via AI',
};
const METHOD_COLORS: Record<DetectionMethod, string> = {
  bookmark:  'bg-green-50  text-green-700',
  heuristic: 'bg-blue-50   text-blue-700',
  llm:       'bg-amber-50  text-amber-700',
};

function DetectionBadge({ method }: { method: DetectionMethod }) {
  return (
    <span className={`inline-block text-xs px-1.5 py-0.5 rounded font-medium ${METHOD_COLORS[method]}`}>
      {METHOD_LABELS[method]}
    </span>
  );
}

function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500">
      <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      {label}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const { state, uploadFile, setTypeConfig, setIntent, applyScheme, generate } = useGeneration();
  const {
    setId, fileName, wordCount, typeConfig, results, isGenerating, exportError,
    difficultyDefault, tone, bankId,
  } = state;

  // ── Scheme step state ─────────────────────────────────────────────────────
  const [schemeStep, setSchemeStep] = useState<'pending' | 'done'>('pending');

  function handleUpload(file: File) {
    setSchemeStep('pending');
    return uploadFile(file);
  }
  function handleSchemeApply(parsedConfig: TypeConfig[], schemeId?: string) {
    applyScheme(parsedConfig, schemeId ?? null);
    setSchemeStep('done');
  }
  function handleSchemeSkip() { setSchemeStep('done'); }

  const canGenerate = !isGenerating && Boolean(setId) && schemeStep === 'done' && typeConfig.some(c => c.count > 0);

  // ── My Schemes sidebar ────────────────────────────────────────────────────
  const [schemes,        setSchemes]       = useState<Scheme[]>([]);
  const [schemesLoading, setSchemesLoading] = useState(true);
  const [deleteTarget,   setDeleteTarget]  = useState<string | null>(null);
  const [deleting,       setDeleting]      = useState(false);
  const [replaceTarget,  setReplaceTarget] = useState<string | null>(null);
  const [replacing,      setReplacing]     = useState(false);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  async function loadSchemes() {
    try {
      const res  = await apiFetch('/api/schemes');
      const data = await res.json() as Scheme[];
      setSchemes(data);
    } catch {
      setSchemes([]);
    } finally {
      setSchemesLoading(false);
    }
  }
  useEffect(() => { loadSchemes(); }, []);

  async function handleUseScheme(scheme: Scheme) {
    applyScheme(scheme.parsedConfig as TypeConfig[], scheme.schemeId);
    setSchemeStep('done');
  }
  async function handleDeleteScheme() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/schemes/${deleteTarget}`, { method: 'DELETE' });
      setSchemes(s => s.filter(x => x.schemeId !== deleteTarget));
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }
  async function handleReplaceFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !replaceTarget) return;
    const existing = schemes.find(s => s.schemeId === replaceTarget);
    if (!existing) return;
    setReplacing(true);
    try {
      const form = new FormData();
      form.append('file',     file);
      form.append('name',     existing.name);
      form.append('subject',  existing.subject);
      form.append('standard', existing.standard);
      const res  = await apiFetch(`/api/schemes/${replaceTarget}/replace`, { method: 'PATCH', body: form });
      const body = await res.json() as Scheme & { error?: string };
      if (res.ok) setSchemes(s => s.map(x => x.schemeId === replaceTarget ? { ...x, ...body } : x));
    } finally {
      setReplacing(false);
      setReplaceTarget(null);
    }
  }

  // ── Textbook upload state ─────────────────────────────────────────────────
  const [tbPhase,           setTbPhase]           = useState<TbPhase>('idle');
  const [tbSubject,         setTbSubject]         = useState('');
  const [tbFile,            setTbFile]            = useState<File | null>(null);
  const [tbError,           setTbError]           = useState<string | null>(null);
  const [tbDraftId,         setTbDraftId]         = useState<string | null>(null);
  const [tbMethod,          setTbMethod]          = useState<DetectionMethod | null>(null);
  const [tbRows,            setTbRows]            = useState<DraftChapterRow[]>([]);
  const [tbConfirmError,    setTbConfirmError]    = useState<string | null>(null);
  const [tbWeightWarning,   setTbWeightWarning]   = useState<string | null>(null);
  const [tbDoneCount,       setTbDoneCount]       = useState(0);
  const tbFileInputRef = useRef<HTMLInputElement>(null);

  async function handleTextbookUpload(e: FormEvent) {
    e.preventDefault();
    if (!tbFile || !tbSubject.trim()) return;
    setTbPhase('uploading');
    setTbError(null);

    const form = new FormData();
    form.append('file',    tbFile);
    form.append('subject', tbSubject.trim());

    try {
      const res  = await apiFetch('/api/textbooks/upload', { method: 'POST', body: form });
      const data = await res.json() as {
        draftId: string; detectionMethod: DetectionMethod;
        chapters: { tempId: string; suggestedTitle: string; suggestedNumber: number; preview: string; wordCount: number }[];
        error?: string;
      };
      if (!res.ok) {
        setTbError(data.error ?? 'Upload failed.');
        setTbPhase('idle');
        return;
      }
      setTbDraftId(data.draftId);
      setTbMethod(data.detectionMethod);
      setTbRows(data.chapters.map(c => ({
        tempId:          c.tempId,
        title:           c.suggestedTitle,
        chapterNumber:   c.suggestedNumber,
        weightPercent:   '',  // intentionally empty — Teacher must set this
        mergeWithNext:   false,
        removed:         false,
        preview:         c.preview,
        wordCount:       c.wordCount,
        detectionMethod: data.detectionMethod,
      })));
      setTbPhase('review');
    } catch {
      setTbError('Network error. Please try again.');
      setTbPhase('idle');
    }
  }

  function updateRow(tempId: string, patch: Partial<DraftChapterRow>) {
    setTbRows(rows => rows.map(r => r.tempId === tempId ? { ...r, ...patch } : r));
  }

  async function handleConfirm() {
    if (!tbDraftId) return;
    setTbPhase('confirming');
    setTbConfirmError(null);
    setTbWeightWarning(null);

    const { chapters, excludedTempIds } = buildConfirmPayload(tbRows);
    try {
      const res  = await apiFetch(`/api/textbooks/${tbDraftId}/confirm`, {
        method: 'POST',
        body:   JSON.stringify({ chapters, excludedTempIds }),
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json() as { count?: number; weightWarning?: string; error?: string };
      if (!res.ok) {
        setTbConfirmError(data.error ?? 'Confirm failed.');
        setTbPhase('review');
        return;
      }
      setTbDoneCount(data.count ?? chapters.length);
      if (data.weightWarning) setTbWeightWarning(data.weightWarning);
      setTbPhase('done');
    } catch {
      setTbConfirmError('Network error. Please try again.');
      setTbPhase('review');
    }
  }

  function resetTextbook() {
    setTbPhase('idle');
    setTbSubject('');
    setTbFile(null);
    setTbError(null);
    setTbDraftId(null);
    setTbMethod(null);
    setTbRows([]);
    setTbConfirmError(null);
    setTbWeightWarning(null);
    setTbDoneCount(0);
  }

  // ── Individual chapter upload state ───────────────────────────────────────
  const [showIndividual, setShowIndividual] = useState(false);
  const [icSubject,      setIcSubject]      = useState('');
  const [icTitle,        setIcTitle]        = useState('');
  const [icNumber,       setIcNumber]       = useState('');
  const [icWeight,       setIcWeight]       = useState('');
  const [icFile,         setIcFile]         = useState<File | null>(null);
  const [icLoading,      setIcLoading]      = useState(false);
  const [icError,        setIcError]        = useState<string | null>(null);
  const [icSuccess,      setIcSuccess]      = useState<string | null>(null);
  const icFileInputRef = useRef<HTMLInputElement>(null);

  async function handleIndividualUpload(e: FormEvent) {
    e.preventDefault();
    if (!icFile || !icSubject.trim() || !icTitle.trim() || !icNumber || !icWeight) return;
    setIcLoading(true);
    setIcError(null);
    setIcSuccess(null);

    const form = new FormData();
    form.append('file',          icFile);
    form.append('subject',       icSubject.trim());
    form.append('title',         icTitle.trim());
    form.append('chapterNumber', icNumber);
    form.append('weightPercent', icWeight);

    try {
      const res  = await apiFetch('/api/chapters/upload', { method: 'POST', body: form });
      const data = await res.json() as { chapterId?: string; error?: string };
      if (!res.ok) {
        setIcError(data.error ?? 'Upload failed.');
      } else {
        setIcSuccess('Chapter saved successfully.');
        setIcSubject(''); setIcTitle(''); setIcNumber(''); setIcWeight(''); setIcFile(null);
      }
    } catch {
      setIcError('Network error. Please try again.');
    } finally {
      setIcLoading(false);
    }
  }

  // ── Results helpers ───────────────────────────────────────────────────────
  const successBlocks = Object.entries(results)
    .filter(([, r]) => r.status === 'success')
    .map(([type, r]) => ({ questionType: type, totalMarks: r.totalMarks ?? 0, questions: r.questions ?? [] }));
  const hasResults = Object.values(results).some(r => r.status === 'success' || r.status === 'failed');

  // ── Review screen derived state ───────────────────────────────────────────
  const mergeTargets  = computeMergeTargets(tbRows);
  const activeChapters = tbRows.filter(r => !r.removed && !mergeTargets.has(r.tempId));
  const totalWeight   = activeChapters.reduce((s, r) => s + (parseFloat(r.weightPercent) || 0), 0);
  const weightOk      = Math.abs(totalWeight - 100) <= 1;
  const canConfirm    = tbPhase === 'review' && activeChapters.length > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Question Generator</h1>
          <p className="text-xs text-gray-500">Welcome, {user?.name}</p>
        </div>
        <button onClick={logout} className="text-sm text-indigo-600 hover:underline">
          Sign out
        </button>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 items-start">

        {/* ── Left: main area ── */}
        <main className="space-y-8">

          {/* Textbook chapter review screen */}
          {(tbPhase === 'review' || tbPhase === 'confirming') && (
            <section className="rounded-2xl border border-indigo-100 bg-white p-5 space-y-5">
              {/* Review header */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-gray-800">Review Detected Chapters</h2>
                  {tbMethod && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      All chapters <DetectionBadge method={tbMethod} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  {/* Running weight total */}
                  <div className={[
                    'text-sm font-semibold tabular-nums',
                    weightOk ? 'text-green-600' : 'text-amber-600',
                  ].join(' ')}>
                    {totalWeight.toFixed(1)}% weight
                    {!weightOk && ' ⚠ (target: 100%)'}
                  </div>
                  <button
                    onClick={resetTextbook}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>

              {/* Chapter rows */}
              <div className="space-y-3">
                {tbRows.map((row) => {
                  if (row.removed) return null;

                  // Merge target — visual indicator only, no edit controls
                  if (mergeTargets.has(row.tempId)) {
                    return (
                      <div
                        key={row.tempId}
                        className="ml-6 border-l-2 border-indigo-200 pl-3 py-2 text-xs text-gray-400 italic"
                      >
                        ↳ "{row.title}" — will be merged into the chapter above
                      </div>
                    );
                  }

                  // Primary row
                  const isLastActive = activeChapters[activeChapters.length - 1]?.tempId === row.tempId;
                  return (
                    <div key={row.tempId} className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                      {/* Editable fields */}
                      <div className="grid grid-cols-[1fr_80px_80px] gap-2">
                        <input
                          type="text"
                          value={row.title}
                          onChange={e => updateRow(row.tempId, { title: e.target.value })}
                          placeholder="Chapter title"
                          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                        <input
                          type="number"
                          min={1}
                          value={row.chapterNumber}
                          onChange={e => updateRow(row.tempId, { chapterNumber: parseInt(e.target.value) || 1 })}
                          placeholder="Ch #"
                          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={row.weightPercent}
                          onChange={e => updateRow(row.tempId, { weightPercent: e.target.value })}
                          placeholder="Weight %"
                          className={[
                            'rounded-lg border px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400',
                            row.weightPercent === '' ? 'border-amber-300 bg-amber-50' : 'border-gray-300',
                          ].join(' ')}
                        />
                      </div>

                      {/* Preview + word count */}
                      <div className="rounded-lg bg-white border border-gray-100 px-3 py-2 text-xs text-gray-500 leading-relaxed">
                        <span className="line-clamp-3">{row.preview}</span>
                        <span className="block mt-1 text-gray-400">{row.wordCount.toLocaleString()} words</span>
                      </div>

                      {/* Row controls */}
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        {/* Merge with next — hidden for the last active chapter */}
                        {!isLastActive && (
                          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={row.mergeWithNext}
                              onChange={e => updateRow(row.tempId, { mergeWithNext: e.target.checked })}
                              className="rounded accent-indigo-600"
                            />
                            Merge with next chapter
                          </label>
                        )}
                        {isLastActive && <span />}

                        <button
                          onClick={() => updateRow(row.tempId, { removed: true, mergeWithNext: false })}
                          className="text-xs text-red-500 hover:text-red-700 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {tbConfirmError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                  {tbConfirmError}
                </p>
              )}

              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                className={[
                  'w-full rounded-xl py-3 text-sm font-semibold transition-colors',
                  canConfirm
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed',
                ].join(' ')}
              >
                {tbPhase === 'confirming' ? 'Saving chapters…' : `Confirm & Save ${activeChapters.length} Chapter${activeChapters.length !== 1 ? 's' : ''}`}
              </button>
            </section>
          )}

          {/* ── Steps 1-5: question generation flow ── */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-gray-800">
              <span className="text-indigo-500 mr-2">1</span>Upload source PDF
            </h2>
            <UploadPanel
              onUpload={handleUpload}
              fileName={fileName}
              wordCount={wordCount}
              disabled={isGenerating}
            />
          </section>

          {setId && schemeStep === 'pending' && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-gray-800">
                <span className="text-indigo-500 mr-2">2</span>Select question paper scheme
              </h2>
              <SchemePicker
                schemes={schemes}
                onApply={handleSchemeApply}
                onSkip={handleSchemeSkip}
                onSchemeSaved={loadSchemes}
              />
            </section>
          )}

          {setId && schemeStep === 'done' && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-800">
                  <span className="text-indigo-500 mr-2">3</span>Choose question types
                </h2>
                <button
                  onClick={() => setSchemeStep('pending')}
                  className="text-xs text-gray-400 hover:text-indigo-600 transition-colors"
                >
                  Change scheme
                </button>
              </div>
              <TypeConfigurator
                config={typeConfig}
                onChange={setTypeConfig}
                difficultyDefault={difficultyDefault}
                tone={tone}
                bankId={bankId}
                onIntentChange={setIntent}
                disabled={isGenerating}
              />
            </section>
          )}

          {setId && schemeStep === 'done' && (
            <button
              onClick={generate}
              disabled={!canGenerate}
              className={[
                'w-full rounded-xl py-3 text-sm font-semibold transition-colors',
                canGenerate
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed',
              ].join(' ')}
            >
              {isGenerating ? 'Generating…' : 'Generate Questions'}
            </button>
          )}

          {exportError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {exportError}
            </p>
          )}

          {(isGenerating || hasResults) && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-gray-800">
                <span className="text-indigo-500 mr-2">4</span>Generation status
              </h2>
              <GenerationProgress
                typeConfig={typeConfig}
                results={results}
                isGenerating={isGenerating}
                difficultyDefault={difficultyDefault}
                tone={tone}
              />
            </section>
          )}

          {successBlocks.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-gray-800">
                <span className="text-indigo-500 mr-2">5</span>Generated questions
              </h2>
              <div className="space-y-3">
                {successBlocks.map(b => (
                  <QuestionBlock
                    key={b.questionType}
                    questionType={b.questionType}
                    totalMarks={b.totalMarks}
                    questions={b.questions}
                  />
                ))}
              </div>
            </section>
          )}
        </main>

        {/* ── Right: sidebar ── */}
        <aside className="space-y-6">

          {/* My Textbooks */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-gray-800">My Textbooks</h2>

            {/* Upload form */}
            {tbPhase === 'idle' && (
              <form onSubmit={handleTextbookUpload} className="space-y-2">
                <input
                  type="text"
                  value={tbSubject}
                  onChange={e => setTbSubject(e.target.value)}
                  placeholder="Subject (e.g. Biology)"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <label className="flex items-center justify-between w-full rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm cursor-pointer hover:border-indigo-400 transition-colors">
                  <span className="truncate text-gray-500">
                    {tbFile ? tbFile.name : 'Choose textbook PDF'}
                  </span>
                  <input
                    ref={tbFileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={e => setTbFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={!tbFile || !tbSubject.trim()}
                  className="w-full rounded-lg py-2 text-sm font-medium bg-indigo-600 text-white disabled:opacity-50 hover:bg-indigo-700 transition-colors"
                >
                  Upload &amp; Detect Chapters
                </button>
              </form>
            )}

            {tbPhase === 'uploading' && (
              <Spinner label="Uploading and detecting chapters… this may take a moment." />
            )}

            {tbError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {tbError}
              </p>
            )}

            {(tbPhase === 'review' || tbPhase === 'confirming') && (
              <p className="text-xs text-indigo-600 font-medium">
                ↑ Review detected chapters above
              </p>
            )}

            {tbPhase === 'done' && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-green-700">
                  {tbDoneCount} chapter{tbDoneCount !== 1 ? 's' : ''} saved.
                </p>
                {tbWeightWarning && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    {tbWeightWarning}
                  </p>
                )}
                <button
                  onClick={resetTextbook}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Upload another textbook
                </button>
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-gray-100 pt-2">
              <button
                onClick={() => { setShowIndividual(v => !v); setIcError(null); setIcSuccess(null); }}
                className="text-xs text-gray-500 hover:text-indigo-600 transition-colors"
              >
                {showIndividual ? 'Hide' : '+ Add a chapter individually'}
              </button>
            </div>

            {/* Individual chapter upload form */}
            {showIndividual && (
              <form onSubmit={handleIndividualUpload} className="space-y-2 bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-xs text-gray-500">
                  Upload a single-chapter PDF directly — useful when the textbook detector made an incorrect split.
                </p>
                <input
                  type="text"
                  value={icSubject}
                  onChange={e => setIcSubject(e.target.value)}
                  placeholder="Subject"
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <input
                  type="text"
                  value={icTitle}
                  onChange={e => setIcTitle(e.target.value)}
                  placeholder="Chapter title"
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1}
                    value={icNumber}
                    onChange={e => setIcNumber(e.target.value)}
                    placeholder="Ch #"
                    className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={icWeight}
                    onChange={e => setIcWeight(e.target.value)}
                    placeholder="Weight %"
                    className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <label className="flex items-center justify-between w-full rounded-lg border border-dashed border-gray-300 px-2.5 py-1.5 text-xs cursor-pointer hover:border-indigo-400 transition-colors">
                  <span className="truncate text-gray-500">
                    {icFile ? icFile.name : 'Chapter PDF'}
                  </span>
                  <input
                    ref={icFileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={e => setIcFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {icError   && <p className="text-xs text-red-600">{icError}</p>}
                {icSuccess && <p className="text-xs text-green-700">{icSuccess}</p>}
                <button
                  type="submit"
                  disabled={icLoading || !icFile || !icSubject.trim() || !icTitle.trim() || !icNumber || !icWeight}
                  className="w-full rounded-lg py-1.5 text-xs font-medium bg-indigo-600 text-white disabled:opacity-50 hover:bg-indigo-700 transition-colors"
                >
                  {icLoading ? 'Saving…' : 'Save Chapter'}
                </button>
              </form>
            )}
          </section>

          {/* My Schemes */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-gray-800">My Schemes</h2>

            <input
              ref={replaceInputRef}
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={handleReplaceFile}
            />

            {replacing && <Spinner label="Replacing scheme…" />}

            {schemesLoading ? (
              <Spinner label="Loading…" />
            ) : schemes.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">No saved schemes yet.</p>
            ) : (
              <div className="space-y-2">
                {schemes.map(scheme => (
                  <div
                    key={scheme.schemeId}
                    className="rounded-xl border border-gray-200 bg-white p-3 space-y-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800 truncate">{scheme.name}</p>
                      <p className="text-xs text-gray-500">
                        {scheme.subject} · {scheme.standard}
                        {scheme.examType ? ` · ${scheme.examType}` : ''}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Updated {new Date(scheme.updatedAt).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleUseScheme(scheme)}
                        className="flex-1 rounded-lg py-1.5 text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                      >
                        Use
                      </button>
                      <button
                        onClick={() => { setReplaceTarget(scheme.schemeId); replaceInputRef.current?.click(); }}
                        className="flex-1 rounded-lg py-1.5 text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                      >
                        Replace
                      </button>
                      <button
                        onClick={() => setDeleteTarget(scheme.schemeId)}
                        className="flex-1 rounded-lg py-1.5 text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                      >
                        Delete
                      </button>
                    </div>

                    {deleteTarget === scheme.schemeId && (
                      <div className="rounded-lg bg-red-50 border border-red-200 p-2 space-y-2">
                        <p className="text-xs text-red-700">
                          Delete this scheme? Sets generated with it are unaffected.
                        </p>
                        <div className="flex gap-1.5">
                          <button
                            onClick={handleDeleteScheme}
                            disabled={deleting}
                            className="flex-1 rounded-lg py-1.5 text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 transition-colors"
                          >
                            {deleting ? 'Deleting…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(null)}
                            className="flex-1 rounded-lg py-1.5 text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

        </aside>
      </div>
    </div>
  );
}

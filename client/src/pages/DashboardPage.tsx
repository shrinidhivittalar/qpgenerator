import { useEffect, useRef, useState, ChangeEvent, FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useGeneration } from '../hooks/useGeneration';
import { apiFetch } from '../lib/api';
import UploadPanel from '../components/UploadPanel';
import SchemePicker from '../components/SchemePicker';
import TypeConfigurator from '../components/TypeConfigurator';
import GenerationProgress from '../components/GenerationProgress';
import QuestionBlock from '../components/QuestionBlock';
import type { Scheme, TypeConfig, ChapterInfo, ReferenceBank } from '../types';

// ── Small re-usable spinner ────────────────────────────────────────────────
function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin shrink-0`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const { state, uploadFile, setTypeConfig, setIntent, applyScheme, generate } = useGeneration();
  const {
    setId, fileName, wordCount, typeConfig, results, isGenerating, exportError,
    difficultyDefault, tone, bankId,
  } = state;

  // ── Scheme step state ──────────────────────────────────────────────────────
  const [schemeStep, setSchemeStep] = useState<'pending' | 'done'>('pending');

  function handleUpload(file: File) {
    setSchemeStep('pending');
    setSelectedChapterIds(new Set());
    return uploadFile(file);
  }

  function handleSchemeApply(parsedConfig: TypeConfig[], schemeId?: string) {
    applyScheme(parsedConfig, schemeId ?? null);
    setSchemeStep('done');
  }

  function handleSchemeSkip() {
    setSchemeStep('done');
  }

  const canGenerate =
    !isGenerating && Boolean(setId) && schemeStep === 'done' && typeConfig.some(c => c.count > 0);

  // ── Chapter state ──────────────────────────────────────────────────────────
  const [chapters,        setChapters]        = useState<ChapterInfo[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(true);
  const [totalWeight,     setTotalWeight]     = useState(0);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());

  // Upload form
  const [showChapterForm,  setShowChapterForm]  = useState(false);
  const [uploadingChapter, setUploadingChapter] = useState(false);
  const [chapterFile,      setChapterFile]      = useState<File | null>(null);
  const [chapterForm,      setChapterForm]      = useState({
    subject: '', chapterName: '', chapterNumber: '', weightPercent: '', highValueSnippets: '',
  });
  const chapterFileRef = useRef<HTMLInputElement>(null);
  const [chapterUploadError, setChapterUploadError] = useState<string | null>(null);

  // Delete
  const [deletingChapterId, setDeletingChapterId] = useState<string | null>(null);

  async function loadChapters() {
    setChaptersLoading(true);
    try {
      const res  = await apiFetch('/api/chapters');
      const data = await res.json() as { chapters: ChapterInfo[]; totalWeightPercent: number };
      setChapters(data.chapters ?? []);
      setTotalWeight(data.totalWeightPercent ?? 0);
    } catch {
      setChapters([]);
    } finally {
      setChaptersLoading(false);
    }
  }

  useEffect(() => { loadChapters(); }, []);

  async function handleChapterUpload(e: FormEvent) {
    e.preventDefault();
    if (!chapterFile) { setChapterUploadError('Select a PDF file.'); return; }
    if (!chapterForm.chapterName.trim()) { setChapterUploadError('Chapter name is required.'); return; }

    setChapterUploadError(null);
    setUploadingChapter(true);
    try {
      const form = new FormData();
      form.append('file',              chapterFile);
      form.append('subject',           chapterForm.subject.trim() || 'General');
      form.append('chapterName',       chapterForm.chapterName.trim());
      form.append('chapterNumber',     chapterForm.chapterNumber || '1');
      form.append('weightPercent',     chapterForm.weightPercent || '0');
      form.append('highValueSnippets', chapterForm.highValueSnippets.trim());

      const res = await apiFetch('/api/chapters/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setChapterUploadError(body.error ?? 'Upload failed.');
        return;
      }
      setChapterForm({ subject: '', chapterName: '', chapterNumber: '', weightPercent: '', highValueSnippets: '' });
      setChapterFile(null);
      if (chapterFileRef.current) chapterFileRef.current.value = '';
      setShowChapterForm(false);
      await loadChapters();
    } catch {
      setChapterUploadError('Upload failed.');
    } finally {
      setUploadingChapter(false);
    }
  }

  async function handleDeleteChapter(id: string) {
    setDeletingChapterId(id);
    try {
      await apiFetch(`/api/chapters/${id}`, { method: 'DELETE' });
      setChapters(cs => cs.filter(c => c._id !== id));
      setSelectedChapterIds(sel => { const n = new Set(sel); n.delete(id); return n; });
      const remaining = chapters.filter(c => c._id !== id);
      setTotalWeight(remaining.reduce((s, c) => s + c.weightPercent, 0));
    } finally {
      setDeletingChapterId(null);
    }
  }

  function toggleChapter(id: string) {
    setSelectedChapterIds(sel => {
      const n = new Set(sel);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  // ── Reference Bank state ───────────────────────────────────────────────────
  const [banks,         setBanks]         = useState<ReferenceBank[]>([]);
  const [banksLoading,  setBanksLoading]  = useState(true);
  const [showBankForm,  setShowBankForm]  = useState(false);
  const [uploadingBank, setUploadingBank] = useState(false);
  const [bankFile,      setBankFile]      = useState<File | null>(null);
  const [bankForm,      setBankForm]      = useState({ bankId: '', subject: '', sourceYear: '' });
  const [bankUploadError, setBankUploadError] = useState<string | null>(null);
  const [deletingBankId,  setDeletingBankId]  = useState<string | null>(null);
  const bankFileRef = useRef<HTMLInputElement>(null);

  async function loadBanks() {
    setBanksLoading(true);
    try {
      const res  = await apiFetch('/api/reference-bank');
      const data = await res.json() as ReferenceBank[];
      setBanks(data ?? []);
    } catch {
      setBanks([]);
    } finally {
      setBanksLoading(false);
    }
  }

  useEffect(() => { loadBanks(); }, []);

  async function handleBankUpload(e: FormEvent) {
    e.preventDefault();
    if (!bankFile)                  { setBankUploadError('Select a PDF file.');      return; }
    if (!bankForm.bankId.trim())    { setBankUploadError('Bank label is required.'); return; }

    setBankUploadError(null);
    setUploadingBank(true);
    try {
      const form = new FormData();
      form.append('file',    bankFile);
      form.append('bankId',  bankForm.bankId.trim());
      if (bankForm.subject.trim())    form.append('subject',    bankForm.subject.trim());
      if (bankForm.sourceYear.trim()) form.append('sourceYear', bankForm.sourceYear.trim());

      const res = await apiFetch('/api/reference-bank/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setBankUploadError(body.error ?? 'Upload failed.');
        return;
      }
      setBankForm({ bankId: '', subject: '', sourceYear: '' });
      setBankFile(null);
      if (bankFileRef.current) bankFileRef.current.value = '';
      setShowBankForm(false);
      await loadBanks();
    } catch {
      setBankUploadError('Upload failed.');
    } finally {
      setUploadingBank(false);
    }
  }

  async function handleDeleteBank(bankId: string) {
    setDeletingBankId(bankId);
    try {
      await apiFetch(`/api/reference-bank/${encodeURIComponent(bankId)}`, { method: 'DELETE' });
      setBanks(bs => bs.filter(b => b.id !== bankId));
    } finally {
      setDeletingBankId(null);
    }
  }

  // ── My Schemes sidebar state ───────────────────────────────────────────────
  const [schemes,        setSchemes]        = useState<Scheme[]>([]);
  const [schemesLoading, setSchemesLoading] = useState(true);
  const [deleteTarget,   setDeleteTarget]   = useState<string | null>(null);
  const [deleting,       setDeleting]       = useState(false);
  const [replaceTarget,  setReplaceTarget]  = useState<string | null>(null);
  const [replacing,      setReplacing]      = useState(false);
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
      if (res.ok) {
        setSchemes(s => s.map(x => x.schemeId === replaceTarget ? { ...x, ...body } : x));
      }
    } finally {
      setReplacing(false);
      setReplaceTarget(null);
    }
  }

  // ── Results helpers ────────────────────────────────────────────────────────
  const successBlocks = Object.entries(results)
    .filter(([, r]) => r.status === 'success')
    .map(([type, r]) => ({ questionType: type, totalMarks: r.totalMarks ?? 0, questions: r.questions ?? [] }));

  const hasResults = Object.values(results).some(r => r.status === 'success' || r.status === 'failed');

  // Total weight badge style
  const weightOk = totalWeight >= 95 && totalWeight <= 105;

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

      {/* 2-column layout */}
      <div className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 items-start">

        {/* ── Left: main generation flow ── */}
        <main className="space-y-8">

          {/* Step 1 — Upload PDF */}
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

          {/* Step 2 — Scheme picker */}
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

          {/* Chapter selection — shown when scheme is done and chapters exist */}
          {setId && schemeStep === 'done' && chapters.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-800">
                  Focus generation on specific chapters
                  <span className="ml-2 text-xs font-normal text-gray-400">(optional)</span>
                </h2>
                {selectedChapterIds.size > 0 && (
                  <button
                    onClick={() => setSelectedChapterIds(new Set())}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Clear selection
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
                {chapters.map(ch => {
                  const checked = selectedChapterIds.has(ch._id);
                  return (
                    <label
                      key={ch._id}
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleChapter(ch._id)}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        disabled={isGenerating}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-800">
                          {ch.chapterNumber}. {ch.chapterName}
                        </span>
                        {ch.subject && (
                          <span className="ml-2 text-xs text-gray-400">{ch.subject}</span>
                        )}
                      </span>
                      <span className="text-xs text-gray-500 tabular-nums shrink-0">
                        {ch.weightPercent}%
                      </span>
                    </label>
                  );
                })}
              </div>

              {selectedChapterIds.size === 0 ? (
                <p className="text-xs text-gray-400">
                  No chapters selected — generation will use the full source PDF.
                </p>
              ) : (
                <p className="text-xs text-indigo-600">
                  {selectedChapterIds.size} chapter{selectedChapterIds.size > 1 ? 's' : ''} selected
                  {' '}({chapters.filter(c => selectedChapterIds.has(c._id)).reduce((s, c) => s + c.weightPercent, 0)}% weight)
                </p>
              )}
            </section>
          )}

          {/* Step 3 — Type configurator */}
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

          {/* Generate button */}
          {setId && schemeStep === 'done' && (
            <button
              onClick={() => generate(Array.from(selectedChapterIds))}
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

          {/* Step 4 — Generation progress */}
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

          {/* Step 5 — Question blocks */}
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

          {/* My Schemes */}
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-gray-800">My Schemes</h2>

            {/* Hidden file input for Replace */}
            <input
              ref={replaceInputRef}
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={handleReplaceFile}
            />

            {replacing && (
              <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
                <Spinner />
                Replacing scheme…
              </div>
            )}

            {schemesLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
                <Spinner />
                Loading…
              </div>
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
          </div>

          {/* ── My Chapters ────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">My Chapters</h2>
              {/* Total weight badge */}
              {!chaptersLoading && chapters.length > 0 && (
                <span className={[
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  weightOk
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700',
                ].join(' ')}>
                  {totalWeight}% total
                </span>
              )}
            </div>

            {/* Add chapter toggle */}
            <button
              onClick={() => { setShowChapterForm(v => !v); setChapterUploadError(null); }}
              className="w-full text-left text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              {showChapterForm ? '− Cancel' : '+ Add chapter'}
            </button>

            {/* Upload form */}
            {showChapterForm && (
              <form onSubmit={handleChapterUpload} className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 space-y-2">
                {/* PDF file */}
                <div>
                  <label className="text-xs text-gray-600 font-medium">Chapter PDF</label>
                  <input
                    ref={chapterFileRef}
                    type="file"
                    accept="application/pdf"
                    onChange={e => setChapterFile(e.target.files?.[0] ?? null)}
                    className="mt-1 block w-full text-xs text-gray-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-white file:text-gray-700 hover:file:bg-gray-100"
                  />
                </div>

                {/* Subject */}
                <div>
                  <label className="text-xs text-gray-600 font-medium">Subject</label>
                  <input
                    type="text"
                    value={chapterForm.subject}
                    onChange={e => setChapterForm(f => ({ ...f, subject: e.target.value }))}
                    placeholder="e.g. Physics"
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>

                {/* Chapter name */}
                <div>
                  <label className="text-xs text-gray-600 font-medium">Chapter name <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={chapterForm.chapterName}
                    onChange={e => setChapterForm(f => ({ ...f, chapterName: e.target.value }))}
                    placeholder="e.g. Laws of Motion"
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>

                {/* Chapter number + weight side by side */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-600 font-medium">Chapter #</label>
                    <input
                      type="number"
                      min="1"
                      value={chapterForm.chapterNumber}
                      onChange={e => setChapterForm(f => ({ ...f, chapterNumber: e.target.value }))}
                      placeholder="1"
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 font-medium">Weight %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={chapterForm.weightPercent}
                      onChange={e => setChapterForm(f => ({ ...f, weightPercent: e.target.value }))}
                      placeholder="20"
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                </div>

                {/* High-value snippets */}
                <div>
                  <label className="text-xs text-gray-600 font-medium">
                    High-value snippets
                    <span className="ml-1 text-gray-400">(optional, one per line)</span>
                  </label>
                  <textarea
                    value={chapterForm.highValueSnippets}
                    onChange={e => setChapterForm(f => ({ ...f, highValueSnippets: e.target.value }))}
                    rows={3}
                    placeholder="Paste key definitions or paragraphs…"
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
                  />
                </div>

                {chapterUploadError && (
                  <p className="text-xs text-red-600">{chapterUploadError}</p>
                )}

                <button
                  type="submit"
                  disabled={uploadingChapter}
                  className="w-full rounded-lg py-1.5 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                >
                  {uploadingChapter ? 'Uploading…' : 'Save chapter'}
                </button>
              </form>
            )}

            {/* Chapter list */}
            {chaptersLoading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
                <Spinner />
                Loading…
              </div>
            ) : chapters.length === 0 ? (
              <p className="text-sm text-gray-400 py-1">
                No chapters yet. Add one to enable chapter-aware generation.
              </p>
            ) : (
              <div className="space-y-1.5">
                {chapters.map(ch => (
                  <div
                    key={ch._id}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 flex items-start gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">
                        {ch.chapterNumber}. {ch.chapterName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {ch.subject} · {ch.weightPercent}%
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteChapter(ch._id)}
                      disabled={deletingChapterId === ch._id}
                      className="shrink-0 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40"
                      title="Delete chapter"
                    >
                      {deletingChapterId === ch._id
                        ? <Spinner className="w-3.5 h-3.5" />
                        : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                      }
                    </button>
                  </div>
                ))}

                {/* Weight warning */}
                {!weightOk && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Chapter weights sum to {totalWeight}% — ideally they should total 100%.
                    Generation still works; weights are normalised automatically.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── My Reference Banks ─────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">My Reference Banks</h2>
            </div>

            <button
              onClick={() => { setShowBankForm(v => !v); setBankUploadError(null); }}
              className="w-full text-left text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              {showBankForm ? '− Cancel' : '+ Add past paper'}
            </button>

            {showBankForm && (
              <form onSubmit={handleBankUpload} className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 space-y-2">
                <div>
                  <label className="text-xs text-gray-600 font-medium">Paper PDF</label>
                  <input
                    ref={bankFileRef}
                    type="file"
                    accept="application/pdf"
                    onChange={e => setBankFile(e.target.files?.[0] ?? null)}
                    className="mt-1 block w-full text-xs text-gray-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-white file:text-gray-700 hover:file:bg-gray-100"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600 font-medium">
                    Bank label <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={bankForm.bankId}
                    onChange={e => setBankForm(f => ({ ...f, bankId: e.target.value }))}
                    placeholder="e.g. CBSE-2023"
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-600 font-medium">Subject</label>
                    <input
                      type="text"
                      value={bankForm.subject}
                      onChange={e => setBankForm(f => ({ ...f, subject: e.target.value }))}
                      placeholder="e.g. Physics"
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 font-medium">Year</label>
                    <input
                      type="number"
                      min="1900"
                      max="2100"
                      value={bankForm.sourceYear}
                      onChange={e => setBankForm(f => ({ ...f, sourceYear: e.target.value }))}
                      placeholder="2023"
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                </div>

                {bankUploadError && (
                  <p className="text-xs text-red-600">{bankUploadError}</p>
                )}

                <button
                  type="submit"
                  disabled={uploadingBank}
                  className="w-full rounded-lg py-1.5 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                >
                  {uploadingBank ? 'Uploading…' : 'Save to bank'}
                </button>
              </form>
            )}

            {banksLoading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
                <Spinner />
                Loading…
              </div>
            ) : banks.length === 0 ? (
              <p className="text-sm text-gray-400 py-1">
                No reference banks yet. Upload a past paper to add one.
              </p>
            ) : (
              <div className="space-y-1.5">
                {banks.map(bank => (
                  <div
                    key={bank.id}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 flex items-center gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{bank.name}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteBank(bank.id)}
                      disabled={deletingBankId === bank.id}
                      className="shrink-0 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40"
                      title="Delete bank"
                    >
                      {deletingBankId === bank.id
                        ? <Spinner className="w-3.5 h-3.5" />
                        : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                      }
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </aside>
      </div>
    </div>
  );
}

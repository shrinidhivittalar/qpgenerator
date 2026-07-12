import { useEffect, useRef, useState, ChangeEvent, FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useGeneration } from '../hooks/useGeneration';
import { apiFetch } from '../lib/api';
import SchemePicker from '../components/SchemePicker';
import TypeConfigurator from '../components/TypeConfigurator';
import GenerationProgress from '../components/GenerationProgress';
import QuestionBlock from '../components/QuestionBlock';
import { PaperView } from '../components/PaperView';
import {
  Spinner, Card, CardHeader, SectionStep, EmptyState,
  WeightBar, InlineAlert, Divider,
} from '../components/ui';
import type { Scheme, TypeConfig, ChapterInfo, ReferenceBank, PaperStructure } from '../types';

// ── Lucide-style inline SVG icons (no extra dep) ──────────────────────────────
const Icons = {
  BookOpen: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  FileText: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  Archive: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  ),
  Layers: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  ),
  Plus: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  X: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  Download: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  ),
  Trash: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  Upload: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  ),
  LogOut: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
  AlertTriangle: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  Sparkles: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
        d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  ),
  ChevronDown: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

// ── Quick Stats strip ─────────────────────────────────────────────────────────
function QuickStats({
  chaptersSelected,
  totalSelWeight,
  activeScheme,
  bankCount,
}: {
  chaptersSelected: number;
  totalSelWeight: number;
  activeScheme: string | null;
  bankCount: number;
}) {
  const stats = [
    {
      label: 'Chapters selected',
      value: chaptersSelected > 0 ? String(chaptersSelected) : '—',
      sub:   chaptersSelected > 0 ? `${totalSelWeight}% weight` : 'None chosen',
      ok:    chaptersSelected > 0,
    },
    {
      label: 'Active scheme',
      value: activeScheme ? 'Applied' : 'None',
      sub:   activeScheme ?? 'Upload or skip',
      ok:    Boolean(activeScheme),
    },
    {
      label: 'Reference banks',
      value: bankCount > 0 ? String(bankCount) : '—',
      sub:   bankCount > 0 ? `${bankCount} paper${bankCount !== 1 ? 's' : ''} uploaded` : 'No past papers',
      ok:    bankCount > 0,
    },
  ];

  return (
    <div className="grid grid-cols-3 divide-x divide-surface-100">
      {stats.map(s => (
        <div key={s.label} className="px-5 py-3.5">
          <p className="text-2xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{s.label}</p>
          <p className={`text-lg font-bold leading-tight ${s.ok ? 'text-slate-800' : 'text-slate-300'}`}>
            {s.value}
          </p>
          <p className="text-2xs text-slate-400 mt-0.5 truncate">{s.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ── Chapter row ───────────────────────────────────────────────────────────────
function ChapterRow({
  chapter,
  selected,
  disabled,
  onToggle,
}: {
  chapter: ChapterInfo;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`chapter-row ${selected ? 'selected' : ''}`}
      aria-selected={selected}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={disabled}
        className="sr-only"
      />
      {/* Custom checkbox */}
      <span
        aria-hidden
        className={[
          'shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors duration-100',
          selected
            ? 'bg-accent-600 border-accent-600'
            : 'bg-white border-surface-300',
          disabled ? 'opacity-50' : '',
        ].join(' ')}
      >
        {selected && (
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-slate-800 leading-tight">
          {chapter.chapterNumber}. {chapter.chapterName}
        </span>
        {chapter.subject && (
          <span className="block text-2xs text-slate-400 mt-0.5">{chapter.subject}</span>
        )}
      </span>
      <span className={`shrink-0 text-2xs font-semibold tabular-nums px-2 py-0.5 rounded-full ${
        selected
          ? 'bg-accent-100 text-accent-700'
          : 'bg-surface-100 text-slate-500'
      }`}>
        {chapter.weightPercent}%
      </span>
    </label>
  );
}

// ── Scheme card in sidebar ────────────────────────────────────────────────────
function SchemeCard({
  scheme,
  isActive,
  isDeleting,
  isReplacing,
  deleteTarget,
  onUse,
  onReplace,
  onDeleteClick,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  scheme: Scheme;
  isActive: boolean;
  isDeleting: boolean;
  isReplacing: boolean;
  deleteTarget: string | null;
  onUse: () => void;
  onReplace: () => void;
  onDeleteClick: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  const showDeleteConfirm = deleteTarget === scheme.schemeId;

  return (
    <div
      className={[
        'rounded-card-inner border p-3.5 transition-all duration-150',
        isActive
          ? 'border-accent-300 bg-accent-50'
          : 'border-surface-200 bg-white hover:border-surface-300',
      ].join(' ')}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold text-slate-800 truncate">{scheme.name}</p>
            {scheme.paperStructure && (
              <span className="badge badge-indigo">Paper</span>
            )}
            {isActive && (
              <span className="badge badge-accent">Active</span>
            )}
          </div>
          <p className="text-2xs text-slate-400 mt-0.5">
            {scheme.subject}
            {scheme.standard ? ` · ${scheme.standard}` : ''}
            {scheme.examType ? ` · ${scheme.examType}` : ''}
          </p>
          <p className="text-2xs text-slate-400">
            Updated {new Date(scheme.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </p>
        </div>
      </div>

      {showDeleteConfirm ? (
        <div className="mt-3 rounded-card-inner bg-rose-50 border border-rose-200 p-2.5 space-y-2">
          <p className="text-2xs text-rose-700">
            Delete this scheme? Generated sets are unaffected.
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={onDeleteConfirm}
              disabled={isDeleting}
              className="flex-1 rounded py-1 text-2xs font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60 transition-colors"
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </button>
            <button
              onClick={onDeleteCancel}
              className="flex-1 rounded py-1 text-2xs font-medium border border-surface-300 text-slate-600 hover:bg-surface-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5 mt-3">
          <button
            onClick={onUse}
            disabled={isReplacing}
            className={[
              'flex-1 rounded py-1.5 text-2xs font-semibold transition-colors',
              isActive
                ? 'bg-accent-600 text-white hover:bg-accent-700'
                : 'bg-slate-800 text-white hover:bg-slate-900',
            ].join(' ')}
          >
            {isActive ? 'Applied ✓' : 'Use'}
          </button>
          <button
            onClick={onReplace}
            disabled={isReplacing}
            className="flex-1 rounded py-1.5 text-2xs font-medium bg-surface-100 text-slate-600 hover:bg-surface-200 border border-surface-200 transition-colors disabled:opacity-60"
          >
            {isReplacing ? <Spinner className="w-3 h-3 mx-auto" /> : 'Replace'}
          </button>
          <button
            onClick={onDeleteClick}
            disabled={isReplacing}
            className="rounded py-1.5 px-2.5 text-2xs font-medium text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
            title="Delete scheme"
          >
            <Icons.Trash />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sidebar chapter row ───────────────────────────────────────────────────────
function SidebarChapterRow({
  chapter,
  isDeleting,
  isScanning,
  onDelete,
  onScanFigures,
}: {
  chapter: ChapterInfo;
  isDeleting: boolean;
  isScanning: boolean;
  onDelete: () => void;
  onScanFigures: (file: File) => void;
}) {
  const scanRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2.5 px-1 py-2 rounded-card-inner hover:bg-surface-50 group transition-colors">
      <input
        ref={scanRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onScanFigures(f);
        }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-700 truncate leading-tight">
          {chapter.chapterNumber}. {chapter.chapterName}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-2xs text-slate-400">{chapter.subject} · {chapter.weightPercent}%</p>
          {chapter.figurePageCount > 0 && (
            <span className="text-2xs text-purple-500 font-medium">{chapter.figurePageCount} fig</span>
          )}
        </div>
      </div>
      <button
        onClick={() => scanRef.current?.click()}
        disabled={isScanning || isDeleting}
        title="Scan for figures"
        className={`shrink-0 transition-colors disabled:opacity-40 ${
          chapter.figurePageCount === 0
            ? 'text-purple-400 hover:text-purple-600'
            : 'text-transparent group-hover:text-purple-300 hover:!text-purple-500'
        }`}
        aria-label={`Scan figures in ${chapter.chapterName}`}
      >
        {isScanning ? <Spinner className="w-3.5 h-3.5 text-purple-400" /> : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      </button>
      <button
        onClick={onDelete}
        disabled={isDeleting || isScanning}
        className="shrink-0 text-transparent group-hover:text-slate-300 hover:!text-rose-500 transition-colors disabled:opacity-40"
        title="Delete chapter"
        aria-label={`Delete ${chapter.chapterName}`}
      >
        {isDeleting ? <Spinner className="w-3.5 h-3.5 text-slate-400" /> : <Icons.X />}
      </button>
    </div>
  );
}

// ── Reference bank row ────────────────────────────────────────────────────────
function BankRow({
  bank,
  isDeleting,
  onDelete,
}: {
  bank: ReferenceBank;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-1 py-2 rounded-card-inner hover:bg-surface-50 group transition-colors">
      <div className="w-7 h-7 shrink-0 rounded bg-surface-100 flex items-center justify-center text-slate-400">
        <Icons.FileText />
      </div>
      <p className="flex-1 min-w-0 text-xs font-medium text-slate-700 truncate">{bank.name}</p>
      <button
        onClick={onDelete}
        disabled={isDeleting}
        className="shrink-0 text-transparent group-hover:text-slate-300 hover:!text-rose-500 transition-colors disabled:opacity-40"
        title="Delete bank"
        aria-label={`Delete ${bank.name}`}
      >
        {isDeleting ? <Spinner className="w-3.5 h-3.5 text-slate-400" /> : <Icons.X />}
      </button>
    </div>
  );
}

// ── Upload form ───────────────────────────────────────────────────────────────
function UploadForm({
  title,
  onCancel,
  children,
  error,
  onSubmit,
  submitLabel,
  submitting,
}: {
  title: string;
  onCancel: () => void;
  children: React.ReactNode;
  error: string | null;
  onSubmit: (e: FormEvent) => void;
  submitLabel: string;
  submitting: boolean;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-card-inner border border-surface-200 bg-surface-50 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">{title}</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-400 hover:text-slate-600 transition-colors"
        >
          <Icons.X />
        </button>
      </div>
      {children}
      {error && (
        <InlineAlert variant="error">{error}</InlineAlert>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="btn-primary w-full py-2 text-xs"
      >
        {submitting ? <><Spinner className="w-3.5 h-3.5" /> {submitLabel.replace(/^[^…]+/, 'Working')}…</> : submitLabel}
      </button>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Dashboard
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user, logout } = useAuth();
  const {
    state, setTypeConfig, setIntent, applyScheme,
    generate, generatePaper,
    editQuestion, regenerateType,
  } = useGeneration();
  const {
    setId, typeConfig, results, isGenerating, isRegenerating, exportError,
    difficultyDefault, tone, bankId, activeSchemeId,
    activePaperStructure, filledPaperStructure, isPaperGenerating,
    paperGenerateError, paperStats,
  } = state;


  const isPaperMode = Boolean(activePaperStructure);

  const [regenToast,        setRegenToast]        = useState<{ type: string; ok: boolean; msg: string } | null>(null);
  const [downloadingPaper,  setDownloadingPaper]  = useState(false);
  const [downloadingBlocks, setDownloadingBlocks] = useState(false);

  async function handleDownloadPaper() {
    if (!setId) return;
    setDownloadingPaper(true);
    try {
      const res = await apiFetch(`/api/sets/${setId}/export/paper`);
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        showToast('export', false, body.error ?? 'Download failed.');
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? 'question-paper.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      showToast('export', false, 'Download failed.');
    } finally {
      setDownloadingPaper(false);
    }
  }

  async function handleDownloadBlocks() {
    if (!setId) return;
    setDownloadingBlocks(true);
    try {
      const res = await apiFetch(`/api/sets/${setId}/export`);
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        showToast('export', false, body.error ?? 'Download failed.');
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? 'question-set.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      showToast('export', false, 'Download failed.');
    } finally {
      setDownloadingBlocks(false);
    }
  }

  function showToast(type: string, ok: boolean, msg: string) {
    setRegenToast({ type, ok, msg });
    setTimeout(() => setRegenToast(null), 3500);
  }

  async function handleRegenerate(type: string) {
    const { success, error } = await regenerateType(type as any);
    showToast(type, success, success ? `${type} regenerated.` : (error ?? 'Regeneration failed.'));
  }

  // ── Scheme step ─────────────────────────────────────────────────────────────
  const [schemeStep, setSchemeStep] = useState<'pending' | 'done'>('pending');

  function handleSchemeApply(parsedConfig: TypeConfig[], schemeId?: string, paperStructure?: PaperStructure | null) {
    applyScheme(parsedConfig, schemeId ?? null, paperStructure ?? null);
    setSchemeStep('done');
  }

  function handleSchemeSkip() {
    setSchemeStep('done');
  }

  // ── Chapter state ────────────────────────────────────────────────────────────
  const [chapters,           setChapters]           = useState<ChapterInfo[]>([]);
  const [chaptersLoading,    setChaptersLoading]    = useState(true);
  const [totalWeight,        setTotalWeight]        = useState(0);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());

  const canGenerate =
    !isGenerating && schemeStep === 'done' &&
    typeConfig.some(c => c.count > 0) && selectedChapterIds.size > 0;

  const canGeneratePaper =
    !isPaperGenerating && schemeStep === 'done' && selectedChapterIds.size > 0;

  // Upload form state
  const [showChapterForm,  setShowChapterForm]  = useState(false);
  const [uploadingChapter, setUploadingChapter] = useState(false);
  const [chapterFile,      setChapterFile]      = useState<File | null>(null);
  const [chapterForm,      setChapterForm]      = useState({
    subject: '', chapterName: '', chapterNumber: '', weightPercent: '', highValueSnippets: '',
  });
  const chapterFileRef = useRef<HTMLInputElement>(null);
  const [chapterUploadError, setChapterUploadError] = useState<string | null>(null);
  const [deletingChapterId,  setDeletingChapterId]  = useState<string | null>(null);
  const [scanningChapterId,  setScanningChapterId]  = useState<string | null>(null);

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
    if (!chapterFile)                   { setChapterUploadError('Select a PDF file.'); return; }
    if (!chapterForm.chapterName.trim()) { setChapterUploadError('Chapter name is required.'); return; }

    setChapterUploadError(null);
    setUploadingChapter(true);
    try {
      const form = new FormData();
      form.append('file',              chapterFile);
      form.append('subject',           chapterForm.subject.trim() || 'General');
      form.append('chapterName',       chapterForm.chapterName.trim());
      form.append('chapterNumber',     chapterForm.chapterNumber || '1');
      form.append('weightPercent',     chapterForm.weightPercent || '10');
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

  async function handleScanFigures(id: string, file: File) {
    setScanningChapterId(id);
    try {
      const form = new FormData();
      form.append('file', file);
      const res  = await apiFetch(`/api/chapters/${id}/scan-figures`, { method: 'POST', body: form });
      const body = await res.json() as { figurePageCount?: number; error?: string };
      if (res.ok) {
        setChapters(cs => cs.map(c => c._id === id ? { ...c, figurePageCount: body.figurePageCount ?? 0 } : c));
      }
    } catch { /* ignore */ } finally {
      setScanningChapterId(null);
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

  // ── Reference Bank state ─────────────────────────────────────────────────────
  const [banks,         setBanks]         = useState<ReferenceBank[]>([]);
  const [banksLoading,  setBanksLoading]  = useState(true);
  const [showBankForm,  setShowBankForm]  = useState(false);
  const [uploadingBank, setUploadingBank] = useState(false);
  const [bankFile,      setBankFile]      = useState<File | null>(null);
  const [bankForm,      setBankForm]      = useState({ bankId: '', subject: '', sourceYear: '' });
  const [bankUploadError, setBankUploadError] = useState<string | null>(null);
  const [deletingBankId,  setDeletingBankId]  = useState<string | null>(null);
  const bankFileRef = useRef<HTMLInputElement>(null);

  // ── Textbook auto-split state ─────────────────────────────────────────────────
  type DraftChapter = {
    tempId: string; title: string; chapterNumber: number;
    weightPercent: number; preview: string; wordCount: number; excluded: boolean;
  };
  const [textbookDraft,       setTextbookDraft]       = useState<{ draftId: string; detectionMethod: string; fileName: string } | null>(null);
  const [draftChapters,       setDraftChapters]       = useState<DraftChapter[]>([]);
  const [textbookUploading,   setTextbookUploading]   = useState(false);
  const [textbookUploadError, setTextbookUploadError] = useState<string | null>(null);
  const [confirmingDraft,     setConfirmingDraft]     = useState(false);
  const [showTextbookForm,    setShowTextbookForm]    = useState(false);
  const [textbookFile,        setTextbookFile]        = useState<File | null>(null);
  const [textbookSubject,     setTextbookSubject]     = useState('');
  const textbookFileRef = useRef<HTMLInputElement>(null);

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
    if (!bankFile)               { setBankUploadError('Select a PDF file.');      return; }
    if (!bankForm.bankId.trim()) { setBankUploadError('Bank label is required.'); return; }

    setBankUploadError(null);
    setUploadingBank(true);
    try {
      const form = new FormData();
      form.append('file',   bankFile);
      form.append('bankId', bankForm.bankId.trim());
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

  async function handleTextbookUpload(e: FormEvent) {
    e.preventDefault();
    if (!textbookFile)           { setTextbookUploadError('Select a PDF file.');   return; }
    if (!textbookSubject.trim()) { setTextbookUploadError('Subject is required.'); return; }
    setTextbookUploadError(null);
    setTextbookUploading(true);
    try {
      const form = new FormData();
      form.append('file',    textbookFile);
      form.append('subject', textbookSubject.trim());
      const res  = await apiFetch('/api/textbooks/upload', { method: 'POST', body: form });
      const body = await res.json() as {
        draftId: string; detectionMethod: string;
        chapters: Array<{ tempId: string; suggestedTitle: string; suggestedNumber: number; preview: string; wordCount: number }>;
        error?: string;
      };
      if (!res.ok) { setTextbookUploadError(body.error ?? 'Upload failed.'); return; }
      const n    = body.chapters.length;
      const base = Math.floor(100 / n);
      const rem  = 100 % n;
      setDraftChapters(body.chapters.map((c, i) => ({
        tempId:        c.tempId,
        title:         c.suggestedTitle,
        chapterNumber: c.suggestedNumber,
        weightPercent: base + (i < rem ? 1 : 0),
        preview:       c.preview,
        wordCount:     c.wordCount,
        excluded:      false,
      })));
      setTextbookDraft({ draftId: body.draftId, detectionMethod: body.detectionMethod, fileName: textbookFile.name });
      setShowTextbookForm(false);
      setTextbookFile(null);
      setTextbookSubject('');
      if (textbookFileRef.current) textbookFileRef.current.value = '';
    } catch {
      setTextbookUploadError('Upload failed.');
    } finally {
      setTextbookUploading(false);
    }
  }

  async function handleConfirmDraft() {
    if (!textbookDraft) return;
    const active   = draftChapters.filter(c => !c.excluded);
    const excluded = draftChapters.filter(c =>  c.excluded).map(c => c.tempId);
    setConfirmingDraft(true);
    setTextbookUploadError(null);
    try {
      const res = await apiFetch(`/api/textbooks/${textbookDraft.draftId}/confirm`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          chapters: active.map(c => ({
            tempId: c.tempId, title: c.title, chapterNumber: c.chapterNumber, weightPercent: c.weightPercent,
          })),
          excludedTempIds: excluded,
        }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setTextbookUploadError(body.error ?? 'Failed to save chapters.');
        return;
      }
      setTextbookDraft(null);
      setDraftChapters([]);
      await loadChapters();
    } catch {
      setTextbookUploadError('Failed to save chapters.');
    } finally {
      setConfirmingDraft(false);
    }
  }

  // ── My Schemes sidebar ───────────────────────────────────────────────────────
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
    applyScheme(scheme.parsedConfig as TypeConfig[], scheme.schemeId, scheme.paperStructure ?? null);
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

  // ── Results helpers ──────────────────────────────────────────────────────────
  const successBlocks = Object.entries(results)
    .filter(([, r]) => r.status === 'success')
    .map(([type, r]) => ({ questionType: type, totalMarks: r.totalMarks ?? 0, questions: r.questions ?? [] }));

  const hasResults = Object.values(results).some(r => r.status === 'success' || r.status === 'failed');
  const weightOk   = totalWeight >= 95 && totalWeight <= 105;

  // Selected chapter weight sum
  const selectedWeight = chapters
    .filter(c => selectedChapterIds.has(c._id))
    .reduce((s, c) => s + c.weightPercent, 0);

  // Active scheme name for quick stats
  const activeSchemeName = schemes.find(s => s.schemeId === activeSchemeId)?.name ?? null;

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-surface-50">

      {/* ── Top Header ─────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-surface-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <div className="w-7 h-7 rounded-card-inner bg-accent-600 flex items-center justify-center text-white">
              <Icons.Sparkles />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-900 leading-none">QPGenerator</span>
              <span className="ml-2 text-2xs text-slate-400 hidden sm:inline">Teacher Dashboard</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* User pill */}
            <div className="hidden sm:flex items-center gap-2 bg-surface-50 border border-surface-200 rounded-full px-3 py-1.5">
              <div className="w-5 h-5 rounded-full bg-accent-100 flex items-center justify-center text-accent-700 text-2xs font-bold">
                {user?.name?.charAt(0).toUpperCase() ?? 'T'}
              </div>
              <span className="text-xs font-medium text-slate-700 max-w-[120px] truncate">{user?.name}</span>
            </div>
            <button
              onClick={logout}
              className="btn-ghost text-slate-500 flex items-center gap-1.5"
              title="Sign out"
            >
              <Icons.LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Page title band ─────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-surface-100">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-base font-bold text-slate-900">Generate Question Paper</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Select chapters, choose a scheme, and generate exam-ready questions.
          </p>
        </div>
      </div>

      {/* ── Quick Stats bar ──────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-surface-100">
        <div className="max-w-7xl mx-auto px-6">
          <QuickStats
            chaptersSelected={selectedChapterIds.size}
            totalSelWeight={selectedWeight}
            activeScheme={activeSchemeName}
            bankCount={banks.length}
          />
        </div>
      </div>

      {/* ── Main 2-column layout ─────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">

        {/* ═══════════════════════════════════════════════════════════════════
            LEFT: main generation flow
        ═══════════════════════════════════════════════════════════════════ */}
        <main className="space-y-5 min-w-0">

          {/* ── Textbook draft review ──────────────────────────────────────── */}
          {textbookDraft && (
            <Card>
              <CardHeader
                title="Review detected chapters"
                subtitle={`${draftChapters.length} chapter${draftChapters.length !== 1 ? 's' : ''} via ${textbookDraft.detectionMethod} · ${textbookDraft.fileName}`}
                icon={<Icons.BookOpen />}
                action={
                  <button
                    onClick={() => { setTextbookDraft(null); setDraftChapters([]); }}
                    className="btn-ghost text-slate-400"
                  >
                    Cancel
                  </button>
                }
              />
              <div className="p-4 space-y-2 max-h-[55vh] overflow-y-auto">
                {draftChapters.map((ch, i) => (
                  <div
                    key={ch.tempId}
                    className={[
                      'rounded-card-inner border p-3 space-y-1.5 transition-opacity',
                      ch.excluded ? 'opacity-40 border-surface-200 bg-surface-50' : 'border-surface-200 bg-white',
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={!ch.excluded}
                        onChange={() => setDraftChapters(chs => chs.map((c, j) => j === i ? { ...c, excluded: !c.excluded } : c))}
                        className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
                      />
                      <input
                        type="text"
                        value={ch.title}
                        disabled={ch.excluded}
                        onChange={e => setDraftChapters(chs => chs.map((c, j) => j === i ? { ...c, title: e.target.value } : c))}
                        className="flex-1 text-sm font-medium text-slate-800 bg-transparent border-0 border-b border-surface-200 focus:border-accent-400 focus:outline-none py-0.5"
                      />
                      <span className="text-2xs text-slate-400 shrink-0">#{ch.chapterNumber}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number" min="0" max="100"
                          value={ch.weightPercent}
                          disabled={ch.excluded}
                          onChange={e => setDraftChapters(chs => chs.map((c, j) => j === i ? { ...c, weightPercent: parseInt(e.target.value) || 0 } : c))}
                          className="w-12 text-xs text-center border border-surface-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-accent-400"
                        />
                        <span className="text-2xs text-slate-400">%</span>
                      </div>
                    </div>
                    {ch.preview && (
                      <p className="text-2xs text-slate-400 pl-6 line-clamp-2 leading-relaxed">{ch.preview}</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 border-t border-surface-100 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  {(() => {
                    const active = draftChapters.filter(c => !c.excluded);
                    const total  = active.reduce((s, c) => s + c.weightPercent, 0);
                    return (
                      <span className={`text-xs font-medium ${Math.abs(total - 100) > 1 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {active.length} chapters · {total}%
                      </span>
                    );
                  })()}
                  <button
                    onClick={() => {
                      const active = draftChapters.filter(c => !c.excluded);
                      const n = active.length;
                      if (n === 0) return;
                      const base = Math.floor(100 / n), rem = 100 % n;
                      let ai = 0;
                      setDraftChapters(chs => chs.map(c => {
                        if (c.excluded) return c;
                        const w = base + (ai < rem ? 1 : 0); ai++;
                        return { ...c, weightPercent: w };
                      }));
                    }}
                    className="text-2xs text-accent-600 hover:text-accent-700 font-medium transition-colors"
                  >
                    Distribute evenly
                  </button>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => { setTextbookDraft(null); setDraftChapters([]); }}
                    className="btn-secondary text-xs py-1.5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmDraft}
                    disabled={confirmingDraft || draftChapters.filter(c => !c.excluded).length === 0}
                    className="btn-primary text-xs py-1.5"
                  >
                    {confirmingDraft ? (
                      <><Spinner className="w-3.5 h-3.5" /> Saving…</>
                    ) : (
                      `Save ${draftChapters.filter(c => !c.excluded).length} chapters`
                    )}
                  </button>
                </div>
              </div>
              {textbookUploadError && (
                <div className="px-4 pb-3">
                  <InlineAlert variant="error">{textbookUploadError}</InlineAlert>
                </div>
              )}
            </Card>
          )}

          {/* ── Normal flow ─────────────────────────────────────────────────── */}
          {!textbookDraft && <>

            {/* Step 1 — Select chapters */}
            <SectionStep step={1} title="Select chapters">
              <Card>
                {chaptersLoading ? (
                  <div className="flex items-center justify-center gap-2.5 py-10 text-slate-400">
                    <Spinner /> <span className="text-sm">Loading chapters…</span>
                  </div>
                ) : chapters.length === 0 ? (
                  <EmptyState
                    icon={<Icons.BookOpen />}
                    title="No chapters yet"
                    description="Upload a textbook PDF from the sidebar to auto-detect chapters."
                  />
                ) : (
                  <>
                    {/* Column header */}
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-100">
                      <span className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">
                        {chapters.length} chapter{chapters.length !== 1 ? 's' : ''}
                      </span>
                      <div className="flex items-center gap-3">
                        {selectedChapterIds.size > 0 && (
                          <button
                            onClick={() => setSelectedChapterIds(new Set())}
                            className="text-2xs text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            Clear all
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedChapterIds(new Set(chapters.map(c => c._id)))}
                          className="text-2xs text-accent-600 hover:text-accent-700 font-medium transition-colors"
                        >
                          Select all
                        </button>
                      </div>
                    </div>
                    <div className="divide-y divide-surface-100">
                      {chapters.map(ch => (
                        <ChapterRow
                          key={ch._id}
                          chapter={ch}
                          selected={selectedChapterIds.has(ch._id)}
                          disabled={isGenerating}
                          onToggle={() => toggleChapter(ch._id)}
                        />
                      ))}
                    </div>
                    {/* Footer summary */}
                    <div className="px-4 py-3 border-t border-surface-100 bg-surface-50 rounded-b-card">
                      {selectedChapterIds.size === 0 ? (
                        <InlineAlert variant="warning">Select at least one chapter to continue.</InlineAlert>
                      ) : (() => {
                        const sel = chapters.filter(c => selectedChapterIds.has(c._id));
                        const selW = sel.reduce((s, c) => s + c.weightPercent, 0);
                        const allZero = sel.every(c => c.weightPercent === 0);
                        return (
                          <p className="text-xs text-accent-700 font-medium">
                            <span className="font-bold">{selectedChapterIds.size}</span> chapter{selectedChapterIds.size > 1 ? 's' : ''} selected
                            {allZero ? ' — split equally' : ` · ${selW}% combined weight`}
                          </p>
                        );
                      })()}
                    </div>
                  </>
                )}
              </Card>
            </SectionStep>

            {/* Step 2 — Scheme picker */}
            {schemeStep === 'pending' && selectedChapterIds.size > 0 && (
              <SectionStep step={2} title="Select question paper scheme">
                <Card className="overflow-hidden">
                  <SchemePicker
                    schemes={schemes}
                    onApply={handleSchemeApply}
                    onSkip={handleSchemeSkip}
                    onSchemeSaved={loadSchemes}
                  />
                </Card>
              </SectionStep>
            )}

            {/* Step 3 — Manual type config (no scheme) */}
            {schemeStep === 'done' && !activeSchemeId && (
              <SectionStep step={3} title="Configure question types">
                <Card className="overflow-hidden">
                  <TypeConfigurator
                    config={typeConfig}
                    onChange={setTypeConfig}
                    difficultyDefault={difficultyDefault}
                    tone={tone}
                    bankId={bankId}
                    onIntentChange={setIntent}
                    disabled={isGenerating}
                  />
                </Card>
              </SectionStep>
            )}

            {/* Step 3 — Paper structure preview */}
            {schemeStep === 'done' && isPaperMode && (
              <SectionStep step={3} title="Paper structure">
                <Card>
                  <CardHeader
                    title="Exam paper structure"
                    subtitle="From applied scheme"
                    icon={<Icons.Layers />}
                    action={
                      <button
                        onClick={() => setSchemeStep('pending')}
                        className="btn-ghost text-xs text-slate-500"
                      >
                        Change scheme
                      </button>
                    }
                  />
                  <div className="p-4">
                    <PaperView structure={activePaperStructure!} isPreview />
                  </div>
                </Card>
              </SectionStep>
            )}

            {/* Step 3 — Scheme flat summary */}
            {schemeStep === 'done' && activeSchemeId && !isPaperMode && typeConfig.length > 0 && (
              <SectionStep step={3} title="Question types from scheme">
                <Card>
                  <CardHeader
                    title="Scheme configuration"
                    icon={<Icons.FileText />}
                    action={
                      <button
                        onClick={() => setSchemeStep('pending')}
                        className="btn-ghost text-xs text-slate-500"
                      >
                        Change
                      </button>
                    }
                  />
                  <div className="divide-y divide-surface-100">
                    {typeConfig.filter(tc => tc.count > 0).map(tc => (
                      <div key={tc.type} className="flex items-center justify-between px-5 py-3">
                        <span className="text-sm text-slate-700 capitalize font-medium">
                          {tc.type.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="badge badge-slate">{tc.count} Q</span>
                          <span className="badge badge-slate">{tc.marksPerQuestion}M each</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </SectionStep>
            )}

            {/* Figure-Based Questions — shown whenever selected chapters have detected figures */}
            {(() => {
              const totalFigurePages = chapters
                .filter(c => selectedChapterIds.has(c._id))
                .reduce((s, c) => s + (c.figurePageCount ?? 0), 0);
              if (totalFigurePages === 0) return null;

              const fbEntry = typeConfig.find(tc => tc.type === 'figureBased');
              const enabled = Boolean(fbEntry);

              function toggleFigureBased() {
                if (enabled) {
                  setTypeConfig(typeConfig.filter(tc => tc.type !== 'figureBased'));
                } else {
                  setTypeConfig([...typeConfig, { type: 'figureBased', count: Math.min(totalFigurePages, 3), marksPerQuestion: 2 }]);
                }
              }
              function updateFb(field: 'count' | 'marksPerQuestion', raw: string) {
                const value = field === 'count'
                  ? Math.max(1, Math.min(totalFigurePages, Math.floor(Number(raw))))
                  : Math.max(0.5, Number(raw));
                setTypeConfig(typeConfig.map(tc => tc.type === 'figureBased' ? { ...tc, [field]: value } : tc));
              }

              return (
                <div className={`rounded-card border p-4 transition-colors ${enabled ? 'border-purple-300 bg-purple-50' : 'border-purple-200 bg-white'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={toggleFigureBased}
                        disabled={isGenerating}
                        className="w-4 h-4 rounded accent-purple-600"
                      />
                      <span className="font-medium text-sm text-gray-800">Figure Based</span>
                    </label>
                    <span className="text-xs text-purple-600 bg-purple-100 rounded-full px-2 py-0.5">
                      {totalFigurePages} figure page{totalFigurePages !== 1 ? 's' : ''} detected
                    </span>
                  </div>
                  <p className="text-xs text-purple-600 mt-1.5 mb-0">
                    Questions framed from diagrams found in your uploaded textbook PDFs.
                  </p>
                  {enabled && fbEntry && (
                    <div className="mt-3 flex gap-3">
                      <label className="flex flex-col gap-1 flex-1">
                        <span className="text-xs text-gray-500">Count (max {totalFigurePages})</span>
                        <input
                          type="number"
                          min={1}
                          max={totalFigurePages}
                          value={fbEntry.count}
                          onChange={e => updateFb('count', e.target.value)}
                          disabled={isGenerating}
                          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                        />
                      </label>
                      <label className="flex flex-col gap-1 flex-1">
                        <span className="text-xs text-gray-500">Marks each</span>
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={fbEntry.marksPerQuestion}
                          onChange={e => updateFb('marksPerQuestion', e.target.value)}
                          disabled={isGenerating}
                          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Generate button */}
            {schemeStep === 'done' && (
              isPaperMode ? (
                <div className="space-y-2">
                  {selectedChapterIds.size === 0 && (
                    <InlineAlert variant="warning">
                      Select at least one chapter to enable paper generation.
                    </InlineAlert>
                  )}
                  <button
                    onClick={() => generatePaper(Array.from(selectedChapterIds))}
                    disabled={!canGeneratePaper}
                    className={`w-full rounded-card py-3.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                      canGeneratePaper
                        ? 'bg-accent-600 text-white hover:bg-accent-700'
                        : 'bg-surface-200 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {isPaperGenerating && <Spinner className="w-4 h-4" />}
                    {isPaperGenerating ? 'Generating paper…' : 'Generate Paper'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => generate(Array.from(selectedChapterIds))}
                  disabled={!canGenerate}
                  className={`w-full rounded-card py-3.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                    canGenerate
                      ? 'bg-accent-600 text-white hover:bg-accent-700'
                      : 'bg-surface-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {isGenerating && <Spinner className="w-4 h-4" />}
                  {isGenerating ? 'Generating…' : 'Generate Questions'}
                </button>
              )
            )}

            {/* Error alerts */}
            {exportError && <InlineAlert variant="error">{exportError}</InlineAlert>}
            {paperGenerateError && <InlineAlert variant="error">{paperGenerateError}</InlineAlert>}

            {/* Paper stats */}
            {isPaperMode && paperStats && !isPaperGenerating && (
              <Card>
                <div className="px-5 py-4 flex items-center gap-5 text-sm">
                  <div>
                    <p className="text-2xs text-slate-400 font-semibold uppercase tracking-wider mb-0.5">Slots filled</p>
                    <p className="font-bold text-slate-800">
                      <span className="text-emerald-600">{paperStats.filledSlots}</span>
                      <span className="text-slate-400 font-normal"> / {paperStats.totalSlots}</span>
                    </p>
                  </div>
                  {paperStats.failedSlots > 0 && (
                    <div>
                      <p className="text-2xs text-rose-500 font-semibold uppercase tracking-wider mb-0.5">Failed</p>
                      <p className="font-bold text-rose-600">{paperStats.failedSlots}</p>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Step 4 — Generation progress */}
            {!isPaperMode && (isGenerating || hasResults) && (
              <SectionStep step={4} title="Generation status">
                <Card className="overflow-hidden">
                  <GenerationProgress
                    typeConfig={typeConfig}
                    results={results}
                    isGenerating={isGenerating}
                    difficultyDefault={difficultyDefault}
                    tone={tone}
                  />
                </Card>
              </SectionStep>
            )}

            {/* Step 5 — Paper result */}
            {isPaperMode && filledPaperStructure && (
              <SectionStep step={4} title="Generated paper">
                <Card>
                  <CardHeader
                    title="Question paper"
                    icon={<Icons.FileText />}
                    action={
                      <button
                        onClick={handleDownloadPaper}
                        disabled={downloadingPaper}
                        className={`flex items-center gap-1.5 rounded-card-inner px-3 py-1.5 text-xs font-semibold transition-colors ${
                          downloadingPaper
                            ? 'bg-surface-100 text-slate-400 cursor-not-allowed'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        }`}
                      >
                        {downloadingPaper ? <><Spinner className="w-3.5 h-3.5" /> Preparing…</> : <><Icons.Download /> Download .docx</>}
                      </button>
                    }
                  />
                  <div className="p-4">
                    <PaperView structure={filledPaperStructure} />
                  </div>
                </Card>
              </SectionStep>
            )}

            {/* Step 5 — Question blocks */}
            {!isPaperMode && successBlocks.length > 0 && (
              <SectionStep step={5} title="Generated questions">
                <div className="flex justify-end mb-3">
                  <button
                    onClick={handleDownloadBlocks}
                    disabled={downloadingBlocks}
                    className={`flex items-center gap-1.5 rounded-card-inner px-3 py-1.5 text-xs font-semibold transition-colors ${
                      downloadingBlocks
                        ? 'bg-surface-100 text-slate-400 cursor-not-allowed'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {downloadingBlocks
                      ? <><Spinner className="w-3.5 h-3.5" /> Preparing…</>
                      : <><Icons.Download /> Download .docx</>}
                  </button>
                </div>
                <div className="space-y-4">
                  {successBlocks.map(b => (
                    <QuestionBlock
                      key={b.questionType}
                      questionType={b.questionType}
                      totalMarks={b.totalMarks}
                      questions={b.questions}
                      setId={setId}
                      isRegenerating={isRegenerating[b.questionType as any] ?? false}
                      onEdit={(qId, updated) => editQuestion(b.questionType as any, qId, updated)}
                      onRegenerate={() => handleRegenerate(b.questionType)}
                    />
                  ))}
                </div>
              </SectionStep>
            )}
          </>}
        </main>

        {/* ═══════════════════════════════════════════════════════════════════
            RIGHT: sidebar
        ═══════════════════════════════════════════════════════════════════ */}
        <aside className="space-y-4 lg:sticky lg:top-[7.5rem]">

          {/* ── My Schemes ────────────────────────────────────────────────── */}
          <Card>
            <CardHeader
              title="My Schemes"
              subtitle="Exam blueprints"
              icon={<Icons.Layers />}
            />

            {/* Hidden replace input */}
            <input
              ref={replaceInputRef}
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={handleReplaceFile}
            />

            <div className="p-3 space-y-2">
              {schemesLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                  <Spinner /> <span className="text-xs">Loading…</span>
                </div>
              ) : schemes.length === 0 ? (
                <EmptyState
                  icon={<Icons.FileText />}
                  title="No schemes yet"
                  description="Upload a marking scheme or past paper PDF to get started."
                />
              ) : (
                <>
                  {replacing && (
                    <div className="flex items-center gap-2 text-xs text-slate-500 px-1 py-2">
                      <Spinner className="w-3.5 h-3.5" /> Replacing scheme…
                    </div>
                  )}
                  {schemes.map(scheme => (
                    <SchemeCard
                      key={scheme.schemeId}
                      scheme={scheme}
                      isActive={scheme.schemeId === activeSchemeId}
                      isDeleting={deleting && deleteTarget === scheme.schemeId}
                      isReplacing={replacing && replaceTarget === scheme.schemeId}
                      deleteTarget={deleteTarget}
                      onUse={() => handleUseScheme(scheme)}
                      onReplace={() => { setReplaceTarget(scheme.schemeId); replaceInputRef.current?.click(); }}
                      onDeleteClick={() => setDeleteTarget(scheme.schemeId)}
                      onDeleteConfirm={handleDeleteScheme}
                      onDeleteCancel={() => setDeleteTarget(null)}
                    />
                  ))}
                </>
              )}
            </div>
          </Card>

          {/* ── My Chapters ───────────────────────────────────────────────── */}
          <Card>
            <CardHeader
              title="My Chapters"
              subtitle={
                !chaptersLoading && chapters.length > 0
                  ? `${chapters.length} chapters`
                  : undefined
              }
              icon={<Icons.BookOpen />}
              action={
                !chaptersLoading && chapters.length > 0 ? (
                  <WeightBar value={totalWeight} />
                ) : undefined
              }
            />

            <div className="p-3 space-y-2">
              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowTextbookForm(v => !v);
                    setShowChapterForm(false);
                    setTextbookUploadError(null);
                  }}
                  className={`flex-1 rounded-card-inner py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    showTextbookForm
                      ? 'bg-accent-100 text-accent-800 border border-accent-200'
                      : 'bg-accent-600 text-white hover:bg-accent-700'
                  }`}
                >
                  {showTextbookForm ? '× Cancel' : <><Icons.Upload /> Upload textbook</>}
                </button>
                <button
                  onClick={() => {
                    setShowChapterForm(v => !v);
                    setShowTextbookForm(false);
                    setChapterUploadError(null);
                  }}
                  className="btn-secondary text-xs py-2 px-3"
                >
                  {showChapterForm ? '× Cancel' : '+ Manual'}
                </button>
              </div>

              {/* Textbook upload form */}
              {showTextbookForm && (
                <UploadForm
                  title="Upload full textbook PDF"
                  onCancel={() => setShowTextbookForm(false)}
                  error={textbookUploadError}
                  onSubmit={handleTextbookUpload}
                  submitLabel="Detect chapters"
                  submitting={textbookUploading}
                >
                  <div>
                    <label className="form-label">Textbook PDF <span className="text-rose-400">*</span></label>
                    <input
                      ref={textbookFileRef}
                      type="file"
                      accept="application/pdf"
                      onChange={e => setTextbookFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-xs text-slate-600 file:mr-2 file:py-1 file:px-2.5 file:rounded-card-inner file:border-0 file:text-xs file:bg-surface-100 file:text-slate-700 hover:file:bg-surface-200 file:font-medium file:transition-colors"
                    />
                  </div>
                  <div>
                    <label className="form-label">Subject <span className="text-rose-400">*</span></label>
                    <input
                      type="text"
                      value={textbookSubject}
                      onChange={e => setTextbookSubject(e.target.value)}
                      placeholder="e.g. Social Science"
                      className="form-input"
                    />
                  </div>
                </UploadForm>
              )}

              {/* Manual chapter form */}
              {showChapterForm && (
                <UploadForm
                  title="Add chapter manually"
                  onCancel={() => setShowChapterForm(false)}
                  error={chapterUploadError}
                  onSubmit={handleChapterUpload}
                  submitLabel="Save chapter"
                  submitting={uploadingChapter}
                >
                  <div>
                    <label className="form-label">Chapter PDF</label>
                    <input
                      ref={chapterFileRef}
                      type="file"
                      accept="application/pdf"
                      onChange={e => setChapterFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-xs text-slate-600 file:mr-2 file:py-1 file:px-2.5 file:rounded-card-inner file:border-0 file:text-xs file:bg-surface-100 file:text-slate-700 hover:file:bg-surface-200 file:font-medium"
                    />
                  </div>
                  <div>
                    <label className="form-label">Subject</label>
                    <input
                      type="text"
                      value={chapterForm.subject}
                      onChange={e => setChapterForm(f => ({ ...f, subject: e.target.value }))}
                      placeholder="e.g. Social Science"
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="form-label">Chapter name <span className="text-rose-400">*</span></label>
                    <input
                      type="text"
                      value={chapterForm.chapterName}
                      onChange={e => setChapterForm(f => ({ ...f, chapterName: e.target.value }))}
                      placeholder="e.g. The Rise of Nationalism"
                      className="form-input"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="form-label">Chapter #</label>
                      <input
                        type="number" min="1"
                        value={chapterForm.chapterNumber}
                        onChange={e => setChapterForm(f => ({ ...f, chapterNumber: e.target.value }))}
                        placeholder="1"
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">Weight %</label>
                      <input
                        type="number" min="0" max="100"
                        value={chapterForm.weightPercent}
                        onChange={e => setChapterForm(f => ({ ...f, weightPercent: e.target.value }))}
                        placeholder="10"
                        className="form-input"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">
                      High-value snippets
                      <span className="ml-1 text-slate-400 font-normal">(optional, one per line)</span>
                    </label>
                    <textarea
                      value={chapterForm.highValueSnippets}
                      onChange={e => setChapterForm(f => ({ ...f, highValueSnippets: e.target.value }))}
                      rows={2}
                      placeholder="Paste key definitions or paragraphs…"
                      className="form-input resize-none"
                    />
                  </div>
                </UploadForm>
              )}

              <Divider />

              {/* Chapter list */}
              {chaptersLoading ? (
                <div className="flex items-center gap-2 py-4 text-slate-400">
                  <Spinner /> <span className="text-xs">Loading…</span>
                </div>
              ) : chapters.length === 0 ? (
                <p className="text-xs text-slate-400 py-2 text-center">
                  No chapters yet. Add one to enable chapter-aware generation.
                </p>
              ) : (
                <>
                  {/* Prompt to re-scan existing chapters that predate figure detection */}
                  {chapters.some(c => c.figurePageCount === 0) && (
                    <div className="rounded-card-inner bg-purple-50 border border-purple-200 p-2.5 text-2xs text-purple-700 leading-relaxed">
                      <p className="font-semibold mb-1">Enable Figure Based questions</p>
                      <p>
                        Chapters uploaded before figure detection was added need a one-time re-scan.
                        Click the <span className="font-semibold">image icon</span> next to each chapter and select its PDF.
                        New uploads are detected automatically.
                      </p>
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {chapters.map(ch => (
                      <SidebarChapterRow
                        key={ch._id}
                        chapter={ch}
                        isDeleting={deletingChapterId === ch._id}
                        isScanning={scanningChapterId === ch._id}
                        onDelete={() => handleDeleteChapter(ch._id)}
                        onScanFigures={f => handleScanFigures(ch._id, f)}
                      />
                    ))}
                  </div>
                  {!weightOk && (
                    <InlineAlert variant="warning">
                      Weights sum to <strong>{totalWeight}%</strong> — ideally 100%.
                      Generation still works; weights are normalised automatically.
                    </InlineAlert>
                  )}
                </>
              )}
            </div>
          </Card>

          {/* ── My Reference Banks ────────────────────────────────────────── */}
          <Card>
            <CardHeader
              title="Reference Banks"
              subtitle="Past papers for style guidance"
              icon={<Icons.Archive />}
              action={
                <button
                  onClick={() => { setShowBankForm(v => !v); setBankUploadError(null); }}
                  className={`text-2xs font-semibold flex items-center gap-1 transition-colors ${
                    showBankForm
                      ? 'text-slate-400 hover:text-slate-600'
                      : 'text-accent-600 hover:text-accent-700'
                  }`}
                >
                  {showBankForm ? '× Cancel' : <><Icons.Plus /> Add paper</>}
                </button>
              }
            />
            <div className="p-3 space-y-2">
              {showBankForm && (
                <UploadForm
                  title="Upload past paper"
                  onCancel={() => setShowBankForm(false)}
                  error={bankUploadError}
                  onSubmit={handleBankUpload}
                  submitLabel="Save to bank"
                  submitting={uploadingBank}
                >
                  <div>
                    <label className="form-label">Paper PDF</label>
                    <input
                      ref={bankFileRef}
                      type="file"
                      accept="application/pdf"
                      onChange={e => setBankFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-xs text-slate-600 file:mr-2 file:py-1 file:px-2.5 file:rounded-card-inner file:border-0 file:text-xs file:bg-surface-100 file:text-slate-700 hover:file:bg-surface-200 file:font-medium"
                    />
                  </div>
                  <div>
                    <label className="form-label">Bank label <span className="text-rose-400">*</span></label>
                    <input
                      type="text"
                      value={bankForm.bankId}
                      onChange={e => setBankForm(f => ({ ...f, bankId: e.target.value }))}
                      placeholder="e.g. CBSE-2024"
                      className="form-input"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="form-label">Subject</label>
                      <input
                        type="text"
                        value={bankForm.subject}
                        onChange={e => setBankForm(f => ({ ...f, subject: e.target.value }))}
                        placeholder="Social"
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">Year</label>
                      <input
                        type="number" min="1900" max="2100"
                        value={bankForm.sourceYear}
                        onChange={e => setBankForm(f => ({ ...f, sourceYear: e.target.value }))}
                        placeholder="2024"
                        className="form-input"
                      />
                    </div>
                  </div>
                </UploadForm>
              )}

              {banksLoading ? (
                <div className="flex items-center gap-2 py-4 text-slate-400">
                  <Spinner /> <span className="text-xs">Loading…</span>
                </div>
              ) : banks.length === 0 && !showBankForm ? (
                <EmptyState
                  icon={<Icons.Archive />}
                  title="No past papers"
                  description="Upload board exam papers to improve question style matching."
                  action={
                    <button
                      onClick={() => { setShowBankForm(true); setBankUploadError(null); }}
                      className="btn-secondary text-xs py-1.5 px-3"
                    >
                      <Icons.Plus /> Add past paper
                    </button>
                  }
                />
              ) : (
                <div className="space-y-0.5">
                  {banks.map(bank => (
                    <BankRow
                      key={bank.id}
                      bank={bank}
                      isDeleting={deletingBankId === bank.id}
                      onDelete={() => handleDeleteBank(bank.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </Card>

        </aside>
      </div>

      {/* ── Toast notification ───────────────────────────────────────────────── */}
      {regenToast && (
        <div
          role="status"
          aria-live="polite"
          className={[
            'fixed bottom-6 right-6 z-50 rounded-card px-4 py-3 text-sm font-medium shadow-card-md transition-all duration-200',
            regenToast.ok
              ? 'bg-emerald-600 text-white'
              : 'bg-rose-600 text-white',
          ].join(' ')}
        >
          {regenToast.msg}
        </div>
      )}
    </div>
  );
}

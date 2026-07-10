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
import type { Scheme, TypeConfig, ChapterInfo, ReferenceBank, PaperStructure, QuestionSetSummary, SetStatus } from '../types';

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

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<SetStatus, string> = {
  draft:              'Draft',
  generating:         'Generating',
  review_pending:     'Pending Review',
  revision_requested: 'Revision Requested',
  approved:           'Approved',
  archived:           'Archived',
};

const STATUS_COLOURS: Record<SetStatus, string> = {
  draft:              'bg-slate-100 text-slate-600',
  generating:         'bg-blue-100 text-blue-700',
  review_pending:     'bg-amber-100 text-amber-700',
  revision_requested: 'bg-orange-100 text-orange-700',
  approved:           'bg-emerald-100 text-emerald-700',
  archived:           'bg-slate-100 text-slate-400',
};

function StatusBadge({ status }: { status: SetStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-2xs font-semibold ${STATUS_COLOURS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Generic collapsible card ──────────────────────────────────────────────────

function CollapsibleCard({
  title, subtitle, icon, children,
}: {
  title:     string;
  subtitle?: string;
  icon:      React.ReactNode;
  children:  React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-card border border-surface-200 bg-white shadow-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-50 transition-colors"
      >
        {icon}
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-slate-800 leading-tight">{title}</p>
          {subtitle && <p className="text-2xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="border-t border-surface-100">{children}</div>}
    </div>
  );
}

// ── My Schemes collapsible card ───────────────────────────────────────────────

function SchemesCard({
  schemes, loading, activeSchemeId, replacing, deleting, deleteTarget,
  replaceInputRef, onReplaceFile, onUse, onReplace, onDeleteClick, onDeleteConfirm, onDeleteCancel,
}: {
  schemes:         Scheme[];
  loading:         boolean;
  activeSchemeId:  string | null;
  replacing:       boolean;
  deleting:        boolean;
  deleteTarget:    string | null;
  replaceInputRef: React.RefObject<HTMLInputElement>;
  onReplaceFile:   (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUse:           (scheme: Scheme) => void;
  onReplace:       (schemeId: string) => void;
  onDeleteClick:   (schemeId: string) => void;
  onDeleteConfirm: () => void;
  onDeleteCancel:  () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-card border border-surface-200 bg-white shadow-card overflow-hidden">
      {/* Hidden replace input — must stay in DOM regardless of open state */}
      <input
        ref={replaceInputRef}
        type="file"
        accept=".pdf,.docx"
        className="hidden"
        onChange={onReplaceFile}
      />

      {/* Header — click to toggle */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-50 transition-colors"
      >
        <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-slate-800 leading-tight">My Schemes</p>
          {!loading && schemes.length > 0 && (
            <p className="text-2xs text-slate-400 mt-0.5">{schemes.length} scheme{schemes.length !== 1 ? 's' : ''}</p>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="border-t border-surface-100">
          <div className="p-3 space-y-2">
            {loading ? (
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
                    isReplacing={replacing && deleteTarget === scheme.schemeId}
                    deleteTarget={deleteTarget}
                    onUse={() => onUse(scheme)}
                    onReplace={() => onReplace(scheme.schemeId)}
                    onDeleteClick={() => onDeleteClick(scheme.schemeId)}
                    onDeleteConfirm={onDeleteConfirm}
                    onDeleteCancel={onDeleteCancel}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── My Sets collapsible card ──────────────────────────────────────────────────

function MySetsCard({
  sets,
  loading,
  activeSetId,
  onRename,
}: {
  sets:        QuestionSetSummary[];
  loading:     boolean;
  activeSetId: string | null;
  onRename:    (id: string, newName: string) => Promise<void>;
}) {
  const [open, setOpen]           = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving]       = useState(false);
  const inputRef                  = useRef<HTMLInputElement>(null);

  function startEdit(s: QuestionSetSummary) {
    setEditingId(s.id);
    setEditValue(s.fileName);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  async function commitEdit(id: string) {
    const trimmed = editValue.trim();
    if (!trimmed) { cancelEdit(); return; }
    setSaving(true);
    await onRename(id, trimmed);
    setSaving(false);
    setEditingId(null);
  }

  return (
    <div className="rounded-card border border-surface-200 bg-white shadow-card overflow-hidden">
      {/* Header — click to toggle */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-50 transition-colors"
      >
        <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-slate-800 leading-tight">My Sets</p>
          {!loading && sets.length > 0 && (
            <p className="text-2xs text-slate-400 mt-0.5">{sets.length} set{sets.length !== 1 ? 's' : ''}</p>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="border-t border-surface-100">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
              <Spinner /> <span className="text-xs">Loading…</span>
            </div>
          ) : sets.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6 px-4">
              No sets yet. Generate your first question set.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-surface-100">
              {sets.map(s => (
                <div
                  key={s.id}
                  className={`px-3 py-2.5 transition-colors group ${
                    s.id === activeSetId ? 'bg-accent-50' : 'hover:bg-surface-50'
                  }`}>
                  {editingId === s.id ? (
                    <input
                      ref={inputRef}
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(s.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit(s.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      disabled={saving}
                      className="w-full text-xs font-medium text-slate-800 border border-accent-400 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent-300"
                      autoFocus
                    />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <p className="flex-1 text-xs font-medium text-slate-800 truncate">{s.fileName}</p>
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600"
                        title="Rename"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <StatusBadge status={s.status} />
                    <span className="text-2xs text-slate-400 shrink-0">
                      {s.questionCount}Q · {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {sets.length === 20 && (
            <p className="text-2xs text-slate-400 text-center py-2 border-t border-surface-100">
              Showing 20 most recent sets
            </p>
          )}
        </div>
      )}
    </div>
  );
}

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

// ── Chapter multi-select dropdown ────────────────────────────────────────────

function ChapterDropdown({
  chapters,
  selectedIds,
  disabled,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  chapters:    ChapterInfo[];
  selectedIds: Set<string>;
  disabled:    boolean;
  onToggle:    (id: string) => void;
  onSelectAll: () => void;
  onClearAll:  () => void;
}) {
  const [open,    setOpen]    = useState(false);
  const [touched, setTouched] = useState(false);
  const ref                   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selCount = selectedIds.size;
  const selWeight = chapters.filter(c => selectedIds.has(c._id)).reduce((s, c) => s + c.weightPercent, 0);
  const allZeroWeight = chapters.filter(c => selectedIds.has(c._id)).every(c => c.weightPercent === 0);

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => { if (!disabled) { setOpen(v => !v); setTouched(true); } }}
        disabled={disabled}
        className={[
          'w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm transition-colors',
          open
            ? 'border-accent-400 ring-2 ring-accent-200 bg-white'
            : 'border-surface-300 bg-white hover:border-surface-400',
          disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
        ].join(' ')}
      >
        <span className={selCount === 0 ? 'text-slate-400' : 'text-slate-800 font-medium'}>
          {selCount === 0
            ? 'Select chapters…'
            : `${selCount} chapter${selCount !== 1 ? 's' : ''} selected${selCount > 0 && !allZeroWeight ? ` · ${selWeight}% weight` : ''}`}
        </span>
        <svg
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-20 mt-1.5 w-full rounded-xl border border-surface-200 bg-white shadow-card-md overflow-hidden">
          {/* Header actions */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-surface-100 bg-surface-50">
            <span className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">
              {chapters.length} chapter{chapters.length !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-3">
              {selCount > 0 && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="text-2xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={onSelectAll}
                className="text-2xs text-accent-600 hover:text-accent-700 font-medium transition-colors"
              >
                Select all
              </button>
            </div>
          </div>

          {/* Chapter list */}
          <div className="max-h-56 overflow-y-auto divide-y divide-surface-100">
            {chapters.map(ch => {
              const sel = selectedIds.has(ch._id);
              return (
                <label
                  key={ch._id}
                  className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={sel}
                    onChange={() => onToggle(ch._id)}
                    className="w-4 h-4 rounded accent-indigo-600 shrink-0"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-slate-800 truncate">
                      {ch.chapterNumber}. {ch.chapterName}
                    </span>
                    {ch.subject && (
                      <span className="block text-2xs text-slate-400">{ch.subject}</span>
                    )}
                  </span>
                  {ch.weightPercent > 0 && (
                    <span className={`shrink-0 text-2xs font-semibold px-2 py-0.5 rounded-full tabular-nums ${
                      sel ? 'bg-accent-100 text-accent-700' : 'bg-surface-100 text-slate-500'
                    }`}>
                      {ch.weightPercent}%
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Validation hint — only after user has opened the dropdown */}
      {touched && selCount === 0 && (
        <p className="mt-1.5 text-xs text-amber-600">Select at least one chapter to continue.</p>
      )}
    </div>
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
  onDelete,
}: {
  chapter: ChapterInfo;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-1 py-2 rounded-card-inner hover:bg-surface-50 group transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-700 truncate leading-tight">
          {chapter.chapterNumber}. {chapter.chapterName}
        </p>
        <p className="text-2xs text-slate-400">{chapter.subject} · {chapter.weightPercent}%</p>
      </div>
      <button
        onClick={onDelete}
        disabled={isDeleting}
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
    generate, generatePaper, editQuestion, regenerateType,
  } = useGeneration();
  const {
    setId, typeConfig, results, isGenerating, isRegenerating, exportError,
    difficultyDefault, tone, bankId, activeSchemeId,
    activePaperStructure, filledPaperStructure, isPaperGenerating,
    paperGenerateError, paperStats,
  } = state;

  const isPaperMode = Boolean(activePaperStructure);

  const [regenToast,       setRegenToast]       = useState<{ type: string; ok: boolean; msg: string } | null>(null);
  const [downloadingPaper, setDownloadingPaper] = useState(false);

  // ── My Sets state ────────────────────────────────────────────────────────────
  const [mySets,       setMySets]       = useState<QuestionSetSummary[]>([]);
  const [setsLoading,  setSetsLoading]  = useState(true);
  const [submitting,   setSubmitting]   = useState(false);
  const [submitted,    setSubmitted]    = useState(false);

  async function loadMySets() {
    try {
      const res  = await apiFetch('/api/sets');
      if (!res.ok) return;
      const data = await res.json() as { sets: QuestionSetSummary[] };
      setMySets(data.sets ?? []);
    } catch {
      /* ignore */
    } finally {
      setSetsLoading(false);
    }
  }

  useEffect(() => { loadMySets(); }, []);
  useEffect(() => { setSubmitted(false); }, [setId]);

  async function handleRename(id: string, newName: string) {
    try {
      const res = await apiFetch(`/api/sets/${id}/rename`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: newName }),
      });
      if (res.ok) {
        setMySets(prev => prev.map(s => s.id === id ? { ...s, fileName: newName } : s));
      }
    } catch {
      /* ignore — input reverts on blur */
    }
  }

  async function handleSubmitForReview() {
    if (!setId) return;
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/sets/${setId}/submit`, { method: 'POST' });
      const body = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) {
        showToast('submit', false, body.error ?? 'Submission failed.');
      } else {
        setSubmitted(true);
        showToast('submit', true, 'Submitted for HOD review.');
        await loadMySets();
      }
    } catch {
      showToast('submit', false, 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  }

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
  const [subjectFilter,      setSubjectFilter]      = useState<string>('All');

  const subjects = ['All', ...Array.from(new Set(chapters.map(c => c.subject).filter(Boolean)))];
  const filteredChapters = subjectFilter === 'All'
    ? chapters
    : chapters.filter(c => c.subject === subjectFilter);

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
      if (sel.has(id)) {
        const n = new Set(sel);
        n.delete(id);
        return n;
      }
      // Enforce single subject — if the new chapter's subject differs from
      // already-selected chapters, clear the old selection first.
      const incomingSubject = chapters.find(c => c._id === id)?.subject;
      const existingSubject = chapters.find(c => sel.has(c._id))?.subject;
      if (incomingSubject && existingSubject && incomingSubject !== existingSubject) {
        return new Set([id]);
      }
      return new Set([...sel, id]);
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
              {chaptersLoading ? (
                <div className="flex items-center gap-2.5 text-slate-400 py-2">
                  <Spinner /> <span className="text-sm">Loading chapters…</span>
                </div>
              ) : chapters.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<Icons.BookOpen />}
                    title="No chapters yet"
                    description="Upload a textbook PDF from the sidebar to auto-detect chapters."
                  />
                </Card>
              ) : (
                <div className="space-y-2">
                  {/* Subject filter pills */}
                  {subjects.length > 2 && (
                    <div className="flex flex-wrap gap-1.5">
                      {subjects.map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSubjectFilter(s)}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            subjectFilter === s
                              ? 'bg-accent-600 text-white'
                              : 'bg-surface-100 text-slate-600 hover:bg-surface-200'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  <ChapterDropdown
                    chapters={filteredChapters}
                    selectedIds={selectedChapterIds}
                    disabled={isGenerating}
                    onToggle={toggleChapter}
                    onSelectAll={() => setSelectedChapterIds(new Set(filteredChapters.map(c => c._id)))}
                    onClearAll={() => {
                      const filteredIds = new Set(filteredChapters.map(c => c._id));
                      setSelectedChapterIds(prev => new Set([...prev].filter(id => !filteredIds.has(id))));
                    }}
                  />
                </div>
              )}
            </SectionStep>

            {/* "What comes next" hint — shown only before any chapters are selected */}
            {!chaptersLoading && chapters.length > 0 && selectedChapterIds.size === 0 && (
              <div className="rounded-xl border border-dashed border-surface-300 bg-surface-50 px-5 py-6">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">What happens next</p>
                <ol className="space-y-2.5">
                  {[
                    { step: '2', text: 'Pick a question paper scheme (or skip to configure manually)' },
                    { step: '3', text: 'Choose question types, counts, and marks per question' },
                    { step: '4', text: 'Generate — the AI creates questions from your selected chapters' },
                    { step: '5', text: 'Review, edit, and submit to your HOD for approval' },
                  ].map(s => (
                    <li key={s.step} className="flex items-start gap-3">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-surface-200 text-slate-500 text-2xs font-bold flex items-center justify-center mt-0.5">
                        {s.step}
                      </span>
                      <span className="text-sm text-slate-500">{s.text}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

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

                {/* Submit for HOD review */}
                <div className="mt-4 flex items-center gap-3">
                  {submitted ? (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700 font-medium w-full">
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Submitted for HOD review
                    </div>
                  ) : (
                    <button
                      onClick={handleSubmitForReview}
                      disabled={submitting || isGenerating}
                      className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors ${
                        submitting || isGenerating
                          ? 'bg-surface-200 text-slate-400 cursor-not-allowed'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {submitting ? <><Spinner className="w-4 h-4" /> Submitting…</> : 'Submit for HOD Review'}
                    </button>
                  )}
                </div>
              </SectionStep>
            )}
          </>}
        </main>

        {/* ═══════════════════════════════════════════════════════════════════
            RIGHT: sidebar
        ═══════════════════════════════════════════════════════════════════ */}
        <aside className="space-y-4 lg:sticky lg:top-[7.5rem]">

          {/* ── My Sets ───────────────────────────────────────────────────── */}
          <MySetsCard
            sets={mySets}
            loading={setsLoading}
            activeSetId={setId}
            onRename={handleRename}
          />

          {/* ── My Schemes ────────────────────────────────────────────────── */}
          <SchemesCard
            schemes={schemes}
            loading={schemesLoading}
            activeSchemeId={activeSchemeId}
            replacing={replacing}
            deleting={deleting}
            deleteTarget={deleteTarget}
            replaceInputRef={replaceInputRef}
            onReplaceFile={handleReplaceFile}
            onUse={handleUseScheme}
            onReplace={(schemeId) => { setReplaceTarget(schemeId); replaceInputRef.current?.click(); }}
            onDeleteClick={setDeleteTarget}
            onDeleteConfirm={handleDeleteScheme}
            onDeleteCancel={() => setDeleteTarget(null)}
          />

          {/* ── My Chapters ───────────────────────────────────────────────── */}
          <CollapsibleCard
            title="My Chapters"
            subtitle={!chaptersLoading && chapters.length > 0 ? `${chapters.length} chapter${chapters.length !== 1 ? 's' : ''}` : undefined}
            icon={
              <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            }
          >
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
                  <div className="max-h-48 overflow-y-auto space-y-0.5">
                    {chapters.map(ch => (
                      <SidebarChapterRow
                        key={ch._id}
                        chapter={ch}
                        isDeleting={deletingChapterId === ch._id}
                        onDelete={() => handleDeleteChapter(ch._id)}
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
          </CollapsibleCard>

          {/* ── My Reference Banks ────────────────────────────────────────── */}
          <CollapsibleCard
            title="Reference Banks"
            subtitle={!banksLoading && banks.length > 0 ? `${banks.length} paper${banks.length !== 1 ? 's' : ''}` : 'Past papers for style guidance'}
            icon={
              <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            }
          >
            <div className="p-3 space-y-2">
              <button
                onClick={() => { setShowBankForm(v => !v); setBankUploadError(null); }}
                className={`w-full rounded-card-inner py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  showBankForm
                    ? 'bg-surface-100 text-slate-600 border border-surface-200'
                    : 'bg-accent-600 text-white hover:bg-accent-700'
                }`}
              >
                {showBankForm ? '× Cancel' : <><Icons.Upload /> Add past paper</>}
              </button>
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
          </CollapsibleCard>

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

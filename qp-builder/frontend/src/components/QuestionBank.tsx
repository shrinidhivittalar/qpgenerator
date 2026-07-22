import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { TYPE_LABELS, TYPE_COLORS } from '../types'
import type { BankQuestion, QuestionType } from '../types'
import { BankCard } from './BankCard'

type SortBy = 'number' | 'type'

const TYPE_SORT_ORDER: Record<string, number> = {
  mcq: 0, text: 1, figure_based: 2, table_based: 3, multi_part: 4,
  analogy: 5, grammar: 6, comprehension: 7, essay: 8, letter: 9,
}

// All known types in display order — used to build the type filter dynamically
const ALL_TYPES: QuestionType[] = [
  'mcq', 'text', 'figure_based', 'table_based', 'multi_part',
  'analogy', 'grammar', 'comprehension', 'essay', 'letter',
]

const STATIC_SOURCE_LABELS: Record<string, string> = {
  qp:               'Question Paper',
  textbook:         'Textbook',
  yashassu_science: 'Yashassu Science',
  yashassu_maths:   'Yashassu Maths',
  yashassu_english: 'Yashassu English',
}

interface Props {
  subjectMap:      Record<string, Record<string, number>>
  uploadedSources: Record<string, { name: string; count: number }>
  sourceLabels:    Record<string, string>    // id -> custom name (uploads + merged)
  subject:         string
  setSubject:      (val: string) => void     // may receive '__up__<id>' virtual key
  source:          string
  setSource:       (s: string) => void
  lockedSubject:   string | null
  onNewPaper:      () => void
  questions:       BankQuestion[]
  allQuestions:    BankQuestion[]
  search:          string
  setSearch:       (s: string) => void
  typeFilter:      string
  setTypeFilter:   (t: string) => void
  paperQids:       Set<string>
  onToggle:        (q: BankQuestion) => void
  loading:              boolean
  bankError:            string | null
  uploading:            boolean
  uploadError:          string | null
  onUpload:             (file: File, paperType: string) => void
  onRenameUpload:       (id: string, name: string) => void
  onDeleteSource:       (subject: string, source: string) => void
  onDeleteBankQuestion: (qid: string) => void
  onEditBankQuestion:   (qid: string, text: string, type: QuestionType) => void
  similarityMap:        Record<string, number>
  crossSourceMap:       Record<string, { sim: number; src: string }>
}

export function QuestionBank({
  subjectMap, uploadedSources, sourceLabels,
  subject, setSubject, source, setSource,
  lockedSubject, onNewPaper,
  questions, allQuestions, search, setSearch, typeFilter, setTypeFilter,
  paperQids, onToggle, loading, bankError,
  uploading, uploadError, onUpload, onRenameUpload, onDeleteSource,
  onDeleteBankQuestion, onEditBankQuestion,
  similarityMap, crossSourceMap,
}: Props) {
  const fileInputRef    = useRef<HTMLInputElement>(null)
  const renameInputRef  = useRef<HTMLInputElement>(null)
  const [paperType, setPaperType] = useState('sslc_qp')


  // ── Inline rename for currently-viewed upload ─────────────────────────
  const [renamingUpload, setRenamingUpload] = useState(false)
  const [renameDraft,    setRenameDraft]    = useState('')

  const startRename = useCallback(() => {
    const current = uploadedSources[source]?.name ?? source
    setRenameDraft(current)
    setRenamingUpload(true)
    setTimeout(() => renameInputRef.current?.select(), 0)
  }, [source, uploadedSources])

  const commitRename = useCallback(() => {
    if (renameDraft.trim()) onRenameUpload(source, renameDraft.trim())
    setRenamingUpload(false)
  }, [source, renameDraft, onRenameUpload])

  // Close rename on subject/source change
  useEffect(() => { setRenamingUpload(false) }, [subject, source])

  const staticSubjects = Object.keys(subjectMap)
  const uploadEntries  = Object.entries(uploadedSources)

  // Dropdown value: use '__up__<id>' virtual key when an upload is active
  const dropdownValue  = subject === 'uploaded' ? `__up__${source}` : subject

  const sources    = Object.keys(subjectMap[subject] ?? {})
  const isTextbook = source === 'textbook'
  const isUploaded = subject === 'uploaded'
  const hasChapters = allQuestions.some(q => q.chapter_num != null)

  // ── Sort ──────────────────────────────────────────────────────────────
  const [sortBy, setSortBy] = useState<SortBy>('number')
  useEffect(() => { setSortBy('number') }, [source, subject])

  // ── Chapter filter ────────────────────────────────────────────────────
  const [chapterFilter, setChapterFilter] = useState('all')
  useEffect(() => { setChapterFilter('all') }, [source, subject])

  const chapters = useMemo(() => {
    if (!hasChapters) return []
    const seen = new Map<string, number>()
    for (const q of allQuestions) {
      if (q.chapter && q.chapter_num != null && !seen.has(q.chapter)) {
        seen.set(q.chapter, q.chapter_num ?? 0)
      }
    }
    return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([ch]) => ch)
  }, [allQuestions, hasChapters])

  const filteredQuestions = useMemo(() => {
    if (!hasChapters || chapterFilter === 'all') return questions
    return questions.filter(q => q.chapter === chapterFilter)
  }, [questions, chapterFilter, hasChapters])

  const visibleQuestions = useMemo(() => {
    if (sortBy === 'type') {
      return [...filteredQuestions].sort(
        (a, b) => (TYPE_SORT_ORDER[a.type] ?? 5) - (TYPE_SORT_ORDER[b.type] ?? 5)
      )
    }
    return [...filteredQuestions].sort((a, b) => a.number - b.number)
  }, [filteredQuestions, sortBy])

  // Build type filter list dynamically from what's actually in the bank
  const allowedTypes = useMemo(() => {
    const inBank = new Set(allQuestions.map(q => q.type))
    return ALL_TYPES.filter(t => inBank.has(t))
  }, [allQuestions])

  const typeCounts = useMemo(() => Object.fromEntries(
    allowedTypes.map(t => [t, allQuestions.filter(q => q.type === t).length])
  ), [allQuestions, allowedTypes])

  const isLocked = !!lockedSubject && lockedSubject !== subject

  // Label for a source tab (merged uploads show custom name; standard sources use static label)
  const srcLabel = (src: string) =>
    sourceLabels[src] ?? STATIC_SOURCE_LABELS[src] ?? src

  return (
    <aside className="flex flex-col w-2/5 border-r border-gray-200 bg-white overflow-hidden">

      {/* ── Subject dropdown ──────────────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-0 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs font-semibold text-gray-500 whitespace-nowrap">Subject:</label>

          <select
            value={dropdownValue}
            onChange={e => setSubject(e.target.value)}
            className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white
                       focus:outline-none focus:ring-2 focus:ring-indigo-400 capitalize"
          >
            {/* Static subjects (science, maths, …) */}
            {staticSubjects.map(s => (
              <option key={s} value={s} className="capitalize">
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}

            {/* Each uploaded paper as its own flat option */}
            {uploadEntries.map(([id, info]) => (
              <option key={`__up__${id}`} value={`__up__${id}`}>
                {info.name}
              </option>
            ))}
          </select>

          {/* Rename button — uploaded papers only */}
          {isUploaded && !renamingUpload && (
            <button
              onClick={startRename}
              title="Rename this uploaded paper"
              className="shrink-0 px-2 py-1.5 text-xs rounded-md border border-gray-300
                         text-gray-500 hover:bg-gray-100 transition"
            >
              Rename
            </button>
          )}

          {/* Delete button — all sources (uploaded + static) */}
          {!renamingUpload && (
            <button
              onClick={() => {
                const label = isUploaded
                  ? 'this uploaded paper and all its questions'
                  : `all ${subject} / ${srcLabel(source)} questions`
                if (window.confirm(`Delete ${label}? This cannot be undone.`)) {
                  onDeleteSource(subject, source)
                }
              }}
              title="Delete this source"
              className="shrink-0 px-2 py-1.5 text-xs rounded-md border border-red-200
                         text-red-500 hover:bg-red-50 transition"
            >
              Delete
            </button>
          )}

          {/* Paper type hint for upload */}
          <select
            value={paperType}
            onChange={e => setPaperType(e.target.value)}
            disabled={uploading}
            title="Paper type helps the AI parse correctly"
            className="shrink-0 px-2 py-1.5 text-xs border border-gray-300 rounded-md bg-white
                       focus:outline-none focus:ring-2 focus:ring-indigo-400
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="sslc_qp">SSLC QP</option>
            <option value="textbook">Textbook</option>
            <option value="generic">Other</option>
          </select>

          {/* Upload PDF button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Upload a question paper PDF to parse with AI"
            className="shrink-0 px-2.5 py-1.5 text-xs font-medium rounded-md bg-indigo-50
                       text-indigo-700 border border-indigo-200 hover:bg-indigo-100
                       disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {uploading ? 'Parsing...' : '+ Upload PDF'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) { onUpload(f, paperType); e.target.value = '' }
            }}
          />
        </div>

        {/* Inline rename field (shown when renaming an upload) */}
        {isUploaded && renamingUpload && (
          <div className="flex items-center gap-2 mb-2">
            <input
              ref={renameInputRef}
              value={renameDraft}
              onChange={e => setRenameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setRenamingUpload(false)
              }}
              placeholder="New name..."
              className="flex-1 px-3 py-1.5 text-sm border border-indigo-400 rounded-md
                         focus:outline-none focus:ring-2 focus:ring-indigo-400"
              autoFocus
            />
            <button
              onClick={commitRename}
              className="shrink-0 px-3 py-1.5 text-xs rounded-md bg-indigo-600 text-white
                         hover:bg-indigo-700 transition"
            >
              Save
            </button>
            <button
              onClick={() => setRenamingUpload(false)}
              className="shrink-0 text-gray-400 hover:text-gray-600 text-xs"
            >
              ✕
            </button>
          </div>
        )}

        {/* Upload progress / error */}
        {uploading && (
          <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-md bg-indigo-50 text-indigo-700 text-xs">
            <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Parsing with AI — this may take 10–20 seconds...
          </div>
        )}
        {uploadError && !uploading && (
          <div className="px-3 py-2 mb-2 rounded-md bg-red-50 text-red-700 text-xs border border-red-200">
            {uploadError}
          </div>
        )}

        {/* Source tabs — only for non-uploaded subjects (incl. merged upload sources) */}
        {!isUploaded && sources.length > 1 && (
          <div className="flex border-b border-gray-200 overflow-x-auto">
            {sources.map(src => (
              <button
                key={src}
                onClick={() => setSource(src)}
                className={`shrink-0 flex-1 py-2 text-xs font-medium transition whitespace-nowrap
                  ${source === src
                    ? 'border-b-2 border-indigo-600 text-indigo-600'
                    : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                {srcLabel(src)}
                <span className="ml-1 text-[10px] text-gray-400">
                  ({subjectMap[subject]?.[src] ?? 0})
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Lock banner ─────────────────────────────────────────────────── */}
      {isLocked && (
        <div className="mx-3 mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 shrink-0">
          <p className="font-semibold mb-1">
            Paper is locked to <span className="capitalize">{lockedSubject}</span>
          </p>
          <p className="mb-2 text-amber-700">
            Remove all <span className="capitalize font-medium">{lockedSubject}</span> questions
            first, or open a separate paper editor.
          </p>
          <button
            onClick={onNewPaper}
            className="px-3 py-1 rounded-md bg-amber-600 text-white font-medium hover:bg-amber-700 transition"
          >
            + New paper
          </button>
        </div>
      )}

      {/* ── Chapter filter ───────────────────────────────────────────────── */}
      {hasChapters && chapters.length > 0 && (
        <div className="px-3 pt-3 pb-1 shrink-0">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-500 whitespace-nowrap">Chapter:</label>
            <select
              value={chapterFilter}
              onChange={e => setChapterFilter(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-md bg-white
                         focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="all">All chapters ({allQuestions.length})</option>
              {chapters.map(ch => {
                const count = allQuestions.filter(q => q.chapter === ch).length
                return <option key={ch} value={ch}>{ch} ({count})</option>
              })}
            </select>
          </div>
        </div>
      )}

      {/* ── Search + Sort ────────────────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-2 shrink-0 flex gap-2">
        <input
          type="text"
          placeholder={
            isUploaded
              ? `Search "${uploadedSources[source]?.name ?? 'uploaded'}" questions...`
              : `Search ${srcLabel(source)} questions...`
          }
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md
                     focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortBy)}
          title="Sort questions"
          className="shrink-0 px-2 py-2 text-xs border border-gray-300 rounded-md bg-white
                     focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="number">No. ↑</option>
          <option value="type">Type</option>
        </select>
      </div>

      {/* ── Type filter pills ────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5 px-3 pb-3 shrink-0">
        <button
          onClick={() => setTypeFilter('all')}
          className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition
            ${typeFilter === 'all'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
        >
          All ({allQuestions.length})
        </button>
        {allowedTypes.filter(t => typeCounts[t] > 0).map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition
              ${typeFilter === t
                ? 'bg-indigo-600 text-white'
                : `${TYPE_COLORS[t]} hover:opacity-80`
              }`}
          >
            {TYPE_LABELS[t]} ({typeCounts[t]})
          </button>
        ))}
      </div>

      {/* ── Question list ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            Loading questions...
          </div>
        ) : bankError ? (
          <div className="mx-1 mt-2 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
            {bankError}
          </div>
        ) : visibleQuestions.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            No questions match.
          </div>
        ) : (
          <ul className="space-y-2">
            {visibleQuestions.map(q => (
              <BankCard
                key={q.qid}
                question={q}
                subject={subject}
                source={source}
                sourceLabels={sourceLabels}
                added={paperQids.has(`${subject}:${source}:${q.qid}`)}
                locked={isLocked}
                paperSimilarity={similarityMap[q.qid] ?? 0}
                crossSimilarity={crossSourceMap[q.qid] ?? null}
                onToggle={() => onToggle(q)}
                onDeleteQuestion={isUploaded ? () => onDeleteBankQuestion(q.qid) : undefined}
                onEditQuestion={isUploaded ? (text, type) => onEditBankQuestion(q.qid, text, type) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

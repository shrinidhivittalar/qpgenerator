import { useMemo } from 'react'
import type { PaperTab } from '../types'

interface Props {
  subjectMap:      Record<string, Record<string, number>>
  uploadedSources: Record<string, { name: string; count: number }>
  papers:          PaperTab[]
  onBrowseAndBuild:          () => void
  onUploadBank:              () => void
  onGenerateFromBlueprint:   () => void
  onOpenPaper:               (id: string) => void
}

const SUBJECT_LABELS: Record<string, string> = {
  science: 'Science',
  maths:   'Mathematics',
  social:  'Social Science',
  english: 'English',
  kannada: 'Kannada',
  hindi:   'Hindi',
}

const SOURCE_LABELS: Record<string, string> = {
  qp: 'Question Paper',
  tb: 'Textbook',
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function Dashboard({
  subjectMap,
  uploadedSources,
  papers,
  onBrowseAndBuild,
  onUploadBank,
  onGenerateFromBlueprint,
  onOpenPaper,
}: Props) {
  const totalQuestions = useMemo(() => {
    let n = 0
    for (const srcs of Object.values(subjectMap))
      for (const c of Object.values(srcs)) n += c
    for (const u of Object.values(uploadedSources)) n += u.count
    return n
  }, [subjectMap, uploadedSources])

  const subjectCount  = Object.keys(subjectMap).length
  const activePapers  = papers.filter(p => p.items.length > 0)

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* ── Greeting ──────────────────────────────────────────────────── */}
        <div className="mb-8">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
            {greeting()}
          </p>
          <h1 className="text-2xl font-bold text-slate-800 leading-snug">
            What would you like to do today?
          </h1>
        </div>

        {/* ── Stats row ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3 mb-10">
          {[
            { value: totalQuestions, label: 'Questions in bank',  sub: 'across all subjects' },
            { value: subjectCount,   label: 'Subjects available', sub: 'ready to use'         },
            { value: activePapers.length, label: 'Papers built',  sub: 'this session'         },
          ].map(s => (
            <div
              key={s.label}
              className="bg-white rounded-xl border border-slate-100 px-5 py-4 shadow-sm"
            >
              <div className="font-mono text-3xl font-bold text-slate-800 tabular-nums leading-none mb-1.5">
                {s.value.toLocaleString()}
              </div>
              <div className="text-sm font-medium text-slate-700">{s.label}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Action cards ──────────────────────────────────────────────── */}
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
          Start from
        </p>
        <div className="grid grid-cols-3 gap-3 mb-10">

          {/* Browse & Build */}
          <button
            onClick={onBrowseAndBuild}
            className="group text-left bg-white rounded-xl border border-slate-100 shadow-sm
                       hover:shadow-md hover:border-indigo-200 transition-all duration-150
                       overflow-hidden focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <div className="h-[3px] bg-indigo-600" />
            <div className="p-5">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center mb-4 text-lg"
                   aria-hidden="true">
                🔍
              </div>
              <div className="text-sm font-semibold text-slate-800 mb-1.5">Browse & Build</div>
              <div className="text-xs text-slate-500 leading-relaxed">
                Search the question bank and hand-pick questions for your paper.
              </div>
            </div>
            <div className="px-5 pb-5">
              <span className="text-xs font-semibold text-indigo-600 group-hover:underline">
                Open question bank →
              </span>
            </div>
          </button>

          {/* Upload Bank — disabled while parsing is being refactored */}
          <button
            disabled
            title="Upload parsing is being refactored — coming soon"
            className="group text-left bg-white rounded-xl border border-slate-100 shadow-sm
                       overflow-hidden opacity-50 cursor-not-allowed"
          >
            <div className="h-[3px] bg-amber-300" />
            <div className="p-5">
              <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center mb-4 text-lg"
                   aria-hidden="true">
                📥
              </div>
              <div className="text-sm font-semibold text-slate-800 mb-1.5">Upload Question Bank</div>
              <div className="text-xs text-slate-500 leading-relaxed">
                Add a past paper or question bank PDF to grow your library.
              </div>
            </div>
            <div className="px-5 pb-5">
              <span className="text-xs font-semibold text-amber-400">
                Coming soon →
              </span>
            </div>
          </button>

          {/* Blueprint — coming soon */}
          <button
            onClick={onGenerateFromBlueprint}
            disabled
            className="group text-left bg-white rounded-xl border border-slate-100 shadow-sm
                       opacity-60 cursor-not-allowed overflow-hidden
                       focus-visible:outline-none"
            aria-disabled="true"
          >
            <div className="h-[3px] bg-emerald-500" />
            <div className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center text-lg"
                     aria-hidden="true">
                  📋
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100
                                 text-emerald-700 px-2 py-0.5 rounded-full">
                  Soon
                </span>
              </div>
              <div className="text-sm font-semibold text-slate-800 mb-1.5">
                Generate from Blueprint
              </div>
              <div className="text-xs text-slate-500 leading-relaxed">
                Upload a board blueprint PDF and auto-generate a chapter-wise paper.
              </div>
            </div>
            <div className="px-5 pb-5">
              <span className="text-xs font-semibold text-emerald-600">
                Coming soon
              </span>
            </div>
          </button>

        </div>

        {/* ── Question bank breakdown ────────────────────────────────────── */}
        {(Object.keys(subjectMap).length > 0 || Object.keys(uploadedSources).length > 0) && (
          <>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
              Question bank
            </p>
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden mb-8">
              {Object.entries(subjectMap).map(([subj, srcs], idx, arr) => {
                const total   = Object.values(srcs).reduce((a, b) => a + b, 0)
                const srcList = Object.entries(srcs)
                  .map(([src, n]) => `${SOURCE_LABELS[src] ?? src.toUpperCase()} (${n})`)
                  .join(' · ')
                return (
                  <div
                    key={subj}
                    className={`flex items-center justify-between px-5 py-3.5 ${
                      idx < arr.length - 1 || Object.keys(uploadedSources).length > 0
                        ? 'border-b border-slate-50'
                        : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-slate-700 capitalize">
                        {SUBJECT_LABELS[subj] ?? subj}
                      </span>
                      <span className="ml-2 text-xs text-slate-400 truncate">{srcList}</span>
                    </div>
                    <span className="font-mono text-sm font-semibold text-slate-600 tabular-nums ml-4 shrink-0">
                      {total.toLocaleString()}
                      <span className="font-normal text-slate-400 text-xs"> q</span>
                    </span>
                  </div>
                )
              })}

              {Object.entries(uploadedSources).map(([id, info], idx, arr) => (
                <div
                  key={id}
                  className={`flex items-center justify-between px-5 py-3.5 ${
                    idx < arr.length - 1 ? 'border-b border-slate-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-slate-700 truncate">{info.name}</span>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider
                                     bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">
                      Uploaded
                    </span>
                  </div>
                  <span className="font-mono text-sm font-semibold text-slate-600 tabular-nums ml-4 shrink-0">
                    {info.count.toLocaleString()}
                    <span className="font-normal text-slate-400 text-xs"> q</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Papers in session ─────────────────────────────────────────── */}
        {activePapers.length > 0 && (
          <>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
              Papers in this session
            </p>
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              {activePapers.map((p, idx, arr) => {
                const marks = p.items.reduce((s, i) => s + i.marks, 0)
                return (
                  <button
                    key={p.id}
                    onClick={() => onOpenPaper(p.id)}
                    className={`w-full flex items-center justify-between px-5 py-3.5 text-left
                                hover:bg-slate-50 transition-colors
                                focus-visible:outline-none focus-visible:ring-2
                                focus-visible:ring-indigo-500 focus-visible:ring-inset
                                ${idx < arr.length - 1 ? 'border-b border-slate-50' : ''}`}
                  >
                    <span className="text-sm font-medium text-slate-700">{p.title}</span>
                    <span className="text-xs text-slate-400 ml-4 shrink-0">
                      {p.items.length} questions · {marks} marks
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* ── Empty state — no bank yet ──────────────────────────────────── */}
        {totalQuestions === 0 && (
          <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-xl px-6 py-5">
            <p className="text-sm font-semibold text-indigo-800 mb-1">Your question bank is empty</p>
            <p className="text-xs text-indigo-600 leading-relaxed">
              Upload a past paper PDF using <strong>Upload Question Bank</strong> to get started.
              Questions will be parsed automatically and added to your library.
            </p>
          </div>
        )}

      </div>
    </div>
  )
}

import { useState, useMemo, useRef } from 'react'
import { TYPE_LABELS, MARKS_DEFAULT } from '../types'
import type { BankQuestion, PaperItem, QuestionType } from '../types'
import { parseBlueprint, classifyQuestions } from '../api'
import type { ParsedBlueprint } from '../api'
import { mkUid } from '../utils'

// ── helpers ──────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function chaptersMatch(bankChapter: string | null, bpChapter: string): boolean {
  if (!bankChapter) return false
  const a = bankChapter.toLowerCase().trim()
  const b = bpChapter.toLowerCase().trim()
  if (a === b || a.includes(b) || b.includes(a)) return true
  // Match on the longest significant word in the blueprint chapter
  const key = b.split(/\s+/).filter(w => w.length > 4).sort((x, y) => y.length - x.length)[0]
  return !!key && a.includes(key)
}

function makePaperItem(q: BankQuestion, subject: string, marks: number): PaperItem {
  return { ...q, uid: mkUid(), subject, marks, sectionId: null, isRephrased: false, originalText: q.text }
}

// Imperative verbs that signal an actual question/task (not a formula/definition)
const QUESTION_VERB_RE =
  /\b(find|prove|solve|calculate|show|draw|write|express|determine|evaluate|construct|verify|obtain|derive|discuss|divide|check|state and prove|if\b.*\bthen)\b/i

// Formula / definition / theorem statements that were wrongly ingested as questions
// (e.g. "sin²A = 1 − cos²A", "Euclid's Division Lemma: ...", "A line ... is called a tangent")
function isLikelyQuestion(q: BankQuestion): boolean {
  // MCQs with real options are always questions
  if (q.type === 'mcq' && q.options && q.options.length > 0) return true
  const t = (q.text || '').trim()
  if (!t) return false
  // Explicit question mark → a question
  if (t.includes('?')) return true
  // Imperative task verb → a question ("Find ...", "Prove ...", "Show that ...")
  if (QUESTION_VERB_RE.test(t)) return true
  // Definition patterns ("... is called ...", "... are called ...") → statement
  if (/\bis called\b|\bare called\b|\bis given by\b|\bis defined as\b/i.test(t)) return false
  // Bare formula (contains "=" but no task verb / question mark) → statement
  if (/=/.test(t)) return false
  // Fall back to treating it as a question (be permissive for edge cases)
  return true
}

// Pick questions from bank for one chapter + one mark value.
// Real questions are strongly preferred over formula/definition statements.
function pickForSlot(
  pool:   BankQuestion[],
  used:   Set<string>,
  count:  number,
  marks:  number,
): BankQuestion[] {
  const avail = pool.filter(q => !used.has(q.qid))
  const real  = avail.filter(isLikelyQuestion)
  const junk  = avail.filter(q => !isLikelyQuestion(q))

  const orderByType = (qs: BankQuestion[]) => {
    // For 1-mark prefer MCQ; for higher marks prefer non-MCQ
    const preferred = qs.filter(q => marks === 1 ? q.type === 'mcq' : q.type !== 'mcq')
    const rest      = qs.filter(q => marks === 1 ? q.type !== 'mcq' : q.type === 'mcq')
    return shuffle(preferred).concat(shuffle(rest))
  }

  // real questions first, statements only as a last resort
  const ordered = orderByType(real).concat(orderByType(junk))
  return ordered.slice(0, count)
}

// ── manual-mode types (unchanged) ────────────────────────────────────────────

const SELECTABLE_TYPES: QuestionType[] = ['mcq', 'text', 'figure_based', 'table_based', 'multi_part']

interface ManualRow {
  id:    string
  type:  QuestionType
  marks: number
  count: number
}

// ── props ─────────────────────────────────────────────────────────────────────

interface Props {
  subject:      string
  source:       string
  sourceLabel:  string
  allQuestions: BankQuestion[]
  paperQids:    Set<string>
  onGenerate:   (items: PaperItem[]) => void
  onCancel:     () => void
}

// ── component ─────────────────────────────────────────────────────────────────

type Tab    = 'blueprint' | 'manual'
type Phase  = 'upload' | 'preview'

export function AutoGenerateModal({
  subject, source, sourceLabel, allQuestions, paperQids, onGenerate, onCancel,
}: Props) {
  const [tab,        setTab]        = useState<Tab>('blueprint')
  const [phase,      setPhase]      = useState<Phase>('upload')
  const [parsing,      setParsing]      = useState(false)
  const [classifying,  setClassifying]  = useState(false)
  const [parseErr,     setParseErr]     = useState<string | null>(null)
  const [blueprint,    setBlueprint]    = useState<ParsedBlueprint | null>(null)
  // qid → chapter, populated after classification
  const [chapterMap,   setChapterMap]   = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  // ── manual mode state ──────────────────────────────────────────────────────
  const [manualRows, setManualRows] = useState<ManualRow[]>(() => [
    { id: mkUid(), type: 'mcq',  marks: 1, count: 10 },
    { id: mkUid(), type: 'text', marks: 2, count: 5  },
  ])

  // ── available counts (for manual mode) ────────────────────────────────────
  const availableCounts = useMemo(() => {
    const counts: Partial<Record<QuestionType, number>> = {}
    for (const q of allQuestions) {
      if (!paperQids.has(`${subject}:${source}:${q.qid}`)) {
        counts[q.type] = (counts[q.type] ?? 0) + 1
      }
    }
    return counts
  }, [allQuestions, paperQids, subject, source])

  // bank questions not already in paper
  const availableBank = useMemo(
    () => allQuestions.filter(q => !paperQids.has(`${subject}:${source}:${q.qid}`)),
    [allQuestions, paperQids, subject, source],
  )

  // ── blueprint parsing ──────────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParsing(true)
    setParseErr(null)
    try {
      const result = await parseBlueprint(file)
      setBlueprint(result)
      setChapterMap({})   // reset any prior classification when blueprint changes
      setPhase('preview')
    } catch (err: unknown) {
      setParseErr(err instanceof Error ? err.message : 'Failed to parse blueprint')
    } finally {
      setParsing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ── blueprint generate ─────────────────────────────────────────────────────
  async function handleBlueprintGenerate() {
    if (!blueprint) return

    // Build effective chapter map: start with bank's own chapter field,
    // then overlay with any AI-classified chapters
    let effectiveMap = { ...chapterMap }

    // If some questions still have no chapter (neither in bank nor classified), classify now
    const needClassification = availableBank.filter(
      q => !q.chapter && !effectiveMap[q.qid]
    )

    if (needClassification.length > 0) {
      setClassifying(true)
      try {
        const chapters = blueprint.rows.map(r => r.chapter)
        // Batch so a large bank's response JSON never truncates (~60 per call)
        const BATCH = 60
        for (let i = 0; i < needClassification.length; i += BATCH) {
          const batch = needClassification.slice(i, i + BATCH)
          const classified = await classifyQuestions(
            batch.map(q => ({ qid: q.qid, text: q.text })),
            chapters,
          )
          effectiveMap = { ...effectiveMap, ...classified }
        }
        setChapterMap(effectiveMap)
      } catch {
        // If classification fails, fall back to unfiltered picking
      } finally {
        setClassifying(false)
      }
    }

    // Resolve chapter for a question: bank field → classified map → null
    const getChapter = (q: BankQuestion): string | null =>
      q.chapter ?? effectiveMap[q.qid] ?? null

    const used  = new Set<string>()
    const items: PaperItem[] = []

    for (const row of blueprint.rows) {
      for (const [mStr, count] of Object.entries({
        '1': row.marks_1, '2': row.marks_2, '3': row.marks_3,
        '4': row.marks_4, '5': row.marks_5,
      })) {
        if (!count) continue
        const marks = parseInt(mStr)

        // Pool: questions classified into this chapter
        let pool = availableBank.filter(q => {
          const ch = getChapter(q)
          return ch ? chaptersMatch(ch, row.chapter) : false
        })
        // Fall back to whole bank if not enough
        if (pool.filter(q => !used.has(q.qid)).length < count) {
          pool = availableBank
        }

        const picked = pickForSlot(pool, used, count, marks)
        for (const q of picked) {
          used.add(q.qid)
          items.push(makePaperItem(q, subject, marks))
        }
      }
    }

    onGenerate(items)
  }

  // ── manual generate ────────────────────────────────────────────────────────
  function handleManualGenerate() {
    const pools: Partial<Record<QuestionType, BankQuestion[]>> = {}
    for (const q of availableBank) {
      pools[q.type] = pools[q.type] ?? []
      pools[q.type]!.push(q)
    }
    for (const t of Object.keys(pools) as QuestionType[]) {
      pools[t] = shuffle(pools[t]!)
    }
    const items: PaperItem[] = []
    for (const row of manualRows) {
      const picked = (pools[row.type] ?? []).splice(0, row.count)
      for (const q of picked) {
        items.push(makePaperItem(q, subject, row.marks))
      }
    }
    onGenerate(items)
  }

  // ── manual row helpers ────────────────────────────────────────────────────
  const manualRowErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    for (const row of manualRows) {
      const avail = availableCounts[row.type] ?? 0
      if (row.count < 1)       errors[row.id] = 'Count must be at least 1'
      else if (row.count > avail) errors[row.id] = `Only ${avail} available`
    }
    return errors
  }, [manualRows, availableCounts])

  const manualHasErrors = manualRows.length === 0 || Object.keys(manualRowErrors).length > 0

  // ── blueprint summary ─────────────────────────────────────────────────────
  const bpAvailable = blueprint
    ? (() => {
        const used = new Set<string>()
        let total = 0
        const hasChapters = availableBank.some(q => q.chapter)
        for (const row of blueprint.rows) {
          for (const [mStr, count] of Object.entries({
            '1': row.marks_1, '2': row.marks_2, '3': row.marks_3,
            '4': row.marks_4, '5': row.marks_5,
          })) {
            if (!count) continue
            const marks = parseInt(mStr)
            let pool = hasChapters
              ? availableBank.filter(q => chaptersMatch(q.chapter, row.chapter))
              : availableBank
            if (pool.filter(q => !used.has(q.qid)).length < count) pool = availableBank
            const picked = pickForSlot(pool, used, count, marks)
            picked.forEach(q => used.add(q.qid))
            total += picked.length
          }
        }
        return total
      })()
    : 0

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Auto-Generate Paper</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                From: <span className="font-medium capitalize">{subject}</span>
                {' / '}
                <span className="font-medium">{sourceLabel}</span>
                <span className="text-gray-400 ml-1">({availableBank.length} available)</span>
              </p>
            </div>
            <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3 border-b border-gray-100 -mb-4 pb-0">
            {(['blueprint', 'manual'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-md border border-b-0 transition
                  ${tab === t
                    ? 'bg-gray-50 border-gray-200 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                {t === 'blueprint' ? '✦ Blueprint PDF' : 'Manual'}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Blueprint tab ── */}
          {tab === 'blueprint' && (
            <>
              {phase === 'upload' && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="text-4xl">📄</div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-700">Upload your blueprint PDF</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Chapter-wise marks distribution table (e.g. Karnataka SSLC blueprint)
                    </p>
                  </div>
                  <label className={`cursor-pointer px-5 py-2.5 rounded-lg text-sm font-medium transition
                    ${parsing
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}>
                    {parsing ? 'Parsing…' : 'Choose PDF'}
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      disabled={parsing}
                      onChange={handleFileChange}
                    />
                  </label>
                  {parseErr && (
                    <p className="text-xs text-red-600 text-center max-w-xs">{parseErr}</p>
                  )}
                </div>
              )}

              {phase === 'preview' && blueprint && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Parsed Blueprint
                    </p>
                    <button
                      onClick={() => { setPhase('upload'); setBlueprint(null) }}
                      className="text-xs text-indigo-500 hover:text-indigo-700 transition"
                    >
                      ← Change file
                    </button>
                  </div>

                  {/* Blueprint table */}
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="text-xs min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Chapter</th>
                          {[1,2,3,4,5].map(m => (
                            <th key={m} className="px-2 py-2 text-center text-gray-500 font-medium">
                              {m}M
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {blueprint.rows.map((row, i) => {
                          const total = row.marks_1 + row.marks_2 + row.marks_3 + row.marks_4 + row.marks_5
                          if (!total) return null
                          return (
                            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="px-3 py-1.5 text-gray-700">{row.chapter}</td>
                              {[row.marks_1, row.marks_2, row.marks_3, row.marks_4, row.marks_5].map((c, j) => (
                                <td key={j} className="px-2 py-1.5 text-center text-gray-600">
                                  {c > 0 ? c : <span className="text-gray-300">—</span>}
                                </td>
                              ))}
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot className="bg-indigo-50">
                        <tr>
                          <td className="px-3 py-1.5 text-xs font-semibold text-indigo-700">Total</td>
                          <td colSpan={5} className="px-2 py-1.5 text-xs text-indigo-700 text-center">
                            {blueprint.total_questions} questions · {blueprint.total_marks} marks
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {bpAvailable < blueprint.total_questions && (
                    <p className="text-xs text-amber-600">
                      ⚠ Bank has {availableBank.length} questions — will pick {bpAvailable} (some chapters may have fewer questions than needed)
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Manual tab ── */}
          {tab === 'manual' && (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_72px_72px_28px] gap-2 text-[11px] font-semibold
                              text-gray-400 uppercase tracking-wide px-0.5">
                <span>Question type</span>
                <span className="text-center">Marks ea.</span>
                <span className="text-center">Count</span>
                <span />
              </div>

              {manualRows.map(row => {
                const avail = availableCounts[row.type] ?? 0
                const err   = manualRowErrors[row.id]
                return (
                  <div key={row.id} className="space-y-1">
                    <div className="grid grid-cols-[1fr_72px_72px_28px] gap-2 items-center">
                      <select
                        value={row.type}
                        onChange={e => setManualRows(prev => prev.map(r =>
                          r.id === row.id ? { ...r, type: e.target.value as QuestionType } : r
                        ))}
                        className="px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white
                                   focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      >
                        {SELECTABLE_TYPES
                          .filter(t => (availableCounts[t] ?? 0) > 0 || t === row.type)
                          .map(t => (
                            <option key={t} value={t}>
                              {TYPE_LABELS[t]} ({availableCounts[t] ?? 0})
                            </option>
                          ))}
                      </select>
                      <input
                        type="number" min={1} max={10} value={row.marks}
                        onChange={e => setManualRows(prev => prev.map(r =>
                          r.id === row.id ? { ...r, marks: Math.max(1, parseInt(e.target.value) || 1) } : r
                        ))}
                        className="px-2 py-1.5 text-sm border border-gray-300 rounded-md text-center
                                   focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                      <input
                        type="number" min={1} max={avail || 1} value={row.count}
                        onChange={e => setManualRows(prev => prev.map(r =>
                          r.id === row.id ? { ...r, count: Math.max(1, parseInt(e.target.value) || 1) } : r
                        ))}
                        className={`px-2 py-1.5 text-sm border rounded-md text-center
                                   focus:outline-none focus:ring-2 focus:ring-indigo-400
                                   ${err ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                      />
                      <button
                        onClick={() => setManualRows(prev => prev.filter(r => r.id !== row.id))}
                        disabled={manualRows.length === 1}
                        className="text-gray-300 hover:text-red-400 transition text-xl leading-none
                                   disabled:opacity-30 disabled:cursor-not-allowed"
                      >×</button>
                    </div>
                    {err && <p className="text-xs text-red-600 pl-0.5">⚠ {err}</p>}
                  </div>
                )
              })}

              <button
                onClick={() => {
                  const used = new Set(manualRows.map(r => r.type))
                  const next = SELECTABLE_TYPES.find(t => !used.has(t) && (availableCounts[t] ?? 0) > 0) ?? 'text'
                  setManualRows(prev => [...prev, { id: mkUid(), type: next, marks: MARKS_DEFAULT[next] ?? 2, count: 1 }])
                }}
                disabled={manualRows.length >= SELECTABLE_TYPES.length}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                + Add row
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 bg-gray-50 rounded-b-xl">
          <div className="flex items-center justify-between gap-3">
            {tab === 'manual' && (
              <span className="text-sm text-gray-500">
                <span className="font-semibold text-gray-800">
                  {manualRows.reduce((s, r) => s + r.marks * r.count, 0)}
                </span> marks ·{' '}
                <span className="font-semibold text-gray-800">
                  {manualRows.reduce((s, r) => s + r.count, 0)}
                </span> questions
              </span>
            )}
            {tab === 'blueprint' && blueprint && (
              <span className="text-sm text-gray-500">
                <span className="font-semibold text-gray-800">{blueprint.total_marks}</span> marks ·{' '}
                <span className="font-semibold text-gray-800">{bpAvailable}</span> questions
              </span>
            )}
            {tab === 'blueprint' && !blueprint && <span />}

            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300
                           text-gray-700 hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              {tab === 'blueprint' && phase === 'preview' && blueprint && (
                <button
                  onClick={handleBlueprintGenerate}
                  disabled={bpAvailable === 0 || classifying}
                  className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium
                             hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {classifying ? 'Classifying…' : 'Generate Paper'}
                </button>
              )}
              {tab === 'manual' && (
                <button
                  onClick={handleManualGenerate}
                  disabled={manualHasErrors}
                  className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium
                             hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Generate Paper
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

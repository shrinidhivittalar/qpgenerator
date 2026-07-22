import { useState, useMemo, useRef, useEffect } from 'react'
import { TYPE_LABELS, MARKS_DEFAULT } from '../types'
import type { BankQuestion, PaperItem, PaperSection, QuestionType, ModelPaperSection, ParsedModelPaper } from '../types'
import { parseBlueprint, classifyQuestions, parseModelPaper, getModelPaper, saveModelPaper, deleteModelPaper, generateQuestions } from '../api'
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

// Partition bank into tiers by difficulty, shuffle within each tier.
function shuffleByTier(all: BankQuestion[], prefer: string[], avoid: string[]): BankQuestion[] {
  const preferred = shuffle(all.filter(q => prefer.includes(q.difficulty ?? '')))
  const neutral   = shuffle(all.filter(q => !prefer.includes(q.difficulty ?? '') && !avoid.includes(q.difficulty ?? '')))
  const avoided   = shuffle(all.filter(q => avoid.includes(q.difficulty ?? '')))
  return [...preferred, ...neutral, ...avoided]
}

function chaptersMatch(bankChapter: string | null, bpChapter: string): boolean {
  if (!bankChapter) return false
  const a = bankChapter.toLowerCase().trim()
  const b = bpChapter.toLowerCase().trim()
  if (a === b || a.includes(b) || b.includes(a)) return true
  const key = b.split(/\s+/).filter(w => w.length > 4).sort((x, y) => y.length - x.length)[0]
  return !!key && a.includes(key)
}

function makePaperItem(q: BankQuestion, subject: string, marks: number, sectionId: string | null = null, isAiGenerated = false): PaperItem {
  return { ...q, uid: mkUid(), subject, marks, sectionId, isRephrased: false, originalText: q.text, isAiGenerated }
}

const QUESTION_VERB_RE =
  /\b(find|prove|solve|calculate|show|draw|write|express|determine|evaluate|construct|verify|obtain|derive|discuss|divide|check|state and prove|if\b.*\bthen)\b/i

function isLikelyQuestion(q: BankQuestion): boolean {
  if (q.type === 'mcq' && q.options && q.options.length > 0) return true
  const t = (q.text || '').trim()
  if (!t) return false
  if (t.includes('?')) return true
  if (QUESTION_VERB_RE.test(t)) return true
  if (/\bis called\b|\bare called\b|\bis given by\b|\bis defined as\b/i.test(t)) return false
  if (/=/.test(t)) return false
  return true
}

function pickForSlot(pool: BankQuestion[], used: Set<string>, count: number, marks: number): BankQuestion[] {
  const avail = pool.filter(q => !used.has(q.qid))
  const real  = avail.filter(isLikelyQuestion)
  const junk  = avail.filter(q => !isLikelyQuestion(q))
  const orderByType = (qs: BankQuestion[]) => {
    const preferred = qs.filter(q => marks === 1 ? q.type === 'mcq' : q.type !== 'mcq')
    const rest      = qs.filter(q => marks === 1 ? q.type !== 'mcq' : q.type === 'mcq')
    return shuffle(preferred).concat(shuffle(rest))
  }
  return orderByType(real).concat(orderByType(junk)).slice(0, count)
}

function sectionTitle(sec: ModelPaperSection): string {
  const partStr = sec.part ? `${sec.part}` : ''
  const topicStr = sec.part_topic ? ` (${sec.part_topic})` : ''
  return `${partStr}${topicStr} — Section ${sec.section_number}`
}

function sectionInstruction(sec: ModelPaperSection): string {
  if (sec.instruction?.trim()) return sec.instruction
  return `Answer the following questions. (${sec.question_count} × ${sec.marks_per_question} = ${sec.total_marks})`
}

// ── manual-mode types ─────────────────────────────────────────────────────────

const SELECTABLE_TYPES: QuestionType[] = ['mcq', 'text', 'figure_based', 'table_based', 'multi_part']

interface ManualRow {
  id:    string
  type:  QuestionType
  marks: number
  count: number
}

// ── props ─────────────────────────────────────────────────────────────────────

interface PaperSet {
  items:    PaperItem[]
  sections: PaperSection[]
  title:    string
}

interface Props {
  subject:          string
  source:           string
  sourceLabel:      string
  allQuestions:     BankQuestion[]
  paperQids:        Set<string>
  onGenerate:       (items: PaperItem[], sections?: PaperSection[]) => void
  onGenerateSets?:  (sets: PaperSet[]) => void
  onCancel:         () => void
}

// ── component ─────────────────────────────────────────────────────────────────

type Tab         = 'model_paper' | 'blueprint' | 'manual'
type BpPhase     = 'upload' | 'preview'
type MpPhase     = 'upload' | 'preview' | 'saved'

export function AutoGenerateModal({
  subject, source, sourceLabel, allQuestions, paperQids, onGenerate, onGenerateSets, onCancel,
}: Props) {
  const [tab,          setTab]          = useState<Tab>('model_paper')

  // ── blueprint state ───────────────────────────────────────────────────────
  const [bpPhase,      setBpPhase]      = useState<BpPhase>('upload')
  const [bpParsing,    setBpParsing]    = useState(false)
  const [bpClassifying,setBpClassifying]= useState(false)
  const [bpParseErr,   setBpParseErr]   = useState<string | null>(null)
  const [blueprint,    setBlueprint]    = useState<ParsedBlueprint | null>(null)
  const [chapterMap,   setChapterMap]   = useState<Record<string, string>>({})
  const bpFileRef = useRef<HTMLInputElement>(null)

  // ── model paper state ─────────────────────────────────────────────────────
  const [mpPhase,      setMpPhase]      = useState<MpPhase>('upload')
  const [mpParsing,    setMpParsing]    = useState(false)
  const [mpSaving,     setMpSaving]     = useState(false)
  const [mpParseErr,   setMpParseErr]   = useState<string | null>(null)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [modelPaper,   setModelPaper]   = useState<ParsedModelPaper | null>(null)
  const [mpSections,   setMpSections]   = useState<ModelPaperSection[]>([])
  const mpFileRef = useRef<HTMLInputElement>(null)

  // ── manual mode state ──────────────────────────────────────────────────────
  const [manualRows, setManualRows] = useState<ManualRow[]>(() => [
    { id: mkUid(), type: 'mcq',  marks: 1, count: 10 },
    { id: mkUid(), type: 'text', marks: 2, count: 5  },
  ])

  // ── load saved model paper on mount ───────────────────────────────────────
  useEffect(() => {
    getModelPaper(subject).then(saved => {
      if (saved) {
        setModelPaper(saved)
        setMpSections(saved.sections)
        setMpPhase('saved')
      }
    }).catch(() => {})
  }, [subject])

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

  const availableBank = useMemo(
    () => allQuestions.filter(q => !paperQids.has(`${subject}:${source}:${q.qid}`)),
    [allQuestions, paperQids, subject, source],
  )

  // ── model paper handlers ───────────────────────────────────────────────────
  async function handleMpFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setMpParsing(true)
    setMpParseErr(null)
    try {
      const result = await parseModelPaper(file)
      setModelPaper(result)
      setMpSections(result.sections)
      setMpPhase('preview')
    } catch (err: unknown) {
      setMpParseErr(err instanceof Error ? err.message : 'Failed to parse model paper')
    } finally {
      setMpParsing(false)
      if (mpFileRef.current) mpFileRef.current.value = ''
    }
  }

  async function handleMpSave() {
    if (!modelPaper) return
    setMpSaving(true)
    try {
      const updated = { ...modelPaper, sections: mpSections }
      await saveModelPaper(subject, updated)
      setModelPaper(updated)
      setMpPhase('saved')
    } catch {
      setMpParseErr('Failed to save — check the server is running.')
    } finally {
      setMpSaving(false)
    }
  }

  async function handleMpDelete() {
    await deleteModelPaper(subject)
    setModelPaper(null)
    setMpSections([])
    setMpPhase('upload')
  }

  function updateSectionCount(idx: number, count: number) {
    setMpSections(prev => prev.map((s, i) =>
      i === idx ? { ...s, question_count: count, total_marks: count * s.marks_per_question } : s
    ))
  }

  function updateSectionMarks(idx: number, marks: number) {
    setMpSections(prev => prev.map((s, i) =>
      i === idx ? { ...s, marks_per_question: marks, total_marks: s.question_count * marks } : s
    ))
  }

  // ── blueprint handlers ─────────────────────────────────────────────────────
  async function handleBpFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBpParsing(true)
    setBpParseErr(null)
    try {
      const result = await parseBlueprint(file)
      setBlueprint(result)
      setChapterMap({})
      setBpPhase('preview')
    } catch (err: unknown) {
      setBpParseErr(err instanceof Error ? err.message : 'Failed to parse blueprint')
    } finally {
      setBpParsing(false)
      if (bpFileRef.current) bpFileRef.current.value = ''
    }
  }

  // ── combined generate ──────────────────────────────────────────────────────
  async function handleGenerate() {
    const effectiveSections = mpPhase === 'saved' || mpPhase === 'preview' ? mpSections : null

    // Model paper with no blueprint: skip marks-bucketing, pick from full bank per section
    if (effectiveSections && effectiveSections.length > 0 && !blueprint) {
      const paperSections: PaperSection[] = []
      const items: PaperItem[] = []
      const usedInSections = new Set<string>()
      const shuffledBank = shuffle(availableBank)

      setAiGenerating(true)
      try {
        for (const sec of effectiveSections) {
          const secId = mkUid()
          paperSections.push({
            id:          secId,
            title:       sectionTitle(sec),
            instruction: sectionInstruction(sec),
            marksPerQ:   sec.marks_per_question,
          })

          let pool = shuffledBank.filter(q => !usedInSections.has(q.qid))

          if (sec.part_topic) {
            const byArea = pool.filter(q => q.subject_area === sec.part_topic)
            if (byArea.length >= sec.question_count) pool = byArea
          }

          const isMcqSection = sec.question_type === 'MCQ'
          const byType = pool.filter(q => isMcqSection ? q.type === 'mcq' : q.type !== 'mcq')
          if (byType.length >= sec.question_count) pool = byType

          const picked = pool.slice(0, sec.question_count)
          for (const q of picked) {
            usedInSections.add(q.qid)
            items.push(makePaperItem(q, subject, sec.marks_per_question, secId))
          }

          // Fill any shortfall with AI-generated questions
          const shortfall = sec.question_count - picked.length
          if (shortfall > 0) {
            try {
              const exampleQs = shuffledBank.slice(0, 5).map(q => ({
                text: q.text, type: q.type, options: q.options ?? null,
              }))
              const aiItems = await generateQuestions({
                subject_area:       sec.part_topic,
                question_type:      sec.question_type,
                marks_per_question: sec.marks_per_question,
                count:              shortfall,
                instruction:        sec.instruction,
                example_questions:  exampleQs,
              })
              for (const q of aiItems) {
                items.push(makePaperItem(q, subject, sec.marks_per_question, secId, true))
              }
            } catch {
              // AI generation failed — section will have fewer questions
            }
          }
        }
      } finally {
        setAiGenerating(false)
      }

      onGenerate(items, paperSections)
      return
    }

    // Build question pools by marks (from blueprint if available, else whole bank)
    let poolsByMarks: Record<number, BankQuestion[]> = {}
    const used = new Set<string>()

    if (blueprint) {
      // Classify unclassified questions if needed
      let effectiveMap = { ...chapterMap }
      const needClassification = availableBank.filter(q => !q.chapter && !effectiveMap[q.qid])
      if (needClassification.length > 0) {
        setBpClassifying(true)
        try {
          const chapters = blueprint.rows.map(r => r.chapter)
          const BATCH = 60
          for (let i = 0; i < needClassification.length; i += BATCH) {
            const batch = needClassification.slice(i, i + BATCH)
            const classified = await classifyQuestions(batch.map(q => ({ qid: q.qid, text: q.text })), chapters)
            effectiveMap = { ...effectiveMap, ...classified }
          }
          setChapterMap(effectiveMap)
        } catch { /* fall back */ }
        finally { setBpClassifying(false) }
      }

      const getChapter = (q: BankQuestion) => q.chapter ?? effectiveMap[q.qid] ?? null

      for (const row of blueprint.rows) {
        for (const [mStr, count] of Object.entries({
          '1': row.marks_1, '2': row.marks_2, '3': row.marks_3, '4': row.marks_4, '5': row.marks_5,
        })) {
          if (!count) continue
          const marks = parseInt(mStr)
          let pool = availableBank.filter(q => {
            const ch = getChapter(q)
            return ch ? chaptersMatch(ch, row.chapter) : false
          })
          if (pool.filter(q => !used.has(q.qid)).length < count) pool = availableBank
          const picked = pickForSlot(pool, used, count, marks)
          for (const q of picked) {
            used.add(q.qid)
            poolsByMarks[marks] = [...(poolsByMarks[marks] ?? []), q]
          }
        }
      }
    } else {
      // No blueprint — use full available bank grouped by marks
      for (const q of shuffle(availableBank)) {
        const m = q.marks ?? MARKS_DEFAULT[q.type] ?? 2
        poolsByMarks[m] = [...(poolsByMarks[m] ?? []), q]
      }
    }

    // If model paper sections present, assign questions to sections
    if (effectiveSections && effectiveSections.length > 0) {
      const paperSections: PaperSection[] = []
      const items: PaperItem[] = []

      // Track used qids across all sections to avoid duplicates
      const usedInSections = new Set<string>()

      for (const sec of effectiveSections) {
        const secId = mkUid()
        paperSections.push({
          id:          secId,
          title:       sectionTitle(sec),
          instruction: sectionInstruction(sec),
          marksPerQ:   sec.marks_per_question,
        })

        // Build candidate pool from the marks-based pool,
        // filtered by subject_area (if part_topic set) and question type
        let pool = (poolsByMarks[sec.marks_per_question] ?? []).filter(
          q => !usedInSections.has(q.qid)
        )

        // Filter by subject area when part_topic is known (Physics/Chemistry/Biology)
        if (sec.part_topic) {
          const byArea = pool.filter(q => q.subject_area === sec.part_topic)
          if (byArea.length >= sec.question_count) pool = byArea
          // else fall back to unfiltered pool (bank may not have enough for this topic)
        }

        // Filter by question type: MCQ sections get MCQ, others get non-MCQ
        const isMcqSection = sec.question_type === 'MCQ'
        const byType = pool.filter(q => isMcqSection ? q.type === 'mcq' : q.type !== 'mcq')
        if (byType.length >= sec.question_count) pool = byType

        const picked = pool.slice(0, sec.question_count)
        for (const q of picked) {
          usedInSections.add(q.qid)
          items.push(makePaperItem(q, subject, sec.marks_per_question, secId))
        }
      }

      onGenerate(items, paperSections)
    } else {
      // Flat list (no sections) — existing behavior
      const items: PaperItem[] = []
      for (const [mStr, qs] of Object.entries(poolsByMarks)) {
        for (const q of qs) items.push(makePaperItem(q, subject, parseInt(mStr)))
      }
      onGenerate(items)
    }
  }

  // ── generate 3 sets (Easy / Medium / Hard) ─────────────────────────────────
  async function handleGenerateSets() {
    const effectiveSections = mpPhase === 'saved' || mpPhase === 'preview' ? mpSections : []
    if (effectiveSections.length === 0 || !onGenerateSets) return

    const TIERS = [
      { label: 'Easy',   prefer: ['Easy'],      avoid: ['Difficult'] },
      { label: 'Medium', prefer: ['Average'],    avoid: []            },
      { label: 'Hard',   prefer: ['Difficult'],  avoid: ['Easy']      },
    ]

    const globalUsed = new Set<string>()
    const results: PaperSet[] = []

    setAiGenerating(true)
    try {
      for (const tier of TIERS) {
        const paperSections: PaperSection[] = []
        const items: PaperItem[] = []
        const usedHere = new Set<string>()

        // Sort full bank by difficulty tier, shuffle within each tier for variety
        const tieredBank = shuffleByTier(allQuestions, tier.prefer, tier.avoid)

        for (const sec of effectiveSections) {
          const secId = mkUid()
          paperSections.push({
            id:          secId,
            title:       sectionTitle(sec),
            instruction: sectionInstruction(sec),
            marksPerQ:   sec.marks_per_question,
          })

          // Prefer questions not used in any paper yet; fall back to not used in this paper
          let pool = tieredBank.filter(q => !globalUsed.has(q.qid) && !usedHere.has(q.qid))
          if (pool.length < sec.question_count) {
            pool = tieredBank.filter(q => !usedHere.has(q.qid))
          }

          if (sec.part_topic) {
            const byArea = pool.filter(q => q.subject_area === sec.part_topic)
            if (byArea.length >= sec.question_count) pool = byArea
          }

          const isMcqSection = sec.question_type === 'MCQ'
          const byType = pool.filter(q => isMcqSection ? q.type === 'mcq' : q.type !== 'mcq')
          if (byType.length >= sec.question_count) pool = byType

          const picked = pool.slice(0, sec.question_count)
          for (const q of picked) {
            usedHere.add(q.qid)
            globalUsed.add(q.qid)
            items.push(makePaperItem(q, subject, sec.marks_per_question, secId))
          }

          const shortfall = sec.question_count - picked.length
          if (shortfall > 0) {
            try {
              const exampleQs = tieredBank.slice(0, 5).map(q => ({
                text: q.text, type: q.type, options: q.options ?? null,
              }))
              const aiItems = await generateQuestions({
                subject_area:       sec.part_topic,
                question_type:      sec.question_type,
                marks_per_question: sec.marks_per_question,
                count:              shortfall,
                instruction:        sec.instruction,
                example_questions:  exampleQs,
              })
              for (const q of aiItems) {
                items.push(makePaperItem(q, subject, sec.marks_per_question, secId, true))
              }
            } catch { /* silently skip */ }
          }
        }

        const label = subject.charAt(0).toUpperCase() + subject.slice(1)
        results.push({ items, sections: paperSections, title: `${label} — ${tier.label}` })
      }

      onGenerateSets(results)
    } finally {
      setAiGenerating(false)
    }
  }

  // ── manual generate ────────────────────────────────────────────────────────
  function handleManualGenerate() {
    const pools: Partial<Record<QuestionType, BankQuestion[]>> = {}
    for (const q of availableBank) {
      pools[q.type] = pools[q.type] ?? []
      pools[q.type]!.push(q)
    }
    for (const t of Object.keys(pools) as QuestionType[]) pools[t] = shuffle(pools[t]!)
    const items: PaperItem[] = []
    for (const row of manualRows) {
      const picked = (pools[row.type] ?? []).splice(0, row.count)
      for (const q of picked) items.push(makePaperItem(q, subject, row.marks))
    }
    onGenerate(items)
  }

  // ── manual row helpers ────────────────────────────────────────────────────
  const manualRowErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    for (const row of manualRows) {
      const avail = availableCounts[row.type] ?? 0
      if (row.count < 1)        errors[row.id] = 'Count must be at least 1'
      else if (row.count > avail) errors[row.id] = `Only ${avail} available`
    }
    return errors
  }, [manualRows, availableCounts])

  const manualHasErrors = manualRows.length === 0 || Object.keys(manualRowErrors).length > 0

  // ── derived state ─────────────────────────────────────────────────────────
  const mpTotalQ  = mpSections.reduce((s, r) => s + r.question_count,     0)
  const mpTotalM  = mpSections.reduce((s, r) => s + r.total_marks,         0)
  const hasModelPaper = (mpPhase === 'saved' || mpPhase === 'preview') && mpSections.length > 0

  const bpAvailable = blueprint
    ? (() => {
        const used = new Set<string>()
        let total = 0
        const hasChapters = availableBank.some(q => q.chapter)
        for (const row of blueprint.rows) {
          for (const [mStr, count] of Object.entries({
            '1': row.marks_1, '2': row.marks_2, '3': row.marks_3, '4': row.marks_4, '5': row.marks_5,
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

  const canGenerate = tab !== 'manual'
    ? (hasModelPaper || blueprint != null)
    : !manualHasErrors

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">

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
            {([
              ['model_paper', 'Paper Format'],
              ['blueprint',   'Blueprint PDF'],
              ['manual',      'Manual'],
            ] as [Tab, string][]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-md border border-b-0 transition
                  ${tab === t
                    ? 'bg-gray-50 border-gray-200 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                {t === 'model_paper' && (
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle
                    ${hasModelPaper ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                )}
                {t === 'blueprint' && (
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle
                    ${blueprint ? 'bg-indigo-500' : 'bg-gray-300'}`} />
                )}
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Model Paper tab ── */}
          {tab === 'model_paper' && (
            <>
              {mpPhase === 'upload' && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="text-4xl">📋</div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-700">Upload a model question paper</p>
                    <p className="text-xs text-gray-400 mt-1">
                      The AI will detect all sections, question types, counts, and marks
                    </p>
                  </div>
                  <label className={`cursor-pointer px-5 py-2.5 rounded-lg text-sm font-medium transition
                    ${mpParsing
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}>
                    {mpParsing ? 'Parsing…' : 'Choose PDF'}
                    <input ref={mpFileRef} type="file" accept=".pdf" className="hidden"
                      disabled={mpParsing} onChange={handleMpFileChange} />
                  </label>
                  {mpParseErr && <p className="text-xs text-red-600 text-center max-w-xs">{mpParseErr}</p>}
                </div>
              )}

              {(mpPhase === 'preview' || mpPhase === 'saved') && modelPaper && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Paper Format
                      {mpPhase === 'saved' && (
                        <span className="ml-2 text-[10px] font-normal text-emerald-600 bg-emerald-50
                                         px-1.5 py-0.5 rounded-full">saved</span>
                      )}
                    </p>
                    <div className="flex gap-3">
                      {mpPhase === 'saved' && (
                        <button onClick={handleMpDelete}
                          className="text-xs text-red-400 hover:text-red-600 transition">
                          Remove
                        </button>
                      )}
                      <button
                        onClick={() => { setMpPhase('upload'); setModelPaper(null); setMpSections([]) }}
                        className="text-xs text-indigo-500 hover:text-indigo-700 transition">
                        ← Upload new
                      </button>
                    </div>
                  </div>

                  {/* Sections table */}
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="text-xs min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Section</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Type</th>
                          <th className="px-2 py-2 text-center text-gray-500 font-medium">Qs</th>
                          <th className="px-2 py-2 text-center text-gray-500 font-medium">Marks ea.</th>
                          <th className="px-2 py-2 text-center text-gray-500 font-medium">Total</th>
                          <th className="px-2 py-2 text-center text-gray-500 font-medium">OR?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mpSections.map((sec, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                              {sec.part && <span className="text-gray-400 mr-1">{sec.part}</span>}
                              {sec.part_topic && <span className="text-indigo-600 mr-1">{sec.part_topic}</span>}
                              <span className="font-medium">§{sec.section_number}</span>
                            </td>
                            <td className="px-3 py-1.5 text-gray-600">{sec.question_type}</td>
                            <td className="px-2 py-1 text-center">
                              <input
                                type="number" min={1} max={50}
                                value={sec.question_count}
                                onChange={e => updateSectionCount(i, Math.max(1, parseInt(e.target.value) || 1))}
                                className="w-12 text-center border border-gray-200 rounded px-1 py-0.5
                                           focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                              />
                            </td>
                            <td className="px-2 py-1 text-center">
                              <input
                                type="number" min={1} max={10}
                                value={sec.marks_per_question}
                                onChange={e => updateSectionMarks(i, Math.max(1, parseInt(e.target.value) || 1))}
                                className="w-12 text-center border border-gray-200 rounded px-1 py-0.5
                                           focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-center text-gray-600">{sec.total_marks}</td>
                            <td className="px-2 py-1.5 text-center">
                              {sec.has_internal_choice
                                ? <span className="text-amber-500 font-medium">OR</span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-indigo-50">
                        <tr>
                          <td colSpan={2} className="px-3 py-1.5 text-xs font-semibold text-indigo-700">Total</td>
                          <td className="px-2 py-1.5 text-center text-xs font-semibold text-indigo-700">{mpTotalQ}</td>
                          <td />
                          <td className="px-2 py-1.5 text-center text-xs font-semibold text-indigo-700">{mpTotalM}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {mpPhase === 'preview' && (
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={handleMpSave}
                        disabled={mpSaving}
                        className="px-4 py-1.5 text-xs rounded-lg bg-emerald-600 text-white font-medium
                                   hover:bg-emerald-700 disabled:opacity-40 transition"
                      >
                        {mpSaving ? 'Saving…' : 'Save format for this subject'}
                      </button>
                    </div>
                  )}

                  {!blueprint && (
                    <p className="text-xs text-amber-600 pt-1">
                      Tip: also upload a Blueprint PDF to pick questions by chapter weightage.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Blueprint tab ── */}
          {tab === 'blueprint' && (
            <>
              {bpPhase === 'upload' && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="text-4xl">📄</div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-700">Upload your blueprint PDF</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Chapter-wise marks distribution table (e.g. Karnataka SSLC blueprint)
                    </p>
                  </div>
                  <label className={`cursor-pointer px-5 py-2.5 rounded-lg text-sm font-medium transition
                    ${bpParsing
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}>
                    {bpParsing ? 'Parsing…' : 'Choose PDF'}
                    <input ref={bpFileRef} type="file" accept=".pdf" className="hidden"
                      disabled={bpParsing} onChange={handleBpFileChange} />
                  </label>
                  {bpParseErr && <p className="text-xs text-red-600 text-center max-w-xs">{bpParseErr}</p>}
                </div>
              )}

              {bpPhase === 'preview' && blueprint && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Parsed Blueprint</p>
                    <button
                      onClick={() => { setBpPhase('upload'); setBlueprint(null) }}
                      className="text-xs text-indigo-500 hover:text-indigo-700 transition"
                    >
                      ← Change file
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="text-xs min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Chapter</th>
                          {[1,2,3,4,5].map(m => (
                            <th key={m} className="px-2 py-2 text-center text-gray-500 font-medium">{m}M</th>
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
            {/* Summary */}
            <span className="text-sm text-gray-500">
              {tab === 'manual' && (
                <>
                  <span className="font-semibold text-gray-800">
                    {manualRows.reduce((s, r) => s + r.marks * r.count, 0)}
                  </span> marks ·{' '}
                  <span className="font-semibold text-gray-800">
                    {manualRows.reduce((s, r) => s + r.count, 0)}
                  </span> questions
                </>
              )}
              {tab !== 'manual' && hasModelPaper && (
                <>
                  <span className="font-semibold text-gray-800">{mpTotalM}</span> marks ·{' '}
                  <span className="font-semibold text-gray-800">{mpTotalQ}</span> questions
                  {blueprint && (
                    <span className="text-gray-400 ml-1">· with blueprint</span>
                  )}
                </>
              )}
              {tab === 'blueprint' && !hasModelPaper && blueprint && (
                <>
                  <span className="font-semibold text-gray-800">{blueprint.total_marks}</span> marks ·{' '}
                  <span className="font-semibold text-gray-800">{bpAvailable}</span> questions
                </>
              )}
            </span>

            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300
                           text-gray-700 hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              {tab !== 'manual' && hasModelPaper && onGenerateSets && (
                <button
                  onClick={handleGenerateSets}
                  disabled={aiGenerating || bpClassifying}
                  className="px-4 py-2 text-sm rounded-lg border border-violet-400 text-violet-700
                             font-medium hover:bg-violet-50 disabled:opacity-40
                             disabled:cursor-not-allowed transition"
                >
                  {aiGenerating ? 'Generating…' : 'Generate 3 Sets'}
                </button>
              )}
              {tab === 'manual' ? (
                <button
                  onClick={handleManualGenerate}
                  disabled={manualHasErrors}
                  className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium
                             hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Generate Paper
                </button>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate || bpClassifying || aiGenerating}
                  className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium
                             hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {bpClassifying ? 'Classifying…' : aiGenerating ? 'Generating…' : 'Generate Paper'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

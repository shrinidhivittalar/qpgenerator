import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { fetchSubjects, fetchQuestions, fetchUploads, rephraseQuestion, uploadPaper, confirmUpload, renameUpload, deleteUpload, deleteQuestionSource, deleteBankQuestion, editBankQuestion } from './api'
import { QuestionBank } from './components/QuestionBank'
import { PaperBuilder } from './components/PaperBuilder'
import { UploadReviewModal } from './components/UploadReviewModal'
import { AutoGenerateModal } from './components/AutoGenerateModal'
import { Dashboard } from './components/Dashboard'
import { DashboardUploadModal } from './components/DashboardUploadModal'
import { PaperConfigDialog } from './components/PaperConfigDialog'
import type { BankQuestion, PaperItem, PaperSection, PaperTab, RawQuestion, PaperConfiguration } from './types'
import { MARKS_DEFAULT, DEFAULT_PAPER_CONFIG } from './types'
import { cleanText, jaccardSimilarity, mkUid } from './utils'
import { composePaper } from './paper-composer/composer'

const newTab = (title = 'New Paper'): PaperTab => ({ id: mkUid(), title, items: [], sections: [], config: { ...DEFAULT_PAPER_CONFIG } })

type BankCache = Record<string, BankQuestion[]>

export default function App() {
  // ── Routing ───────────────────────────────────────────────────────────
  const navigate = useNavigate()
  const location = useLocation()
  const view = location.pathname === '/builder' ? 'builder' : 'dashboard'
  const goTo  = useCallback((path: '/' | '/builder') => navigate(path), [navigate])

  // ── Dashboard upload modal ────────────────────────────────────────────
  const [showDashboardUpload, setShowDashboardUpload] = useState(false)

  // ── Subject / source selection ─────────────────────────────────────────
  const [subjectMap, setSubjectMap]   = useState<Record<string, Record<string, number>>>({})
  const [subject, setSubject]         = useState('science')
  const [source, setSource]           = useState('qp')

  // ── Question bank cache ───────────────────────────────────────────────
  const [bankCache, setBankCache]     = useState<BankCache>({})
  const [loading, setLoading]         = useState(false)
  const [bankError, setBankError]     = useState<string | null>(null)

  // ── Search / filter ───────────────────────────────────────────────────
  const [search, setSearch]           = useState('')
  const [typeFilter, setTypeFilter]   = useState('all')

  // ── Multi-paper state ─────────────────────────────────────────────────
  const [papers, setPapers]           = useState<PaperTab[]>([newTab('Model Question Paper')])
  const [activeId, setActiveId]       = useState(() => papers[0].id)
  const [rephrasing, setRephrasing]   = useState<string | null>(null)

  // ── Upload state ──────────────────────────────────────────────────────
  const [uploading, setUploading]     = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saving, setSaving]           = useState(false)
  const [uploadPreview, setUploadPreview] = useState<{
    upload_id: string; name: string; raw: RawQuestion[]; warnings: string[]
  } | null>(null)
  // id -> { name, count }
  const [uploadedSources, setUploadedSources] =
    useState<Record<string, { name: string; count: number }>>({})
  // subject -> { uploadId -> customName }  (after merge into existing subject)
  const [mergedSources, setMergedSources] =
    useState<Record<string, Record<string, string>>>({})
  // pending merge dialog
  const [mergeDialog, setMergeDialog] =
    useState<{ id: string; name: string; target: string } | null>(null)

  // ── Section state ─────────────────────────────────────────────────────
  const [activeSectionId, setActiveSectionId]   = useState<string | null>(null)

  // ── Auto-generate ─────────────────────────────────────────────────────
  const [showAutoGenerate, setShowAutoGenerate] = useState(false)

  // ── Config dialog ─────────────────────────────────────────────────────
  const [showConfigDialog, setShowConfigDialog] = useState(false)

  // ── Derived ───────────────────────────────────────────────────────────
  const activePaper   = papers.find(p => p.id === activeId) ?? papers[0]
  const paper         = activePaper.items
  const paperTitle    = activePaper.title
  const paperConfig   = activePaper.config
  const lockedSubject = paper.find(i => i.subject !== 'custom')?.subject ?? null
  const bankKey       = `${subject}/${source}`
  const bankQuestions = bankCache[bankKey] ?? []

  // ── Load subject map on mount ─────────────────────────────────────────
  useEffect(() => {
    // Load static subjects + persisted uploads in parallel
    Promise.all([fetchSubjects(), fetchUploads()])
      .then(([map, uploads]) => {
        const { uploaded: _ignored, ...staticMap } = map
        setSubjectMap(staticMap)
        const firstSubj = Object.keys(staticMap)[0]
        if (firstSubj) {
          setSubject(firstSubj)
          setSource(Object.keys(staticMap[firstSubj])[0] ?? 'qp')
        }
        // Restore persisted uploads into client state (questions lazy-loaded on demand)
        if (uploads.length > 0) {
          setUploadedSources(
            Object.fromEntries(uploads.map(u => [u.id, { name: u.name, count: u.count }]))
          )
        }
      })
      .catch(console.error)
  }, [])

  // ── Reset filters when subject/source changes ─────────────────────────
  useEffect(() => {
    setSearch('')
    setTypeFilter('all')
  }, [subject, source])

  // ── Load questions when subject/source changes ────────────────────────
  useEffect(() => {
    if (bankCache[bankKey]) return   // already in cache
    setBankError(null)
    setLoading(true)
    const key = bankKey  // capture at effect run time
    fetchQuestions(subject, source)
      .then(qs => setBankCache(prev => ({ ...prev, [key]: qs })))
      .catch(() => setBankError('Failed to load questions — check the server is running.'))
      .finally(() => setLoading(false))
  }, [bankKey, subject, source])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effective subject map ─────────────────────────────────────────────
  // Static subjects + merged upload sources as extra source tabs per subject.
  // Uploaded papers are NOT included here; they appear in the dropdown directly.
  const effectiveSubjectMap = useMemo(() => {
    const result: Record<string, Record<string, number>> = {}
    for (const [subj, srcs] of Object.entries(subjectMap)) {
      result[subj] = { ...srcs }
    }
    for (const [target, srcs] of Object.entries(mergedSources)) {
      if (result[target]) {
        for (const [id] of Object.entries(srcs)) {
          result[target][id] = bankCache[`${target}/${id}`]?.length ?? 0
        }
      }
    }
    return result
  }, [subjectMap, mergedSources, bankCache])

  // Maps any source ID (upload or merged) to its custom display name
  const sourceLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const [id, info] of Object.entries(uploadedSources)) labels[id] = info.name
    for (const srcs of Object.values(mergedSources)) {
      for (const [id, name] of Object.entries(srcs)) labels[id] = name
    }
    return labels
  }, [uploadedSources, mergedSources])

  // ── setSubject handler (handles __up__<id> virtual keys) ─────────────
  const handleSelectSubject = useCallback((val: string) => {
    if (val.startsWith('__up__')) {
      const id = val.slice(6)
      setSubject('uploaded')
      setSource(id)
    } else {
      setSubject(val)
      setSource(Object.keys(effectiveSubjectMap[val] ?? {})[0] ?? 'qp')
    }
  }, [effectiveSubjectMap])

  // ── Helpers that mutate only active paper ─────────────────────────────
  const setItems = useCallback((updater: (prev: PaperItem[]) => PaperItem[]) => {
    setPapers(prev => prev.map(p =>
      p.id === activeId ? { ...p, items: updater(p.items) } : p
    ))
  }, [activeId])

  const setTitle = useCallback((title: string) => {
    setPapers(prev => prev.map(p => p.id === activeId ? { ...p, title } : p))
  }, [activeId])

  const setFullConfig = useCallback((config: PaperConfiguration) => {
    setPapers(prev => prev.map(p =>
      p.id === activeId ? { ...p, config } : p
    ))
  }, [activeId])

  // ── Section helpers ───────────────────────────────────────────────────
  const setSections = useCallback((updater: (prev: PaperSection[]) => PaperSection[]) => {
    setPapers(prev => prev.map(p =>
      p.id === activeId ? { ...p, sections: updater(p.sections) } : p
    ))
  }, [activeId])

  const handleAddSection = useCallback((sec: PaperSection) => {
    setSections(prev => [...prev, sec])
    setActiveSectionId(sec.id)
  }, [setSections])

  const handleUpdateSection = useCallback((id: string, updates: Partial<PaperSection>) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
    if (updates.marksPerQ != null) {
      setItems(prev => prev.map(i => i.sectionId === id ? { ...i, marks: updates.marksPerQ! } : i))
    }
  }, [setSections])

  const handleDeleteSection = useCallback((id: string) => {
    setSections(prev => prev.filter(s => s.id !== id))
    setItems(prev => prev.map(i => i.sectionId === id ? { ...i, sectionId: null } : i))
    setActiveSectionId(prev => {
      if (prev !== id) return prev
      const remaining = activePaper.sections.filter(s => s.id !== id)
      return remaining[0]?.id ?? null
    })
  }, [setSections, activePaper.sections])

  const handleMoveToSection = useCallback((uid: string, sectionId: string | null) => {
    setItems(prev => prev.map(i => i.uid === uid ? { ...i, sectionId } : i))
  }, [setItems])

  // ── Paper tab management ──────────────────────────────────────────────
  const handleNewPaper = useCallback(() => {
    const tab = newTab()
    setPapers(prev => [...prev, tab])
    setActiveId(tab.id)
  }, [])

  const handleSwitchPaper = useCallback((id: string) => {
    setActiveId(id)
    const target = papers.find(p => p.id === id)
    setActiveSectionId(target?.sections[0]?.id ?? null)
  }, [papers])

  const handleRenameTab = useCallback((id: string, title: string) => {
    setPapers(prev => prev.map(p => p.id === id ? { ...p, title } : p))
  }, [])

  const handleCloseTab = useCallback((id: string) => {
    setPapers(prev => {
      if (prev.length === 1) return prev
      const idx  = prev.findIndex(p => p.id === id)
      const next = prev.filter(p => p.id !== id)
      setActiveId(cur => cur === id ? next[Math.max(0, idx - 1)].id : cur)
      return next
    })
  }, [])

  // ── Question handlers ─────────────────────────────────────────────────
  const paperQids = useMemo(
    () => new Set(paper.map(i => `${i.subject}:${i.source}:${i.qid}`)),
    [paper]
  )

  const handleToggle = useCallback((q: BankQuestion) => {
    const key = `${subject}:${source}:${q.qid}`
    if (paperQids.has(key)) {
      setItems(prev => prev.filter(i => !(i.subject === subject && i.source === source && i.qid === q.qid)))
    } else {
      const activeSection = activePaper.sections.find(s => s.id === activeSectionId)
      const item: PaperItem = {
        ...q,
        uid:          mkUid(),
        subject,
        source,
        marks:        activeSection?.marksPerQ ?? q.marks ?? MARKS_DEFAULT[q.type] ?? 2,
        sectionId:    activeSectionId,
        isRephrased:  false,
        originalText: q.text,
      }
      setItems(prev => [...prev, item])
    }
  }, [subject, source, paperQids, setItems, activeSectionId, activePaper.sections])

  const handleRemove      = useCallback((uid: string) => setItems(p => p.filter(i => i.uid !== uid)), [setItems])
  const handleMarksChange = useCallback((uid: string, marks: number) =>
    setItems(p => p.map(i => i.uid === uid ? { ...i, marks } : i)), [setItems])

  const handleTextChange  = useCallback((uid: string, newText: string) =>
    setItems(p => p.map(i => i.uid === uid
      ? { ...i, text: newText, ...(!i.isRephrased ? { originalText: newText } : {}) }
      : i
    )), [setItems])

  const handleUndoRephrase = useCallback((uid: string) =>
    setItems(p => p.map(i => i.uid === uid
      ? { ...i, text: i.originalText, isRephrased: false } : i
    )), [setItems])

  const handleRephrase = useCallback(async (uid: string) => {
    const item = paper.find(i => i.uid === uid)
    if (!item) return
    setRephrasing(uid)
    try {
      const rephrased = await rephraseQuestion(cleanText(item.text), item.type)
      setItems(p => p.map(i => i.uid === uid ? { ...i, text: rephrased, isRephrased: true } : i))
    } catch {
      alert('Rephrase failed. Check the server is running.')
    } finally {
      setRephrasing(null)
    }
  }, [paper, setItems])

  const handleAddCustom = useCallback((text: string) => {
    setItems(prev => [...prev, {
      uid:          mkUid(),
      qid:          `CUSTOM-${mkUid()}`,
      number:       0,
      subject:      'custom',
      source:       'custom',
      chapter:      null,
      chapter_num:  null,
      section:      null,
      text,
      originalText: text,
      type:         'custom',
      options:      null,
      has_figure:   false,
      has_table:    false,
      images:       [],
      tables:       [],
      marks:        2,
      sectionId:    activeSectionId,
      isRephrased:  false,
    }])
  }, [setItems, activeSectionId])

  const handleReorder = useCallback((items: PaperItem[]) => setItems(() => items), [setItems])

  const handleAutoGenerate = useCallback((items: PaperItem[]) => {
    setItems(prev => [...prev, ...items])
    setShowAutoGenerate(false)
  }, [setItems])

  // ── Delete a source (uploaded paper OR static subject/source) ────────
  const handleDeleteSource = useCallback(async (subj: string, src: string) => {
    if (subj === 'uploaded') {
      try { await deleteUpload(src) } catch { return }
      setUploadedSources(prev => { const n = { ...prev }; delete n[src]; return n })
      setBankCache(prev => { const n = { ...prev }; delete n[`uploaded/${src}`]; return n })
      if (subject === 'uploaded' && source === src) {
        const firstSubj = Object.keys(subjectMap)[0]
        if (firstSubj) {
          setSubject(firstSubj)
          setSource(Object.keys(subjectMap[firstSubj])[0] ?? 'qp')
        }
      }
    } else {
      try { await deleteQuestionSource(subj, src) } catch { return }
      setBankCache(prev => { const n = { ...prev }; delete n[`${subj}/${src}`]; return n })
      setSubjectMap(prev => {
        const next    = { ...prev }
        const srcMap  = { ...next[subj] }
        delete srcMap[src]
        if (Object.keys(srcMap).length === 0) delete next[subj]
        else next[subj] = srcMap
        return next
      })
      // Navigate away if currently viewing the deleted source
      if (subject === subj && source === src) {
        const remaining = Object.keys(subjectMap[subj] ?? {}).filter(s => s !== src)
        if (remaining.length > 0) {
          setSource(remaining[0])
        } else {
          const nextSubj = Object.keys(subjectMap).find(s => s !== subj)
          if (nextSubj) { setSubject(nextSubj); setSource(Object.keys(subjectMap[nextSubj])[0] ?? 'qp') }
        }
      }
    }
  }, [subject, source, subjectMap])

  // ── Delete individual question from uploaded bank ─────────────────────
  const handleDeleteBankQuestion = useCallback(async (qid: string) => {
    const key = `${subject}/${source}`
    setBankCache(prev => ({
      ...prev,
      [key]: (prev[key] ?? []).filter(q => q.qid !== qid),
    }))
    try {
      await deleteBankQuestion(source, qid)
    } catch {
      // Force refetch on failure
      setBankCache(prev => { const n = { ...prev }; delete n[key]; return n })
    }
  }, [subject, source])

  // ── Edit individual question in uploaded bank ─────────────────────────
  const handleEditBankQuestion = useCallback(async (
    qid: string, text: string, type: import('./types').QuestionType
  ) => {
    const key = `${subject}/${source}`
    setBankCache(prev => ({
      ...prev,
      [key]: (prev[key] ?? []).map(q =>
        q.qid === qid ? { ...q, text, type, has_figure: type === 'figure_based' } : q
      ),
    }))
    try {
      await editBankQuestion(source, qid, text, type)
    } catch {
      setBankCache(prev => { const n = { ...prev }; delete n[key]; return n })
    }
  }, [subject, source])

  // ── Upload rename with merge detection ────────────────────────────────
  const handleRenameUpload = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const collision = Object.keys(subjectMap).find(
      k => k.toLowerCase() === trimmed.toLowerCase()
    )
    if (collision) {
      setMergeDialog({ id, name: trimmed, target: collision })
    } else {
      const oldName = uploadedSources[id]?.name ?? trimmed
      setUploadedSources(cur => ({ ...cur, [id]: { ...cur[id], name: trimmed } }))
      try {
        await renameUpload(id, trimmed)
      } catch {
        setUploadedSources(cur => ({ ...cur, [id]: { ...cur[id], name: oldName } }))
      }
    }
  }, [subjectMap, uploadedSources])

  // Confirm / cancel the merge dialog
  const handleMerge = useCallback((confirmed: boolean) => {
    if (confirmed && mergeDialog) {
      const { id, name, target } = mergeDialog
      const questions = bankCache[`uploaded/${id}`] ?? []
      // Move cache to new key under the target subject
      setBankCache(prev => {
        const next = { ...prev, [`${target}/${id}`]: questions }
        delete next[`uploaded/${id}`]
        return next
      })
      // Register as a merged source under the target subject
      setMergedSources(prev => ({
        ...prev,
        [target]: { ...(prev[target] ?? {}), [id]: name },
      }))
      // Remove from standalone uploads
      setUploadedSources(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      // Switch view to the merged subject + source
      setSubject(target)
      setSource(id)
    }
    setMergeDialog(null)
  }, [mergeDialog, bankCache])

  // ── Upload handler — parse only, open review modal ───────────────────
  const handleUpload = useCallback(async (file: File, paperType: string) => {
    setUploading(true)
    setUploadError(null)
    try {
      const result = await uploadPaper(file, paperType)
      setUploadPreview({
        upload_id: result.upload_id,
        name:      result.name,
        raw:       result.raw,
        warnings:  result.warnings,
      })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [])

  // ── Confirm handler — save reviewed questions to DB ───────────────────
  const handleConfirmUpload = useCallback(async (name: string, questions: RawQuestion[]) => {
    setSaving(true)
    setUploadError(null)

    // Auto-disambiguate if a paper with this name already exists
    let finalName = name
    const existingNames = Object.values(uploadedSources).map(u => u.name.toLowerCase())
    if (existingNames.includes(name.toLowerCase())) {
      let i = 2
      while (existingNames.includes(`${name} (${i})`.toLowerCase())) i++
      finalName = `${name} (${i})`
    }

    try {
      const result = await confirmUpload(uploadPreview?.upload_id ?? '', finalName, questions)
      // Don't pre-populate bankCache here — let the useEffect fetch naturally
      // after subject/source change. This avoids stale-closure timing issues.
      setUploadedSources(prev => ({
        ...prev,
        [result.id]: { name: result.name, count: result.count },
      }))
      setUploadPreview(null)
      setSubject('uploaded')
      setSource(result.id)
      // After upload from dashboard, take the teacher straight to the builder
      if (location.pathname !== '/builder') navigate('/builder')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Save failed')
      setUploadPreview(null)
    } finally {
      setSaving(false)
    }
  }, [uploadedSources, uploadPreview, location.pathname, navigate])

  // ── Similarity maps ───────────────────────────────────────────────────
  const similarityMap = useMemo(() => {
    const result: Record<string, number> = {}
    if (!paper.length) return result
    for (const q of bankQuestions) {
      const qWords = cleanText(q.text)
      let best = 0
      for (const item of paper) {
        const sim = jaccardSimilarity(qWords, cleanText(item.text))
        if (sim > best) best = sim
      }
      if (best > 0.35) result[q.qid] = best
    }
    return result
  }, [bankQuestions, paper])

  const crossSourceMap = useMemo(() => {
    const paperFromOtherSrc = paper.filter(
      i => i.source !== source && i.subject === subject
    )
    if (!paperFromOtherSrc.length) return {}
    const result: Record<string, { sim: number; src: string }> = {}
    for (const q of bankQuestions) {
      const qWords = cleanText(q.text)
      let best = 0; let bestSrc = ''
      for (const item of paperFromOtherSrc) {
        const sim = jaccardSimilarity(qWords, cleanText(item.text))
        if (sim > best) { best = sim; bestSrc = item.source }
      }
      if (best > 0.4) result[q.qid] = { sim: best, src: bestSrc }
    }
    return result
  }, [bankQuestions, paper, source, subject])

  // ── Export ────────────────────────────────────────────────────────────
  // Opens the Paper Details dialog.
  const handleExport = useCallback(() => {
    setShowConfigDialog(true)
  }, [])

  // Called by PaperConfigDialog — persists config and opens the composed print window.
  const handleConfirmExport = useCallback((config: PaperConfiguration) => {
    setFullConfig(config)
    setShowConfigDialog(false)

    const win = window.open('', '_blank')
    if (!win) return

    const imgBase = import.meta.env.VITE_SUPABASE_IMAGES_URL || 'http://localhost:5050/api/images'
    const html    = composePaper(paper, config, { imgBase, paperTitle }, activePaper.sections)

    win.document.write(html)
    win.document.close()
    setTimeout(() => win.print(), 400)
  }, [paper, paperTitle, setFullConfig])

  // ── Filtered bank ─────────────────────────────────────────────────────
  const visibleQuestions = useMemo(() =>
    bankQuestions.filter(q => {
      const matchType   = typeFilter === 'all' || q.type === typeFilter
      const matchSearch = !search || q.text.toLowerCase().includes(search.toLowerCase())
      return matchType && matchSearch
    }),
  [bankQuestions, typeFilter, search])

  const totalMarks = paper.reduce((s, i) => s + i.marks, 0)

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="flex items-center justify-between px-6 py-3 bg-indigo-700 text-white shadow-md shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => goTo('/')}
            className="text-xl font-bold tracking-tight hover:text-indigo-200 transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white
                       focus-visible:ring-offset-2 focus-visible:ring-offset-indigo-700 rounded"
          >
            QP Builder
          </button>
          <span className="text-indigo-300 text-sm">MVP</span>
          {view === 'builder' && (
            <button
              onClick={() => goTo('/')}
              className="text-xs text-indigo-300 hover:text-white transition-colors
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white
                         focus-visible:ring-offset-1 focus-visible:ring-offset-indigo-700 rounded px-1"
            >
              ← Home
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          {view === 'builder' && (
            <>
              <span className="text-sm text-indigo-200">
                {paper.length} question{paper.length !== 1 ? 's' : ''} · {totalMarks} marks
              </span>
              <button
                onClick={handleExport}
                disabled={paper.length === 0}
                className="px-4 py-1.5 bg-white text-indigo-700 rounded-md text-sm font-medium
                           hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Export / Print
              </button>
            </>
          )}
        </div>
      </header>

      {view === 'dashboard' ? (
        <Dashboard
          subjectMap={effectiveSubjectMap}
          uploadedSources={uploadedSources}
          papers={papers}
          onBrowseAndBuild={() => goTo('/builder')}
          onUploadBank={() => setShowDashboardUpload(true)}
          onGenerateFromBlueprint={() => {}}
          onOpenPaper={(id) => { setActiveId(id); goTo('/builder') }}
        />
      ) : (
      <div className="flex flex-1 overflow-hidden">
        <QuestionBank
          subjectMap={effectiveSubjectMap}
          uploadedSources={uploadedSources}
          sourceLabels={sourceLabels}
          subject={subject}
          setSubject={handleSelectSubject}
          source={source}
          setSource={setSource}
          lockedSubject={lockedSubject}
          onNewPaper={handleNewPaper}
          questions={visibleQuestions}
          allQuestions={bankQuestions}
          search={search}
          setSearch={setSearch}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          paperQids={paperQids}
          onToggle={handleToggle}
          loading={loading}
          bankError={bankError}
          uploading={uploading}
          uploadError={uploadError}
          onUpload={handleUpload}
          onRenameUpload={handleRenameUpload}
          onDeleteSource={handleDeleteSource}
          onDeleteBankQuestion={handleDeleteBankQuestion}
          onEditBankQuestion={handleEditBankQuestion}
          similarityMap={similarityMap}
          crossSourceMap={crossSourceMap}
        />
        <PaperBuilder
          papers={papers}
          activeId={activeId}
          paper={paper}
          paperTitle={paperTitle}
          setPaperTitle={setTitle}
          rephrasing={rephrasing}
          sections={activePaper.sections}
          activeSectionId={activeSectionId}
          onActiveSectionChange={setActiveSectionId}
          onAddSection={handleAddSection}
          onUpdateSection={handleUpdateSection}
          onDeleteSection={handleDeleteSection}
          onMoveToSection={handleMoveToSection}
          onSwitchPaper={handleSwitchPaper}
          onNewPaper={handleNewPaper}
          onCloseTab={handleCloseTab}
          onRenameTab={handleRenameTab}
          onRemove={handleRemove}
          onRephrase={handleRephrase}
          onUndoRephrase={handleUndoRephrase}
          onMarksChange={handleMarksChange}
          onTextChange={handleTextChange}
          onAddCustom={handleAddCustom}
          onReorder={handleReorder}
          onExport={handleExport}
          onAutoGenerate={() => setShowAutoGenerate(true)}
          canAutoGenerate={bankQuestions.length > 0}
          onClearPaper={() => setItems(() => [])}
        />
      </div>
      )}

      {/* ── Dashboard upload modal ───────────────────────────────────────── */}
      {showDashboardUpload && !uploadPreview && (
        <DashboardUploadModal
          uploading={uploading}
          uploadError={uploadError}
          onUpload={handleUpload}
          onCancel={() => { setShowDashboardUpload(false); setUploadError(null) }}
        />
      )}

      {/* ── Upload review modal ──────────────────────────────────────────── */}
      {uploadPreview && (
        <UploadReviewModal
          upload_id={uploadPreview.upload_id}
          name={uploadPreview.name}
          questions={uploadPreview.raw}
          warnings={uploadPreview.warnings}
          saving={saving}
          onConfirm={handleConfirmUpload}
          onCancel={() => setUploadPreview(null)}
        />
      )}

      {/* ── Auto-generate modal ─────────────────────────────────────────── */}
      {showAutoGenerate && (
        <AutoGenerateModal
          subject={subject}
          source={source}
          sourceLabel={sourceLabels[source] ?? (source === 'qp' ? 'Question Paper' : source)}
          allQuestions={bankQuestions}
          paperQids={paperQids}
          onGenerate={handleAutoGenerate}
          onCancel={() => setShowAutoGenerate(false)}
        />
      )}

      {/* ── Paper config / export dialog ───────────────────────────────── */}
      {showConfigDialog && (
        <PaperConfigDialog
          config={paperConfig}
          computedMarks={paper.reduce((s, i) => s + i.marks, 0)}
          questionCount={paper.length}
          sections={activePaper.sections}
          items={paper}
          onExport={handleConfirmExport}
          onCancel={() => setShowConfigDialog(false)}
        />
      )}

      {/* ── Merge confirmation dialog ──────────────────────────────────── */}
      {mergeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Merge into existing subject?</h2>
            </div>
            <div className="px-6 py-4 space-y-3 text-sm text-gray-700">
              <p>
                The name <span className="font-semibold">"{mergeDialog.name}"</span> matches
                the existing subject <span className="font-semibold capitalize">{mergeDialog.target}</span>.
              </p>
              <p>
                Merging will add these uploaded questions as a new source tab inside{' '}
                <span className="capitalize font-medium">{mergeDialog.target}</span>.
                Questions similar to existing ones will be flagged automatically.
              </p>
              <p className="text-gray-500 text-xs">
                If you want to keep them separate, click Cancel and choose a different name.
              </p>
            </div>
            <div className="px-6 py-4 flex justify-end gap-3 bg-gray-50">
              <button
                onClick={() => handleMerge(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300
                           text-gray-700 hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleMerge(true)}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white
                           font-medium hover:bg-indigo-700 transition"
              >
                Merge into {mergeDialog.target}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

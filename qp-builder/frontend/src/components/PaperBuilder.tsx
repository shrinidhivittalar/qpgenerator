import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { PaperCard } from './PaperCard'
import type { PaperItem, PaperSection, PaperTab } from '../types'
import { mkUid } from '../utils'

interface Props {
  papers:               PaperTab[]
  activeId:             string
  paper:                PaperItem[]
  paperTitle:           string
  setPaperTitle:        (t: string) => void
  rephrasing:           string | null
  sections:             PaperSection[]
  activeSectionId:      string | null
  onActiveSectionChange:(id: string | null) => void
  onAddSection:         (sec: PaperSection) => void
  onUpdateSection:      (id: string, updates: Partial<PaperSection>) => void
  onDeleteSection:      (id: string) => void
  onMoveToSection:      (uid: string, sectionId: string | null) => void
  onSwitchPaper:        (id: string) => void
  onNewPaper:           () => void
  onCloseTab:           (id: string) => void
  onRenameTab:          (id: string, title: string) => void
  onRemove:             (uid: string) => void
  onRephrase:           (uid: string) => void
  onUndoRephrase:       (uid: string) => void
  onMarksChange:        (uid: string, marks: number) => void
  onTextChange:         (uid: string, text: string) => void
  onAddCustom:          (text: string) => void
  onReorder:            (paper: PaperItem[]) => void
  onExport:             () => void
  onAutoGenerate:       () => void
  canAutoGenerate:      boolean
  onClearPaper:         () => void
}

// ── Section edit dialog ───────────────────────────────────────────────────────

interface SectionDraft { title: string; instruction: string; marksPerQ: number }

const DIALOG_INPUT =
  'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent ' +
  'placeholder:text-gray-300 transition'

function SectionEditDialog({
  initial, sectionsCount, onSave, onClose,
}: {
  initial:       SectionDraft | null
  sectionsCount: number
  onSave:        (d: SectionDraft) => void
  onClose:       () => void
}) {
  const defaultTitle = `Section ${String.fromCharCode(65 + sectionsCount)}`
  const [draft, setDraft] = useState<SectionDraft>(
    initial ?? { title: defaultTitle, instruction: '', marksPerQ: 1 }
  )
  function set<K extends keyof SectionDraft>(k: K, v: SectionDraft[K]) {
    setDraft(d => ({ ...d, [k]: v }))
  }
  function handleSave() {
    if (!draft.title.trim()) return
    onSave({ ...draft, title: draft.title.trim(), marksPerQ: Math.max(1, draft.marksPerQ) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">
            {initial ? 'Edit Section' : 'New Section'}
          </h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest block mb-1">
              Title
            </label>
            <input
              autoFocus
              className={DIALOG_INPUT}
              value={draft.title}
              onChange={e => set('title', e.target.value)}
              placeholder="e.g. Section A · Multiple Choice Questions"
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest block mb-1">
              Instruction
            </label>
            <input
              className={DIALOG_INPUT}
              value={draft.instruction}
              onChange={e => set('instruction', e.target.value)}
              placeholder="e.g. Answer any 5 questions."
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest block mb-1">
              Marks per Question
            </label>
            <input
              type="number"
              min={1}
              max={20}
              className={DIALOG_INPUT}
              value={draft.marksPerQ}
              onChange={e => set('marksPerQ', parseInt(e.target.value) || 1)}
            />
            {initial && (
              <p className="text-[10px] text-gray-400 mt-1">
                Changing marks per question will update all questions in this section.
              </p>
            )}
          </div>
        </div>
        <div className="px-5 py-3 flex justify-end gap-2 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-lg border border-gray-300
                       text-gray-700 hover:bg-white transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!draft.title.trim()}
            className="px-4 py-1.5 text-sm rounded-lg bg-indigo-600 text-white font-medium
                       hover:bg-indigo-700 disabled:opacity-40 transition"
          >
            {initial ? 'Save Changes' : 'Add Section'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PaperBuilder({
  papers, activeId, paper, paperTitle, setPaperTitle, rephrasing,
  sections, activeSectionId, onActiveSectionChange,
  onAddSection, onUpdateSection, onDeleteSection, onMoveToSection,
  onSwitchPaper, onNewPaper, onCloseTab, onRenameTab,
  onRemove, onRephrase, onUndoRephrase, onMarksChange, onTextChange,
  onAddCustom, onReorder, onExport, onAutoGenerate, canAutoGenerate, onClearPaper,
}: Props) {
  const [customText, setCustomText]         = useState('')
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [editingTabId, setEditingTabId]     = useState<string | null>(null)
  const [tabDraft, setTabDraft]             = useState('')
  const [sectionDialog, setSectionDialog]   = useState<{
    mode: 'add' | 'edit'
    sec:  PaperSection | null
  } | null>(null)

  function startRenameTab(id: string, currentTitle: string, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingTabId(id)
    setTabDraft(currentTitle)
  }

  function commitRename(id: string) {
    const trimmed = tabDraft.trim()
    if (trimmed) onRenameTab(id, trimmed)
    setEditingTabId(null)
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = paper.findIndex(i => i.uid === active.id)
    const newIdx = paper.findIndex(i => i.uid === over.id)
    if (sections.length > 0) {
      // Block cross-section drags
      if (paper[oldIdx]?.sectionId !== paper[newIdx]?.sectionId) return
    }
    onReorder(arrayMove(paper, oldIdx, newIdx))
  }

  function submitCustom() {
    if (!customText.trim()) return
    onAddCustom(customText.trim())
    setCustomText('')
    setShowCustomForm(false)
  }

  function handleSectionSave(draft: SectionDraft) {
    if (sectionDialog?.mode === 'edit' && sectionDialog.sec) {
      onUpdateSection(sectionDialog.sec.id, draft)
    } else {
      onAddSection({ id: mkUid(), ...draft })
    }
    setSectionDialog(null)
  }

  const totalMarks   = paper.reduce((s, i) => s + i.marks, 0)
  const hasSections  = sections.length > 0
  const getSecItems  = (id: string) => paper.filter(i => i.sectionId === id)
  const unsectioned  = paper.filter(i => !i.sectionId || !sections.find(s => s.id === i.sectionId))

  return (
    <main className="flex flex-col flex-1 overflow-hidden bg-gray-50">

      {/* ── Paper tabs ─────────────────────────────────────────────────── */}
      <div className="flex items-end gap-0 px-3 pt-2 bg-white border-b border-gray-200 shrink-0 overflow-x-auto">
        {papers.map(p => (
          <div
            key={p.id}
            onClick={() => onSwitchPaper(p.id)}
            className={`group flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md
                        cursor-pointer select-none border border-b-0 mr-1 transition whitespace-nowrap
              ${p.id === activeId
                ? 'bg-gray-50 border-gray-200 text-indigo-600'
                : 'bg-gray-100 border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
          >
            {editingTabId === p.id ? (
              <input
                autoFocus
                className="max-w-[120px] bg-white border border-indigo-400 rounded px-1
                           text-xs text-gray-800 outline-none"
                value={tabDraft}
                onChange={e => setTabDraft(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename(p.id)
                  if (e.key === 'Escape') setEditingTabId(null)
                }}
                onBlur={() => commitRename(p.id)}
              />
            ) : (
              <span
                className="max-w-[120px] truncate"
                onDoubleClick={e => startRenameTab(p.id, p.title, e)}
                title="Double-click to rename"
              >
                {p.title}
              </span>
            )}
            {p.items.length > 0 && (
              <span className={`text-[10px] rounded-full px-1.5 py-0.5
                ${p.id === activeId ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-200 text-gray-500'}`}>
                {p.items.length}
              </span>
            )}
            {papers.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); onCloseTab(p.id) }}
                className="ml-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500
                           leading-none transition rounded-full w-4 h-4 flex items-center justify-center"
                title="Close paper"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button
          onClick={onNewPaper}
          className="px-2.5 py-2 text-xs text-gray-400 hover:text-indigo-600 transition mb-0 self-end"
          title="New paper"
        >
          + New
        </button>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <input
            type="text"
            value={paperTitle}
            onChange={e => setPaperTitle(e.target.value)}
            className="flex-1 max-w-xs text-sm font-medium text-gray-700 bg-transparent border-b border-transparent
                       hover:border-gray-300 focus:border-indigo-500 focus:outline-none px-1 transition"
          />
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {paper.length} questions · {totalMarks} marks
          </span>
        </div>
        <div className="flex items-center gap-2 ml-3">
          <button
            onClick={onAutoGenerate}
            disabled={!canAutoGenerate}
            title={canAutoGenerate ? 'Auto-generate paper from bank' : 'Load a question bank first'}
            className="px-3 py-1.5 text-xs rounded-md border border-indigo-300 text-indigo-600
                       hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            ✦ Auto-Generate
          </button>
          {paper.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm(`Clear all ${paper.length} questions from this paper?`)) onClearPaper()
              }}
              className="px-3 py-1.5 text-xs rounded-md border border-red-200 text-red-500
                         hover:bg-red-50 transition"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setShowCustomForm(v => !v)}
            className="px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600
                       hover:bg-gray-50 transition"
          >
            + Custom
          </button>
          <button
            onClick={onExport}
            disabled={paper.length === 0}
            className="px-3 py-1.5 text-xs rounded-md bg-indigo-600 text-white
                       hover:bg-indigo-700 disabled:opacity-40 transition"
          >
            Export
          </button>
        </div>
      </div>

      {/* Custom question form */}
      {showCustomForm && (
        <div className="px-4 py-3 bg-white border-b border-gray-200 shrink-0">
          <textarea
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md resize-none
                       focus:outline-none focus:ring-2 focus:ring-indigo-400"
            rows={3}
            placeholder="Type your custom question here..."
            value={customText}
            onChange={e => setCustomText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) submitCustom() }}
            autoFocus
          />
          <div className="flex gap-2 mt-2">
            <button onClick={submitCustom} disabled={!customText.trim()}
              className="px-3 py-1.5 text-xs rounded-md bg-green-600 text-white
                         hover:bg-green-700 disabled:opacity-40 transition">
              Add Question
            </button>
            <button onClick={() => { setShowCustomForm(false); setCustomText('') }}
              className="px-3 py-1.5 text-xs rounded-md bg-gray-100 text-gray-600
                         hover:bg-gray-200 transition">
              Cancel
            </button>
            <span className="text-xs text-gray-400 self-center ml-1">Ctrl+Enter to add</span>
          </div>
        </div>
      )}

      {/* ── Paper list ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {paper.length === 0 && !hasSections ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2">
            <p className="text-4xl">📋</p>
            <p>This paper is empty.</p>
            <p className="text-xs">Click + on questions from the bank to add them here.</p>
            <button
              onClick={() => setSectionDialog({ mode: 'add', sec: null })}
              className="mt-3 px-4 py-2 text-xs rounded-lg border-2 border-dashed border-indigo-200
                         text-indigo-500 hover:border-indigo-400 hover:bg-indigo-50 transition"
            >
              + Add a section to organise your paper
            </button>
          </div>
        ) : hasSections ? (
          /* ── Sectioned view ─────────────────────────────────────────── */
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div className="space-y-5">
              {sections.map(sec => {
                const secItems = getSecItems(sec.id)
                const isActive = activeSectionId === sec.id
                return (
                  <div key={sec.id}>
                    {/* Section header */}
                    <div
                      onClick={() => onActiveSectionChange(sec.id)}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer
                                  border-2 transition mb-2
                        ${isActive
                          ? 'border-indigo-400 bg-indigo-50'
                          : 'border-gray-200 bg-white hover:border-indigo-200'}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 transition
                          ${isActive ? 'bg-indigo-500' : 'bg-gray-300'}`} />
                        <div>
                          <p className="text-sm font-semibold text-gray-800 leading-tight">{sec.title}</p>
                          {(sec.instruction || sec.marksPerQ > 0) && (
                            <p className="text-xs text-gray-400 leading-tight mt-0.5">
                              {sec.instruction ? sec.instruction : ''}
                              {sec.marksPerQ ? ` · ${sec.marksPerQ}m each` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 ml-2">
                        <span className="text-xs text-gray-400 mr-1">
                          {secItems.length}q · {secItems.reduce((s, i) => s + i.marks, 0)}m
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); setSectionDialog({ mode: 'edit', sec }) }}
                          className="w-6 h-6 flex items-center justify-center rounded text-gray-300
                                     hover:text-indigo-500 hover:bg-indigo-50 transition text-xs"
                          title="Edit section"
                        >
                          ✎
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (secItems.length === 0 || window.confirm(
                              `Delete "${sec.title}"? Its ${secItems.length} question${secItems.length !== 1 ? 's' : ''} will become unsectioned.`
                            )) onDeleteSection(sec.id)
                          }}
                          className="w-6 h-6 flex items-center justify-center rounded text-gray-300
                                     hover:text-red-500 hover:bg-red-50 transition text-xs"
                          title="Delete section"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {secItems.length > 0 ? (
                      <SortableContext
                        items={secItems.map(i => i.uid)}
                        strategy={verticalListSortingStrategy}
                      >
                        <ul className="space-y-2 pl-1">
                          {secItems.map((item, idx) => (
                            <PaperCard
                              key={item.uid}
                              item={item}
                              index={idx}
                              rephrasing={rephrasing}
                              sections={sections}
                              onMoveToSection={onMoveToSection}
                              onRemove={onRemove}
                              onRephrase={onRephrase}
                              onUndoRephrase={onUndoRephrase}
                              onMarksChange={onMarksChange}
                              onTextChange={onTextChange}
                            />
                          ))}
                        </ul>
                      </SortableContext>
                    ) : (
                      <p className={`text-xs italic pl-4 py-2
                        ${isActive ? 'text-indigo-400' : 'text-gray-400'}`}>
                        {isActive
                          ? 'Active — add questions from the bank on the left.'
                          : 'No questions yet. Click this section to make it active.'}
                      </p>
                    )}
                  </div>
                )
              })}

              {/* Unsectioned questions */}
              {unsectioned.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg mb-2">
                    <span className="text-xs font-semibold text-amber-700">
                      Unsectioned ({unsectioned.length})
                    </span>
                    <span className="text-xs text-amber-500">— assign these to a section using the dropdown on each card</span>
                  </div>
                  <SortableContext
                    items={unsectioned.map(i => i.uid)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="space-y-2 pl-1">
                      {unsectioned.map((item, idx) => (
                        <PaperCard
                          key={item.uid}
                          item={item}
                          index={idx}
                          rephrasing={rephrasing}
                          sections={sections}
                          onMoveToSection={onMoveToSection}
                          onRemove={onRemove}
                          onRephrase={onRephrase}
                          onUndoRephrase={onUndoRephrase}
                          onMarksChange={onMarksChange}
                          onTextChange={onTextChange}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </div>
              )}
            </div>
          </DndContext>
        ) : (
          /* ── Flat list (no sections defined) ────────────────────────── */
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={paper.map(i => i.uid)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {paper.map((item, idx) => (
                  <PaperCard
                    key={item.uid}
                    item={item}
                    index={idx}
                    rephrasing={rephrasing}
                    sections={[]}
                    onMoveToSection={() => {}}
                    onRemove={onRemove}
                    onRephrase={onRephrase}
                    onUndoRephrase={onUndoRephrase}
                    onMarksChange={onMarksChange}
                    onTextChange={onTextChange}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        {/* Add Section button */}
        <button
          onClick={() => setSectionDialog({ mode: 'add', sec: null })}
          className="mt-4 w-full px-3 py-2 text-xs rounded-lg border-2 border-dashed
                     border-indigo-200 text-indigo-400 hover:border-indigo-400 hover:text-indigo-600
                     hover:bg-indigo-50 transition"
        >
          + Add Section
        </button>
      </div>

      {/* Section edit dialog */}
      {sectionDialog && (
        <SectionEditDialog
          initial={sectionDialog.mode === 'edit' && sectionDialog.sec
            ? { title: sectionDialog.sec.title, instruction: sectionDialog.sec.instruction, marksPerQ: sectionDialog.sec.marksPerQ }
            : null}
          sectionsCount={sections.length}
          onSave={handleSectionSave}
          onClose={() => setSectionDialog(null)}
        />
      )}
    </main>
  )
}

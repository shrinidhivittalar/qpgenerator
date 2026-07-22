import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TYPE_LABELS, TYPE_COLORS } from '../types'
import type { PaperItem, PaperSection } from '../types'
import { imageUrl } from '../api'
import type { User } from '../api'
import { cleanText } from '../utils'
import { MathText } from './MathText'

interface Props {
  item:            PaperItem
  index:           number
  rephrasing:      string | null
  sections:        PaperSection[]
  onMoveToSection: (uid: string, sectionId: string | null) => void
  onRemove:        (uid: string) => void
  onRephrase:      (uid: string) => void
  onUndoRephrase:  (uid: string) => void
  onMarksChange:   (uid: string, marks: number) => void
  onTextChange:    (uid: string, text: string) => void
  user:            User
}

export function PaperCard({
  item, index, rephrasing, sections, onMoveToSection,
  onRemove, onRephrase, onUndoRephrase, onMarksChange, onTextChange,
  user,
}: Props) {
  const isViewer = user.role === 'Viewer'
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.uid, disabled: isViewer })

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft]         = useState('')

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const isRephrasing = rephrasing === item.uid
  const displayText  = cleanText(item.text)

  function startEdit() {
    if (isViewer) return
    setDraft(displayText)
    setIsEditing(true)
  }

  function cancelEdit() {
    setIsEditing(false)
  }

  function saveEdit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== displayText) {
      onTextChange(item.uid, trimmed)
    }
    setIsEditing(false)
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group/card relative bg-[#faf9f7] rounded-xl border border-stone-200 p-4 shadow-sm hover:border-stone-300 transition"
    >
      <div className="flex items-start gap-3">
        {/* Drag handle */}
        {!isViewer && (
          <div
            {...attributes}
            {...listeners}
            className="drag-handle shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center text-stone-300 hover:text-stone-500 rounded transition"
            title="Drag to reorder"
          >
            ⋮⋮
          </div>
        )}

        {/* Index badge */}
        <div className="shrink-0 font-mono text-xs font-semibold text-stone-400 mt-0.5">
          Q{index}
        </div>

        {/* Card content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium tracking-wide font-mono ${TYPE_COLORS[item.type] || 'bg-stone-100 text-stone-800'}`}>
              {TYPE_LABELS[item.type] || item.type.toUpperCase()}
            </span>
            {item.isRephrased && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium tracking-wide bg-emerald-50 text-emerald-600 font-mono">
                REPHRASED
              </span>
            )}
            {item.isAiGenerated && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium tracking-wide bg-violet-50 text-violet-600 font-mono">
                AI GENERATED
              </span>
            )}
          </div>

          {/* Question text / edit textarea */}
          {isEditing ? (
            <div className="mt-1">
              <textarea
                className="w-full px-3 py-2 text-xs bg-white border border-stone-200 rounded-md focus:outline-none focus:ring-1 focus:ring-stone-900"
                rows={2}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.ctrlKey) saveEdit()
                  if (e.key === 'Escape') cancelEdit()
                }}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={saveEdit}
                  disabled={!draft.trim()}
                  className="px-3 py-1 text-xs rounded bg-stone-900 text-white hover:opacity-90 disabled:opacity-40 transition font-medium"
                >
                  Save
                </button>
                <button
                  onClick={cancelEdit}
                  className="px-3 py-1 text-xs rounded bg-stone-100 text-stone-600 hover:opacity-90 transition font-medium"
                >
                  Cancel
                </button>
                <span className="text-[10px] text-stone-400 self-center">Ctrl+Enter · Esc to cancel</span>
              </div>
            </div>
          ) : (
            <p className={`text-xs text-stone-800 leading-relaxed whitespace-pre-wrap ${isRephrasing ? 'opacity-50' : ''}`}>
              {isRephrasing ? 'Rephrasing...' : <MathText text={displayText} />}
            </p>
          )}

          {/* MCQ options */}
          {!isEditing && !item.isRephrased && item.type === 'mcq' && item.options && item.options.length > 0 && (
            <ul className="mt-2 space-y-1 pl-1">
              {item.options.map((opt, i) => (
                <li key={i} className="flex items-baseline gap-1 text-[11px] text-stone-600">
                  <span className="shrink-0 font-medium text-stone-400">
                    {String.fromCharCode(65 + i)}.
                  </span>
                  <MathText text={opt} />
                </li>
              ))}
            </ul>
          )}

          {/* Images */}
          {!isEditing && item.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {item.images.map(img => (
                <img
                  key={img.fid}
                  src={imageUrl(item.subject, item.source, img.file)}
                  alt={img.fid}
                  className="h-20 w-auto rounded border border-stone-200 object-contain bg-stone-50"
                />
              ))}
            </div>
          )}

          {/* Tables */}
          {!isEditing && item.tables.length > 0 && (
            <div className="mt-3 space-y-1">
              {item.tables.map((tbl, idx) => (
                <div key={tbl.tid}>
                  {idx > 0 && (
                    <div className="flex items-center gap-2 my-2">
                      <div className="flex-1 border-t border-stone-200" />
                      <span className="text-[10px] font-bold text-stone-400 px-1">OR</span>
                      <div className="flex-1 border-t border-stone-200" />
                    </div>
                  )}
                  <div className="overflow-x-auto rounded border border-stone-200">
                    <table className="text-[11px] min-w-full">
                      <thead className="bg-stone-50">
                        <tr>
                          {tbl.headers.map((h, i) => (
                            <th key={i} className="px-2.5 py-1 text-left font-medium text-stone-600 border-b border-stone-200">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tbl.rows.map((row, ri) => (
                          <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-stone-50/60'}>
                            {tbl.headers.map((h, ci) => (
                              <td key={ci} className="px-2.5 py-1 text-stone-700 border-b border-stone-100">
                                {row[h] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Actions row */}
          {!isEditing && (
            <div className="flex items-center gap-2.5 mt-3 flex-wrap">
              {/* Section move */}
              {sections.length > 0 && (
                <select
                  value={item.sectionId ?? ''}
                  onChange={e => onMoveToSection(item.uid, e.target.value || null)}
                  disabled={isViewer}
                  className="text-[11px] border border-stone-200 rounded px-2 py-0.5 text-stone-500 bg-white focus:outline-none"
                  title="Move to section"
                >
                  <option value="">No section</option>
                  {sections.map(s => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              )}

              {/* Marks */}
              <label className="flex items-center gap-1.5 text-[11px] text-stone-500">
                Marks:
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={item.marks}
                  onChange={e => onMarksChange(item.uid, Math.max(1, +e.target.value))}
                  disabled={isViewer}
                  className="w-10 px-1 py-0.5 border border-stone-200 rounded text-center text-[11px] focus:outline-none focus:ring-1 focus:ring-stone-900"
                />
              </label>

              {!isViewer && (
                <>
                  {/* Edit */}
                  <button
                    onClick={startEdit}
                    disabled={isRephrasing}
                    className="px-2.5 py-0.5 text-[11px] rounded border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-40 transition font-medium"
                  >
                    Edit
                  </button>

                  {/* Rephrase */}
                  <button
                    onClick={() => onRephrase(item.uid)}
                    disabled={isRephrasing}
                    className="px-2.5 py-0.5 text-[11px] rounded border border-stone-200 text-stone-700 hover:bg-stone-100 disabled:opacity-40 transition font-medium"
                  >
                    {isRephrasing ? 'Rephrasing...' : 'Rephrase'}
                  </button>

                  {/* Undo rephrase */}
                  {item.isRephrased && (
                    <button
                      onClick={() => onUndoRephrase(item.uid)}
                      className="px-2.5 py-0.5 text-[11px] rounded border border-stone-200 text-stone-500 hover:bg-stone-100 transition font-medium"
                    >
                      Undo
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Remove button */}
        {!isViewer && (
          <button
            onClick={() => onRemove(item.uid)}
            className="shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-stone-300 hover:bg-red-50 hover:text-red-500 transition text-xs"
            title="Remove"
          >
            ✕
          </button>
        )}
      </div>
    </li>
  )
}

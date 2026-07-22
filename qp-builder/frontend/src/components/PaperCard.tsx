import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TYPE_LABELS, TYPE_COLORS } from '../types'
import type { PaperItem, PaperSection } from '../types'
import { imageUrl } from '../api'
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
}

export function PaperCard({
  item, index, rephrasing, sections, onMoveToSection,
  onRemove, onRephrase, onUndoRephrase, onMarksChange, onTextChange,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.uid })

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
    setDraft(displayText)
    setIsEditing(true)
  }

  function saveEdit() {
    if (draft.trim()) onTextChange(item.uid, draft.trim())
    setIsEditing(false)
  }

  function cancelEdit() {
    setIsEditing(false)
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border bg-white p-3 text-sm
        ${isDragging ? 'shadow-xl ring-2 ring-indigo-400' : 'shadow-sm border-gray-200'}`}
    >
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <button
          className="drag-handle shrink-0 mt-1 text-gray-300 hover:text-gray-500 text-lg leading-none select-none"
          {...attributes}
          {...listeners}
          title="Drag to reorder"
        >
          ⠿
        </button>

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-xs font-semibold text-gray-400">#{index + 1}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[item.type]}`}>
              {TYPE_LABELS[item.type]}
            </span>
            {item.subject !== 'custom' && (
              <span className="text-xs text-gray-400 capitalize">{item.subject}</span>
            )}
            {item.isRephrased && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">
                rephrased
              </span>
            )}
          </div>

          {/* Question text — edit mode or display mode */}
          {isEditing ? (
            <div>
              <textarea
                className="w-full px-2 py-1.5 text-sm border border-indigo-400 rounded-md resize-none
                           focus:outline-none focus:ring-2 focus:ring-indigo-400 leading-snug"
                rows={Math.max(3, displayText.split('\n').length + 1)}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.ctrlKey) saveEdit()
                  if (e.key === 'Escape') cancelEdit()
                }}
              />
              <div className="flex gap-2 mt-1.5">
                <button
                  onClick={saveEdit}
                  disabled={!draft.trim()}
                  className="px-2.5 py-0.5 text-xs rounded-md bg-indigo-600 text-white
                             hover:bg-indigo-700 disabled:opacity-40 transition"
                >
                  Save
                </button>
                <button
                  onClick={cancelEdit}
                  className="px-2.5 py-0.5 text-xs rounded-md bg-gray-100 text-gray-600
                             hover:bg-gray-200 transition"
                >
                  Cancel
                </button>
                <span className="text-xs text-gray-400 self-center">Ctrl+Enter · Esc to cancel</span>
              </div>
            </div>
          ) : (
            <p className={`text-gray-800 leading-snug whitespace-pre-wrap ${isRephrasing ? 'opacity-50' : ''}`}>
              {isRephrasing ? 'Rephrasing...' : <MathText text={displayText} />}
            </p>
          )}

          {/* MCQ options — hidden after rephrase because new options are in the rephrased text */}
          {!isEditing && !item.isRephrased && item.type === 'mcq' && item.options && item.options.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 pl-0.5">
              {item.options.map((opt, i) => (
                <li key={i} className="flex items-baseline gap-1 text-xs text-gray-700">
                  <span className="shrink-0 font-medium text-gray-500">
                    {String.fromCharCode(65 + i)}.
                  </span>
                  <MathText text={opt} />
                </li>
              ))}
            </ul>
          )}

          {/* Images */}
          {!isEditing && item.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {item.images.map(img => (
                <img
                  key={img.fid}
                  src={imageUrl(item.subject, item.source, img.file)}
                  alt={img.fid}
                  className="h-20 w-auto rounded border border-gray-200 object-contain bg-gray-50"
                />
              ))}
            </div>
          )}

          {/* Tables */}
          {!isEditing && item.tables.length > 0 && (
            <div className="mt-2 space-y-1">
              {item.tables.map((tbl, idx) => (
                <div key={tbl.tid}>
                  {idx > 0 && (
                    <div className="flex items-center gap-2 my-1.5">
                      <div className="flex-1 border-t border-gray-200" />
                      <span className="text-xs font-semibold text-gray-400 px-1">OR</span>
                      <div className="flex-1 border-t border-gray-200" />
                    </div>
                  )}
                  <div className="overflow-x-auto rounded border border-gray-200">
                    <table className="text-xs min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          {tbl.headers.map((h, i) => (
                            <th key={i} className="px-2 py-1 text-left font-medium text-gray-600 border-b border-gray-200">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tbl.rows.map((row, ri) => (
                          <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-gray-50'}>
                            {tbl.headers.map((h, ci) => (
                              <td key={ci} className="px-2 py-1 text-gray-700 border-b border-gray-100">
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
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              {/* Section move */}
              {sections.length > 0 && (
                <select
                  value={item.sectionId ?? ''}
                  onChange={e => onMoveToSection(item.uid, e.target.value || null)}
                  className="text-xs border border-gray-200 rounded px-1.5 py-0.5 text-gray-500
                             focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                  title="Move to section"
                >
                  <option value="">No section</option>
                  {sections.map(s => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              )}

              {/* Marks */}
              <label className="flex items-center gap-1 text-xs text-gray-500">
                Marks:
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={item.marks}
                  onChange={e => onMarksChange(item.uid, Math.max(1, +e.target.value))}
                  className="w-12 px-1.5 py-0.5 border border-gray-300 rounded text-xs
                             focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </label>

              {/* Edit */}
              <button
                onClick={startEdit}
                disabled={isRephrasing}
                className="px-2.5 py-0.5 text-xs rounded-md bg-gray-100 text-gray-600
                           hover:bg-gray-200 disabled:opacity-40 transition"
              >
                Edit
              </button>

              {/* Rephrase */}
              <button
                onClick={() => onRephrase(item.uid)}
                disabled={isRephrasing}
                className="px-2.5 py-0.5 text-xs rounded-md bg-indigo-50 text-indigo-600
                           hover:bg-indigo-100 disabled:opacity-40 transition"
              >
                {isRephrasing ? 'Rephrasing...' : 'Rephrase'}
              </button>

              {/* Undo rephrase */}
              {item.isRephrased && (
                <button
                  onClick={() => onUndoRephrase(item.uid)}
                  className="px-2.5 py-0.5 text-xs rounded-md bg-gray-100 text-gray-600
                             hover:bg-gray-200 transition"
                >
                  Undo
                </button>
              )}
            </div>
          )}
        </div>

        {/* Remove button */}
        <button
          onClick={() => onRemove(item.uid)}
          className="shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center
                     text-gray-300 hover:bg-red-100 hover:text-red-500 transition text-sm"
          title="Remove"
        >
          ✕
        </button>
      </div>
    </li>
  )
}

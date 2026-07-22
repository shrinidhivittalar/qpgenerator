import { useState } from 'react'
import { TYPE_LABELS, TYPE_COLORS } from '../types'
import type { BankQuestion, QuestionType } from '../types'
import { imageUrl } from '../api'
import { cleanText } from '../utils'
import { MathText } from './MathText'

const STATIC_SOURCE_LABELS: Record<string, string> = { qp: 'QP', textbook: 'Textbook' }

const EDITABLE_TYPES: QuestionType[] = ['mcq', 'text', 'figure_based']

interface Props {
  question:          BankQuestion
  subject:           string
  source:            string
  sourceLabels:      Record<string, string>
  added:             boolean
  locked:            boolean
  paperSimilarity:   number
  crossSimilarity:   { sim: number; src: string } | null
  onToggle:          () => void
  onDeleteQuestion?: () => void
  onEditQuestion?:   (text: string, type: QuestionType) => void
}

export function BankCard({
  question: q, subject, source, sourceLabels, added, locked,
  paperSimilarity, crossSimilarity, onToggle,
  onDeleteQuestion, onEditQuestion,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [editing,  setEditing]  = useState(false)
  const [editText, setEditText] = useState('')
  const [editType, setEditType] = useState<QuestionType>(q.type)

  const srcLabel = (src: string) => sourceLabels[src] ?? STATIC_SOURCE_LABELS[src] ?? src
  const canAdd   = !locked
  const isUploaded = subject === 'uploaded'
  const ct = cleanText(q.text)
  const isLong = ct.length > 150

  const simLevel =
    paperSimilarity >= 0.6 ? 'high'
    : paperSimilarity >= 0.3 ? 'medium'
    : null

  const startEdit = () => {
    setEditText(ct)
    setEditType(q.type)
    setEditing(true)
  }

  const saveEdit = () => {
    if (editText.trim() && onEditQuestion) {
      onEditQuestion(editText.trim(), editType)
    }
    setEditing(false)
  }

  const cancelEdit = () => setEditing(false)

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <li className="rounded-lg border border-indigo-300 bg-indigo-50 p-3 text-sm space-y-2">
        <textarea
          value={editText}
          onChange={e => setEditText(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md resize-y
                     focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
          autoFocus
        />
        <div className="flex items-center gap-2">
          <select
            value={editType}
            onChange={e => setEditType(e.target.value as QuestionType)}
            className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-md bg-white
                       focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            {EDITABLE_TYPES.map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
          <button
            onClick={saveEdit}
            disabled={!editText.trim()}
            className="px-3 py-1.5 text-xs rounded-md bg-indigo-600 text-white font-medium
                       hover:bg-indigo-700 disabled:opacity-40 transition"
          >
            Save
          </button>
          <button
            onClick={cancelEdit}
            className="px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600
                       hover:bg-gray-100 transition"
          >
            Cancel
          </button>
        </div>
      </li>
    )
  }

  // ── Normal view ────────────────────────────────────────────────────────────
  return (
    <li
      className={`rounded-lg border p-3 text-sm transition
        ${added
          ? 'border-indigo-300 bg-indigo-50'
          : locked
          ? 'border-gray-200 bg-gray-50 opacity-60'
          : 'border-gray-200 bg-white hover:border-gray-300'
        }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">

          {/* Header row */}
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <span className="text-xs font-semibold text-gray-400">
              {q.chapter ? q.chapter : `Q${q.number}`}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[q.type]}`}>
              {TYPE_LABELS[q.type]}
            </span>
            {q.section === 'in_text' && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-sky-50 text-sky-600 border border-sky-200">
                in-text
              </span>
            )}
            {q.marks != null && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 font-semibold">
                {q.marks}m
              </span>
            )}
            {q.difficulty && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                q.difficulty === 'Easy'     ? 'bg-green-50 text-green-600' :
                q.difficulty === 'Average'  ? 'bg-yellow-50 text-yellow-600' :
                q.difficulty === 'Difficult'? 'bg-red-50 text-red-600' :
                'bg-gray-50 text-gray-500'
              }`}>
                {q.difficulty}
              </span>
            )}
            {q.has_figure && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-50 text-yellow-600 border border-yellow-200">fig</span>
            )}
            {q.has_table && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-600 border border-purple-200">table</span>
            )}

            {/* Edit / Delete controls — uploaded questions only */}
            {isUploaded && (
              <div className="ml-auto flex items-center gap-1">
                {onEditQuestion && (
                  <button
                    onClick={startEdit}
                    title="Edit question"
                    className="text-gray-300 hover:text-indigo-500 transition text-xs px-1"
                  >
                    ✎
                  </button>
                )}
                {onDeleteQuestion && (
                  <button
                    onClick={onDeleteQuestion}
                    title="Delete question"
                    className="text-gray-300 hover:text-red-400 transition text-xs px-1"
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Question text */}
          <p className={`text-gray-700 leading-snug ${expanded ? '' : 'line-clamp-3'}`}>
            {ct ? <MathText text={ct} /> : <em className="text-gray-400">No text</em>}
          </p>

          {/* Expand / collapse */}
          {isLong && (
            <button
              onClick={() => setExpanded(p => !p)}
              className="mt-1 text-xs text-indigo-500 hover:text-indigo-700 transition"
            >
              {expanded ? 'Show less ▲' : 'Show more ▼'}
            </button>
          )}

          {/* MCQ options */}
          {q.type === 'mcq' && q.options && q.options.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 pl-0.5">
              {q.options.map((opt, i) => (
                <li key={i} className="flex items-baseline gap-1 text-xs text-gray-500">
                  <span className="shrink-0 font-medium text-gray-400">
                    {String.fromCharCode(65 + i)}.
                  </span>
                  <MathText text={opt} />
                </li>
              ))}
            </ul>
          )}

          {/* Figures */}
          {q.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {q.images.map(img => (
                <img
                  key={img.fid}
                  src={imageUrl(subject, source, img.file)}
                  alt={img.fid}
                  className="h-16 w-auto rounded border border-gray-200 object-contain bg-gray-50"
                />
              ))}
            </div>
          )}

          {/* Tables */}
          {q.tables.length > 0 && (
            <div className="mt-2 space-y-1">
              {q.tables.map((tbl, idx) => (
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
                            <th key={i} className="px-2 py-1 text-left font-medium text-gray-600 border-b border-gray-200">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tbl.rows.map((row, ri) => (
                          <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-gray-50'}>
                            {tbl.headers.map((h, ci) => (
                              <td key={ci} className="px-2 py-1 text-gray-700 border-b border-gray-100 last:border-0">
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
        </div>

        {/* Add / Remove button */}
        <button
          onClick={onToggle}
          disabled={locked && !added}
          title={locked ? 'Paper locked to another subject' : added ? 'Remove from paper' : 'Add to paper'}
          className={`shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold
                      transition focus:outline-none focus:ring-2 focus:ring-indigo-400
            ${added
              ? 'bg-indigo-600 text-white hover:bg-red-500'
              : canAdd
              ? 'bg-gray-100 text-gray-500 hover:bg-indigo-600 hover:text-white'
              : 'bg-gray-100 text-gray-300 cursor-not-allowed'
            }`}
        >
          {added ? '✓' : '+'}
        </button>
      </div>
    </li>
  )
}

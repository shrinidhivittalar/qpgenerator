import { useState, useMemo } from 'react'
import { validatePaper } from '../types'
import type { PaperConfiguration, PaperSection, PaperItem } from '../types'

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  config:        PaperConfiguration
  computedMarks: number
  questionCount: number
  sections:      PaperSection[]
  items:         PaperItem[]
  onExport:      (config: PaperConfiguration) => void
  onCancel:      () => void
}

// ── Live header preview ───────────────────────────────────────────────────────
// Mirrors the visual structure of buildPaperHeaderHtml using React JSX so the
// preview updates instantly without building an HTML string.

function PaperHeaderPreview({
  config, computedMarks, questionCount,
}: {
  config:        PaperConfiguration
  computedMarks: number
  questionCount: number
}) {
  const displayMarks = config.totalMarks || computedMarks

  const row1 = [
    config.className && `Class: ${config.className}`,
    config.subject   && `Subject: ${config.subject}`,
    config.section   && `Section: ${config.section}`,
  ].filter(Boolean) as string[]

  const row2 = [
    config.date     && `Date: ${config.date}`,
    config.duration && `Duration: ${config.duration}`,
    displayMarks    && `Maximum Marks: ${displayMarks}`,
  ].filter(Boolean) as string[]

  const hasMetaRows  = row1.length > 0 || row2.length > 0
  const instructions = (config.instructions ?? []).filter(Boolean)

  return (
    <div className="font-sans leading-snug">
      {/* Bordered header box */}
      <div className="border border-gray-700 px-4 py-3 text-center rounded-sm">

        {config.schoolName
          ? <p className="text-sm font-bold uppercase tracking-wide">{config.schoolName}</p>
          : <p className="text-sm font-bold text-gray-300 uppercase tracking-wide">School Name</p>}

        {config.boardName && (
          <p className="text-[10px] text-gray-500 mt-0.5">{config.boardName}</p>
        )}

        {config.examName
          ? <p className="text-xs font-semibold mt-1">{config.examName}</p>
          : <p className="text-xs font-semibold text-gray-300 mt-1">Model Question Paper</p>}

        {config.academicYear && (
          <p className="text-[10px] text-gray-500 mt-0.5">{config.academicYear}</p>
        )}

        {hasMetaRows && (
          <div className="border-t border-gray-400 mt-2 pt-2 space-y-1">
            {row1.length > 0 && (
              <div className="flex justify-between text-[10px] text-gray-700">
                {row1.map((item, i) => <span key={i}>{item}</span>)}
              </div>
            )}
            {row2.length > 0 && (
              <div className="flex justify-between text-[10px] text-gray-700">
                {row2.map((item, i) => <span key={i}>{item}</span>)}
              </div>
            )}
          </div>
        )}

        {!hasMetaRows && (
          <p className="text-[10px] text-gray-400 mt-2 border-t border-gray-200 pt-2">
            Total Marks: {displayMarks} · Questions: {questionCount}
          </p>
        )}
      </div>

      {/* Instructions preview */}
      {instructions.length > 0 && (
        <div className="mt-2 text-left">
          <p className="text-[9px] font-semibold text-gray-600 mb-0.5">General Instructions:</p>
          <ol className="text-[9px] text-gray-600 pl-3 list-decimal space-y-0.5">
            {instructions.slice(0, 4).map((inst, i) => <li key={i}>{inst}</li>)}
            {instructions.length > 4 && (
              <li className="text-gray-400">…and {instructions.length - 4} more</li>
            )}
          </ol>
        </div>
      )}
    </div>
  )
}

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({ label, hint, required, children }: {
  label:    string
  hint?:    string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest block mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

// Returns appropriate input className based on whether the field has an error
function inputCls(err = false) {
  return (
    'w-full px-3 py-2 text-sm border rounded-lg ' +
    'focus:outline-none focus:ring-2 focus:border-transparent placeholder:text-gray-300 transition ' +
    (err ? 'border-red-300 focus:ring-red-300' : 'border-gray-200 focus:ring-indigo-400')
  )
}

const INPUT = inputCls(false)

// ── Dialog ────────────────────────────────────────────────────────────────────

export function PaperConfigDialog({
  config, computedMarks, questionCount, sections, items, onExport, onCancel,
}: Props) {
  const [draft, setDraft] = useState<PaperConfiguration>(() => ({ ...config }))

  // Field-level required checks — shown as red * + red border, not as a list
  const fieldErr = {
    subject:   !draft.subject?.trim(),
    className: !draft.className?.trim(),
    duration:  !draft.duration?.trim(),
  }
  const hasFieldErrors = Object.values(fieldErr).some(Boolean)

  // Non-field errors (section issues, missing questions) — still shown as compact list
  const FIELD_CODES = new Set(['no_subject', 'no_class', 'no_duration'])
  const contentErrors = useMemo(
    () => validatePaper(draft, sections, items).filter(e => !FIELD_CODES.has(e.code)),
    [draft, sections, items]   // eslint-disable-line react-hooks/exhaustive-deps
  )

  const canExport = !hasFieldErrors && contentErrors.length === 0

  function set<K extends keyof PaperConfiguration>(key: K, val: PaperConfiguration[K]) {
    setDraft(d => ({ ...d, [key]: val }))
  }

  function handleExport() {
    const final: PaperConfiguration = {
      ...draft,
      totalMarks:      draft.totalMarks      || computedMarks,
      totalQuestions:  draft.totalQuestions  || questionCount,
      instructions:    (draft.instructions ?? []).filter(Boolean),
    }
    onExport(final)
  }

  const instructionsText = (draft.instructions ?? []).join('\n')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Paper Details</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Saved per paper tab · appears in the exported document header
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center
                       rounded-full hover:bg-gray-100 transition text-lg leading-none ml-4 shrink-0"
          >
            ✕
          </button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">

          {/* Left: Form ─────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">

            {/* School */}
            <section>
              <p className="text-[10px] font-semibold text-gray-300 uppercase tracking-widest mb-3">
                School
              </p>
              <div className="space-y-3">
                <Field label="School Name">
                  <input
                    className={INPUT}
                    value={draft.schoolName}
                    onChange={e => set('schoolName', e.target.value)}
                    placeholder="e.g. Sunshine Public School"
                    autoFocus
                  />
                </Field>

                {/* Logo placeholder — future upload */}
                <div className="flex items-center gap-3 px-3 py-2.5 border border-dashed border-gray-200
                                rounded-xl bg-gray-50 cursor-not-allowed select-none">
                  <div className="w-9 h-9 rounded-lg bg-gray-200 flex items-center justify-center
                                  text-gray-400 text-base shrink-0">
                    🖼
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">School Logo</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Upload coming soon — logo will appear beside school name
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Exam */}
            <section>
              <p className="text-[10px] font-semibold text-gray-300 uppercase tracking-widest mb-3">
                Exam
              </p>
              <div className="space-y-3">
                <Field label="Exam Name">
                  <input
                    className={INPUT}
                    value={draft.examName}
                    onChange={e => set('examName', e.target.value)}
                    placeholder="e.g. Annual Examination 2024-25"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Academic Year">
                    <input
                      className={INPUT}
                      value={draft.academicYear ?? ''}
                      onChange={e => set('academicYear', e.target.value)}
                      placeholder="e.g. 2024-25"
                    />
                  </Field>
                  <Field label="Board / University">
                    <input
                      className={INPUT}
                      value={draft.boardName ?? ''}
                      onChange={e => set('boardName', e.target.value)}
                      placeholder="e.g. Karnataka State Board"
                    />
                  </Field>
                </div>
              </div>
            </section>

            {/* Paper Details */}
            <section>
              <p className="text-[10px] font-semibold text-gray-300 uppercase tracking-widest mb-3">
                Paper Details
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Class" required>
                  <input
                    className={inputCls(fieldErr.className)}
                    value={draft.className}
                    onChange={e => set('className', e.target.value)}
                    placeholder="e.g. 10"
                  />
                </Field>
                <Field label="Subject" required>
                  <input
                    className={inputCls(fieldErr.subject)}
                    value={draft.subject}
                    onChange={e => set('subject', e.target.value)}
                    placeholder="e.g. Mathematics"
                  />
                </Field>
                <Field label="Section">
                  <input
                    className={INPUT}
                    value={draft.section ?? ''}
                    onChange={e => set('section', e.target.value)}
                    placeholder="e.g. A"
                  />
                </Field>
                <Field label="Date">
                  <input
                    className={INPUT}
                    value={draft.date ?? ''}
                    onChange={e => set('date', e.target.value)}
                    placeholder="e.g. 15 March 2025"
                  />
                </Field>
                <Field label="Duration" required>
                  <input
                    className={inputCls(fieldErr.duration)}
                    value={draft.duration}
                    onChange={e => set('duration', e.target.value)}
                    placeholder="e.g. 3 Hours"
                  />
                </Field>
                <Field
                  label="Maximum Marks"
                  hint={draft.totalMarks ? undefined : `Defaults to ${computedMarks} (sum of question marks)`}
                >
                  <input
                    className={INPUT}
                    type="number"
                    min={0}
                    value={draft.totalMarks || ''}
                    onChange={e => set('totalMarks', parseInt(e.target.value) || 0)}
                    placeholder={`${computedMarks}`}
                  />
                </Field>
              </div>
            </section>

            {/* Optional */}
            <section>
              <p className="text-[10px] font-semibold text-gray-300 uppercase tracking-widest mb-3">
                Optional
              </p>
              <div className="space-y-3">
                <Field
                  label="General Instructions"
                  hint="One instruction per line — printed as a numbered list on the paper"
                >
                  <textarea
                    className={INPUT + ' resize-none'}
                    rows={4}
                    value={instructionsText}
                    onChange={e =>
                      set('instructions', e.target.value ? e.target.value.split('\n') : [])
                    }
                    placeholder={
                      'All questions are compulsory.\n' +
                      'Draw neat diagrams wherever necessary.\n' +
                      'Write the question number clearly on your answer sheet.'
                    }
                  />
                </Field>
                <Field label="Footer / Prepared By">
                  <input
                    className={INPUT}
                    value={draft.footerText ?? ''}
                    onChange={e => set('footerText', e.target.value)}
                    placeholder="e.g. Prepared by: Mathematics Department"
                  />
                </Field>
              </div>
            </section>

          </div>

          {/* Right: Preview ──────────────────────────────────────────── */}
          <div className="w-72 shrink-0 bg-slate-50 border-l border-gray-100 overflow-y-auto px-5 py-5">
            <p className="text-[10px] font-semibold text-gray-300 uppercase tracking-widest mb-4">
              Preview
            </p>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <PaperHeaderPreview
                config={draft}
                computedMarks={computedMarks}
                questionCount={questionCount}
              />
            </div>

            <p className="text-[10px] text-gray-300 mt-2 text-center">Updates as you type</p>

            {/* Paper stats */}
            <div className="mt-5 bg-white rounded-xl border border-gray-100 p-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-gray-300 uppercase tracking-widest mb-2">
                Paper Summary
              </p>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Questions</span>
                <span className="font-medium text-gray-800">{questionCount}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Computed total</span>
                <span className="font-medium text-gray-800">{computedMarks} marks</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Maximum Marks</span>
                <span className="font-medium text-indigo-600">
                  {draft.totalMarks || computedMarks}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Section / content errors (not field-level) ───────────── */}
        {contentErrors.length > 0 && (
          <div className="px-6 py-3 bg-red-50 border-t border-red-200 shrink-0">
            <ul className="space-y-0.5">
              {contentErrors.map(e => (
                <li key={e.code} className="flex items-start gap-1.5 text-xs text-red-600">
                  <span className="shrink-0">✗</span>
                  {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between
                        shrink-0 bg-gray-50 rounded-b-2xl">
          <p className="text-xs text-gray-400">
            {hasFieldErrors
              ? <span className="text-red-500">Fill in required fields (<span className="font-semibold">*</span>) to export.</span>
              : 'Configuration is remembered per paper tab.'}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300
                         text-gray-700 hover:bg-white transition"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={!canExport}
              className="px-5 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium
                         hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Export / Print →
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

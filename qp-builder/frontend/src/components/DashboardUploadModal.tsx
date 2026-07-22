import { useState, useRef, useCallback } from 'react'
import type { DragEvent } from 'react'

const PAPER_TYPES = [
  { value: 'sslc_qp',  label: 'QP'        },
  { value: 'textbook', label: 'Textbook'  },
  { value: 'generic',  label: 'Other'     },
]

interface Props {
  uploading:   boolean
  uploadError: string | null
  onUpload:    (file: File, paperType: string) => void
  onCancel:    () => void
}

export function DashboardUploadModal({ uploading, uploadError, onUpload, onCancel }: Props) {
  const [paperType,   setPaperType]   = useState('sslc_qp')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [dragOver,    setDragOver]    = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.pdf')) return
    setPendingFile(file)
  }, [])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleSubmit = useCallback(() => {
    if (!pendingFile) return
    onUpload(pendingFile, paperType)
  }, [pendingFile, paperType, onUpload])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget && !uploading) onCancel() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Add to Question Bank</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              AI will parse your PDF and extract questions automatically
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={uploading}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                       hover:bg-slate-100 hover:text-slate-600 transition
                       disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Paper type segmented control */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Paper type
            </p>
            <div className="flex gap-2">
              {PAPER_TYPES.map(pt => (
                <button
                  key={pt.value}
                  onClick={() => setPaperType(pt.value)}
                  disabled={uploading}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition
                             disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2
                             focus-visible:ring-indigo-400 focus-visible:ring-offset-1
                             ${paperType === pt.value
                               ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                               : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                             }`}
                >
                  {pt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Drop zone */}
          {!uploading && (
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload PDF — drag and drop or click to browse"
              onClick={() => !pendingFile && fileInputRef.current?.click()}
              onKeyDown={e => e.key === 'Enter' && !pendingFile && fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`rounded-xl border-2 border-dashed transition-all duration-150 outline-none
                         focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2
                         ${dragOver
                           ? 'border-indigo-400 bg-indigo-50'
                           : pendingFile
                             ? 'border-emerald-300 bg-emerald-50 cursor-default'
                             : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50 cursor-pointer'
                         }`}
            >
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center select-none">
                {pendingFile ? (
                  <>
                    <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center
                                    justify-center mb-3 text-2xl" aria-hidden="true">
                      ✓
                    </div>
                    <p className="text-sm font-semibold text-slate-700 mb-0.5 truncate max-w-xs">
                      {pendingFile.name}
                    </p>
                    <p className="text-xs text-slate-400 mb-4">
                      {(pendingFile.size / 1024).toFixed(0)} KB · PDF
                    </p>
                    <button
                      onClick={e => { e.stopPropagation(); setPendingFile(null) }}
                      className="text-xs text-slate-400 hover:text-red-500 transition underline
                                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400
                                 focus-visible:ring-offset-2 rounded"
                    >
                      Choose a different file
                    </button>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center
                                    justify-center mb-3" aria-hidden="true">
                      <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24"
                           stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-slate-700 mb-1">
                      {dragOver ? 'Drop it here' : 'Drag your PDF here'}
                    </p>
                    <p className="text-xs text-slate-400 mb-3">or</p>
                    <span className="text-xs font-semibold text-indigo-600 underline">
                      Browse files
                    </span>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                aria-hidden="true"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                  e.target.value = ''
                }}
              />
            </div>
          )}

          {/* Parsing loading state */}
          {uploading && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <svg className="animate-spin h-9 w-9 text-indigo-500" viewBox="0 0 24 24" fill="none"
                   aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10"
                        stroke="currentColor" strokeWidth="3"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-700">AI is reading your paper…</p>
                <p className="text-xs text-slate-400 mt-1">This usually takes 10–20 seconds</p>
              </div>
            </div>
          )}

          {/* Error */}
          {uploadError && !uploading && (
            <div className="px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 leading-relaxed">
              {uploadError}
            </div>
          )}
        </div>

        {/* Footer */}
        {!uploading && (
          <div className="px-6 pb-6 flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 text-sm rounded-xl border border-slate-200 text-slate-600
                         font-medium hover:bg-slate-50 transition focus-visible:outline-none
                         focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!pendingFile}
              className="flex-1 py-2.5 text-sm rounded-xl bg-indigo-600 text-white font-semibold
                         hover:bg-indigo-700 transition focus-visible:outline-none
                         focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Parse with AI
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

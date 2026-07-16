import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Spinner } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { bankApi } from '../lib/api';

interface Upload {
  uploadId:  string;
  total:     number;
  accepted:  number;
  subject:   string | null;
  class:     string | null;
  createdAt: string;
}

function greeting(name: string) {
  const h = new Date().getHours();
  const time = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${time}, ${name.split(' ')[0]}`;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate  = useNavigate();
  const [total,   setTotal]   = useState<number | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadData = useCallback(() => {
    bankApi.stats().then(d => setTotal(d.totalAccepted)).catch(() => setTotal(0));
    bankApi.uploads().then(setUploads).catch(() => setUploads([]));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const deleteUpload = async (uploadId: string) => {
    if (!confirm('Delete all questions from this upload?')) return;
    setDeleting(uploadId);
    try {
      await bankApi.deleteUpload(uploadId);
      loadData();
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Layout>
      <div className="px-8 py-8 max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            {user ? greeting(user.name) : 'Welcome back'}
          </h1>
          <p className="text-slate-500 text-sm mt-1">Here's an overview of your question bank.</p>
        </div>

        {/* Stats + actions */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="card p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-accent-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Total Questions</p>
              {total === null
                ? <Spinner className="w-5 h-5 text-accent-500 mt-1" />
                : <p className="text-3xl font-bold text-slate-900 tabular-nums">{total.toLocaleString()}</p>
              }
            </div>
          </div>

          <button
            onClick={() => navigate('/upload')}
            className="card p-5 text-left border-2 border-dashed border-surface-200 hover:border-accent-300 hover:bg-accent-50/40 transition-all duration-200 group focus-ring"
          >
            <div className="w-10 h-10 rounded-xl bg-accent-100 text-accent-600 flex items-center justify-center mb-3 group-hover:bg-accent-200 transition-colors">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p className="font-semibold text-slate-800 text-sm mb-1">Upload Past Paper</p>
            <p className="text-xs text-slate-500 leading-relaxed">Extract questions automatically from PDFs and images.</p>
          </button>

          <div className="card p-5 opacity-50 cursor-not-allowed" aria-disabled="true">
            <div className="w-10 h-10 rounded-xl bg-surface-100 text-slate-400 flex items-center justify-center mb-3">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </div>
            <p className="font-semibold text-slate-500 text-sm mb-1">Create New Paper</p>
            <p className="text-xs text-slate-400 leading-relaxed">Assemble a fresh assessment from your bank.</p>
            <span className="inline-block mt-2 text-2xs bg-surface-100 text-slate-400 px-2 py-0.5 rounded-full border border-surface-200">Coming soon</span>
          </div>
        </div>

        {/* Recent uploads */}
        <div className="card">
          <div className="px-5 py-4 border-b border-surface-100">
            <h2 className="text-sm font-semibold text-slate-800">Recent Uploads</h2>
          </div>

          {uploads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-100 flex items-center justify-center text-slate-300 mb-3">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-500 mb-1">No papers uploaded yet</p>
              <p className="text-xs text-slate-400 mb-4 max-w-xs leading-relaxed">Upload your first past paper to start building your question bank.</p>
              <button onClick={() => navigate('/upload')} className="btn-primary text-xs px-3 py-1.5">Upload Past Paper</button>
            </div>
          ) : (
            <ul>
              {uploads.map((u, i) => (
                <li key={u.uploadId} className={`flex items-center gap-4 px-5 py-3.5 ${i < uploads.length - 1 ? 'border-b border-surface-100' : ''}`}>
                  <div className="w-8 h-8 rounded-lg bg-accent-50 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {[u.subject, u.class].filter(Boolean).join(' · ') || 'Untitled upload'}
                    </p>
                    <p className="text-xs text-slate-400">{fmt(u.createdAt)} · {u.total} questions extracted · {u.accepted} accepted</p>
                  </div>
                  <button
                    onClick={() => deleteUpload(u.uploadId)}
                    disabled={deleting === u.uploadId}
                    className="btn-danger py-1 px-2 text-xs shrink-0"
                    aria-label="Delete this upload"
                  >
                    {deleting === u.uploadId ? <Spinner className="w-3.5 h-3.5" /> : 'Delete'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Layout>
  );
}

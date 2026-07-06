import { useState } from 'react';
import { QUESTION_TYPE_LABELS, QuestionType } from '../types';

interface Question {
  id:           number;
  marks:        number;
  explanation:  string;
  question?:    { text: string; hide_text: boolean; image: string };
  assertion?:   string;
  modelAnswer?: string;
  [key: string]: unknown;
}

interface Props {
  questionType: string;
  totalMarks:   number;
  questions:    unknown[];
}

function QuestionCard({ q, index }: { q: Question; index: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-800">
          <span className="text-gray-400 mr-1">#{index + 1}</span>
          {q.question?.text ?? q.assertion ?? q.modelAnswer ?? 'Question'}
        </p>
        <span className="shrink-0 text-xs text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
          {q.marks} {q.marks === 1 ? 'mark' : 'marks'}
        </span>
      </div>
      <p className="text-xs text-gray-500 italic">{q.explanation}</p>
    </div>
  );
}

export default function QuestionBlock({ questionType, totalMarks, questions }: Props) {
  const [open, setOpen] = useState(false);
  const label = QUESTION_TYPE_LABELS[questionType as QuestionType] ?? questionType;

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 bg-white hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <div className="text-left">
            <p className="font-semibold text-gray-800 text-sm">{label}</p>
            <p className="text-xs text-gray-500">
              {questions.length} {questions.length === 1 ? 'question' : 'questions'} - {totalMarks} marks
            </p>
          </div>
        </div>
        <span className="text-xs font-medium text-green-600 bg-green-50 border border-green-100 rounded px-2 py-0.5">
          Generated
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-2">
          {(questions as Question[]).map((q, i) => (
            <QuestionCard key={q.id ?? i} q={q} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
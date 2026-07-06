import { Schema, model, Types } from 'mongoose';

interface ICandidate {
  tempId:          string;
  suggestedTitle:  string;
  suggestedNumber: number;
  startOffset:     number;
  endOffset:       number;
  detectionMethod: 'bookmark' | 'heuristic' | 'llm';
}

export interface ITextbookUploadDraft {
  teacherId:  Types.ObjectId;
  subject:    string;
  fullText:   string;
  candidates: ICandidate[];
  createdAt:  Date;
  updatedAt:  Date;
}

const CandidateSchema = new Schema<ICandidate>(
  {
    tempId:          { type: String },
    suggestedTitle:  { type: String },
    suggestedNumber: { type: Number },
    startOffset:     { type: Number },
    endOffset:       { type: Number },
    detectionMethod: { type: String, enum: ['bookmark', 'heuristic', 'llm'] },
  },
  { _id: false },
);

// Short-lived document — Teacher should confirm promptly. Simplest v1 is to
// delete the draft once confirmed (Stage 1e). A TTL index (e.g. 24 hours) is
// a reasonable follow-up addition.
const TextbookUploadDraftSchema = new Schema<ITextbookUploadDraft>(
  {
    teacherId:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subject:    { type: String, required: true },
    fullText:   { type: String, required: true },
    candidates: { type: [CandidateSchema], default: [] },
  },
  { timestamps: true },
);

TextbookUploadDraftSchema.index({ teacherId: 1 });

export default model<ITextbookUploadDraft>('TextbookUploadDraft', TextbookUploadDraftSchema);

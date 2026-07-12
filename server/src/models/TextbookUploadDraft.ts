import { Schema, model, Types } from 'mongoose';

interface ICandidate {
  tempId:          string;
  suggestedTitle:  string;
  suggestedNumber: number;
  startOffset:     number;
  endOffset:       number;
  detectionMethod: 'bookmark' | 'heuristic' | 'llm';
}

export interface IFigurePage {
  pageNum: number;
  base64:  string;
  width:   number;
  height:  number;
}

export interface ITextbookUploadDraft {
  teacherId:   Types.ObjectId;
  subject:     string;
  fullText:    string;
  candidates:  ICandidate[];
  pageOffsets: number[];   // char offset where each PDF page starts in fullText
  figurePages: IFigurePage[];
  createdAt:   Date;
  updatedAt:   Date;
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

const FigurePageSchema = new Schema<IFigurePage>(
  {
    pageNum: { type: Number, required: true },
    base64:  { type: String, required: true },
    width:   { type: Number, required: true },
    height:  { type: Number, required: true },
  },
  { _id: false },
);

const TextbookUploadDraftSchema = new Schema<ITextbookUploadDraft>(
  {
    teacherId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subject:     { type: String, required: true },
    fullText:    { type: String, required: true },
    candidates:  { type: [CandidateSchema], default: [] },
    pageOffsets: { type: [Number], default: [] },
    figurePages: { type: [FigurePageSchema], default: [] },
  },
  { timestamps: true },
);

TextbookUploadDraftSchema.index({ teacherId: 1 });

export default model<ITextbookUploadDraft>('TextbookUploadDraft', TextbookUploadDraftSchema);

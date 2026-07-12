import { Schema, model, Types } from 'mongoose';

export interface ITextbookChapter {
  teacherId:          Types.ObjectId;
  subject:            string;
  title:              string;
  chapterNumber:      number;
  weightPercent:      number;
  sourceText:         string;
  highValueSnippets:  string[];
  createdAt:          Date;
  updatedAt:          Date;
}

const TextbookChapterSchema = new Schema<ITextbookChapter>(
  {
    teacherId:         { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subject:           { type: String, required: true, trim: true },
    title:             { type: String, required: true, trim: true },
    chapterNumber:     { type: Number, required: true, min: 1 },
    weightPercent:     { type: Number, required: true, min: 0, max: 100 },
    sourceText:        { type: String, required: true },
    highValueSnippets: { type: [String], default: [] },
  },
  { timestamps: true },
);

TextbookChapterSchema.index({ teacherId: 1 });

export default model<ITextbookChapter>('TextbookChapter', TextbookChapterSchema);

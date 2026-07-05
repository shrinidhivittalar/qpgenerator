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
    subject:           { type: String, required: true },
    title:             { type: String, required: true },
    chapterNumber:     { type: Number, required: true },
    weightPercent:     { type: Number, required: true },
    sourceText:        { type: String, required: true },
    highValueSnippets: { type: [String], default: [] },
  },
  { timestamps: true },
);

TextbookChapterSchema.index({ teacherId: 1 });

export default model<ITextbookChapter>('TextbookChapter', TextbookChapterSchema);

import { Schema, model, Types } from 'mongoose';

export interface IChapterFigurePage {
  chapterId: Types.ObjectId;
  teacherId: Types.ObjectId;
  pageNum:   number;
  base64:    string;
  width:     number;
  height:    number;
  mimeType?: string;  // defaults to 'image/png'; manually uploaded assets may be jpeg/webp
}

const ChapterFigurePageSchema = new Schema<IChapterFigurePage>(
  {
    chapterId: { type: Schema.Types.ObjectId, ref: 'TextbookChapter', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'User',             required: true },
    pageNum:   { type: Number,  required: true },
    base64:    { type: String,  required: true },
    width:     { type: Number,  required: true },
    height:    { type: Number,  required: true },
    mimeType:  { type: String,  default: 'image/png' },
  },
  { timestamps: false },
);

// Primary access pattern: all figure pages for a chapter, in page order.
ChapterFigurePageSchema.index({ chapterId: 1, pageNum: 1 });
// Secondary: clean up all pages when a teacher's chapters are deleted.
ChapterFigurePageSchema.index({ teacherId: 1 });

export default model<IChapterFigurePage>('ChapterFigurePage', ChapterFigurePageSchema);

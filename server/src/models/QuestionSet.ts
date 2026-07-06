import { Schema, model } from 'mongoose';
import { TypeConfigSchema } from './shared.js';

const QuestionBlockSchema = new Schema(
  {
    questionType: { type: String, required: true },
    totalMarks:   { type: Number, required: true },
    status:       { type: String, enum: ['success', 'failed'], default: 'success' },
    questions:    { type: [Schema.Types.Mixed], default: [] },
  },
  { _id: false },
);

const GenerationErrorSchema = new Schema(
  {
    type:      { type: String, required: true },
    requested: { type: Number, required: true },
    received:  { type: Number, required: true },
    error:     { type: String, required: true },
  },
  { _id: false },
);

const ExportEventSchema = new Schema(
  {
    exportedAt:     { type: Date, default: Date.now },
    fileName:       { type: String, required: true },
    typeCount:      { type: Number, required: true },
    totalQuestions: { type: Number, required: true },
  },
  { _id: false },
);

const QuestionSetSchema = new Schema(
  {
    teacherId:          { type: Schema.Types.ObjectId, ref: 'User', required: true },
    department:         { type: String, required: true },
    fileName:           { type: String, required: true },
    sourceText:         { type: String, required: true },
    status: {
      type:    String,
      enum:    ['draft', 'generating', 'review_pending', 'revision_requested', 'approved', 'archived'],
      default: 'draft',
    },
    typeConfig:           { type: [TypeConfigSchema],        default: [] },
    questionBlocks:       { type: [QuestionBlockSchema],     default: [] },
    generationErrors:     { type: [GenerationErrorSchema],   default: [] },
    exportHistory:        { type: [ExportEventSchema],       default: [] },
    schemeId:             { type: Schema.Types.ObjectId, ref: 'Scheme',  default: null },
    difficultyDefault:    { type: String, enum: ['easy', 'moderate', 'hard'], default: null },
    tone:                 { type: String, enum: ['formal-board-exam', 'neutral', 'conversational'], default: null },
    bankId:               { type: String, default: null },
    chapterIds:           { type: [Schema.Types.ObjectId], ref: 'TextbookChapter', default: [] },
    hodId:                { type: Schema.Types.ObjectId, ref: 'User',    default: null },
    hodComment:           { type: String,   default: null },
    typesUnderRevision:   { type: [String], default: [] },
    approvedAt:           { type: Date,     default: null },
    submittedAt:          { type: Date,     default: null },
  },
  { timestamps: true },
);

QuestionSetSchema.index({ teacherId: 1 });
QuestionSetSchema.index({ department: 1, status: 1 });
QuestionSetSchema.index({ status: 1 });
QuestionSetSchema.index({ createdAt: -1 });

export const QuestionSet = model('QuestionSet', QuestionSetSchema);

import { Schema, model } from 'mongoose';

const GenerationRunSchema = new Schema(
  {
    setId:           { type: Schema.Types.ObjectId, ref: 'QuestionSet', required: true },
    userId:          { type: Schema.Types.ObjectId, ref: 'User',        required: true },
    role:            { type: String,                required: true },
    typesRequested:  { type: [String],              required: true },
    typesSucceeded:  { type: [String],              default: [] },
    typesFailed:     { type: [String],              default: [] },
    countsRequested: { type: Schema.Types.Mixed,    required: true },
    countsGenerated: { type: Schema.Types.Mixed,    default: {} },
    tokensUsed:      { type: Number,                default: 0 },
    durationMs:      { type: Number,                default: 0 },
    requestId:       { type: String },
    chapterIds:      { type: [Schema.Types.ObjectId], ref: 'TextbookChapter', default: [] },
  },
  { timestamps: true },
);

GenerationRunSchema.index({ setId: 1 });
GenerationRunSchema.index({ userId: 1 });
GenerationRunSchema.index({ createdAt: -1 });
GenerationRunSchema.index({ typesFailed: 1 });

export const GenerationRun = model('GenerationRun', GenerationRunSchema);

import { Schema, model } from 'mongoose';

const ReferenceExemplarSchema = new Schema(
  {
    teacherId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    uploadId:     { type: String, required: true },
    questionType: { type: String, required: true },
    rawText:      { type: String, required: true },
    status:       { type: String, enum: ['accepted', 'needs_review', 'rejected'], default: 'needs_review' },
    confidence:   { type: Number, default: 0 },
    marks:        { type: Number, default: null },
    subject:      { type: String, default: null },
    class:        { type: String, default: null },
    chapter:      { type: String, default: null },
    sourceYear:   { type: Number, default: null },
  },
  { timestamps: true },
);

ReferenceExemplarSchema.index({ teacherId: 1, status: 1 });
ReferenceExemplarSchema.index({ teacherId: 1, uploadId: 1, status: 1 });
ReferenceExemplarSchema.index({ teacherId: 1, subject: 1, class: 1, questionType: 1, status: 1 });

export const ReferenceExemplar = model('ReferenceExemplar', ReferenceExemplarSchema);

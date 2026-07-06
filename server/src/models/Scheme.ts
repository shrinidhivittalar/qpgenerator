import { Schema, model } from 'mongoose';
import { TypeConfigSchema } from './shared.js';

const SchemeSchema = new Schema(
  {
    teacherId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name:          { type: String, required: true, maxlength: 100 },
    subject:       { type: String, required: true },
    standard:      { type: String, required: true },
    examType:      { type: String, default: '' },
    rawText:       { type: String, required: true },
    parsedConfig:  { type: [TypeConfigSchema], required: true },
    examBlueprint: { type: Schema.Types.Mixed, default: null },
    fileType:      { type: String, enum: ['pdf', 'docx'], required: true },
  },
  { timestamps: true },
);

SchemeSchema.index({ teacherId: 1 });

export default model('Scheme', SchemeSchema);

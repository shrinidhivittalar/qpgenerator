import { Schema, model } from 'mongoose';

const BankStyleGuideSchema = new Schema(
  {
    teacherId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
    bankId:        { type: String, required: true },
    styleGuide:    { type: Schema.Types.Mixed, required: true },
    questionCount: { type: Number, required: true },
  },
  { timestamps: true },
);

BankStyleGuideSchema.index({ teacherId: 1, bankId: 1 }, { unique: true });

export const BankStyleGuide = model('BankStyleGuide', BankStyleGuideSchema);

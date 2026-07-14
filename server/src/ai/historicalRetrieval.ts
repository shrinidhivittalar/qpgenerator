import { ReferenceExemplar } from '../models/ReferenceExemplar.js';

export async function countExemplarsForType(
  teacherId: string,
  type:      string,
): Promise<number> {
  return ReferenceExemplar.countDocuments({ teacherId, questionType: type });
}

export async function getHistoricalCandidate(
  teacherId: string,
  chapterId: string | null,
  type: string,
): Promise<{ rawText: string; sourceYear: number | null } | null> {
  const query: Record<string, unknown> = { teacherId, questionType: type };
  if (chapterId) query.chapterId = chapterId;

  let docs = await ReferenceExemplar.find(query).lean();

  if (docs.length === 0 && chapterId) {
    // Chapter-tagged search returned nothing for this type — fall back to any
    // exemplar of this type regardless of chapter so the caller always has
    // rephrase/variant material when the bank has relevant content.
    docs = await ReferenceExemplar.find({ teacherId, questionType: type }).lean();
  }

  if (docs.length === 0) return null;

  const pick = docs[Math.floor(Math.random() * docs.length)];
  return {
    rawText:    pick.rawText as string,
    sourceYear: (pick.sourceYear as number | null | undefined) ?? null,
  };
}

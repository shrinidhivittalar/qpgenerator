import {
  BlueprintMetadata,
  inferExamBlueprint,
  typeConfigFromBlueprint,
} from './blueprintInferencer.js';
import { ExamBlueprint } from '../validation/schemas/examBlueprint.js';

export type TypeConfig = {
  type: string;
  count: number;
  marksPerQuestion: number;
};

function mergeDuplicateTypes(config: TypeConfig[]): TypeConfig[] {
  const merged = new Map<string, TypeConfig>();
  for (const tc of config) {
    const key = `${tc.type}:${tc.marksPerQuestion}`;
    if (merged.has(key)) {
      merged.get(key)!.count += tc.count;
    } else {
      merged.set(key, { ...tc });
    }
  }
  return Array.from(merged.values());
}

export async function parseSchemeBlueprint(
  rawText: string,
  metadata: BlueprintMetadata = {},
): Promise<ExamBlueprint> {
  try {
    return await inferExamBlueprint(rawText, metadata);
  } catch (err) {
    if ((err as Error).message === 'BLUEPRINT_PARSE_FAILED') {
      throw new Error('SCHEME_PARSE_FAILED');
    }
    throw err;
  }
}

export async function parseScheme(
  rawText: string,
  metadata: BlueprintMetadata = {},
): Promise<TypeConfig[]> {
  const blueprint = await parseSchemeBlueprint(rawText, metadata);
  const config = typeConfigFromBlueprint(blueprint);
  if (config.length === 0) throw new Error('SCHEME_PARSE_FAILED');
  return mergeDuplicateTypes(config);
}

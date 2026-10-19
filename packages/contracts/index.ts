import { z } from 'zod';
export const TYPES = ['receipt', 'discharge_summary', 'lab_report', 'prescription'] as const;
export const required: Record<string, string[]> = {
  receipt: [
    'hospital_name',
    'patient_name',
    'date',
    'grand_total',
    'payment_method',
    'currency',
    'items',
  ],
  discharge_summary: [
    'hospital_name',
    'patient_name',
    'admission_date',
    'discharge_date',
    'diagnosis.primary',
    'diagnosis.secondary',
    'procedures_performed',
    'attending_physician',
    'discharge_instructions',
  ],
  lab_report: ['lab_name', 'patient_name', 'date', 'tests'],
  prescription: ['doctor_name', 'patient_name', 'date', 'medications'],
};
export const inputField = z
  .object({
    path: z.string().min(1).max(160),
    raw_value: z.string().max(20000).nullable(),
    value: z.string().max(20000).nullable(),
    confidence: z.number().min(0).max(1),
    page: z.number().int().positive(),
    // Homogeneous items are required by OpenAI Structured Outputs; tuples emit an unsupported items array.
    bbox: z.array(z.number()).length(4).nullable(),
    handwritten_uncertain: z.boolean(),
  })
  .strict();
export const readerSchema = z
  .object({
    documents: z
      .array(
        z
          .object({
            document_type: z.enum(TYPES),
            classification_confidence: z.number().min(0).max(1),
            segmentation_confidence: z.number().min(0).max(1),
            pages: z.array(z.number().int().positive()).min(1),
            fields: z.array(inputField).max(3000),
          })
          .strict(),
      )
      .max(100),
    unsupported_pages: z.array(z.number().int().positive()),
  })
  .strict();
export type ReaderOutput = z.infer<typeof readerSchema>;
export type Issue = { code: string; path: string; message: string; blocking: boolean };
export type Evidence = {
  page: number;
  bbox: number[] | null;
  image: string;
  source_image: string;
  fallback: boolean;
};
export type Field = z.infer<typeof inputField> & {
  extraction_confidence: number;
  final_confidence: number;
  final_value: string | null;
  candidate_value: string | null;
  normalized_value: string | null;
  review_status: 'pending' | 'confirmed' | 'corrected';
  requires_review: boolean;
  warnings: string[];
  review_reasons?: string[];
  evidence?: Evidence;
  missing: boolean;
  draft_value?: string | null;
};
export type DocumentResult = {
  document_id: string;
  document_type: (typeof TYPES)[number];
  pages: number[];
  classification_confidence: number;
  segmentation_confidence: number;
  structure_confirmed: boolean;
  requires_structure_review?: boolean;
  fields: Field[];
  confidence: number;
  final_confidence: number;
  validation_errors: Issue[];
};
export function validPath(type: string, path: string) {
  if (path.split('.').some((s) => ['__proto__', 'constructor', 'prototype'].includes(s)))
    return false;
  const scalar =
    required[type]?.filter(
      (s) => !['items', 'tests', 'medications', 'procedures_performed'].includes(s),
    ) ?? [];
  if (scalar.includes(path)) return true;
  const patterns: Record<string, RegExp[]> = {
    receipt: [
      /^items\.\d{1,4}\.(description|quantity|unit_price|total)$/,
      /^(tax|discount|refund)$/,
    ],
    lab_report: [/^tests\.\d{1,4}\.(test_name|result|unit|reference_range|flag)$/],
    prescription: [/^medications\.\d{1,4}\.(name|dosage|frequency|duration|quantity)$/],
    discharge_summary: [/^procedures_performed\.\d{1,4}$/],
  };
  return required[type]?.includes(path) || patterns[type]?.some((r) => r.test(path)) || false;
}
export function confidenceBand(n: number) {
  return n < 0.2
    ? 'very-low'
    : n < 0.5
      ? 'low'
      : n < 0.8
        ? 'medium'
        : n < 0.95
          ? 'high'
          : 'very-high';
}
export function flatOutputFields(fields: Field[]) {
  const result: Record<string, unknown> = {};
  for (const f of fields) {
    // Flat field paths are canonical: preserve every list item without unsafe object traversal.
    result[f.path] = {
      value: f.normalized_value,
      confidence: f.extraction_confidence,
      raw_value: f.raw_value,
      candidate_value: f.candidate_value,
      final_value: f.final_value,
      final_confidence: f.final_confidence,
      review_status: f.review_status,
      requires_review: f.requires_review,
      review_reasons: f.review_reasons ?? [],
      warnings: f.warnings,
      evidence: f.evidence,
    };
  }
  return result;
}

export function outputFields(fields: Field[]) {
  const flat = flatOutputFields(fields),
    result: Record<string, any> = {};
  const grouped = new Map<string, Field[]>();
  for (const f of fields) {
    const root = f.path.split('.')[0];
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root)!.push(f);
  }
  for (const [root, leaves] of grouped) {
    if (leaves.length === 1 && leaves[0].path === root) {
      result[root] = flat[root];
      continue;
    }
    const isList = leaves.some((f) => /^\d+$/.test(f.path.split('.')[1]));
    const values: any = isList ? [] : {};
    for (const f of leaves) {
      const parts = f.path.split('.').slice(1);
      let cursor = values;
      for (let i = 0; i < parts.length; i++) {
        const k = parts[i];
        if (i === parts.length - 1) cursor[k] = flat[f.path];
        else cursor = cursor[k] ??= /^\d+$/.test(parts[i + 1]) ? [] : {};
      }
    }
    result[root] = {
      value: values,
      confidence: Math.min(...leaves.map((f) => f.extraction_confidence)),
      final_confidence: Math.min(...leaves.map((f) => f.final_confidence)),
    };
  }
  return result;
}

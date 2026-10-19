import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import {
  Field,
  DocumentResult,
  Issue,
  ReaderOutput,
  required,
  validPath,
} from '../contracts/index.js';
const D = (Decimal.default ?? Decimal).clone({ precision: 50 });
export function money(raw: string, currency: string | null) {
  if (!currency || !/^(USD|VND|EUR|GBP|THB|JPY|AUD|CAD|SGD)$/.test(currency))
    throw Error('CURRENCY_UNCLEAR');
  let v = raw.trim(),
    negative = /^\(.*\)$/.test(v);
  if (negative) v = v.slice(1, -1);
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(v)) throw Error('MONEY_FORMAT_UNCLEAR');
  const n = new D(v.replaceAll(',', '')).times(negative ? -1 : 1);
  if (n.sd() > 34) throw Error('DECIMAL_PRECISION');
  return n.toFixed();
}
export function date(raw: string): { value: string | null; warning?: string } {
  let d: number, m: number, y: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) [y, m, d] = raw.split('-').map(Number);
  else if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    [d, m, y] = raw.split('/').map(Number);
    if (d <= 12 && m <= 12 && d !== m) return { value: null, warning: 'AMBIGUOUS_DATE' };
  } else return { value: null, warning: 'DATE_FORMAT_UNCLEAR' };
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d)
    return { value: null, warning: 'INVALID_DATE' };
  return {
    value: `${y.toString().padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  };
}
export function mismatch(total: string, expected: string) {
  const t = new D(total),
    e = new D(expected);
  return t.isZero() ? !e.isZero() : e.minus(t).abs().div(t.abs()).gt('.05');
}
const monetary = (p: string) => /grand_total|unit_price|\.total$|^(tax|discount|refund)$/.test(p);
export function makeDocuments(output: ReaderOutput): DocumentResult[] {
  return output.documents.map((doc) => {
    const paths = new Set<string>();
    for (const f of doc.fields) {
      if (!validPath(doc.document_type, f.path) || paths.has(f.path))
        throw Error('INVALID_FIELD_PATH');
      paths.add(f.path);
    }
    const fields: Field[] = doc.fields.map((f) => ({
      ...f,
      extraction_confidence: f.confidence,
      final_confidence: f.confidence,
      final_value: f.value,
      candidate_value: null,
      normalized_value: null,
      review_status: 'pending',
      requires_review: false,
      warnings: [],
      missing: f.raw_value === null,
    }));
    for (const path of required[doc.document_type])
      if (!fields.some((f) => f.path === path || f.path.startsWith(path + '.')))
        fields.push({
          path,
          raw_value: null,
          value: null,
          confidence: 0,
          page: doc.pages[0],
          bbox: null,
          handwritten_uncertain: false,
          extraction_confidence: 0,
          final_confidence: 0,
          final_value: null,
          candidate_value: null,
          normalized_value: null,
          review_status: 'pending',
          requires_review: true,
          warnings: [],
          missing: true,
        });
    // A partial list item must not hide missing required leaf fields.
    const lists: Record<string, string[]> = {
      items: ['description', 'quantity', 'unit_price', 'total'],
      tests: ['test_name', 'result', 'unit', 'reference_range', 'flag'],
      medications: ['name', 'dosage', 'frequency', 'duration', 'quantity'],
    };
    for (const [root, leaves] of Object.entries(lists)) {
      const indices = new Set(
        fields.filter((f) => f.path.startsWith(root + '.')).map((f) => f.path.split('.')[1]),
      );
      for (const index of indices)
        for (const leaf of leaves) {
          const path = `${root}.${index}.${leaf}`;
          if (fields.some((f) => f.path === path)) continue;
          fields.push({
            path,
            raw_value: null,
            value: null,
            confidence: 0,
            page: doc.pages[0],
            bbox: null,
            handwritten_uncertain: false,
            extraction_confidence: 0,
            final_confidence: 0,
            final_value: null,
            candidate_value: null,
            normalized_value: null,
            review_status: 'pending',
            requires_review: true,
            warnings: [],
            missing: true,
          });
        }
    }
    return evaluate({
      ...doc,
      document_id: randomUUID(),
      fields,
      structure_confirmed: false,
      confidence: 0,
      final_confidence: 0,
      validation_errors: [],
    });
  });
}
export function evaluate(doc: DocumentResult): DocumentResult {
  const errors: Issue[] = [];
  const currency = doc.fields.find((f) => f.path === 'currency')?.final_value ?? null;
  for (const f of doc.fields) {
    f.warnings = [];
    let score = f.confidence,
      mandatory = false,
      normalized = f.value;
    const original = f.raw_value;
    if (original === null) {
      score = 0;
      mandatory = true;
      f.warnings.push('MISSING_FIELD');
      normalized = null;
    }
    if (f.handwritten_uncertain) {
      score = Math.min(score, 0.49);
      mandatory = true;
      f.warnings.push('HANDWRITING_UNCERTAIN');
    }
    if (/(?:^|_)date$/.test(f.path)) {
      mandatory = true;
      const parsed = original === null ? { value: null } : date(original);
      normalized = parsed.value;
      if (parsed.warning) {
        score = Math.min(score, 0.49);
        f.warnings.push(parsed.warning);
      }
    }
    if (monetary(f.path) && original !== null) {
      try {
        normalized = money(original, doc.fields.find((x) => x.path === 'currency')?.value ?? null);
      } catch (e) {
        score = Math.min(score, 0.49);
        normalized = null;
        f.warnings.push((e as Error).message);
      }
      if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}$/.test(original)) {
        mandatory = true;
        f.warnings.push('NON_STANDARD_MONEY_FORMAT');
      }
      if (score < 0.5) mandatory = true;
    }
    if (
      f.path === 'currency' &&
      (original === null || !/^(USD|VND|EUR|GBP|THB|JPY|AUD|CAD|SGD)$/.test(original))
    ) {
      score = Math.min(score, 0.49);
      mandatory = true;
      f.warnings.push('CURRENCY_UNCLEAR');
    }
    if (f.path.endsWith('.flag')) {
      mandatory = true;
      if (original !== null && !['normal', 'high', 'low'].includes(original.trim().toLowerCase())) {
        score = Math.min(score, 0.49);
        normalized = null;
        f.warnings.push('FLAG_OUTSIDE_ENUM');
      } else normalized = original?.trim().toLowerCase() ?? null;
    }
    if (!Number.isFinite(score) || score < 0 || score > 1) score = 0;
    f.extraction_confidence = score;
    f.normalized_value = normalized;
    f.candidate_value = normalized === null && original !== null ? f.value : null;
    f.requires_review = mandatory || score < 0.5;
    if (f.review_status === 'pending') {
      f.final_confidence = f.draft_value !== undefined ? Math.min(score, 0.49) : score;
      f.final_value = f.draft_value !== undefined ? f.draft_value : normalized;
      if (f.draft_value !== undefined) f.requires_review = true;
    } else {
      if (f.final_value !== null && /(?:^|_)date$/.test(f.path)) {
        const parsed = date(f.final_value);
        if (!parsed.value)
          errors.push({
            code: parsed.warning!,
            path: f.path,
            message: 'Resolve the date explicitly (YYYY-MM-DD)',
            blocking: true,
          });
        else f.final_value = parsed.value;
      }
      if (f.final_value !== null && monetary(f.path)) {
        try {
          f.final_value = money(f.final_value, currency);
        } catch (e) {
          errors.push({
            code: (e as Error).message,
            path: f.path,
            message: 'Resolve currency and decimal value',
            blocking: true,
          });
        }
      }
      if (f.final_value === null && !f.missing)
        errors.push({
          code: 'UNRESOLVED_VALUE',
          path: f.path,
          message: 'A visible but uncertain value must be resolved',
          blocking: true,
        });
      f.final_confidence = 1;
    }
  }
  if (doc.document_type === 'receipt') {
    const total = doc.fields.find((f) => f.path === 'grand_total')?.final_value;
    const lines = doc.fields.filter((f) => /^items\.\d+\.total$/.test(f.path));
    if (
      total !== null &&
      total !== undefined &&
      lines.length &&
      lines.every((f) => f.final_value !== null)
    )
      try {
        let sum = lines.reduce((s, f) => s.plus(f.final_value!), new D(0));
        for (const p of ['tax', 'discount', 'refund']) {
          const v = doc.fields.find((f) => f.path === p)?.final_value;
          if (v) sum = sum.plus(p === 'tax' ? new D(v) : new D(v).abs().negated());
        }
        if (mismatch(total, sum.toFixed()))
          errors.push({
            code: 'TOTAL_MISMATCH',
            path: 'grand_total',
            message: 'Item totals + explicit tax - discount - refund differ by more than 5%',
            blocking: true,
          });
      } catch {
        errors.push({
          code: 'MONEY_UNRESOLVED',
          path: 'grand_total',
          message: 'Cannot reconcile amounts',
          blocking: true,
        });
      }
  }
  // Review reasons describe policy separately from warnings: a legible date is not an error.
  for (const f of doc.fields) {
    const reasons = [...f.warnings];
    if (/(?:^|_)date$/.test(f.path)) reasons.push('DATE_REVIEW_REQUIRED');
    if (f.path.endsWith('.flag')) reasons.push('LAB_FLAG_REVIEW_REQUIRED');
    if (f.extraction_confidence < 0.5) reasons.push('LOW_CONFIDENCE');
    if (f.review_status === 'pending' && f.draft_value !== undefined) reasons.push('DRAFT_PENDING');
    for (const e of errors.filter((e) => e.blocking && e.path === f.path)) {
      reasons.push(e.code);
      f.requires_review = true;
    }
    f.review_reasons = [...new Set(reasons)];
  }
  doc.requires_structure_review =
    !doc.structure_confirmed &&
    (doc.classification_confidence < 0.5 || doc.segmentation_confidence < 0.5);
  doc.validation_errors = errors;
  doc.confidence = Math.min(
    doc.classification_confidence,
    doc.segmentation_confidence,
    ...doc.fields.map((f) => f.extraction_confidence),
  );
  doc.final_confidence = Math.min(
    doc.structure_confirmed ? 1 : doc.classification_confidence,
    doc.structure_confirmed ? 1 : doc.segmentation_confidence,
    ...doc.fields.map((f) => f.final_confidence),
  );
  return doc;
}
export function gate(documents: DocumentResult[], coverage: boolean) {
  const confidence = documents.length
    ? Math.min(...documents.map((d) => d.confidence), coverage ? 1 : 0.49)
    : 0;
  const final = documents.length
    ? Math.min(...documents.map((d) => d.final_confidence), coverage ? 1 : 0.49)
    : 0;
  const ready =
    coverage &&
    documents.length > 0 &&
    final >= 0.5 &&
    documents.every(
      (d) =>
        !d.validation_errors.some((e) => e.blocking) &&
        !d.fields.some((f) => f.requires_review && f.review_status === 'pending'),
    );
  return { confidence, final_confidence: final, status: ready ? 'ready' : 'awaiting_review' };
}

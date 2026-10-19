import { sampleSetForMode } from '../packages/contracts/sample-sets.js';
import { describe, test, expect } from '@jest/globals';
import { date, money, mismatch, makeDocuments, gate, evaluate } from '../packages/domain/index.js';
import { confidenceBand, readerSchema } from '../packages/contracts/index.js';
import { zodTextFormat } from 'openai/helpers/zod';
import { config } from '../packages/contracts/config.js';
const output = () =>
  readerSchema.parse({
    documents: [
      {
        document_type: 'receipt',
        classification_confidence: 0.95,
        segmentation_confidence: 0.9,
        pages: [1],
        fields: [
          {
            path: 'date',
            raw_value: '03/04/2026',
            value: '03/04/2026',
            confidence: 0.99,
            page: 1,
            bbox: null,
            handwritten_uncertain: false,
          },
        ],
      },
    ],
    unsupported_pages: [],
  });
describe('date and confidence controls', () => {
  test.each([
    ['23/04/2026', '2026-04-23'],
    ['03/03/2026', '2026-03-03'],
    ['29/02/2024', '2024-02-29'],
  ])('%s → %s', (s, v) => expect(date(s).value).toBe(v));
  test.each(['03/04/2026', '29/02/2025', '31/04/2026', '23/04/26', 'April 3'])(
    'does not silently normalize %s',
    (s) => expect(date(s).value).toBeNull(),
  );
  test.each([
    [0.1999, 'very-low'],
    [0.2, 'low'],
    [0.4999, 'low'],
    [0.5, 'medium'],
    [0.8, 'high'],
    [0.95, 'very-high'],
  ])('confidence band %s', (n, b) => expect(confidenceBand(n as number)).toBe(b));
  test('caps model .99 and includes missing fields in min', () => {
    const d = makeDocuments(output());
    expect(d[0].fields.find((f) => f.path === 'date')!.extraction_confidence).toBeLessThan(0.5);
    expect(gate(d, true).status).toBe('awaiting_review');
    expect(d[0].fields.find((f) => f.path === 'hospital_name')!.final_value).toBeNull();
  });
});
describe('decimal money', () => {
  test.each([
    ['1,234.56', 'USD', '1234.56'],
    ['0.00', 'USD', '0'],
    ['(10.00)', 'USD', '-10'],
  ])('%s is exact', (r, c, v) => expect(money(r, c)).toBe(v));
  test.each([
    ['1.234,56', 'USD'],
    ['1 234,56', 'EUR'],
    ['100.00', null],
    ['100.00', '$'],
  ])('rejects ambiguous %s', (r, c) => expect(() => money(r!, c)).toThrow());
  test('5 percent boundary and zero denominator', () => {
    expect(mismatch('100', '105')).toBe(false);
    expect(mismatch('100', '105.01')).toBe(true);
    expect(mismatch('0', '0')).toBe(false);
    expect(mismatch('0', '1')).toBe(true);
    expect(mismatch('-100', '-105')).toBe(false);
  });
});
describe('config validation', () => {
  test('requires key/model without leaking secrets', () =>
    expect(() =>
      config({ MONGODB_URI: 'mongodb://local', AI_MODE: 'openai', OPENAI_API_KEY: 'secret-value' }),
    ).toThrow('OPENAI_MODEL'));
  test('explicit mock mode has no key', () =>
    expect(config({ MONGODB_URI: 'mongodb://local', AI_MODE: 'mock' }).OPENAI_API_KEY).toBe(''));
});

describe('provider bbox schema regression', () => {
  test('emits homogeneous JSON Schema items for OpenAI', () => {
    const schema: any = zodTextFormat(readerSchema, 'medical_documents').schema;
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'array') {
        expect(Array.isArray(node.items)).toBe(false);
        expect(typeof node.items).toBe('object');
      }
      Object.values(node).forEach((v) => (Array.isArray(v) ? v.forEach(visit) : visit(v)));
    };
    visit(schema);
  });
  test('accepts four bbox coordinates or null and rejects other lengths', () => {
    const doc = output();
    const field = doc.documents[0].fields[0];
    for (const bbox of [null, [0, 0.1, 0.9, 1]]) {
      field.bbox = bbox;
      expect(readerSchema.safeParse(doc).success).toBe(true);
    }
    for (const bbox of [[], [0, 1, 2], [0, 1, 2, 3, 4]]) {
      field.bbox = bbox;
      expect(readerSchema.safeParse(doc).success).toBe(false);
    }
  });
});

describe('deployment port configuration', () => {
  test('derives the browser origin from APP_PORT', () => {
    const c = config({ MONGODB_URI: 'mongodb://local', AI_MODE: 'mock', APP_PORT: '4100' });
    expect(c.APP_PORT).toBe(4100);
    expect(c.APP_URL).toBe('http://127.0.0.1:4100');
  });
  test('uses explicit browser origin when configured', () =>
    expect(
      config({
        MONGODB_URI: 'mongodb://local',
        AI_MODE: 'mock',
        APP_PORT: '4100',
        APP_URL: 'http://localhost:4100',
      }).APP_URL,
    ).toBe('http://localhost:4100'));
  test('rejects ports outside TCP range', () =>
    expect(() =>
      config({ MONGODB_URI: 'mongodb://local', AI_MODE: 'mock', APP_PORT: '65536' }),
    ).toThrow('APP_PORT'));
});

describe('sample sets by runtime mode', () => {
  test('mock points to text mock fixtures only', () => {
    const s = sampleSetForMode('mock');
    expect(s?.directory).toBe('mock-samples');
    expect(s?.accept).toBe('.pdf');
  });
  test('manual OpenAI points to image-only scan fixtures', () => {
    const s = sampleSetForMode('openai');
    expect(s?.directory).toBe('manual-test-samples');
    expect(s?.accept).toContain('.png');
  });
  test('disabled has no recommended sample set', () =>
    expect(sampleSetForMode('disabled')).toBeNull());
});

describe('table review policy', () => {
  test('legible dates have a review reason without reducing score or inventing warnings', () => {
    const o = output();
    o.documents[0].fields[0].raw_value = '23/04/2026';
    o.documents[0].fields[0].value = '23/04/2026';
    const f = makeDocuments(o)[0].fields.find((f) => f.path === 'date')!;
    expect(f.requires_review).toBe(true);
    expect(f.review_reasons).toContain('DATE_REVIEW_REQUIRED');
    expect(f.extraction_confidence).toBe(0.99);
    expect(f.warnings).toEqual([]);
  });
  test('high-score names do not require confirmation; draft reopens review', () => {
    const o = output();
    const f = {
      ...o.documents[0].fields[0],
      path: 'patient_name',
      raw_value: 'Demo',
      value: 'Demo',
    };
    o.documents[0].fields.push(f);
    const d = makeDocuments(o)[0],
      name = d.fields.find((f) => f.path === 'patient_name')!;
    expect(name.requires_review).toBe(false);
    name.draft_value = 'Edited Demo';
    evaluate(d);
    expect(name.requires_review).toBe(true);
    expect(name.review_reasons).toContain('DRAFT_PENDING');
    expect(name.final_confidence).toBeLessThan(0.5);
    expect(name.raw_value).toBe('Demo');
  });
  test('structure review is required only when confidence is low and not yet confirmed', () => {
    const d = makeDocuments(output())[0];
    expect(d.requires_structure_review).toBe(false);
    d.segmentation_confidence = 0.49;
    evaluate(d);
    expect(d.requires_structure_review).toBe(true);
    d.structure_confirmed = true;
    evaluate(d);
    expect(d.requires_structure_review).toBe(false);
  });
});

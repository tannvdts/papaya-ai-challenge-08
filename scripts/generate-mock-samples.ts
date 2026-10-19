import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { readerSchema, ReaderOutput } from '../packages/contracts/index.js';
const font =
  process.env.SAMPLE_FONT ??
  [
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ].find(existsSync);
await mkdir('mock-samples', { recursive: true });
const specs: { id: string; type: any; fields: Record<string, string | null> }[] = [];
for (let i = 1; i <= 3; i++)
  specs.push({
    id: `DOC-REC-0${i}`,
    type: 'receipt',
    fields: {
      hospital_name: i === 2 ? 'Bệnh viện Minh An' : 'Lotus Hospital',
      patient_name: `Synthetic Patient R${i}`,
      date: i === 2 ? '03/04/2026' : '23/04/2026',
      'items.0.description': 'Consultation',
      'items.0.quantity': '1',
      'items.0.unit_price': '100.00',
      'items.0.total': '100.00',
      ...(i === 3
        ? {
            'items.1.description': 'Refunded service',
            'items.1.quantity': '1',
            'items.1.unit_price': '-10.00',
            'items.1.total': '-10.00',
            tax: '5.00',
            discount: '5.00',
          }
        : {}),
      grand_total: i === 3 ? '90.00' : '100.00',
      payment_method: 'card',
      currency: 'USD',
    },
  });
for (let i = 1; i <= 3; i++)
  specs.push({
    id: `DOC-DIS-0${i}`,
    type: 'discharge_summary',
    fields: {
      hospital_name: 'Lotus Hospital',
      patient_name: `Synthetic Patient D${i}`,
      admission_date: i === 2 ? '03/04/2026' : '23/04/2026',
      discharge_date: '25/04/2026',
      'diagnosis.primary': i === 3 ? 'Viêm họng / Pharyngitis' : 'Pharyngitis',
      'diagnosis.secondary': i === 2 ? null : 'None documented',
      'procedures_performed.0': 'Examination',
      attending_physician: 'Dr Demo',
      discharge_instructions: 'Follow the printed care instructions.',
    },
  });
for (let i = 1; i <= 2; i++)
  specs.push({
    id: `DOC-LAB-0${i}`,
    type: 'lab_report',
    fields: {
      lab_name: 'Lotus Laboratory',
      patient_name: `Synthetic Patient L${i}`,
      date: '23/04/2026',
      'tests.0.test_name': 'Glucose',
      'tests.0.result': '110',
      'tests.0.unit': 'mg/dL',
      'tests.0.reference_range': '70-100',
      'tests.0.flag': i === 2 ? 'HH' : 'high',
      ...(i === 2
        ? {
            'tests.1.test_name': 'Sodium',
            'tests.1.result': '140',
            'tests.1.unit': 'mmol/L',
            'tests.1.reference_range': '135-145',
            'tests.1.flag': null,
          }
        : {}),
    },
  });
for (let i = 1; i <= 2; i++)
  specs.push({
    id: `DOC-RX-0${i}`,
    type: 'prescription',
    fields: {
      doctor_name: 'Dr Demo',
      patient_name: `Synthetic Patient P${i}`,
      date: '23/04/2026',
      'medications.0.name': 'Demo medicine (synthetic)',
      'medications.0.dosage': i === 2 ? null : '1 unit',
      'medications.0.frequency': 'once daily',
      'medications.0.duration': '3 days',
      'medications.0.quantity': '3',
    },
  });
const manifest: any[] = [];
for (const spec of specs) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  if (font) doc.font(font);
  const stream = createWriteStream(`mock-samples/${spec.id}.pdf`);
  doc.pipe(stream);
  doc.fontSize(20).text(spec.type.replaceAll('_', ' ').toUpperCase());
  doc
    .fontSize(9)
    .fillColor('#555')
    .text('SYNTHETIC TRAINING FIXTURE — NOT A REAL PATIENT / NOT MEDICAL ADVICE');
  doc.moveDown();
  doc.fillColor('#111').fontSize(11);
  doc.text(`document_type: ${spec.type}`);
  doc.text(`Document reference ${spec.id}`);
  const fields: ReaderOutput['documents'][0]['fields'] = [];
  for (const [path, value] of Object.entries(spec.fields)) {
    doc.text(`${path}: ${value ?? '[not visible]'}`, { lineGap: 5 });
    fields.push({
      path,
      value,
      raw_value: value,
      confidence: value === null ? 0 : 0.9,
      page: 1,
      bbox: null,
      handwritten_uncertain: false,
    });
  }
  doc.end();
  await finished(stream);
  const truth = readerSchema.parse({
    documents: [
      {
        document_type: spec.type,
        classification_confidence: 0.95,
        segmentation_confidence: 0.9,
        pages: [1],
        fields,
      },
    ],
    unsupported_pages: [],
  });
  await writeFile(`mock-samples/${spec.id}.truth.json`, JSON.stringify(truth, null, 2));
  manifest.push({
    id: spec.id,
    file: `${spec.id}.pdf`,
    truth: `${spec.id}.truth.json`,
    type: spec.type,
    synthetic: true,
    limitations:
      spec.id === 'DOC-RX-02'
        ? 'Missing dosage fixture, not evidence of real handwriting recognition'
        : undefined,
  });
}
await writeFile('mock-samples/manifest.json', JSON.stringify(manifest, null, 2));
console.log(
  `Created ${manifest.length} synthetic PDFs and independent declarative truth files. Ground truth requires human verification before acceptance.`,
);

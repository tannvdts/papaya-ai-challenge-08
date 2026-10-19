import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, cp, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import sharp from 'sharp';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import { Tools } from '../packages/mcp-client/index.js';
import { bootstrap } from '../apps/backend/main.js';
import { makeDocuments, evaluate, gate, date, money, mismatch } from '../packages/domain/index.js';
import { config } from '../packages/contracts/config.js';
import { readerSchema, confidenceBand, validPath } from '../packages/contracts/index.js';
import { Reader } from '../packages/ai-reader/index.js';
import { crop, prepare } from '../packages/document-tools/index.js';
import { testReport } from '../packages/reporting/index.js';

const reportBaseURL =
  process.env.REPORT_BASE_URL ??
  process.env.APP_URL ??
  `http://127.0.0.1:${process.env.APP_PORT ?? 4000}`;
const suite = process.argv[2] ?? 'smoke';
const runId = process.env.TEST_RUN_ID ?? `run-${Date.now()}`;
if (!/^[\w-]{1,100}$/.test(runId)) throw Error('INVALID_TEST_RUN_ID');
const reportRoot = resolve(process.env.REPORT_ROOT ?? 'runtime'),
  reportDir = join(reportRoot, 'test-reports', runId);
await mkdir(reportDir, { recursive: true });
const catalog = JSON.parse(await readFile('tests/catalog.json', 'utf8')) as any[];
let results: any[] = [];
try {
  results = JSON.parse(await readFile(join(reportDir, 'results.json'), 'utf8'));
} catch {}
async function record(id: string, status: string, details: any, duration_ms = 0) {
  const prior = results.find((r) => r.id === id);
  const attempt = { status, details, duration_ms, at: new Date().toISOString() };
  const row = {
    ...catalog.find((c) => c.id === id),
    id,
    status,
    details,
    duration_ms,
    attempts: [...(prior?.attempts ?? []), attempt],
  };
  results = results.filter((r) => r.id !== id);
  results.push(row);
  await writeFile(join(reportDir, 'results.json'), JSON.stringify(results, null, 2));
}
const truth = async (id = 'DOC-REC-01') =>
  readerSchema.parse(JSON.parse(await readFile(`mock-samples/${id}.truth.json`, 'utf8')));
if (suite === 'live' && (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)) {
  for (const c of catalog.filter((c) => c.suite === 'live'))
    await record(c.id, 'SKIPPED', {
      reason: 'OPENAI_API_KEY / OPENAI_MODEL not configured. No provider requests made.',
    });
  console.log(await testReport(reportRoot, runId));
  process.exit(0);
}
const dbName = 'med_test_' + randomUUID().replaceAll('-', '');
const sandbox = join(reportRoot, 'test-sandboxes', dbName);
await mkdir(sandbox, { recursive: true });
const uri = (
  process.env.TEST_MONGODB_URI ??
  'mongodb://127.0.0.1:27019/DB?replicaSet=rs0&directConnection=true'
).replace(/\/[^/?]+(?=\?|$)/, '/' + dbName);
Object.assign(process.env, {
  MONGODB_URI: uri,
  STORAGE_ROOT: sandbox,
  AI_MODE: suite === 'live' ? 'openai' : 'mock',
  NODE_ENV: 'test',
  APP_PORT: '3105',
  APP_URL: 'http://127.0.0.1:3105',
});
const { app, runtime } = await bootstrap(false);
const http = request(app.getHttpServer()),
  tools = runtime.tools;
const conn = await mongoose.createConnection(uri).asPromise();
const token = runtime.token;
const post = (url: string, body: any) => http.post(url).set('x-review-token', token).send(body);
const call = (name: string, p: any = {}) => tools.call(name, p);
const tests: Record<string, () => Promise<any>> = {};
let first: any;
async function pipeline(id = 'DOC-REC-01', out?: any, bytes?: Buffer) {
  const data = bytes ?? (await readFile(`mock-samples/${id}.pdf`));
  const t = await call('create_scan_task', {
    filename: id + '.pdf',
    data: data.toString('base64'),
  });
  // Pause workflow tick during deterministic direct-tool integration to avoid races.
  const lease = await conn.collection('scan_tasks').findOneAndUpdate(
    { task_id: t.task_id },
    {
      $set: {
        status: 'processing',
        lease_token: randomUUID(),
        lease_until: new Date(Date.now() + 90000),
      },
    },
    { returnDocument: 'after' },
  );
  const p = { task_id: t.task_id, lease_token: lease!.lease_token };
  await call('prepare_document', p);
  const input = await call('build_reader_input', p);
  const result = out
    ? { output: out, provider: 'fake-ground-truth', usage: null }
    : await runtime.reader.read(input);
  await call('commit_extraction', { ...p, ...result });
  await call('build_field_evidence', p);
  await call('generate_html_report', p);
  return call('get_scan_task', { task_id: t.task_id });
}
async function review(
  t: any,
  path: string,
  action = 'approve',
  value?: string | null,
  reason = 'Compared to synthetic source',
) {
  return call('submit_review', {
    task_id: t.task_id,
    document_id: t.documents[0].document_id,
    path,
    action,
    value,
    reason,
    expected_revision: t.revision,
    operation_id: randomUUID(),
  });
}
async function rejection(fn: () => Promise<any>, code?: string) {
  if (code) await assert.rejects(fn, new RegExp(code));
  else await assert.rejects(fn);
}
async function readyTask() {
  let t = await pipeline();
  for (const f of t.documents[0].field_list.filter((f: any) => f.requires_review))
    t = await review(t, f.path);
  assert.equal(t.status, 'ready');
  return t;
}
function fieldDoc(raw: string, path: string, type = 'receipt') {
  const o = {
    documents: [
      {
        document_type: type,
        classification_confidence: 0.99,
        segmentation_confidence: 0.99,
        pages: [1],
        fields: [
          {
            path,
            value: raw,
            raw_value: raw,
            confidence: 0.99,
            page: 1,
            bbox: null,
            handwritten_uncertain: false,
          },
        ],
      },
    ],
    unsupported_pages: [],
  };
  return makeDocuments(readerSchema.parse(o))[0];
}
async function getJson(url: string) {
  return (await http.get(url)).body;
}
async function copyEvidence(t: any, id: string) {
  const dest = join(reportDir, 'assets', id);
  await mkdir(dest, { recursive: true });
  await cp(join(sandbox, 'tasks', t.task_id, 'reports'), dest, { recursive: true });
  const row = results.find((r) => r.id === id);
  if (row) row.scan_report = `assets/${id}/index.html`;
}

// Smoke: real NestJS + MCP + MongoDB + PDF/PNG/filesystem, fake Reader only.
tests['SM-01'] = async () => {
  assert.equal((await http.get('/health/live')).status, 200);
  const s = await getJson('/session');
  assert.equal(s.mode, 'mock');
  assert.equal(s.sample_set.directory, 'mock-samples');
};
tests['SM-02'] = async () => {
  const names = (await tools.client.listTools()).tools.map((t) => t.name);
  for (const n of ['prepare_document', 'submit_review', 'generate_test_report'])
    assert(names.includes(n));
  assert.equal((await call('get_system_health')).mongodb, 'up');
};
tests['SM-03'] = async () => {
  const h = await http.get('/health/ready');
  assert.equal(h.status, 503);
  assert.equal(h.body.openai.verification_status, 'not_checked');
  assert.equal(runtime.reader.requests, 0);
};
tests['SM-04'] = async () => {
  first = await pipeline();
  assert.equal(first.documents.length, 1);
  assert(first.documents[0].fields_by_path.hospital_name.value);
  assert(first.report);
};
tests['SM-05'] = async () => {
  const buf = await sharp({ create: { width: 800, height: 600, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  const t = await call('create_scan_task', {
    filename: 'synthetic.png',
    data: buf.toString('base64'),
  });
  const token = randomUUID();
  await conn.collection('scan_tasks').updateOne(
    { task_id: t.task_id },
    {
      $set: {
        status: 'processing',
        lease_token: token,
        lease_until: new Date(Date.now() + 90000),
      },
    },
  );
  const p = { task_id: t.task_id, lease_token: token };
  const r = await call('prepare_document', p);
  assert.equal(r.pages.length, 1);
  assert(r.pages[0].width > 0);
};
tests['SM-06'] = async () => {
  const out = await truth();
  const other = (await truth('DOC-LAB-01')).documents[0];
  out.documents.push(other);
  const t = await pipeline('DOC-REC-01', out);
  assert.equal(t.documents.length, 2);
  assert.notEqual(t.documents[0].document_id, t.documents[1].document_id);
  assert(t.final_confidence < 0.5);
};
tests['SM-07'] = async () => {
  const out = await truth();
  out.documents[0].fields[0].confidence = 0.49;
  const t = await pipeline('DOC-REC-01', out);
  assert(t.confidence < 0.5);
  await rejection(
    () => call('export_approved_result', { task_id: t.task_id, expected_revision: t.revision }),
    'REVIEW_REQUIRED',
  );
};
tests['SM-08'] = async () => {
  const t = await readyTask();
  assert.equal(t.documents[0].fields_by_path.date.final_confidence, 1);
  assert.equal(t.documents[0].fields_by_path.date.confidence, 0.9);
};
tests['SM-09'] = async () => {
  const t = first ?? (await pipeline());
  const page = await http.get(t.report.url);
  assert.equal(page.status, 200);
  assert.match(page.text, /Source evidence/);
  assert(!page.text.includes('https://'));
};
tests['SM-10'] = async () => {
  const t = await pipeline();
  await conn
    .collection('scan_tasks')
    .updateOne({ task_id: t.task_id }, { $set: { report_expires_at: new Date(0) } });
  assert.equal((await http.get(t.report.url)).status, 410);
  await call('cleanup_expired_reports');
  await assert.rejects(() => stat(join(sandbox, 'tasks', t.task_id, 'reports/index.html')));
  assert((await stat(join(sandbox, 'tasks', t.task_id, 'source/document.pdf'))).size > 0);
};
tests['SM-11'] = async () => {
  runtime.tools.connected = false;
  runtime.lastHealth = null;
  assert.equal((await http.get('/health/live')).status, 200);
  assert.equal((await http.get('/health/ready')).status, 503);
  runtime.tools.connected = true;
  runtime.lastHealth = null;
  assert((await getJson('/health')).capabilities.review);
};
tests['SM-12'] = async () => {
  const before = runtime.reader.requests;
  for (let i = 0; i < 3; i++) await http.get('/health');
  const t = await pipeline();
  await review(t, 'date');
  assert.equal(runtime.reader.requests, before);
};

// Date/amount/flag/score controls run through actual MCP persistence where applicable.
tests['IT-DATE-01'] = async () => {
  const t = await pipeline();
  assert.equal(t.documents[0].fields_by_path.date.value, '2026-04-23');
  assert.equal(t.status, 'awaiting_review');
};
tests['IT-DATE-02'] = async () => {
  const t = await pipeline('DOC-DIS-02');
  const f = t.documents[0].fields_by_path.admission_date;
  assert.equal(f.value, null);
  assert(f.confidence < 0.5);
  assert(f.evidence);
};
tests['IT-DATE-03'] = async () => {
  assert.equal(date('03/03/2026').value, '2026-03-03');
  assert.equal(date('29/02/2025').value, null);
  assert.equal(date('29/02/2024').value, '2024-02-29');
};
tests['IT-DATE-04'] = async () => {
  for (const raw of ['03/04/26', '3 April 2026', '令和8年4月3日']) {
    const d = fieldDoc(raw, 'date');
    assert(d.fields[0].extraction_confidence < 0.5);
    assert.equal(d.fields[0].normalized_value, null);
  }
};
tests['IT-MONEY-01'] = async () => {
  const t = await pipeline();
  const rec = await conn
    .collection('document_results')
    .findOne({ task_id: t.task_id, revision: t.revision });
  const f = rec!.data.fields.find((f: any) => f.path === 'grand_total');
  assert.equal(f.final_value._bsontype, 'Decimal128');
  assert.equal(t.documents[0].fields_by_path.grand_total.final_value, '100');
  assert(t.documents[0].fields_by_path.grand_total.evidence);
};
tests['IT-MONEY-02'] = async () => {
  for (const raw of ['1.234,56', '1 234,56', '1,234']) {
    if (raw === '1,234') assert.equal(money(raw, 'USD'), '1234');
    else assert.throws(() => money(raw, 'USD'));
  }
  const t = await pipeline();
  assert(t.documents[0].fields_by_path.grand_total.raw_value);
};
tests['IT-MONEY-03'] = async () => {
  for (const c of [null, '$', 'UNKNOWN']) assert.throws(() => money('100.00', c));
};
tests['IT-MONEY-04'] = async () => {
  const t = await pipeline('DOC-REC-03');
  assert.equal(t.documents[0].validation_errors.length, 0);
  assert.equal(money('(10.00)', 'USD'), '-10');
  assert.equal(money('0.00', 'USD'), '0');
};
tests['IT-MONEY-05'] = async () => {
  assert(!mismatch('100', '105'));
  assert(mismatch('100', '105.01'));
  assert(!mismatch('0', '0'));
  assert(mismatch('0', '1'));
  assert(!mismatch('-100', '-105'));
};
tests['IT-MONEY-06'] = async () => {
  assert.equal(money('12345678901234567890.12', 'USD'), '12345678901234567890.12');
  assert.throws(() => money('12345678901234567890123456789012345.12', 'USD'));
};
tests['IT-FLAG-01'] = async () => {
  const t = await pipeline('DOC-LAB-01');
  const f = t.documents[0].fields_by_path['tests.0.flag'];
  assert.equal(f.value, 'high');
  assert(f.requires_review);
};
tests['IT-FLAG-02'] = async () => {
  const t = await pipeline('DOC-LAB-02');
  const f = t.documents[0].fields_by_path['tests.0.flag'];
  assert.equal(f.raw_value, 'HH');
  assert.equal(f.value, null);
  assert(f.confidence < 0.5 && f.evidence);
};
tests['IT-FLAG-03'] = async () => {
  const t = await pipeline('DOC-LAB-02');
  const f = t.documents[0].fields_by_path['tests.1.flag'];
  assert.equal(f.value, null);
  assert(f.confidence < 0.5);
  assert(!f.evidence);
};
tests['IT-CONF-01'] = tests['SM-07'];
tests['IT-CONF-02'] = async () => {
  for (const [n, b] of [
    [0, 'very-low'],
    [0.2, 'low'],
    [0.4999, 'low'],
    [0.5, 'medium'],
    [0.8, 'high'],
    [0.95, 'very-high'],
    [1, 'very-high'],
  ] as const)
    assert.equal(confidenceBand(n), b);
};
tests['IT-CONF-03'] = async () => {
  assert.equal(gate([], true).status, 'awaiting_review');
  assert.throws(() => readerSchema.parse({ documents: [{ confidence: NaN }] }));
  const t = await pipeline('DOC-DIS-02');
  assert(t.documents[0].fields_by_path['diagnosis.secondary'].confidence < 0.5);
};
tests['IT-CONF-04'] = async () => {
  const d = fieldDoc('03/04/2026', 'date');
  assert(d.fields[0].extraction_confidence < 0.5);
  assert.equal(d.fields[0].confidence, 0.99);
};

// Document mapping, ownership, completeness and input rejection.
tests['IT-DOC-01'] = async () => {
  for (const spec of JSON.parse(await readFile('mock-samples/manifest.json', 'utf8'))) {
    const t = await pipeline(spec.id);
    assert.equal(t.documents[0].document_type, spec.type);
    assert(t.documents[0].field_list.length > 0);
  }
};
tests['IT-DOC-02'] = tests['SM-06'];
tests['IT-DOC-03'] = async () => {
  const out = await truth();
  const d = structuredClone(out.documents[0]);
  d.fields.find((f) => f.path === 'patient_name')!.value = 'Different Patient';
  d.fields.find((f) => f.path === 'patient_name')!.raw_value = 'Different Patient';
  out.documents.push(d);
  const t = await pipeline('DOC-REC-01', out);
  assert.equal(t.documents.length, 2);
  assert.notEqual(
    t.documents[0].fields_by_path.patient_name.value,
    t.documents[1].fields_by_path.patient_name.value,
  );
};
tests['IT-DOC-05'] = async () => {
  const out = await truth();
  out.documents.push(structuredClone(out.documents[0]));
  out.documents.forEach((d, i) =>
    d.fields.forEach((f) => (f.bbox = [0, i * 0.5, 1, (i + 1) * 0.5])),
  );
  let t = await pipeline('DOC-REC-01', out);
  assert.equal(t.documents.length, 2);
  assert(t.documents[0].field_list[0].evidence);
  assert(t.final_confidence < 0.5);
  assert(t.documents.every((d: any) => d.requires_structure_review));
  const body = {
    task_id: t.task_id,
    document_id: t.documents[0].document_id,
    action: 'confirm_structure',
    reason: 'Compared both source regions and patient boundaries',
    expected_revision: t.revision,
    operation_id: randomUUID(),
  };
  t = await call('submit_review', body);
  const duplicate = await call('submit_review', body);
  assert.equal(duplicate.revision, t.revision);
  assert.equal(t.documents[0].requires_structure_review, false);
  await rejection(
    () =>
      call('submit_review', { ...body, expected_revision: t.revision, operation_id: randomUUID() }),
    'STRUCTURE_REVIEW_NOT_REQUIRED',
  );
  t = await call('submit_review', {
    ...body,
    document_id: t.documents[1].document_id,
    expected_revision: t.revision,
    operation_id: randomUUID(),
  });
  assert(t.final_confidence >= 0.5);
  assert.equal(t.status, 'awaiting_review');
};
tests['IT-DOC-06'] = async () => {
  const out = await truth();
  out.unsupported_pages = [1];
  const t = await pipeline('DOC-REC-01', out);
  assert(t.final_confidence < 0.5);
  assert.equal(t.status, 'awaiting_review');
};
tests['IT-DOC-08'] = async () => {
  const dir = join(sandbox, 'render-test');
  const pages = await prepare('mock-samples/DOC-REC-02.pdf', dir, 20);
  assert.match(pages[0].text, /Bệnh viện/);
  const rotated = join(sandbox, 'rotated.png');
  await sharp(join(dir, 'page-1.png')).rotate(90).toFile(rotated);
  assert((await prepare(rotated, join(sandbox, 'rotated-pages'), 20))[0].width > 0);
  // Exercise the actual MCP process with image-only scans, not just text PDF fixtures.
  const scans = JSON.parse(await readFile('manual-test-samples/manifest.json', 'utf8'));
  for (const sample of scans.samples) {
    const t = await call('create_scan_task', {
      filename: sample.file,
      data: (await readFile('manual-test-samples/' + sample.file)).toString('base64'),
    });
    const lease_token = randomUUID();
    await conn
      .collection('scan_tasks')
      .updateOne(
        { task_id: t.task_id },
        { $set: { status: 'processing', lease_token, lease_until: new Date(Date.now() + 90000) } },
      );
    const result = await call('prepare_document', { task_id: t.task_id, lease_token });
    assert.equal(result.pages.length, sample.page_count);
    assert(result.pages.every((p: any) => p.text.trim() === ''));
    assert.equal((await call('get_system_health')).mongodb, 'up');
  }
};
tests['IT-DOC-09'] = async () => {
  const t = await pipeline('DOC-DIS-03');
  assert.match(t.documents[0].fields_by_path['diagnosis.primary'].raw_value, /Viêm/);
};
tests['IT-DOC-10'] = async () => {
  const out = await truth('DOC-RX-01');
  out.documents[0].fields.find((f) => f.path === 'medications.0.dosage')!.handwritten_uncertain =
    true;
  const t = await pipeline('DOC-RX-01', out);
  assert(t.documents[0].fields_by_path['medications.0.dosage'].confidence < 0.5);
  assert(t.documents[0].fields_by_path['medications.0.dosage'].evidence);
};
tests['IT-DOC-11'] = async () => {
  const t = await pipeline();
  const path = join(sandbox, 'tasks', t.task_id, 'pages/page-1.png');
  assert(await crop(path, join(sandbox, 'fallback.png'), [0, 0, 2, 2]));
  assert(!(await crop(path, join(sandbox, 'crop.png'), [0, 0, 0.5, 0.5])));
};
tests['IT-DOC-12'] = async () => {
  await rejection(
    () =>
      call('create_scan_task', {
        filename: 'fake.pdf',
        data: Buffer.from('not pdf').toString('base64'),
      }),
    'UNSUPPORTED_FILE',
  );
  const t = await call('create_scan_task', {
    filename: 'broken.pdf',
    data: Buffer.from('%PDF-broken').toString('base64'),
  });
  const token = randomUUID();
  await conn
    .collection('scan_tasks')
    .updateOne(
      { task_id: t.task_id },
      { $set: { lease_token: token, lease_until: new Date(Date.now() + 90000) } },
    );
  await rejection(() => call('prepare_document', { task_id: t.task_id, lease_token: token }));
};

// Review, revision, transaction, idempotence and access controls.
tests['IT-MCP-01'] = async () => {
  const bad = await tools.client.callTool({
    name: 'get_scan_task',
    arguments: { payload: 'invalid' },
  });
  assert(bad.isError);
  await rejection(() => call('get_scan_task', { task_id: '../other' }), 'INVALID_TOOL_INPUT');
};
tests['IT-DB-02'] = async () => {
  const t = await pipeline();
  const body = {
    task_id: t.task_id,
    document_id: t.documents[0].document_id,
    path: 'date',
    action: 'approve',
    reason: 'source',
    expected_revision: t.revision,
  };
  const result = await Promise.allSettled([
    call('submit_review', { ...body, operation_id: randomUUID() }),
    call('submit_review', { ...body, operation_id: randomUUID() }),
  ]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
};
tests['IT-WORK-01'] = async () => {
  const t = await pipeline();
  await conn
    .collection('scan_tasks')
    .updateOne({ task_id: t.task_id }, { $set: { status: 'queued', lease_until: new Date(0) } });
  const [a, b] = await Promise.all([call('claim_scan_task'), call('claim_scan_task')]);
  assert(a === null || b === null || a.task_id !== b.task_id);
  if (a)
    await rejection(
      () => call('prepare_document', { task_id: a.task_id, lease_token: randomUUID() }),
      'LEASE_LOST',
    );
};
tests['IT-REVIEW-01'] = async () => {
  const t = await pipeline();
  const r = await post('/api/tasks/' + t.task_id + '/export', { expected_revision: t.revision });
  assert.equal(r.status, 409);
};
tests['IT-REVIEW-02'] = async () => {
  const t = await pipeline();
  const next = await review(t, 'date');
  assert.equal(next.revision, t.revision + 1);
  const audit = await call('get_audit', { task_id: t.task_id });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, 'local-reviewer');
  assert.equal(next.documents[0].fields_by_path.date.confidence, 0.9);
  assert.equal(next.documents[0].fields_by_path.date.final_confidence, 1);
};
tests['IT-REVIEW-03'] = async () => {
  const t = await pipeline();
  await rejection(() => review(t, 'date', 'correct', '31/02/2026'), 'INVALID_CORRECTION');
  const next = await review(t, 'date');
  await rejection(
    () => call('export_approved_result', { task_id: t.task_id, expected_revision: t.revision }),
    'REVISION_CONFLICT',
  );
  assert.equal(next.documents[0].fields_by_path.date.final_confidence, 1);
};
tests['IT-MCP-02'] = async () => {
  const t = await pipeline();
  const p = {
    task_id: t.task_id,
    document_id: t.documents[0].document_id,
    path: 'date',
    action: 'approve',
    reason: 'idempotence',
    expected_revision: t.revision,
    operation_id: randomUUID(),
  };
  const a = await call('submit_review', p),
    b = await call('submit_review', p);
  assert.equal(a.revision, b.revision);
  assert.equal((await call('get_audit', { task_id: t.task_id })).length, 1);
  await tools.close();
  assert.equal(tools.connected, false);
  await tools.reconnect();
  assert.equal((await call('get_system_health')).mongodb, 'up');
};
tests['IT-DB-01'] = async () => {
  const t = await pipeline();
  const count = await conn.collection('review_events').countDocuments({ task_id: t.task_id });
  await rejection(() => review(t, 'date', 'correct', 'invalid'));
  assert.equal((await call('get_scan_task', { task_id: t.task_id })).revision, t.revision);
  assert.equal(
    await conn.collection('review_events').countDocuments({ task_id: t.task_id }),
    count,
  );
};

// Environment, health and secrets.
tests['IT-ENV-01'] = async () => {
  assert.throws(
    () => config({ MONGODB_URI: uri, AI_MODE: 'openai', OPENAI_API_KEY: 'SECRET_VALUE' }),
    (e) => !String(e).includes('SECRET_VALUE'),
  );
  assert.throws(() => config({ MONGODB_URI: uri, AI_MODE: 'mock', OPENAI_TIMEOUT_MS: '-1' }));
  assert.equal(config({ MONGODB_URI: uri, AI_MODE: 'disabled' }).AI_MODE, 'disabled');
};
tests['IT-ENV-03'] = async () => {
  const h = JSON.stringify(await getJson('/health'));
  assert(!h.includes(uri));
  assert(!h.includes('OPENAI_API_KEY'));
  assert(runtime.tools.connected);
};
tests['IT-AI-04'] = tests['SM-12'];
tests['IT-HEALTH-01'] = tests['SM-11'];
tests['IT-HEALTH-02'] = async () => {
  runtime.lastHealth = null;
  const h = await getJson('/health');
  assert.equal(h.openai.verification_status, 'not_checked');
  assert(h.checked_at);
};
tests['IT-HEALTH-03'] = tests['SM-12'];
tests['IT-HEALTH-04'] = async () => {
  assert.equal((await http.post('/diagnostics/openai/verify')).status, 403);
  assert.equal((await post('/diagnostics/openai/verify', {})).status, 409);
};

// Static reports and artifact access through HTTP, plus expiry/cleanup.
tests['IT-REPORT-01'] = async () => {
  const t = await pipeline('DOC-LAB-02');
  const html = (await http.get(t.report.url)).text;
  assert.match(html, /tests.0.flag/);
  assert.match(html, /HH/);
  assert.match(html, /Final/);
  assert.match(html, /Source evidence/);
};
tests['IT-REPORT-02'] = async () => {
  const t = await pipeline();
  const html = (await http.get(t.report.url)).text;
  for (const m of html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g))
    assert((await stat(join(sandbox, 'tasks', t.task_id, 'reports', m[1]))).size);
  assert(!html.includes('cdn'));
};
tests['IT-REPORT-03'] = async () => {
  const t = await pipeline();
  const next = await review(t, 'date');
  assert.equal(t.report.expires_at, next.report.expires_at);
  assert.equal(next.report.revision, next.revision);
};
tests['IT-REPORT-04'] = async () => {
  const t = await pipeline();
  await conn
    .collection('scan_tasks')
    .updateOne({ task_id: t.task_id }, { $set: { report_expires_at: new Date(0) } });
  const image = t.documents[0].field_list.find((f: any) => f.evidence).evidence;
  assert.equal(
    (await http.get('/reports/' + t.task_id + '/assets/' + image.image.replaceAll('/', '_')))
      .status,
    410,
  );
  await call('cleanup_expired_reports');
  await call('cleanup_expired_reports');
  assert((await stat(join(sandbox, 'tasks', t.task_id, image.image))).size);
};
tests['IT-SEC-01'] = async () => {
  const t = await pipeline();
  await rejection(
    () => call('get_artifact_metadata', { task_id: t.task_id, path: '../../.env' }),
    'INVALID_ARTIFACT',
  );
  assert.equal(validPath('receipt', '__proto__.bad'), false);
};
tests['IT-SEC-02'] = async () => {
  const out = await truth();
  out.documents[0].fields[0].value = '<script>alert(1)</script>';
  out.documents[0].fields[0].raw_value = out.documents[0].fields[0].value;
  const t = await pipeline('DOC-REC-01', out);
  const html = (await http.get(t.report.url)).text;
  assert(!html.includes('<script>alert'));
  assert(html.includes('&lt;script&gt;'));
};
tests['IT-SEC-03'] = async () => {
  const t = await pipeline();
  assert.equal(
    (await http.post('/api/tasks/' + t.task_id + '/review').send({ actor: 'admin' })).status,
    403,
  );
  const names = (await tools.client.listTools()).tools.map((t) => t.name);
  assert(!names.includes('shell'));
};
tests['IT-SEC-04'] = tests['SM-10'];

// Manual APIs and browser suite share this contract; browser navigation below is separate.
tests['IT-MANUAL-03'] = async () => {
  let t = await pipeline();
  assert(t.documents[0].fields_by_path.date.review_reasons.includes('DATE_REVIEW_REQUIRED'));
  assert.equal(t.documents[0].fields_by_path.hospital_name.requires_review, false);
  await rejection(() => review(t, 'hospital_name'), 'REVIEW_NOT_REQUIRED');
  await rejection(() => review(t, 'hospital_name', 'correct', 'Edited'), 'REVIEW_NOT_REQUIRED');
  await rejection(
    () =>
      call('submit_review', {
        task_id: t.task_id,
        document_id: t.documents[0].document_id,
        action: 'confirm_structure',
        reason: 'No ambiguity',
        expected_revision: t.revision,
        operation_id: randomUUID(),
      }),
    'STRUCTURE_REVIEW_NOT_REQUIRED',
  );
  t = await review(t, 'date');
  await rejection(() => review(t, 'date'), 'REVIEW_NOT_REQUIRED');
  assert.equal(t.status, 'ready');
  t = await review(t, 'hospital_name', 'draft', 'Demo Updated');
  assert.equal(t.status, 'awaiting_review');
  assert(t.final_confidence < 0.5);
  assert(t.documents[0].fields_by_path.hospital_name.requires_review);
  assert(t.documents[0].fields_by_path.hospital_name.review_reasons.includes('DRAFT_PENDING'));
  const raw = t.documents[0].fields_by_path.hospital_name.raw_value;
  t = await review(t, 'hospital_name', 'correct', 'Demo Updated');
  assert.equal(t.status, 'ready');
  assert.equal(t.documents[0].fields_by_path.hospital_name.raw_value, raw);
  assert.equal(t.documents[0].fields_by_path.hospital_name.final_confidence, 1);
  const out = await truth();
  const total = out.documents[0].fields.find((f) => f.path === 'grand_total')!;
  total.raw_value = total.value = '200.00';
  let mismatchTask = await pipeline('DOC-REC-01', out);
  const f = mismatchTask.documents[0].fields_by_path.grand_total;
  assert(f.requires_review);
  assert(f.review_reasons.includes('TOTAL_MISMATCH'));
  await rejection(() => review(mismatchTask, 'grand_total'), 'FIELD_VALIDATION_REQUIRED');
  mismatchTask = await review(mismatchTask, 'grand_total', 'correct', '100.00');
  assert.equal(mismatchTask.documents[0].validation_errors.length, 0);
};
tests['IT-MANUAL-04'] = async () => {
  let t = await readyTask();
  t = await review(t, 'date', 'draft', '2026-04-24');
  assert.equal(t.status, 'awaiting_review');
  assert.equal(t.documents[0].fields_by_path.date.final_value, '2026-04-24');
  assert(t.documents[0].fields_by_path.date.final_confidence < 0.5);
  t = await review(t, 'date', 'correct', '2026-04-24');
  assert.equal(t.status, 'ready');
};
tests['IT-MANUAL-05'] = tests['SM-06'];
tests['IT-MANUAL-06'] = tests['IT-DB-02'];
tests['IT-MANUAL-07'] = tests['IT-REPORT-03'];
tests['IT-MANUAL-08'] = tests['SM-12'];
tests['IT-TREPORT-01'] = async () => {
  const id = 'report-fixture-' + randomUUID();
  const dir = join(reportRoot, 'test-reports', id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'results.json'),
    JSON.stringify([{ id: 'SM-01', status: 'FAIL', details: { message: 'expected failure' } }]),
  );
  const r = await testReport(reportRoot, id);
  assert.equal(r.counts.FAIL, 1);
  assert.equal(r.counts.NOT_RUN, 94);
};
tests['IT-TREPORT-02'] = async () => {
  const id = 'report-partial-' + randomUUID();
  const r = await testReport(reportRoot, id);
  const html = await readFile(r.path, 'utf8');
  for (let i = 1; i <= 10; i++) assert(html.includes('LIVE-' + String(i).padStart(2, '0')));
  assert.equal(r.counts.NOT_RUN, 95);
};
tests['IT-TREPORT-04'] = async () => {
  const id = 'report-escape-' + randomUUID();
  const dir = join(reportRoot, 'test-reports', id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'results.json'),
    JSON.stringify([{ id: 'SM-01', status: 'FAIL', details: '<img src=x onerror=alert(1)>' }]),
  );
  const r = await testReport(reportRoot, id),
    html = await readFile(r.path, 'utf8');
  assert(!html.includes('<img src=x'));
};

// OpenAI HTTP fake verifies actual SDK/request/schema behavior without paid calls.
async function fakeProvider(
  status: number,
  output: any,
  fn: (reader: Reader, counter: () => number) => Promise<any>,
) {
  let calls = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    calls++;
    const parsed = JSON.parse(body);
    assert(parsed.model === 'test-model');
    assert(parsed.text.format.schema);
    assert(parsed.input[1].content.some((c: any) => c.type === 'input_image'));
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = status;
    res.end(
      status === 200
        ? JSON.stringify({
            id: 'resp_fake',
            object: 'response',
            created_at: 1,
            status: 'completed',
            model: 'test-model',
            output: [
              {
                id: 'msg_1',
                type: 'message',
                status: 'completed',
                role: 'assistant',
                content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }],
              },
            ],
            usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
          })
        : JSON.stringify({ error: { message: 'synthetic fault', type: 'test' } }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  try {
    const cfg = config({
      ...process.env,
      AI_MODE: 'openai',
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'test-model',
      OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      OPENAI_MAX_RETRIES: '1',
      AI_MAX_CALLS_PER_TASK: '2',
    });
    await fn(new Reader(cfg), () => calls);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
async function readerInput() {
  const t = await pipeline();
  return call('build_reader_input', { task_id: t.task_id });
}
tests['IT-ENV-02'] = async () => {
  const input = await readerInput();
  await fakeProvider(200, await truth(), async (r, n) => {
    const result = await r.read(input);
    assert.equal(result.output.documents[0].document_type, 'receipt');
    assert.equal(n(), 1);
    assert.equal(result.provider, 'openai:test-model');
  });
};
tests['IT-AI-01'] = async () => {
  const input = await readerInput();
  await fakeProvider(200, { bad: 'schema' }, async (r) => {
    await assert.rejects(() => r.read(input));
  });
};
tests['IT-AI-02'] = async () => {
  const input = await readerInput();
  for (const status of [400, 401, 403, 429, 500])
    await fakeProvider(status, null, async (r, n) => {
      await assert.rejects(() => r.read(input));
      assert.equal(n(), status >= 429 ? 2 : 1);
      assert.equal(r.lastError, 'PROVIDER_HTTP_' + status);
    });
};
tests['IT-AI-03'] = tests['IT-AI-02'];

// Additional boundary, failure and report cases.
async function multiPdf() {
  const doc = new PDFDocument(),
    chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on('end', () => r(Buffer.concat(chunks))));
  doc.text('Synthetic invoice page 1');
  doc.addPage().text('Synthetic invoice continuation page 2');
  doc.end();
  return done;
}
tests['IT-DOC-04'] = async () => {
  const out = await truth();
  out.documents[0].pages = [1, 2];
  out.documents[0].fields.slice(5).forEach((f) => (f.page = 2));
  const t = await pipeline('DOC-REC-01', out, await multiPdf());
  assert.equal(t.documents.length, 1);
  assert.equal(t.documents[0].pages.length, 2);
  assert.equal(t.documents[0].fields_by_path.grand_total.evidence.page, 2);
};
tests['IT-DOC-07'] = async () => {
  const out = await truth();
  const t = await pipeline('DOC-REC-01', out, await multiPdf());
  assert.equal(t.coverage, false);
  assert(t.final_confidence < 0.5);
  const dup = await truth();
  dup.documents[0].fields.push(dup.documents[0].fields[0]);
  await rejection(() => pipeline('DOC-REC-01', dup));
};
tests['IT-DB-03'] = async () => {
  const original = process.env.MONGODB_URI;
  const missing = new Tools();
  try {
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/unavailable?serverSelectionTimeoutMS=500';
    await assert.rejects(() => missing.connect());
    assert.equal(missing.connected, false);
  } finally {
    process.env.MONGODB_URI = original;
    await missing.close().catch(() => {});
  }
};
tests['IT-WORK-02'] = async () => {
  const t = await readyTask();
  const image = t.documents[0].field_list.find((f: any) => f.evidence).evidence.image;
  await rm(join(sandbox, 'tasks', t.task_id, image));
  await rejection(
    () => call('export_approved_result', { task_id: t.task_id, expected_revision: t.revision }),
    'ARTIFACT_MISSING',
  );
};
tests['IT-CACHE-01'] = async () => {
  const t = await pipeline();
  const input = await call('build_reader_input', { task_id: t.task_id });
  assert.equal(await call('get_cached_extraction', { cache_key: 'missing-key' }), null);
  const a = await conn.collection('scan_tasks').findOne({ task_id: t.task_id });
  await conn.collection('reader_caches').insertOne({
    cache_key: 'test-cache',
    output: await truth(),
    expires_at: new Date(Date.now() + 60000),
  });
  const cached = await call('get_cached_extraction', { cache_key: 'test-cache' });
  assert.equal(cached.output.documents.length, 1);
  const second = await pipeline('DOC-REC-01', cached.output);
  assert.notEqual(t.task_id, second.task_id);
  assert.equal(second.documents[0].fields_by_path.date.review_status, 'pending');
  await conn
    .collection('reader_caches')
    .updateOne({ cache_key: 'test-cache' }, { $set: { expires_at: new Date(0) } });
  assert.equal(await call('get_cached_extraction', { cache_key: 'test-cache' }), null);
};
tests['IT-REPORT-05'] = async () => {
  const t = await pipeline();
  await conn
    .collection('scan_tasks')
    .updateOne({ task_id: t.task_id }, { $set: { report_expires_at: new Date(0) } });
  await call('cleanup_expired_reports');
  assert.equal((await http.get(t.report.url)).status, 410);
  assert((await stat(join(sandbox, 'tasks', t.task_id, 'source/document.pdf'))).size > 0);
};
tests['IT-TREPORT-03'] = async () => {
  const id = 'history-' + randomUUID();
  const dir = join(reportRoot, 'test-reports', id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'results.json'),
    JSON.stringify([
      {
        id: 'SM-01',
        status: 'FAIL',
        details: 'partial',
        attempts: [{ status: 'FAIL' }, { status: 'PASS' }],
      },
    ]),
  );
  const r = await testReport(reportRoot, id);
  assert.equal(r.counts.FAIL, 1);
  assert.equal(r.counts.NOT_RUN, 94);
  const html = await readFile(r.path, 'utf8');
  assert(html.includes('partial'));
};
tests['IT-TREPORT-05'] = async () => {
  const id = 'expiry-' + randomUUID();
  const r = await testReport(sandbox, id);
  const dir = join(sandbox, 'test-reports', id);
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ expires_at: new Date(0) }));
  await writeFile(join(dir, 'results.json'), '[]');
  await call('cleanup_expired_reports');
  await assert.rejects(() => stat(r.path));
  assert((await stat(join(dir, 'results.json'))).size > 0);
};
tests['IT-MANUAL-01'] = async () => {
  runtime.working = false;
  try {
    const response = await http
      .post('/api/tasks')
      .set('x-review-token', token)
      .attach('document', 'mock-samples/DOC-REC-01.pdf');
    assert.equal(response.status, 201);
    let t: any;
    for (let i = 0; i < 60; i++) {
      t = await call('get_scan_task', { task_id: response.body.task_id });
      if (!['queued', 'processing'].includes(t.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(t.status, 'awaiting_review');
    assert(t.report);
    assert.equal((await http.get('/manual-test')).status, 200);
  } finally {
    runtime.working = true;
  }
};
tests['IT-MANUAL-02'] = async () => {
  const t = await pipeline('DOC-LAB-01');
  const f = t.documents[0].fields_by_path['tests.0.flag'];
  assert.equal((await http.get('/artifacts/' + t.task_id + '/' + f.evidence.image)).status, 200);
  const html = (await http.get('/manual-test')).text;
  for (const word of ['manual-test.js', 'manual-test.css', 'result-json', 'source-panel'])
    assert(html.includes(word));
  assert.equal((await http.get('/manual-test.js')).status, 200);
  assert.equal((await http.get('/manual-test.css')).status, 200);
};

// Remaining high-complexity cases are explicitly NOT_RUN until implemented; never auto-PASS by category.
let failures = 0;
try {
  if (suite === 'e2e') {
    const { chromium } = await import('playwright');
    await app.listen(3105, '127.0.0.1');
    runtime.working = false;
    let browser: any;
    const start = Date.now();
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1536, height: 1080 } });
      const errors: string[] = [];
      page.on('pageerror', (e: any) => errors.push(e.message));
      await page.goto('http://127.0.0.1:3105/manual-test');
      await page.locator('#session').filter({ hasText: 'mock' }).waitFor();
      assert.equal(await page.locator('#json-result').isVisible(), false);
      await page.locator('input[type=file]').setInputFiles('mock-samples/DOC-REC-01.pdf');
      await page.locator('#upload button').click();
      await page.locator('#summary[data-status="awaiting_review"]').waitFor({ timeout: 45000 });
      const resultJSON = async () =>
        JSON.parse((await page.locator('#result-json').textContent())!);
      const before = await resultJSON();
      assert.equal(before.documents.length, 1);
      assert.deepEqual(
        before,
        await (await page.request.get('http://127.0.0.1:3105/api/tasks/' + before.task_id)).json(),
      );
      const dateRow = page.locator('tr[data-path="date"]'),
        nameRow = page.locator('tr[data-path="hospital_name"]');
      assert.equal(await nameRow.locator('[data-action="approve"]').count(), 0);
      assert.equal(await page.locator('[data-action="approve"]').count(), 1);
      assert((await nameRow.textContent()).includes('Không bắt buộc'));
      assert((await nameRow.textContent()).includes('—'));
      assert.equal(
        await page
          .getByRole('button', { name: 'Xác nhận nguồn và ranh giới', exact: true })
          .count(),
        0,
      );
      await page.locator('[data-filter="pending"]').click();
      assert.equal(await page.locator('#results tbody tr').count(), 1);
      await page.locator('[data-filter="all"]').click();
      await page.screenshot({ path: join(reportDir, 'manual-pending.png'), fullPage: true });
      await dateRow.getByRole('button', { name: 'Xác nhận', exact: true }).click();
      await page.locator('#summary[data-status="ready"]').waitFor();
      const approved = await resultJSON();
      assert(approved.revision > before.revision);
      assert.equal(approved.documents[0].fields_by_path.date.final_confidence, 1);
      assert.equal(await page.locator('[data-action="approve"]').count(), 0);
      await nameRow.getByRole('button', { name: 'Sửa', exact: true }).click();
      assert(
        await page
          .getByLabel('hospital_name value', { exact: true })
          .evaluate((n: Element) => document.activeElement === n),
      );
      assert.equal(await page.locator('[data-action="confirm-edit"]').count(), 0);
      await page.getByLabel('hospital_name value', { exact: true }).fill('Demo Updated');
      await page.getByLabel('hospital_name reason', { exact: true }).fill('Synthetic correction');
      await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
      await page.locator('#summary[data-status="awaiting_review"]').waitFor();
      assert((await resultJSON()).final_confidence < 0.5);
      await page.locator('[data-action="confirm-edit"]').click();
      await page.locator('#summary[data-status="ready"]').waitFor();
      assert.equal(
        (await resultJSON()).documents[0].fields_by_path.hospital_name.final_value,
        'Demo Updated',
      );
      await dateRow.getByRole('button', { name: 'Sửa', exact: true }).click();
      await page.getByLabel('date value', { exact: true }).fill('2026-04-24');
      await page
        .getByLabel('date reason', { exact: true })
        .fill('Synthetic edit to verify JSON synchronization');
      await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
      await page.locator('#summary[data-status="awaiting_review"]').waitFor();
      const draft = await resultJSON();
      assert.equal(draft.documents[0].fields_by_path.date.final_value, '2026-04-24');
      assert(draft.documents[0].fields_by_path.date.final_confidence < 0.5);
      await page.locator('[data-action="confirm-edit"]').click();
      await page.locator('#summary[data-status="ready"]').waitFor();
      const corrected = await resultJSON();
      assert.equal(corrected.documents[0].fields_by_path.date.review_status, 'corrected');
      // A concurrent backend review must not destroy the user's unsaved text.
      await nameRow.getByRole('button', { name: 'Sửa', exact: true }).click();
      await page.getByLabel('hospital_name value', { exact: true }).fill('My local edit');
      await page
        .getByLabel('hospital_name reason', { exact: true })
        .fill('Synthetic conflict resolution');
      await review(corrected, 'date', 'draft', '2026-04-25');
      await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
      await page
        .getByRole('button', { name: 'Đã đối chiếu, dùng phiên bản mới', exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel('hospital_name value', { exact: true }).inputValue(),
        'My local edit',
      );
      await page
        .getByRole('button', { name: 'Đã đối chiếu, dùng phiên bản mới', exact: true })
        .click();
      await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click();
      await page.waitForFunction(
        () =>
          JSON.parse(document.querySelector('#result-json')!.textContent!).documents[0]
            .fields_by_path.hospital_name.final_value === 'My local edit',
      );
      await page.locator('[data-action="confirm-edit"]').click();
      await page.waitForFunction(
        () =>
          JSON.parse(document.querySelector('#result-json')!.textContent!).documents[0]
            .fields_by_path.hospital_name.review_status === 'corrected',
      );
      await dateRow.getByRole('button', { name: 'Sửa', exact: true }).click();
      await page.getByLabel('date value', { exact: true }).fill('2026-04-24');
      await page
        .getByLabel('date reason', { exact: true })
        .fill('Resolved against synthetic source');
      await page.locator('[data-action="confirm-edit"]').click();
      await page.locator('#summary[data-status="ready"]').waitFor();
      const resolved = await resultJSON();
      await page.reload();
      await page.locator('#summary[data-status="ready"]').waitFor();
      assert.deepEqual(await resultJSON(), resolved);
      await page.locator('#results table').first().waitFor();
      await page.waitForFunction(() =>
        Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0),
      );
      await page.screenshot({ path: join(reportDir, 'manual-page.png'), fullPage: true });
      await page.setViewportSize({ width: 430, height: 932 });
      await page.screenshot({ path: join(reportDir, 'manual-mobile.png'), fullPage: true });
      assert(await page.locator('#source-panel').isVisible());
      runtime.working = true;
      const out = await truth();
      out.documents[0].fields.find((f) => f.path === 'hospital_name')!.raw_value =
        out.documents[0].fields.find((f) => f.path === 'hospital_name')!.value =
          '<img src=x onerror=alert(1)>';
      const zero = out.documents[0].fields.find((f) => f.path === 'items.0.quantity')!;
      zero.raw_value = zero.value = '0';
      for (const [path, value] of [
        ['patient_name', 'Nguyễn An Demo'],
        ['items.0.unit_price', '-10.00'],
        ['grand_total', '12345678901234567890.12'],
        ['payment_method', null],
      ] as const) {
        const field = out.documents[0].fields.find((f) => f.path === path)!;
        field.raw_value = field.value = value;
      }
      const copy = structuredClone(out.documents[0]);
      out.documents.push(copy);
      const multi = await pipeline('DOC-REC-01', out);
      runtime.working = false;
      await page.goto('http://127.0.0.1:3105/manual-test#task=' + multi.task_id);
      await page.locator('#results table').nth(1).waitFor();
      assert.equal(await page.locator('#results table').count(), 2);
      assert.equal(
        await page.locator('tr[data-path="hospital_name"] .value').first().textContent(),
        '<img src=x onerror=alert(1)>',
      );
      assert.equal(await page.locator('tr[data-path="hospital_name"] .value img').count(), 0);
      assert.equal(
        await page.locator('tr[data-path="items.0.quantity"] .value').first().textContent(),
        '0',
      );
      assert.equal(
        await page.locator('tr[data-path="items.0.unit_price"] .value').first().textContent(),
        '-10',
      );
      assert.equal(
        await page.locator('tr[data-path="grand_total"] .value').first().textContent(),
        '12345678901234567890.12',
      );
      assert.equal(
        await page.locator('tr[data-path="patient_name"] .value').first().textContent(),
        'Nguyễn An Demo',
      );
      assert.equal(
        await page.locator('tr[data-path="payment_method"] .value').first().textContent(),
        'Không có giá trị',
      );
      assert(
        await page
          .getByRole('button', { name: 'Xác nhận nguồn và ranh giới', exact: true })
          .first()
          .isVisible(),
      );
      assert(await page.locator('#export').isDisabled());
      assert.deepEqual(errors, []);
      await record(
        'IT-MANUAL-01',
        'PASS',
        {
          browser: 'Chromium',
          flow: 'table upload/filter, only required confirmation, optional draft/correct, JSON sync and reload',
        },
        Date.now() - start,
      );
      await record(
        'IT-MANUAL-02',
        'PASS',
        {
          browser: 'Chromium',
          flow: 'source panel, desktop/mobile, concurrent draft preserved, multiple documents, zero and HTML as text, structure gate',
        },
        Date.now() - start,
      );
    } catch (e) {
      failures++;
      await record('IT-MANUAL-01', 'FAIL', { message: (e as Error).message }, Date.now() - start);
    } finally {
      await browser?.close();
    }
  } else {
    runtime.working = true; // deterministic harness owns task processing except live reader calls.
    for (const c of catalog.filter((c) => c.suite === suite)) {
      const start = Date.now();
      if (suite === 'live') {
        // Live automated regression retains the 10 text baselines; manual AI scans use manual-test-samples.
        const manifest = JSON.parse(await readFile('mock-samples/manifest.json', 'utf8'));
        const spec = manifest[Number(c.id.split('-')[1]) - 1];
        try {
          const t = await pipeline(spec.id);
          const expected = await truth(spec.id);
          const diffs: any[] = [];
          assert.equal(t.documents.length, 1);
          if (t.documents[0].document_type !== expected.documents[0].document_type)
            diffs.push({
              path: 'document_type',
              expected: expected.documents[0].document_type,
              actual: t.documents[0].document_type,
            });
          for (const f of expected.documents[0].fields) {
            const actual = t.documents[0].fields_by_path[f.path]?.raw_value;
            if (actual !== f.raw_value) diffs.push({ path: f.path, expected: f.raw_value, actual });
          }
          await record(
            c.id,
            diffs.length ? 'FAIL' : 'PASS',
            {
              task_id: t.task_id,
              diffs,
              mode: 'real OpenAI; synthetic ground truth not yet independently human verified',
            },
            Date.now() - start,
          );
          await copyEvidence(t, c.id);
          if (diffs.length) failures++;
        } catch (e) {
          failures++;
          await record(c.id, 'FAIL', { message: (e as Error).message }, Date.now() - start);
        }
      } else if (tests[c.id]) {
        try {
          await tests[c.id]();
          await record(
            c.id,
            'PASS',
            { assertions: 'Executed against local components; see tests/run.ts' },
            Date.now() - start,
          );
        } catch (e) {
          failures++;
          await record(
            c.id,
            'FAIL',
            { message: (e as Error).message, stack: (e as Error).stack?.split('\n').slice(0, 5) },
            Date.now() - start,
          );
        }
      } else
        await record(c.id, 'NOT_RUN', {
          reason: 'Scenario not implemented yet. Not counted as passed.',
        });
    }
  }
} finally {
  await writeFile(join(reportDir, 'results.json'), JSON.stringify(results, null, 2));
  const report = await testReport(reportRoot, runId);
  console.log(
    JSON.stringify(
      {
        run_id: runId,
        suite,
        failures,
        ...report,
        test_report_url: `${reportBaseURL}/test-reports/${runId}/index.html`,
      },
      null,
      2,
    ),
  );
  await app.close();
  await conn.dropDatabase();
  await conn.close();
}
process.exitCode = failures ? 1 : 0;

import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
const { Schema } = mongoose;
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  readerSchema,
  DocumentResult,
  Field,
  outputFields,
  flatOutputFields,
} from '../contracts/index.js';
import { makeDocuments, evaluate, gate } from '../domain/index.js';
import { prepare, crop } from '../document-tools/index.js';
import { scanReport, testReport } from '../reporting/index.js';

export class DomainError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
const safeId = (s: string) => {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(s)) throw new DomainError('INVALID_ID');
  return s;
};
function decode(v: any): any {
  if (v?._bsontype === 'Decimal128') return v.toString();
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object' && !(v instanceof Date))
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, decode(val)]));
  return v;
}
function encodeDocs(doc: DocumentResult) {
  const d = structuredClone(doc);
  for (const f of d.fields)
    if (
      /grand_total|unit_price|\.total$|^(tax|discount|refund)$/.test(f.path) &&
      f.final_value !== null &&
      /^-?\d+(?:\.\d+)?$/.test(f.final_value)
    )
      (f as any).final_value = mongoose.Types.Decimal128.fromString(f.final_value);
  return d;
}
@Injectable()
export class StorageService {
  tasks: any;
  docs: any;
  events: any;
  ops: any;
  runs: any;
  cache: any;
  root = resolve(process.env.STORAGE_ROOT ?? 'runtime');
  constructor(@InjectConnection() private db: Connection) {
    const model = (name: string, def: any, index?: any) => {
      const schema = new Schema(def, { strict: false, versionKey: false });
      if (index) schema.index(index, { unique: true });
      return db.model(name, schema);
    };
    this.tasks = model('scan_tasks', {
      task_id: { type: String, unique: true },
      revision: Number,
      status: String,
      created_at: Date,
      report_expires_at: Date,
      lease_until: Date,
    });
    this.docs = model(
      'document_results',
      { task_id: String, revision: Number, document_id: String, data: Schema.Types.Mixed },
      { task_id: 1, revision: 1, document_id: 1 },
    );
    this.events = model('review_events', {
      task_id: String,
      revision: Number,
      actor: String,
      operation_id: { type: String, unique: true },
      created_at: Date,
    });
    this.ops = model('operations', {
      operation_id: { type: String, unique: true },
      task_id: String,
      result: Schema.Types.Mixed,
    });
    this.runs = model('extraction_runs', { task_id: String, revision: Number });
    this.cache = model('reader_cache', {
      cache_key: { type: String, unique: true },
      expires_at: Date,
      output: Schema.Types.Mixed,
    });
  }
  async init() {
    await mkdir(this.root, { recursive: true });
    await Promise.all([
      this.tasks.init(),
      this.docs.init(),
      this.events.init(),
      this.ops.init(),
      this.cache.init(),
    ]);
  }
  dir(id: string) {
    return join(this.root, 'tasks', safeId(id));
  }
  async task(id: string, session?: any) {
    const t = await this.tasks
      .findOne({ task_id: safeId(id) })
      .session(session ?? null)
      .lean();
    if (!t) throw new DomainError('NOT_FOUND', 404);
    return t;
  }
  async documents(t: any, session?: any): Promise<DocumentResult[]> {
    return (
      await this.docs
        .find({ task_id: t.task_id, revision: t.revision })
        .session(session ?? null)
        .lean()
    ).map((d: any) => decode(d.data));
  }
  async saveDocs(t: any, docs: DocumentResult[], session?: any) {
    if (docs.length)
      await this.docs.insertMany(
        docs.map((d) => ({
          task_id: t.task_id,
          revision: t.revision,
          document_id: d.document_id,
          data: encodeDocs(d),
        })),
        { session },
      );
  }
  async snapshot(id: string) {
    const t = await this.task(id),
      docs = (await this.documents(t)).map(evaluate);
    const { source_path, lease_token, ...meta } = t;
    return {
      ...meta,
      ...(['ready', 'awaiting_review'].includes(t.status) ? gate(docs, t.coverage) : {}),
      scan_task_id: t.task_id,
      documents: docs.map((d) => ({
        ...d,
        field_list: d.fields,
        fields: outputFields(d.fields),
        fields_by_path: flatOutputFields(d.fields),
      })),
      report: t.report_created_at
        ? {
            url: `/reports/${id}/index.html`,
            expires_at: t.report_expires_at,
            revision: t.report_revision,
          }
        : null,
    };
  }
  async health() {
    await this.db.db!.admin().ping();
    const hello = await this.db.db!.admin().command({ hello: 1 });
    await mkdir(join(this.root, 'health'), { recursive: true });
    const f = join(this.root, 'health', randomUUID());
    await writeFile(f, 'ok');
    await rm(f);
    return {
      mongodb: hello.setName ? 'up' : 'standalone',
      storage: 'up',
      checked_at: new Date().toISOString(),
      version: '1.0',
      transactions: !!hello.setName,
    };
  }
  async create(p: any) {
    const bytes = Buffer.from(p.data ?? '', 'base64');
    if (!bytes.length || bytes.length > Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024)
      throw new DomainError('UPLOAD_SIZE');
    const pdf = bytes.subarray(0, 5).toString() === '%PDF-',
      png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      jpeg = bytes[0] === 255 && bytes[1] === 216;
    if (!pdf && !png && !jpeg) throw new DomainError('UNSUPPORTED_FILE');
    const id = randomUUID();
    await mkdir(join(this.dir(id), 'source'), { recursive: true });
    const source = join(this.dir(id), 'source', pdf ? 'document.pdf' : 'document.img');
    await writeFile(source, bytes);
    await this.tasks.create({
      task_id: id,
      filename: String(p.filename ?? 'document').slice(0, 200),
      source_path: source,
      source_hash: createHash('sha256').update(bytes).digest('hex'),
      status: 'queued',
      revision: 0,
      created_at: new Date(),
      coverage: false,
      confidence: 0,
      final_confidence: 0,
    });
    return this.snapshot(id);
  }
  async claim(p: any) {
    if (p.renew) {
      const t = await this.tasks
        .findOneAndUpdate(
          { task_id: p.task_id, lease_token: p.lease_token, lease_until: { $gt: new Date() } },
          { $set: { lease_until: new Date(Date.now() + 90000) } },
          { new: true },
        )
        .lean();
      if (!t) throw new DomainError('LEASE_LOST', 409);
      return t;
    }
    const token = randomUUID();
    return this.tasks
      .findOneAndUpdate(
        {
          status: { $in: ['queued', 'processing'] },
          $or: [{ lease_until: { $exists: false } }, { lease_until: { $lte: new Date() } }],
        },
        {
          $set: {
            status: 'processing',
            lease_token: token,
            lease_until: new Date(Date.now() + 90000),
          },
        },
        { new: true, sort: { created_at: 1 } },
      )
      .lean();
  }
  async assertLease(p: any) {
    const t = await this.task(p.task_id);
    if (t.lease_token !== p.lease_token || new Date(t.lease_until).getTime() <= Date.now())
      throw new DomainError('LEASE_LOST', 409);
    return t;
  }
  async prepare(p: any) {
    const t = await this.assertLease(p);
    const pages = await prepare(
      t.source_path,
      join(this.dir(t.task_id), 'pages'),
      Number(process.env.MAX_PAGES ?? 20),
    );
    await this.tasks.updateOne(
      { task_id: t.task_id, lease_token: p.lease_token },
      { $set: { pages, checkpoint: 'prepared' } },
    );
    return { pages };
  }
  async readerInput(p: any) {
    const t = await this.task(p.task_id);
    return {
      task_id: t.task_id,
      pages: t.pages ?? [],
      source_hash: t.source_hash,
      ai_calls: t.ai_calls ?? 0,
    };
  }
  async commit(p: any) {
    const t = await this.assertLease(p);
    const output = readerSchema.parse(p.output);
    const count = t.pages.length;
    if (
      output.documents.some(
        (d) =>
          d.pages.some((n) => n > count) ||
          d.fields.some((f) => f.page > count || !d.pages.includes(f.page)),
      )
    )
      throw new DomainError('SOURCE_PAGE_INVALID');
    const docs = makeDocuments(output),
      seen = new Set(docs.flatMap((d) => d.pages));
    // Shared pages are allowed, but without trusted regions the grouping must be reviewed.
    const shared = docs.flatMap((d) => d.pages).filter((n, i, a) => a.indexOf(n) !== i);
    for (const d of docs) {
      if (d.pages.some((n) => shared.includes(n)))
        d.segmentation_confidence = Math.min(d.segmentation_confidence, 0.49);
      evaluate(d);
    }
    const coverage = seen.size === count && !output.unsupported_pages.length && docs.length > 0;
    const session = await this.db.startSession();
    try {
      await session.withTransaction(async () => {
        const current = await this.task(p.task_id, session);
        if (current.revision !== t.revision) throw new DomainError('REVISION_CONFLICT', 409);
        const next = { ...t, revision: t.revision + 1 };
        await this.saveDocs(next, docs, session);
        const changed = await this.tasks.updateOne(
          { task_id: t.task_id, revision: t.revision, lease_token: p.lease_token },
          {
            $set: {
              revision: next.revision,
              coverage,
              unsupported_pages: output.unsupported_pages,
              checkpoint: 'extracted',
              ...gate(docs, coverage),
              status: 'processing',
            },
          },
          { session },
        );
        if (changed.modifiedCount !== 1) throw new DomainError('LEASE_OR_REVISION_LOST', 409);
        await this.runs.create(
          [
            {
              task_id: t.task_id,
              revision: next.revision,
              provider: p.provider,
              usage: p.usage ?? null,
              output,
              created_at: new Date(),
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    if (p.cache_key)
      await this.cache.updateOne(
        { cache_key: p.cache_key },
        { $set: { output, expires_at: new Date(Date.now() + 86400000) } },
        { upsert: true },
      );
    return this.snapshot(t.task_id);
  }
  async evidence(p: any) {
    const t = await this.task(p.task_id),
      docs = await this.documents(t);
    const dir = join(this.dir(t.task_id), 'evidence', String(t.revision));
    await mkdir(dir, { recursive: true });
    for (const doc of docs)
      for (let i = 0; i < doc.fields.length; i++) {
        const f = doc.fields[i];
        if (f.missing) continue;
        const page = t.pages.find((x: any) => x.number === f.page);
        if (!page) continue;
        const name = `${doc.document_id}-${i}.png`,
          target = join(dir, name),
          source = join(this.dir(t.task_id), 'pages', page.image);
        const fallback = await crop(source, target, f.bbox);
        f.evidence = {
          page: f.page,
          bbox: f.bbox,
          image: `evidence/${t.revision}/${name}`,
          source_image: `pages/${page.image}`,
          fallback,
        };
      }
    for (const d of docs)
      await this.docs.updateOne(
        { task_id: t.task_id, revision: t.revision, document_id: d.document_id },
        { $set: { data: encodeDocs(d) } },
      );
    return this.snapshot(t.task_id);
  }
  async review(p: any) {
    safeId(p.operation_id);
    const prior = await this.ops.findOne({ operation_id: p.operation_id }).lean();
    if (prior) {
      if (
        prior.task_id !== p.task_id ||
        prior.request_hash !== createHash('sha256').update(JSON.stringify(p)).digest('hex')
      )
        throw new DomainError('OPERATION_CONFLICT', 409);
      return this.snapshot(p.task_id);
    }
    const session = await this.db.startSession();
    try {
      await session.withTransaction(async () => {
        const t = await this.task(p.task_id, session);
        if (t.revision !== p.expected_revision) throw new DomainError('REVISION_CONFLICT', 409);
        if (!['awaiting_review', 'ready'].includes(t.status))
          throw new DomainError('TASK_NOT_REVIEWABLE', 409);
        const docs = (await this.documents(t, session)).map(evaluate),
          before = structuredClone(docs),
          doc = docs.find((d) => d.document_id === p.document_id);
        if (!doc) throw new DomainError('DOCUMENT_NOT_FOUND', 404);
        if (p.action === 'confirm_structure') {
          if (!doc.requires_structure_review)
            throw new DomainError('STRUCTURE_REVIEW_NOT_REQUIRED', 409);
          if (doc.pages.length === 0 || !p.reason?.trim())
            throw new DomainError('REVIEW_REASON_REQUIRED');
          doc.structure_confirmed = true;
        } else {
          const f = doc.fields.find((x) => x.path === p.path);
          if (!f) throw new DomainError('FIELD_NOT_FOUND', 404);
          if (!['approve', 'correct', 'draft'].includes(p.action))
            throw new DomainError('INVALID_ACTION');
          if (p.action !== 'draft' && (!f.requires_review || f.review_status !== 'pending'))
            throw new DomainError('REVIEW_NOT_REQUIRED', 409);
          if (
            p.action === 'approve' &&
            doc.validation_errors.some((e) => e.blocking && e.path === f.path)
          )
            throw new DomainError('FIELD_VALIDATION_REQUIRED', 409);
          if (p.action === 'correct' && !p.reason?.trim())
            throw new DomainError('REVIEW_REASON_REQUIRED');
          if (p.action !== 'approve' && p.value !== null && typeof p.value !== 'string')
            throw new DomainError('INVALID_VALUE');
          const supplied = p.action === 'approve' ? f.final_value : p.value;
          if (p.action !== 'draft' && supplied === null && !p.reason?.trim())
            throw new DomainError('MISSING_VALUE_REASON_REQUIRED');
          f.review_status =
            p.action === 'draft' ? 'pending' : p.action === 'approve' ? 'confirmed' : 'corrected';
          f.final_value = supplied;
          if (p.action === 'draft') f.draft_value = supplied;
          else delete f.draft_value;
          if (p.action === 'draft') {
            f.requires_review = true;
            f.final_confidence = Math.min(f.extraction_confidence, 0.49);
          }
          evaluate(doc);
          if (
            p.action !== 'draft' &&
            doc.validation_errors.some((e) => e.path === f.path && e.code !== 'TOTAL_MISMATCH')
          )
            throw new DomainError('INVALID_CORRECTION');
        }
        docs.forEach(evaluate);
        const next = t.revision + 1;
        await this.saveDocs({ ...t, revision: next }, docs, session);
        const changed = await this.tasks.updateOne(
          { task_id: t.task_id, revision: t.revision },
          { $set: { revision: next, ...gate(docs, t.coverage) } },
          { session },
        );
        if (changed.modifiedCount !== 1) throw new DomainError('REVISION_CONFLICT', 409);
        const event = {
          task_id: t.task_id,
          revision: next,
          actor: process.env.REVIEWER_NAME ?? 'local-reviewer',
          operation_id: p.operation_id,
          action: p.action,
          reason: p.reason ?? '',
          before,
          after: docs,
          created_at: new Date(),
        };
        await this.events.create([event], { session });
        await this.ops.create(
          [
            {
              operation_id: p.operation_id,
              task_id: p.task_id,
              request_hash: createHash('sha256').update(JSON.stringify(p)).digest('hex'),
              result: { revision: next },
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    // Report is a recoverable projection: failed generation never rolls back a successful review.
    try {
      await this.report(p);
    } catch {
      await this.tasks.updateOne(
        { task_id: p.task_id },
        { $set: { report_error: 'REPORT_GENERATION_FAILED' } },
      );
    }
    return this.snapshot(p.task_id);
  }
  async report(p: any) {
    const t = await this.task(p.task_id),
      docs = await this.documents(t);
    if (t.report_expires_at && new Date(t.report_expires_at) <= new Date())
      throw new DomainError('REPORT_EXPIRED', 410);
    const expires = t.report_expires_at ?? new Date(Date.now() + 30 * 86400000);
    await scanReport(this.root, t, docs, expires);
    await this.tasks.updateOne(
      { task_id: t.task_id, revision: t.revision },
      {
        $set: {
          report_created_at: t.report_created_at ?? new Date(),
          report_expires_at: expires,
          report_revision: t.revision,
          report_error: null,
          ...gate(docs, t.coverage),
        },
      },
    );
    return this.snapshot(t.task_id);
  }
  async artifact(p: any) {
    const t = await this.task(p.task_id);
    const path = String(p.path ?? '');
    if (
      !/^(pages\/page-\d+\.png|evidence\/\d+\/[\w-]+\.png|reports\/(index\.html|manifest\.json|assets\/[\w.-]+))$/.test(
        path,
      )
    )
      throw new DomainError('INVALID_ARTIFACT', 403);
    if (
      path.startsWith('reports/') &&
      (!t.report_expires_at || new Date(t.report_expires_at) <= new Date())
    )
      throw new DomainError('REPORT_EXPIRED', 410);
    const file = resolve(this.dir(t.task_id), path);
    if (!file.startsWith(this.dir(t.task_id) + '/')) throw new DomainError('INVALID_ARTIFACT', 403);
    await stat(file);
    return { path: file };
  }
  async cleanup() {
    const expired = await this.tasks
      .find({ report_expires_at: { $lte: new Date() }, report_deleted: { $ne: true } })
      .lean();
    for (const t of expired) {
      await rm(join(this.dir(t.task_id), 'reports'), { recursive: true, force: true });
      await this.tasks.updateOne({ task_id: t.task_id }, { $set: { report_deleted: true } });
    }
    const base = join(this.root, 'test-reports');
    try {
      for (const id of await readdir(base)) {
        if (!/^[\w-]{1,100}$/.test(id)) continue;
        try {
          const m = JSON.parse(await readFile(join(base, id, 'manifest.json'), 'utf8'));
          if (new Date(m.expires_at) <= new Date()) {
            await rm(join(base, id, 'index.html'), { force: true });
            await rm(join(base, id, 'assets'), { recursive: true, force: true });
          }
        } catch {}
      }
    } catch {}
    return { deleted: expired.length };
  }
  async dispatch(name: string, p: any): Promise<any> {
    switch (name) {
      case 'get_system_health':
        return this.health();
      case 'get_cached_extraction':
        return this.cache
          .findOne({ cache_key: p.cache_key, expires_at: { $gt: new Date() } })
          .select('output')
          .lean();
      case 'record_ai_attempt': {
        await this.assertLease(p);
        const r = await this.tasks.updateOne(
          {
            task_id: p.task_id,
            lease_token: p.lease_token,
            $or: [{ ai_calls: { $exists: false } }, { ai_calls: { $lt: p.max_calls } }],
          },
          { $inc: { ai_calls: 1 } },
        );
        if (r.modifiedCount !== 1) throw new DomainError('AI_BUDGET_EXHAUSTED', 409);
        return { recorded: true };
      }
      case 'create_scan_task':
        return this.create(p);
      case 'claim_scan_task':
        return this.claim(p);
      case 'prepare_document':
        return this.prepare(p);
      case 'build_reader_input':
        return this.readerInput(p);
      case 'commit_extraction':
        return this.commit(p);
      case 'build_field_evidence':
        return this.evidence(p);
      case 'get_scan_task':
        return this.snapshot(p.task_id);
      case 'list_scan_tasks':
        return this.tasks
          .find({})
          .select('task_id filename status revision confidence final_confidence created_at')
          .sort({ created_at: -1 })
          .limit(100)
          .lean();
      case 'get_review_queue':
        return this.snapshot(p.task_id);
      case 'submit_review':
        return this.review(p);
      case 'generate_html_report':
        return this.report(p);
      case 'get_report_link':
        return (await this.snapshot(p.task_id)).report;
      case 'get_artifact_metadata':
        return this.artifact(p);
      case 'cleanup_expired_reports':
        return this.cleanup();
      case 'get_audit':
        await this.task(p.task_id);
        return this.events
          .find({ task_id: p.task_id })
          .select('-before -after')
          .sort({ revision: 1 })
          .lean();
      case 'generate_test_report':
        return testReport(this.root, safeId(p.test_run_id));
      case 'export_approved_result': {
        const t = await this.task(p.task_id),
          docs = await this.documents(t),
          g = gate(docs, t.coverage);
        if (g.status !== 'ready') throw new DomainError('REVIEW_REQUIRED', 409);
        if (p.expected_revision !== t.revision) throw new DomainError('REVISION_CONFLICT', 409);
        try {
          await stat(t.source_path);
          for (const d of docs)
            for (const f of d.fields)
              if (f.evidence) await stat(join(this.dir(t.task_id), f.evidence.image));
        } catch {
          throw new DomainError('ARTIFACT_MISSING', 409);
        }
        return this.snapshot(p.task_id);
      }
      case 'advance_scan_task': {
        await this.assertLease(p);
        if (p.status === 'failed')
          await this.tasks.updateOne(
            { task_id: p.task_id, lease_token: p.lease_token },
            {
              $set: { status: 'failed', error: p.error ?? 'PROCESSING_FAILED' },
              $unset: { lease_until: 1, lease_token: 1 },
            },
          );
        return this.snapshot(p.task_id);
      }
      case 'check_document_coverage':
      case 'normalize_and_validate':
      case 'evaluate_confidence_and_gate': {
        const t = await this.task(p.task_id),
          docs = await this.documents(t);
        docs.forEach(evaluate);
        for (const d of docs)
          await this.docs.updateOne(
            { task_id: t.task_id, revision: t.revision, document_id: d.document_id },
            { $set: { data: encodeDocs(d) } },
          );
        await this.tasks.updateOne(
          { task_id: t.task_id, revision: t.revision },
          {
            $set: {
              ...gate(docs, t.coverage),
              ...(t.status === 'processing' ? { status: 'processing' } : {}),
            },
          },
        );
        return this.snapshot(p.task_id);
      }
      default:
        throw new DomainError('UNKNOWN_TOOL', 404);
    }
  }
}

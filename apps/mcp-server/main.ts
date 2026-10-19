import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readerSchema } from '../../packages/contracts/index.js';
import { StorageService, DomainError } from '../../packages/storage/service.js';
const names = [
  'get_system_health',
  'get_cached_extraction',
  'record_ai_attempt',
  'create_scan_task',
  'claim_scan_task',
  'prepare_document',
  'build_reader_input',
  'commit_extraction',
  'build_field_evidence',
  'get_scan_task',
  'list_scan_tasks',
  'get_review_queue',
  'submit_review',
  'generate_html_report',
  'get_report_link',
  'get_artifact_metadata',
  'cleanup_expired_reports',
  'get_audit',
  'generate_test_report',
  'export_approved_result',
  'advance_scan_task',
  'check_document_coverage',
  'normalize_and_validate',
  'evaluate_confidence_and_gate',
];
const id = z.string().uuid(),
  task = z.object({ task_id: id }).strict();
const leased = z.object({ task_id: id, lease_token: id }).strict();
const schemas: Record<string, z.ZodTypeAny> = {
  get_system_health: z.object({}).strict(),
  list_scan_tasks: z.object({}).strict(),
  cleanup_expired_reports: z.object({}).strict(),
  create_scan_task: z
    .object({ filename: z.string().max(200), data: z.string().min(1).max(30000000) })
    .strict(),
  claim_scan_task: z
    .object({ task_id: id.optional(), lease_token: id.optional(), renew: z.boolean().optional() })
    .strict(),
  prepare_document: leased,
  build_reader_input: z.object({ task_id: id, lease_token: id.optional() }).strict(),
  commit_extraction: z
    .object({
      task_id: id,
      lease_token: id,
      output: readerSchema,
      provider: z.string(),
      usage: z.unknown().optional(),
      attempts: z.array(z.unknown()).optional(),
      cache_key: z.string().max(100).optional(),
    })
    .strict(),
  submit_review: z
    .object({
      task_id: id,
      document_id: id,
      path: z.string().max(160).nullable().optional(),
      action: z.enum(['approve', 'correct', 'draft', 'confirm_structure']),
      value: z.string().max(20000).nullable().optional(),
      reason: z.string().max(2000).optional(),
      expected_revision: z.number().int().nonnegative(),
      operation_id: id,
    })
    .strict(),
  get_artifact_metadata: z.object({ task_id: id, path: z.string().max(400) }).strict(),
  export_approved_result: z
    .object({ task_id: id, expected_revision: z.number().int().nonnegative() })
    .strict(),
  generate_test_report: z.object({ test_run_id: z.string().regex(/^[\w-]{1,100}$/) }).strict(),
  get_cached_extraction: z.object({ cache_key: z.string().max(100) }).strict(),
  record_ai_attempt: z
    .object({ task_id: id, lease_token: id, max_calls: z.number().int().positive() })
    .strict(),
  advance_scan_task: z
    .object({
      task_id: id,
      lease_token: id,
      status: z.literal('failed'),
      error: z.string().max(100).optional(),
    })
    .strict(),
};
for (const n of [
  'build_field_evidence',
  'check_document_coverage',
  'normalize_and_validate',
  'evaluate_confidence_and_gate',
  'generate_html_report',
])
  schemas[n] = z.object({ task_id: id, lease_token: id.optional() }).strict();
for (const n of ['get_scan_task', 'get_review_queue', 'get_report_link', 'get_audit'])
  schemas[n] = task;
@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI!, {
      serverSelectionTimeoutMS: 3000,
      retryAttempts: 0,
    }),
  ],
  providers: [StorageService],
})
class App {}
const app = await NestFactory.createApplicationContext(App, { logger: false });
const service = app.get(StorageService);
await service.init();
await service.cleanup();
const server = new McpServer({ name: 'medical-document-tools', version: '1.0.0' });
for (const name of names)
  server.registerTool(
    name,
    {
      description: `Local deterministic medical document tool: ${name}. No AI calls.`,
      inputSchema: { payload: schemas[name] },
    },
    async ({ payload }: { payload: any }) => {
      try {
        const data = await service.dispatch(name, payload);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }) }] };
      } catch (error) {
        const e = error as Error;
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                ok: false,
                code:
                  error instanceof DomainError
                    ? error.code
                    : e.name === 'ZodError'
                      ? 'INVALID_SCHEMA'
                      : 'TOOL_FAILED',
                status: error instanceof DomainError ? error.status : 400,
              }),
            },
          ],
        };
      }
    },
  );
await server.connect(new StdioServerTransport());
const stop = async () => {
  await server.close();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdin.on('end', stop);

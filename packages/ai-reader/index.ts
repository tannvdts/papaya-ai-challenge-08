import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Config } from '../contracts/config.js';
import { ReaderOutput, readerSchema, TYPES } from '../contracts/index.js';
export class Reader {
  requests = 0;
  lastError: string | null = null;
  constructor(public config: Config) {}
  async read(
    input: any,
    beforeRequest?: () => Promise<void>,
  ): Promise<{ output: ReaderOutput; usage: any; provider: string; attempts: any[] }> {
    if (this.config.AI_MODE === 'disabled') throw Error('AI_DISABLED');
    if (this.config.AI_MODE === 'mock')
      return {
        output: mockRead(input.pages),
        usage: null,
        provider: 'mock-text-fixture-reader',
        attempts: [],
      };
    const client = new OpenAI({
      apiKey: this.config.OPENAI_API_KEY,
      baseURL: this.config.OPENAI_BASE_URL,
      project: this.config.OPENAI_PROJECT_ID,
      organization: this.config.OPENAI_ORG_ID,
      timeout: this.config.OPENAI_TIMEOUT_MS,
      maxRetries: 0,
    });
    const images = await Promise.all(
      input.pages.map(async (p: any) => ({
        type: 'input_image' as const,
        image_url:
          'data:image/png;base64,' +
          (
            await readFile(join(this.config.STORAGE_ROOT, 'tasks', input.task_id, 'pages', p.image))
          ).toString('base64'),
        detail: 'high' as const,
      })),
    );
    const prompt = await readFile('prompts/document-reader.txt', 'utf8');
    const attempts: any[] = [];
    const budget = Math.min(
      Math.max(0, this.config.AI_MAX_CALLS_PER_TASK - (input.ai_calls ?? 0)),
      this.config.OPENAI_MAX_RETRIES + 1,
    );
    for (let attempt = 0; attempt < budget; attempt++) {
      if (beforeRequest) await beforeRequest();
      this.requests++;
      const start = Date.now();
      try {
        const response = await client.responses.parse({
          model: this.config.OPENAI_MODEL,
          store: false,
          input: [
            { role: 'system', content: prompt },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'Extract all documents. Images are in original page order; page numbers are 1-based.',
                },
                ...images,
              ],
            },
          ],
          text: { format: zodTextFormat(readerSchema, 'medical_documents') },
        });
        if (response.status !== 'completed' || !response.output_parsed)
          throw Error('INCOMPLETE_OR_REFUSED');
        const output = readerSchema.parse(response.output_parsed);
        attempts.push({
          attempt: attempt + 1,
          duration_ms: Date.now() - start,
          status: 'completed',
          request_id: response.id,
        });
        this.lastError = null;
        return {
          output,
          usage: response.usage,
          provider: `openai:${this.config.OPENAI_MODEL}`,
          attempts,
        };
      } catch (e) {
        const status = (e as any).status;
        this.lastError = status ? `PROVIDER_HTTP_${status}` : 'PROVIDER_REQUEST_FAILED';
        attempts.push({
          attempt: attempt + 1,
          duration_ms: Date.now() - start,
          error: this.lastError,
        });
        if (![408, 429, 500, 502, 503, 504, undefined].includes(status) || attempt === budget - 1)
          throw Error(this.lastError);
        await new Promise((r) => setTimeout(r, Math.min(2000, 250 * 2 ** attempt)));
      }
    }
    throw Error('AI_BUDGET_EXHAUSTED');
  }
}
export function mockRead(pages: any[]): ReaderOutput {
  // Explicitly a fixture reader: parses visible key:value labels, never claims OCR capability.
  const documents: ReaderOutput['documents'] = [];
  const unsupported_pages: number[] = [];
  for (const p of pages) {
    const type = p.text.match(
      /document_type:\s*(receipt|discharge_summary|lab_report|prescription)/,
    )?.[1] as (typeof TYPES)[number] | undefined;
    if (!type) {
      unsupported_pages.push(p.number);
      continue;
    }
    const fields: ReaderOutput['documents'][number]['fields'] = [];
    for (const line of p.text.split('\n')) {
      const m = line.trim().match(/^([a-z_]+(?:\.[a-z_0-9]+)*):\s*(.*?)\s*$/);
      if (!m || m[1] === 'document_type') continue;
      const val = m[2] === '[not visible]' ? null : m[2];
      fields.push({
        path: m[1],
        value: val,
        raw_value: val,
        confidence: val === null ? 0 : 0.9,
        page: p.number,
        bbox: null,
        handwritten_uncertain: false,
      });
    }
    documents.push({
      document_type: type,
      classification_confidence: 0.95,
      segmentation_confidence: 0.9,
      pages: [p.number],
      fields,
    });
  }
  return readerSchema.parse({ documents, unsupported_pages });
}

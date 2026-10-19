import { z } from 'zod';
import { resolve } from 'node:path';
const pos = z.coerce.number().int().positive();
export const envSchema = z
  .object({
    AI_MODE: z.enum(['openai', 'mock', 'disabled']).default('openai'),
    BIND_HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
    APP_PORT: pos.max(65535).default(4000),
    APP_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
    STORAGE_ROOT: z.string().default('./runtime'),
    MONGODB_URI: z.string().min(1),
    OPENAI_API_KEY: z.string().default(''),
    OPENAI_MODEL: z.string().default(''),
    OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    OPENAI_PROJECT_ID: z.string().optional(),
    OPENAI_ORG_ID: z.string().optional(),
    OPENAI_TIMEOUT_MS: pos.default(60000),
    OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_MAX_CALLS_PER_TASK: pos.default(5),
    MAX_PAGES: pos.max(100).default(20),
    MAX_UPLOAD_MB: pos.max(100).default(20),
    REVIEWER_NAME: z.string().min(1).default('local-reviewer'),
    HEALTHCHECK_TIMEOUT_MS: pos.default(3000),
    HEALTHCHECK_CACHE_TTL_MS: pos.default(5000),
  })
  .superRefine((e, c) => {
    if (e.AI_MODE === 'openai')
      for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL'] as const)
        if (!e[key])
          c.addIssue({ code: 'custom', path: [key], message: 'Required in openai mode' });
  })
  .transform((e) => ({ ...e, APP_URL: e.APP_URL ?? `http://127.0.0.1:${e.APP_PORT}` }));
export type Config = z.infer<typeof envSchema>;
export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const p = envSchema.safeParse(env);
  if (!p.success)
    throw new Error('Invalid env: ' + p.error.issues.map((i) => i.path.join('.')).join(', '));
  return { ...p.data, STORAGE_ROOT: resolve(p.data.STORAGE_ROOT) };
}

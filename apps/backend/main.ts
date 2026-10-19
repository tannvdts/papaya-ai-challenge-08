import 'reflect-metadata';
import {
  Module,
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  Req,
  UploadedFile,
  UseInterceptors,
  Inject,
  OnModuleDestroy,
  HttpException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Request, Response } from 'express';
import { config, Config } from '../../packages/contracts/config.js';
import { Tools, ToolError } from '../../packages/mcp-client/index.js';
import { Reader } from '../../packages/ai-reader/index.js';
import { sampleSetForMode, MANUAL_TEST_SAMPLE_DIR } from '../../packages/contracts/sample-sets.js';
export class Runtime implements OnModuleDestroy {
  tools = new Tools();
  reader: Reader;
  token = randomUUID();
  timer?: NodeJS.Timeout;
  cleanupTimer?: NodeJS.Timeout;
  working = false;
  stopping = false;
  heartbeat = Date.now();
  verification: any = { status: 'not_checked' };
  lastHealth: any;
  lastHealthTime = 0;
  nextReconnectAt = 0;
  constructor(public cfg: Config) {
    this.reader = new Reader(cfg);
  }
  async init() {
    await this.tools.connect();
    await this.tools.call('cleanup_expired_reports');
    this.timer = setInterval(() => void this.tick(), 1000);
    this.cleanupTimer = setInterval(
      () => void this.tools.call('cleanup_expired_reports').catch(() => {}),
      60000,
    );
    await this.tick();
  }
  check(req: Request) {
    if (req.get('x-review-token') !== this.token)
      throw new HttpException('LOCAL_SESSION_REQUIRED', 403);
    const origin = req.get('origin');
    if (origin && origin !== this.cfg.APP_URL) throw new HttpException('ORIGIN_DENIED', 403);
  }
  async tick() {
    this.heartbeat = Date.now();
    if (this.working || this.stopping) return;
    this.working = true;
    let task: any;
    let renew: NodeJS.Timeout | undefined;
    try {
      if (!this.tools.connected) {
        if (Date.now() < this.nextReconnectAt) return;
        this.nextReconnectAt = Date.now() + 5000;
        await this.tools.reconnect();
      }
      if (this.cfg.AI_MODE === 'disabled') return;
      task = await this.tools.call('claim_scan_task');
      if (!task) return;
      renew = setInterval(
        () =>
          void this.tools
            .call('claim_scan_task', {
              task_id: task.task_id,
              lease_token: task.lease_token,
              renew: true,
            })
            .catch(() => {}),
        15000,
      );
      const payload = { task_id: task.task_id, lease_token: task.lease_token };
      await this.tools.call('prepare_document', payload);
      const input = await this.tools.call('build_reader_input', payload);
      const cache_key = createHash('sha256')
        .update(
          JSON.stringify({
            source: input.source_hash,
            mode: this.cfg.AI_MODE,
            model: this.cfg.OPENAI_MODEL,
            endpoint: this.cfg.OPENAI_BASE_URL,
            credential: createHash('sha256').update(this.cfg.OPENAI_API_KEY).digest('hex'),
            prompt: await readFile('prompts/document-reader.txt', 'utf8'),
            schema: '1.0',
            render: '1.7-v1',
          }),
        )
        .digest('hex');
      const cached = await this.tools.call('get_cached_extraction', { cache_key });
      const result = cached
        ? {
            output: cached.output,
            provider: 'cache:' + this.cfg.AI_MODE,
            usage: null,
            attempts: [],
          }
        : await this.reader.read(input, () =>
            this.tools.call('record_ai_attempt', {
              ...payload,
              max_calls: this.cfg.AI_MAX_CALLS_PER_TASK,
            }),
          );
      await this.tools.call('commit_extraction', { ...payload, ...result, cache_key });
      await this.tools.call('normalize_and_validate', payload);
      await this.tools.call('build_field_evidence', payload);
      await this.tools.call('generate_html_report', payload);
      if (this.verification.task_id === task.task_id)
        this.verification = {
          status: 'verified',
          at: new Date().toISOString(),
          task_id: task.task_id,
        };
    } catch (e) {
      if (task)
        await this.tools
          .call('advance_scan_task', {
            task_id: task.task_id,
            lease_token: task.lease_token,
            status: 'failed',
            error:
              e instanceof ToolError
                ? e.code
                : (e as Error).message.startsWith('PROVIDER_')
                  ? (e as Error).message
                  : 'PROCESSING_FAILED',
          })
          .catch(() => {});
    } finally {
      if (renew) clearInterval(renew);
      this.working = false;
    }
  }
  async health() {
    const checked = Date.now();
    if (this.lastHealth && checked - this.lastHealthTime < this.cfg.HEALTHCHECK_CACHE_TTL_MS)
      return this.lastHealth;
    let local: any = { status: 'down' };
    let timer: NodeJS.Timeout | undefined;
    try {
      local = await Promise.race([
        this.tools.call('get_system_health'),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error('HEALTH_TIMEOUT')),
            this.cfg.HEALTHCHECK_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
    } finally {
      if (timer) clearTimeout(timer);
    }
    const healthy =
      local.mongodb === 'up' &&
      local.storage === 'up' &&
      this.tools.connected &&
      !this.stopping &&
      Date.now() - this.heartbeat < 30000;
    const scan = healthy && this.cfg.AI_MODE === 'openai';
    this.lastHealthTime = checked;
    return (this.lastHealth = {
      ready: scan,
      mode: this.cfg.AI_MODE,
      capabilities: {
        scan_openai: scan,
        scan_mock: healthy && this.cfg.AI_MODE === 'mock',
        review: healthy,
        report: healthy,
      },
      local,
      openai: {
        configuration_valid: this.cfg.AI_MODE === 'openai',
        verification_status: this.verification.status,
        last_verified_at: this.verification.at ?? null,
        last_error: this.reader.lastError,
      },
      checked_at: new Date().toISOString(),
    });
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await this.tools.close();
  }
}
@Controller()
class AppController {
  constructor(@Inject(Runtime) private rt: Runtime) {}
  @Get() root(@Res() res: Response) {
    res.redirect('/manual-test');
  }
  @Get('manual-test') async page(@Res() res: Response) {
    res.type('html').send(await readFile('public/manual.html', 'utf8'));
  }
  @Get('manual-test.css') async style(@Res() res: Response) {
    res.type('text/css').send(await readFile('public/manual-test.css', 'utf8'));
  }
  @Get('manual-test.js') async script(@Res() res: Response) {
    res.type('application/javascript').send(await readFile('public/manual-test.js', 'utf8'));
  }
  @Get('session') session() {
    return {
      token: this.rt.token,
      reviewer: this.rt.cfg.REVIEWER_NAME,
      mode: this.rt.cfg.AI_MODE,
      sample_set: sampleSetForMode(this.rt.cfg.AI_MODE),
    };
  }
  @Get('health/live') live(@Res() res: Response) {
    res
      .status(this.rt.stopping ? 503 : 200)
      .json({ status: this.rt.stopping ? 'shutting_down' : 'up' });
  }
  @Get(['health', 'health/ready']) async health(@Res() res: Response) {
    const h = await this.rt.health();
    res.status(h.ready ? 200 : 503).json(h);
  }
  @Get('api/tasks') list() {
    return this.rt.tools.call('list_scan_tasks');
  }
  @Post('api/tasks')
  @UseInterceptors(
    FileInterceptor('document', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }),
  )
  async upload(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    this.rt.check(req);
    if (this.rt.cfg.AI_MODE === 'disabled') throw new HttpException('AI_DISABLED', 409);
    if (!file || file.size > this.rt.cfg.MAX_UPLOAD_MB * 1024 * 1024)
      throw new HttpException('UPLOAD_SIZE', 400);
    return this.rt.tools.call('create_scan_task', {
      filename: file.originalname,
      data: file.buffer.toString('base64'),
    });
  }
  @Get('api/tasks/:id') get(@Param('id') id: string) {
    return this.rt.tools.call('get_scan_task', { task_id: id });
  }
  @Get('api/tasks/:id/audit') audit(@Param('id') id: string) {
    return this.rt.tools.call('get_audit', { task_id: id });
  }
  @Post('api/tasks/:id/review') review(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    this.rt.check(req);
    return this.rt.tools.call('submit_review', { ...body, task_id: id });
  }
  @Post('api/tasks/:id/export') export(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    this.rt.check(req);
    return this.rt.tools.call('export_approved_result', {
      task_id: id,
      expected_revision: body.expected_revision,
    });
  }
  @Get('artifacts/:id/*path') async image(
    @Param('id') id: string,
    @Param('path') path: string | string[],
    @Res() res: Response,
  ) {
    const p = Array.isArray(path) ? path.join('/') : path;
    const a = await this.rt.tools.call('get_artifact_metadata', { task_id: id, path: p });
    res.sendFile(a.path);
  }
  @Get('reports/:id/*path') async report(
    @Param('id') id: string,
    @Param('path') path: string | string[],
    @Res() res: Response,
  ) {
    const p = Array.isArray(path) ? path.join('/') : path;
    const a = await this.rt.tools.call('get_artifact_metadata', {
      task_id: id,
      path: 'reports/' + p,
    });
    res.sendFile(a.path);
  }
  @Get('test-reports/:id/*path') async testReport(
    @Param('id') id: string,
    @Param('path') path: string | string[],
    @Res() res: Response,
  ) {
    const p = Array.isArray(path) ? path.join('/') : path;
    if (
      !/^[\w-]{1,100}$/.test(id) ||
      !/^(index\.html|results\.json|manifest\.json|assets\/[\w.-]+)$/.test(p)
    )
      throw new HttpException('INVALID_REPORT', 403);
    const dir = join(this.rt.cfg.STORAGE_ROOT, 'test-reports', id);
    const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    if (new Date(m.expires_at) <= new Date()) throw new HttpException('REPORT_EXPIRED', 410);
    res.sendFile(resolve(dir, p));
  }
  @Post('diagnostics/openai/verify') async verify(@Req() req: Request) {
    this.rt.check(req);
    if (this.rt.cfg.AI_MODE !== 'openai') throw new HttpException('OPENAI_NOT_CONFIGURED', 409);
    if (this.rt.verification.at && Date.now() - Date.parse(this.rt.verification.at) < 60000)
      throw new HttpException('VERIFY_COOLDOWN', 429);
    this.rt.verification = { status: 'checking', at: new Date().toISOString() };
    // Diagnostics uses the same reader input/schema, with an isolated synthetic sample task.
    const data = await readFile(join(MANUAL_TEST_SAMPLE_DIR, 'MT-01-clean-receipt.pdf'));
    const task = await this.rt.tools.call('create_scan_task', {
      filename: 'diagnostics-synthetic.pdf',
      data: data.toString('base64'),
    });
    try {
      this.rt.verification = {
        status: 'submitted',
        at: new Date().toISOString(),
        task_id: task.task_id,
      };
      await this.rt.tick();
      return this.rt.verification;
    } catch {
      this.rt.verification = { status: 'failed', at: new Date().toISOString() };
      throw new HttpException('VERIFY_FAILED', 502);
    }
  }
}
export async function bootstrap(listen = true) {
  const cfg = config();
  Object.assign(process.env, { STORAGE_ROOT: cfg.STORAGE_ROOT, REVIEWER_NAME: cfg.REVIEWER_NAME });
  const runtime = new Runtime(cfg);
  @Module({
    imports: [ConfigModule.forRoot({ ignoreEnvFile: true }), TerminusModule],
    controllers: [AppController],
    providers: [{ provide: Runtime, useValue: runtime }],
  })
  class AppModule {}
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'test' ? false : ['error', 'warn'],
  });
  app.use((req: Request, res: Response, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const host = req.hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
      return res.status(403).send('HOST_DENIED');
    next();
  });
  app.useGlobalFilters({
    catch(error: any, host: any) {
      const res = host.switchToHttp().getResponse();
      res
        .status(
          error instanceof ToolError
            ? error.status
            : error instanceof HttpException
              ? error.getStatus()
              : 500,
        )
        .json({
          error:
            error instanceof ToolError
              ? error.code
              : error instanceof HttpException
                ? error.message
                : 'REQUEST_FAILED',
        });
    },
  });
  app.enableShutdownHooks();
  await runtime.init();
  await app.init();
  if (listen) await app.listen(cfg.APP_PORT, cfg.BIND_HOST);
  return { app, runtime };
}
if (process.argv[1] && resolve(process.argv[1]) === resolve('dist/apps/backend/main.js'))
  await bootstrap();

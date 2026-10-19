import { test, expect } from '@jest/globals';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';

// Run native rendering in a child so a SIGSEGV becomes a failed regression test.
test('renders image-only PDF pages without mixing native canvas versions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scan-render-regression-'));
  try {
    const pdf = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      pdf.on('data', (c) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
    });
    const png = await sharp({
      create: { width: 640, height: 860, channels: 3, background: '#13a83a' },
    })
      .png()
      .toBuffer();
    const jpeg = await sharp(png).jpeg().toBuffer();
    for (const image of [png, jpeg]) {
      pdf.addPage({ size: 'A4', margin: 0 });
      pdf.image(image, 0, 0, { width: 595.28, height: 841.89 });
    }
    pdf.end();
    const source = join(dir, 'scan.pdf');
    await writeFile(source, await done);
    const moduleURL = new URL('../packages/document-tools/index.js', import.meta.url).href;
    const code = `import {prepare} from ${JSON.stringify(moduleURL)};import sharp from 'sharp';const pages=await prepare(process.argv[1],process.argv[2],5);for(const p of pages){const {channels}=await sharp(process.argv[2]+'/'+p.image).stats();if(channels[1].mean<80||channels[1].mean<channels[0].mean*2)throw Error('PDF_IMAGE_NOT_RENDERED');if(p.text.trim())throw Error('UNEXPECTED_TEXT_LAYER');}console.log(JSON.stringify({pages:pages.length}));`;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--input-type=module', '-e', code, source, join(dir, 'pages')],
      { cwd: resolve('.'), timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    expect(JSON.parse(stdout.trim()).pages).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 40000);

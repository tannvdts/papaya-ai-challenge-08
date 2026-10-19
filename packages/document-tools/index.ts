import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { DOMMatrix, ImageData, Path2D, createCanvas } from '@napi-rs/canvas';
export type Page = { number: number; image: string; width: number; height: number; text: string };
export async function prepare(source: string, dir: string, maxPages: number): Promise<Page[]> {
  await mkdir(dir, { recursive: true });
  const data = await readFile(source);
  if (data.subarray(0, 5).toString() === '%PDF-') {
    Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({ data: new Uint8Array(data), useSystemFonts: true });
    const pdf = await loading.promise;
    if (pdf.numPages > maxPages) {
      await loading.destroy();
      throw Error('MAX_PAGES');
    }
    const pages: Page[] = [];
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n),
          viewport = page.getViewport({ scale: 1.7 });
        if (viewport.width * viewport.height > 40_000_000) throw Error('PAGE_TOO_LARGE');
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({
          canvas: canvas as any,
          canvasContext: canvas.getContext('2d') as any,
          viewport,
        }).promise;
        const file = `page-${n}.png`;
        await writeFile(join(dir, file), canvas.toBuffer('image/png'));
        const tc = await page.getTextContent();
        pages.push({
          number: n,
          image: file,
          width: canvas.width,
          height: canvas.height,
          text: tc.items.map((i: any) => i.str + (i.hasEOL ? '\n' : ' ')).join(''),
        });
      }
    } finally {
      await loading.destroy();
    }
    return pages;
  }
  const image = sharp(data, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate();
  const out = await image.png().toBuffer({ resolveWithObject: true });
  await writeFile(join(dir, 'page-1.png'), out.data);
  return [
    { number: 1, image: 'page-1.png', width: out.info.width, height: out.info.height, text: '' },
  ];
}
export async function crop(source: string, destination: string, bbox: number[] | null) {
  const meta = await sharp(source).metadata();
  if (
    !bbox ||
    bbox.length !== 4 ||
    bbox.some((x) => !Number.isFinite(x)) ||
    bbox[0] < 0 ||
    bbox[1] < 0 ||
    bbox[2] <= bbox[0] ||
    bbox[3] <= bbox[1] ||
    bbox[2] > 1 ||
    bbox[3] > 1
  ) {
    await sharp(source).png().toFile(destination);
    return true;
  }
  const [x, y, r, b] = bbox;
  const left = Math.floor(x * meta.width!),
    top = Math.floor(y * meta.height!);
  await sharp(source)
    .extract({
      left,
      top,
      width: Math.max(1, Math.ceil(r * meta.width!) - left),
      height: Math.max(1, Math.ceil(b * meta.height!) - top),
    })
    .png()
    .toFile(destination);
  return false;
}

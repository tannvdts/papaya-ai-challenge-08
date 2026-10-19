import { readFile, mkdir, writeFile } from 'node:fs/promises';
const base = process.env.APP_URL ?? 'http://127.0.0.1:4000';
const session = (await (await fetch(base + '/session')).json()) as any;
if (session.mode !== 'mock')
  throw Error(
    'This command only exports explicitly labeled MOCK results. Set AI_MODE=mock and restart.',
  );
const manifest = JSON.parse(await readFile('mock-samples/manifest.json', 'utf8'));
await mkdir('mock-samples/extraction-results/mock', { recursive: true });
for (const spec of manifest) {
  const form = new FormData();
  form.append('document', new Blob([await readFile('mock-samples/' + spec.file)]), spec.file);
  const res = await fetch(base + '/api/tasks', {
    method: 'POST',
    headers: { 'x-review-token': session.token },
    body: form,
  });
  if (!res.ok) throw Error('UPLOAD_FAILED');
  let t: any = await res.json();
  for (let i = 0; i < 150 && ['queued', 'processing'].includes(t.status); i++) {
    await new Promise((r) => setTimeout(r, 200));
    t = await (await fetch(base + '/api/tasks/' + t.task_id)).json();
  }
  if (['queued', 'processing', 'failed'].includes(t.status))
    throw Error('MOCK_EXTRACTION_NOT_COMPLETED');
  await writeFile(
    'mock-samples/extraction-results/mock/' + spec.id + '.json',
    JSON.stringify({ mode: 'mock; NOT OpenAI benchmark', ...t }, null, 2),
  );
  console.log(spec.id, t.status);
}

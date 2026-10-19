import Handlebars from 'handlebars';
import { mkdir, writeFile, readFile, rename, cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { confidenceBand } from '../contracts/index.js';
Handlebars.registerHelper('band', confidenceBand);
Handlebars.registerHelper('json', (v: unknown) => JSON.stringify(v, null, 2));
export const style = `body{font:16px system-ui;margin:0;background:#f3f5f8;color:#142235}main{max-width:1200px;margin:auto;padding:28px}h1{font-size:30px}article,section{background:white;padding:20px;border-radius:12px;margin:16px 0}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;text-align:left;padding:10px;vertical-align:top;overflow-wrap:anywhere}pre{white-space:pre-wrap}img{max-width:320px;max-height:220px}a{color:#135fbd}button,input,select,textarea{font:inherit;padding:8px;margin:4px}button{cursor:pointer;background:#eaf1ff;border:1px solid #acc5ee;border-radius:5px}.badge{padding:4px 8px;border-radius:4px;display:inline-block}.very-low,.FAIL{background:#8b1522;color:white}.low{background:#f9c6c6}.medium,.BLOCKED{background:#ffe2a3}.high{background:#caf0ce}.very-high,.PASS{background:#146b36;color:white}.SKIPPED,.NOT_RUN,.RUNNING{background:#e4e7ec}.muted{color:#64748b}.error{color:#9e1b26}.row{display:flex;gap:16px;flex-wrap:wrap}.field{border-left:4px solid #b3c9e2;padding:14px;margin:12px 0}label{display:block}details{margin:12px 0}small{display:block}.summary{font-size:18px}`;
const scanTemplate = Handlebars.compile(
  `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Scan {{task_id}}</title><style>${style}</style><main><h1>Medical document scan</h1><p>{{task_id}} · revision {{revision}} · {{status}}</p><p>Generated {{generated}} · expires {{expires}}</p><p>AI confidence <b>{{confidence}}</b> · final <b>{{final_confidence}}</b></p><p>Read-only snapshot. Review in the local manual-test application. Confidence: red &lt;0.5; orange &lt;0.8; green ≥0.8. Final 1.0 after review means human-confirmed.</p>{{#each documents}}<article><h2>{{document_type}} — {{document_id}}</h2><p>Pages {{pages}} · classification {{classification_confidence}} · segmentation {{segmentation_confidence}}</p><pre>{{json validation_errors}}</pre>{{#each fields}}<section class="field"><h3>{{path}}</h3><p>Raw: {{raw_value}}</p><p>Extracted: {{normalized_value}} · candidate: {{candidate_value}}</p><p>Final: <b>{{final_value}}</b></p><span class="badge {{band extraction_confidence}}">AI {{extraction_confidence}}</span> <span class="badge {{band final_confidence}}">Final {{final_confidence}}</span><p>{{review_status}} · requires review: {{requires_review}}</p><pre>{{json warnings}}</pre>{{#if evidence}}<a href="{{evidence.source_image}}"><img loading="lazy" src="{{evidence.image}}" alt="Source evidence"></a><small>Page {{evidence.page}} · full-page fallback: {{evidence.fallback}}</small>{{/if}}</section>{{/each}}</article>{{/each}}</main></html>`,
);
export async function scanReport(root: string, task: any, documents: any[], expires: Date) {
  const parent = join(root, 'tasks', task.task_id),
    dest = join(parent, 'reports'),
    temp = join(parent, 'report-staging');
  await rm(temp, { recursive: true, force: true });
  await mkdir(join(temp, 'assets'), { recursive: true });
  const cloned = structuredClone(documents);
  for (const doc of cloned)
    for (const f of doc.fields)
      if (f.evidence) {
        const e = f.evidence;
        for (const key of ['image', 'source_image']) {
          const source = resolve(parent, e[key]);
          if (!source.startsWith(parent + '/')) throw Error('UNSAFE_EVIDENCE');
          const filename = e[key].replaceAll('/', '_');
          await cp(source, join(temp, 'assets', filename));
          e[key] = 'assets/' + filename;
        }
      }
  await writeFile(
    join(temp, 'index.html'),
    scanTemplate({
      ...task,
      documents: cloned,
      generated: new Date().toISOString(),
      expires: expires.toISOString(),
    }),
  );
  await writeFile(
    join(temp, 'manifest.json'),
    JSON.stringify({ task_id: task.task_id, revision: task.revision, expires_at: expires }),
  );
  await rm(dest, { recursive: true, force: true });
  await rename(temp, dest);
  return dest;
}
export async function testReport(root: string, runId: string) {
  if (!/^[\w-]{1,100}$/.test(runId)) throw Error('INVALID_RUN_ID');
  const dir = join(root, 'test-reports', runId);
  await mkdir(dir, { recursive: true });
  let results: any[] = [];
  try {
    results = JSON.parse(await readFile(join(dir, 'results.json'), 'utf8'));
  } catch {}
  const catalog = JSON.parse(await readFile('tests/catalog.json', 'utf8')) as {
    id: string;
    suite: string;
    name: string;
  }[];
  const all = catalog.map((c) => ({
    ...c,
    ...results.find((r) => r.id === c.id),
    status: results.find((r) => r.id === c.id)?.status ?? 'NOT_RUN',
  }));
  const counts = all.reduce((a: any, r: any) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
  let manifest: any;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch {
    manifest = {
      run_id: runId,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    };
  }
  const template = Handlebars.compile(
    `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Test report {{runId}}</title><style>${style}</style><main><h1>Test results — {{runId}}</h1><p>Generated {{generated}} · expires {{expires}}</p><pre>{{json counts}}</pre><p>PASS = assertions executed successfully. SKIPPED/BLOCKED/NOT_RUN are not passed. Confidence and test status are different measures.</p><label>Filter <input id="filter" placeholder="ID, suite, status or text"></label>{{#each suites}}<article><h2>{{name}}</h2>{{#each cases}}<details class="case"><summary><span class="badge {{status}}">{{status}}</span> {{id}} — {{name}}</summary><p>{{suite}} · {{duration_ms}} ms</p><pre>{{json details}}</pre>{{#each attempts}}<pre>{{json this}}</pre>{{/each}}{{#if scan_report}}<a href="{{scan_report}}">Document extraction / source evidence</a>{{/if}}</details>{{/each}}</article>{{/each}}<script>document.getElementById('filter').oninput=function(){const q=this.value.toLowerCase();document.querySelectorAll('.case').forEach(e=>e.hidden=!e.textContent.toLowerCase().includes(q))}</script></main></html>`,
  );
  const suites = ['smoke', 'integration', 'live', 'e2e'].map((name) => ({
    name,
    cases: all.filter((c) => c.suite === name),
  }));
  await writeFile(
    join(dir, 'index.html'),
    template({
      runId,
      generated: new Date().toISOString(),
      expires: manifest.expires_at,
      counts,
      suites,
    }),
  );
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { path: join(dir, 'index.html'), counts, expires_at: manifest.expires_at };
}

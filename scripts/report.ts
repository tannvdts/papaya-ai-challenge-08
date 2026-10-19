import { resolve } from 'node:path';
import { testReport } from '../packages/reporting/index.js';
const id = process.env.TEST_RUN_ID;
if (!id) throw Error('Set TEST_RUN_ID to the run to aggregate');
const result = await testReport(resolve(process.env.STORAGE_ROOT ?? 'runtime'), id);
console.log(
  JSON.stringify(
    {
      test_run_id: id,
      test_report_url: `${process.env.REPORT_BASE_URL ?? process.env.APP_URL ?? `http://127.0.0.1:${process.env.APP_PORT ?? 4000}`}/test-reports/${id}/index.html`,
      ...result,
    },
    null,
    2,
  ),
);

// Writes the example report of design/reference/bericht.html (web/components/report/example-report.json) from
// web/scripts/example-report-source.ts.
//
//   node web/scripts/make-example-report.ts           writes the file
//   node web/scripts/make-example-report.ts --check   fails when the file differs from what it would write
import { readFileSync, writeFileSync } from 'node:fs';
import { EXAMPLE_REPORT_FILE, exampleReportText } from './example-report-source.ts';

const text = exampleReportText();
if (process.argv.includes('--check')) {
  if (readFileSync(EXAMPLE_REPORT_FILE, 'utf8') !== text) {
    console.error(`${EXAMPLE_REPORT_FILE} differs from what web/scripts/make-example-report.ts writes`);
    process.exit(1);
  }
  console.log('example-report.json is up to date');
} else {
  writeFileSync(EXAMPLE_REPORT_FILE, text);
  console.log(`wrote ${EXAMPLE_REPORT_FILE}`);
}

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FIXTURE_SETS, FIXTURES_ROOT, takeFixtureSnapshots } from './fixture-snapshots.ts';
import { launchLocalBrowser } from './playwright-capture.ts';

/**
 * `npm run fixtures:snapshots`: takes the snapshots of the A4 fixture pages again with the local
 * Chromium and writes them next to the pages. Run it after changing a fixture page.
 */

const browser = await launchLocalBrowser();
try {
  for (const set of FIXTURE_SETS) {
    const snapshots = await takeFixtureSnapshots(browser, set);
    const dir = resolve(FIXTURES_ROOT, set.snapshots);
    await mkdir(dir, { recursive: true });
    for (const [name, snapshot] of Object.entries(snapshots)) await writeFile(resolve(dir, `${name}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`${set.name}: ${Object.keys(snapshots).length} snapshots`);
  }
} finally {
  await browser.close();
}

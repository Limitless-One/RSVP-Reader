import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DIST_DIR = new URL('../dist/assets/', import.meta.url);
const SIZE_LIMIT_BYTES = 200 * 1024;

const files = await readdir(DIST_DIR);
const contentBundle = files.find(file => /^index\.ts-.*\.js$/.test(file));

if (!contentBundle) {
  console.error('Could not find the built content bundle in dist/assets.');
  process.exit(1);
}

const bundlePath = path.join(DIST_DIR.pathname, contentBundle);
const bundleStats = await stat(bundlePath);

if (bundleStats.size > SIZE_LIMIT_BYTES) {
  console.error(`Content bundle is ${bundleStats.size} bytes, above the 200KB limit.`);
  process.exit(1);
}

console.log(`Content bundle size OK: ${bundleStats.size} bytes.`);

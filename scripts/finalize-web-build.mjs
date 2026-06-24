import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath decodes the file:// URL (e.g. %20 → space) so the build works
// when the repo lives under a path containing spaces.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const indexPath = path.join(distDir, 'index.html');
const manifestPath = path.join(distDir, 'web-artifact-manifest.json');

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
let commitSha = process.env.GIT_COMMIT_SHA ?? 'uncommitted';
if (!process.env.GIT_COMMIT_SHA) {
  try {
    commitSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    commitSha = 'uncommitted';
  }
}
const releaseDate = process.env.BUILD_RELEASE_DATE ?? new Date().toISOString();

const indexHtml = readFileSync(indexPath, 'utf8').replace(/type=\"module\" crossorigin /g, 'defer ');
writeFileSync(indexPath, indexHtml);

const manifest = {
  bundleVersion: packageJson.version,
  commitSha,
  releaseDate,
  compatibilityNote: 'Opaque web bundle for explicit external consumers. No shared runtime source is supported.',
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// Drop upstream's hosted landing-page / OpenGraph share-card assets. The CLI only
// serves the editor (index.html -> assets/editor.js + favicons + color swatches),
// which never references these, so shipping them just bloats the npm tarball by
// ~30 MB. Verified unreferenced in index.html and assets/editor.js.
const prune = [
  'assets/og-share',
  'assets/bg.jpg',
  'assets/screenshot.jpg',
  'assets/lottie.min.js',
];
const sizeOf = (p) => {
  const s = statSync(p);
  if (s.isFile()) return s.size;
  return readdirSync(p).reduce((sum, name) => sum + sizeOf(path.join(p, name)), 0);
};
let freed = 0;
for (const rel of prune) {
  const target = path.join(distDir, rel);
  if (!existsSync(target)) continue;
  freed += sizeOf(target);
  rmSync(target, { recursive: true, force: true });
}
if (freed > 0) {
  console.log(`pruned hosted-page assets from dist (${(freed / 1e6).toFixed(1)} MB)`);
}

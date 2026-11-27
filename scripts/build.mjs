import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = spawnSync('moonc', ['-v'], { cwd: root, encoding: 'utf8', shell: false });
if (compiler.error) throw compiler.error;
const version = (compiler.stdout + compiler.stderr).match(/v(\d+)\.(\d+)\.(\d+)(?:-([^\s+]+))?/);
const supported = version && (Number(version[1]) > 1 ||
  (Number(version[1]) === 1 && (Number(version[2]) > 0 || Number(version[3]) > 0 ||
    !version[4] || /^rc\.?[1-9]\d*$/.test(version[4]))));
if (compiler.status !== 0 || !supported) {
  console.error('MoonHeap requires MoonBit 1.0.0-rc1 or newer. Run moon upgrade; CI pins .moonbit-version.');
  process.exit(1);
}
const result = spawnSync('moon', ['build', 'bridge', '--target', 'js', '--release', '--deny-warn'], { cwd: root, stdio: 'inherit', shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
for (const folder of ['dist', 'web']) mkdirSync(resolve(root, folder), { recursive: true });
const source = resolve(root, '_build/js/release/build/bridge/bridge.js');
copyFileSync(source, resolve(root, 'dist/moonheap.mjs'));
copyFileSync(source, resolve(root, 'web/engine.mjs'));
console.log('Built the shared MoonBit analysis engine.');

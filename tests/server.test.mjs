import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('offline demo server serves only explicit assets and never accepts uploads', { timeout: 20000 }, async () => {
  const child = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, PORT: '0' }, stdio: ['ignore','pipe','pipe'] });
  try {
    const base = await new Promise((resolve, reject) => {
      let output = ''; child.once('error', reject); child.once('exit', code => reject(new Error('Server exited: ' + code)));
      child.stdout.on('data', b => { output += b; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) resolve(match[0]); });
    });
    const index = await fetch(base);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.match(await index.text(), /MoonHeap/);
    for (const path of ['/moon.mod','/.git/config','/../README.md','/work/real/growth.heapsnapshot']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(base, { method: 'POST', body: 'private heap' })).status, 404);
    assert.equal((await fetch(base + '/engine.mjs')).status, 200);
    assert.equal((await fetch(base + '/examples/shared.heapsnapshot')).status, 200);
  } finally { child.kill(); }
});


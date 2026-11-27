import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyManifest, readCaptureManifest, loadFile, unwrap } from '../lib/host.mjs';
import { query_snapshot, close_snapshot } from '../dist/moonheap.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'moonheap-integrity-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = await readFile(new URL('../examples/shared.heapsnapshot', import.meta.url));
  const snapshots = [];
  for (const label of ['before', 'growth', 'cleanup']) {
    const file = label + '.heapsnapshot';
    await writeFile(join(dir, file), bytes);
    snapshots.push({ label, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const manifest = { schema: 'moonheap-capture-v1', run_id: 'test-capture', same_isolate: true, snapshots };
  const path = join(dir, 'capture.json');
  await writeFile(path, JSON.stringify(manifest));
  return { dir, bytes, manifest, path, files: snapshots.map(s => join(dir, s.file)) };
}

test('manifest rejects reversed stages and repeated inputs instead of asserting false provenance', async t => {
  const f = await fixture(t);
  assert.equal(await verifyManifest(f.path, f.files), 'test-capture');
  await assert.rejects(verifyManifest(f.path, [f.files[0], f.files[2], f.files[1]]), e => e.code === 'identity_conflict');
  await assert.rejects(verifyManifest(f.path, [f.files[0], f.files[0], f.files[2]]), e => e.code === 'identity_conflict');
  await assert.rejects(verifyManifest(f.path, [f.files[2], f.files[0]]), e => e.code === 'identity_conflict');
});

test('malformed or ambiguous manifests fail with a stable input error', async t => {
  const f = await fixture(t);
  const malformed = [null, {}, { ...f.manifest, run_id: '' },
    { ...f.manifest, snapshots: [f.manifest.snapshots[0], f.manifest.snapshots[0], f.manifest.snapshots[2]] },
    { ...f.manifest, snapshots: [null, ...f.manifest.snapshots.slice(1)] }];
  for (const value of malformed) {
    await writeFile(f.path, JSON.stringify(value));
    await assert.rejects(verifyManifest(f.path, f.files), e => e.code === 'invalid_input');
  }
  await writeFile(f.path, '{broken');
  await assert.rejects(verifyManifest(f.path, f.files), e => e.code === 'invalid_input');
});

test('report cannot overwrite an input snapshot even with force or a hard-link alias', async t => {
  const f = await fixture(t);
  const alias = join(f.dir, 'alias.csv');
  await link(f.files[0], alias);
  for (const output of [f.files[0], alias]) {
    const r = spawnSync(process.execPath, ['bin/moonheap.mjs', 'report', f.files[0], '--format', 'csv', '--output', output, '--force', '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr || r.stdout);
    assert.equal(JSON.parse(r.stderr).error.code, 'invalid_input');
    assert.deepEqual(await readFile(f.files[0]), f.bytes);
  }
});

test('manifest hash covers the bytes actually parsed and failed imports release their decoder', async t => {
  const f = await fixture(t);
  const provenance = await readCaptureManifest(f.path, f.files);
  // A valid snapshot changes after its manifest is read, before import begins.
  await writeFile(f.files[0], Buffer.concat([f.bytes, Buffer.from(' ')]));
  await assert.rejects(loadFile(f.files[0], {}, () => {}, provenance.snapshots[0]), e => e.code === 'identity_conflict');
  const handle = await loadFile(f.files[1], {}, () => {}, provenance.snapshots[1]);
  try { assert.equal(unwrap(query_snapshot(handle, '{}')).nodes, 4); }
  finally { close_snapshot(handle); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, open, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = 'examples/shared.heapsnapshot';
function cli(...args) {
  const r = spawnSync(process.execPath, ['bin/moonheap.mjs', ...args, '--json'], { cwd: root, encoding: 'utf8' });
  assert.ifError(r.error);
  return { status: r.status, ...JSON.parse(r.status === 0 ? r.stdout : r.stderr) };
}
test('CLI reports graph retention, precise IDs and all navigation operations', () => {
  const summary = cli('summary', fixture);
  assert.equal(summary.status, 0); assert.equal(summary.api_version, 1);
  assert.equal(summary.data.reachable_bytes, 60);
  assert.equal(summary.data.nodes, 4);
  const node = cli('node', fixture, '--id', '9007199254740993').data;
  assert.equal(node.id, '9007199254740993');
  assert.equal(node.retained_bytes, 10); // shared child also retained through B
  const refs = cli('refs', fixture, '--id', '7').data;
  assert.equal(refs.total, 2);
  assert.deepEqual(refs.items.map(e => e.source.name), ['A', 'B']);
  const path = cli('path', fixture, '--id', '7').data;
  assert.equal(path.reachable, true);
  assert.deepEqual(path.edges.map(e => e.target.name), ['A', 'shared']);
  assert.equal(cli('dominated', fixture, '--id', '1').data.total, 3);
  assert.equal(cli('nodes', fixture, '--query', 'shared').data.total, 1);
  assert.equal(cli('groups', fixture, '--query', 'shared').data.items[0].shallow_bytes, 30);
  assert.equal(cli('diff', fixture, fixture).data.mode, 'aggregate');
  const diff = cli('diff', fixture, fixture, '--same-isolate').data;
  assert.equal(diff.survived, 4); assert.equal(diff.added, 0); assert.equal(diff.removed, 0);
});
test('CLI fails explicitly for invalid arguments, missing objects and files', () => {
  for (const args of [
    ['unknown', fixture], ['node', fixture], ['summary', fixture, '--wat'],
    ['nodes', fixture, '--limit', '0'], ['nodes', fixture, '--limit', '4.5'],
    ['summary', fixture, '--same-isolate'], ['nodes', fixture, '--order', 'random'],
    ['nodes', fixture, '--limit', '2', '--limit', '3'],
  ]) { const r = cli(...args); assert.equal(r.status, 2); assert.equal(r.ok, false); }
  assert.equal(cli('node', fixture, '--id', '99').error.code, 'not_found');
  assert.equal(cli('summary', 'absent.heapsnapshot').status, 5);
});
test('CLI rejects corrupt and oversized input and contradictory identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moonheap-'));
  try {
    const invalid = join(dir, 'invalid.heapsnapshot');
    await writeFile(invalid, '{}');
    assert.equal(cli('validate', invalid).status, 2);
    await writeFile(invalid, Buffer.from([0xff, 0xfe]));
    assert.equal(cli('validate', invalid).status, 2);
    const large = join(dir, 'large.heapsnapshot');
    const f = await open(large, 'w'); await f.truncate(64 * 1024 * 1024 + 1); await f.close();
    assert.equal(cli('validate', large).status, 3);
    const changed = join(dir, 'changed.heapsnapshot');
    await writeFile(changed, (await readFile(join(root, fixture), 'utf8')).replace('"A"', '"Other"'));
    assert.equal(cli('diff', fixture, changed, '--same-isolate').status, 4);
    assert.equal(cli('diff', fixture, changed).status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load_snapshot, query_snapshot, diff_snapshots, close_snapshot } from '../dist/moonheap.mjs';
test('shared bridge supports two snapshots and releases handles', async () => {
  const input = await readFile(new URL('../examples/shared.heapsnapshot', import.meta.url), 'utf8');
  const a = JSON.parse(load_snapshot(input)).data, b = JSON.parse(load_snapshot(input)).data, c = JSON.parse(load_snapshot(input)).data;
  try {
    assert.equal(JSON.parse(load_snapshot(input)).error.code, 'resource_limit');
    assert.equal(JSON.parse(query_snapshot(a, '{"op":"summary"}')).data.nodes, 4);
    assert.equal(JSON.parse(diff_snapshots(a, b, '{"same_isolate":true}')).data.survived, 4);
    assert.equal(JSON.parse(query_snapshot(a, '{"op":"references","id":"7","incoming":"no"}')).error.code, 'invalid_input');
  } finally { close_snapshot(a); close_snapshot(b); close_snapshot(c); }
  assert.equal(JSON.parse(query_snapshot(a, '{}')).error.code, 'not_found');
  const d = JSON.parse(load_snapshot(input)).data;
  assert.ok(d > c); close_snapshot(d);
});


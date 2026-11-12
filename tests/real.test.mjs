import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load_snapshot, query_snapshot, diff_snapshots, close_snapshot } from '../dist/moonheap.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
function unwrap(raw) { const r = JSON.parse(raw); assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data; }
function query(h, request) { return unwrap(query_snapshot(h, JSON.stringify(request))); }
// Independent raw-record totals: does not use MoonHeap parsing or graph algorithms.
function referenceTotals(raw) {
  const { snapshot: { meta }, nodes, strings } = JSON.parse(raw);
  const stride = meta.node_fields.length;
  const offsets = Object.fromEntries(meta.node_fields.map((key, i) => [key, i]));
  const types = meta.node_types[offsets.type];
  let shallow = 0, markers = 0, markerBytes = 0;
  for (let p = 0; p < nodes.length; p += stride) {
    shallow += nodes[p + offsets.self_size];
    if (types[nodes[p + offsets.type]] === 'object' && strings[nodes[p + offsets.name]] === 'MoonHeapMarker') {
      markers++; markerBytes += nodes[p + offsets.self_size];
    }
  }
  return { nodes: nodes.length / stride, shallow, markers, markerBytes };
}
// Independent removal oracle: retained bytes are the originally reachable
// bytes lost when one vertex is removed. No dominator tree is calculated here.
function removalOracle(raw, selected) {
  const { snapshot: { meta }, nodes, edges } = JSON.parse(raw);
  const nf = meta.node_fields, ef = meta.edge_fields, n = nodes.length / nf.length;
  const size = nf.indexOf('self_size'), count = nf.indexOf('edge_count');
  const et = ef.indexOf('type'), target = ef.indexOf('to_node'), types = meta.edge_types[et];
  const adjacency = Array.from({ length: n }, () => []);
  let cursor = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < nodes[i * nf.length + count]; j++) {
    const kind = types[edges[cursor + et]], to = edges[cursor + target] / nf.length;
    if (kind !== 'weak' && i !== to && (kind !== 'shortcut' || i === 0)) adjacency[i].push(to);
    cursor += ef.length;
  }
  function reachable(excluded) {
    if (excluded === 0) return 0;
    const seen = new Uint8Array(n), queue = [0]; seen[0] = 1; let bytes = 0;
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h]; bytes += nodes[i * nf.length + size];
      for (const to of adjacency[i]) if (to !== excluded && !seen[to]) { seen[to] = 1; queue.push(to); }
    }
    return bytes;
  }
  const total = reachable(-1);
  return selected.map(i => total - reachable(i));
}
test('real V8 baseline → growth → cleanup agrees with independent record totals', { timeout: 120000 }, async () => {
  const directory = resolve(root, 'work/real');
  await mkdir(directory, { recursive: true });
  const capture = spawnSync(process.execPath, ['--expose-gc', 'scripts/capture-fixtures.mjs', directory], { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.ifError(capture.error); assert.equal(capture.status, 0, capture.stderr);
  const inputs = await Promise.all(['before','growth','cleanup'].map(n => readFile(resolve(directory, n + '.heapsnapshot'), 'utf8')));
  const totals = inputs.map(referenceTotals);
  assert.deepEqual(totals.map(t => t.markers), [0, 64, 0]);
  const before = unwrap(load_snapshot(inputs[0]));
  const growth = unwrap(load_snapshot(inputs[1]));
  try {
    for (const [h, t] of [[before, totals[0]], [growth, totals[1]]]) {
      const summary = query(h, { op: 'summary' });
      assert.equal(summary.nodes, t.nodes);
      assert.equal(summary.total_shallow_bytes, t.shallow);
      assert.ok(summary.reachable_nodes > 0);
    }
    const markers = query(growth, { op: 'nodes', query: 'MoonHeapMarker', kind: 'object' });
    assert.equal(markers.total, 64);
    assert.equal(markers.items.reduce((a,n) => a + n.shallow_bytes, 0), totals[1].markerBytes);
    const path = query(growth, { op: 'path', id: markers.items[0].id });
    assert.ok(path.reachable);
    assert.ok(path.edges.some(e => e.name === 'moonheapFixture'), 'path should explain the global owner');
    const samples = [query(growth, { op: 'node', index: 0 }), ...markers.items.slice(0, 10), ...path.edges.slice(0, 6).map(e => e.source)];
    assert.deepEqual(samples.map(n => n.retained_bytes), removalOracle(inputs[1], samples.map(n => n.index)));
    const diff = unwrap(diff_snapshots(before, growth, '{"same_isolate":true,"query":"MoonHeapMarker"}'));
    const row = diff.groups.find(g => g.kind === 'object' && g.name === 'MoonHeapMarker');
    assert.equal(row.count_delta, 64);
    assert.equal(row.bytes_delta, totals[1].markerBytes);
    assert.equal(diff.changes.filter(c => c.kind === 'object' && c.name === 'MoonHeapMarker' && c.status === 'added').length, 64);
  } finally { close_snapshot(before); }
  const cleanup = unwrap(load_snapshot(inputs[2]));
  try {
    assert.equal(query(cleanup, { op: 'nodes', query: 'MoonHeapMarker', kind: 'object' }).total, 0);
    const diff = unwrap(diff_snapshots(growth, cleanup, '{"same_isolate":true,"query":"MoonHeapMarker"}'));
    assert.equal(diff.groups.find(g => g.kind === 'object' && g.name === 'MoonHeapMarker').count_delta, -64);
    assert.equal(diff.changes.filter(c => c.kind === 'object' && c.status === 'removed').length, 64);
    console.log(JSON.stringify({ scenario: 'real-v8', node: process.version, snapshots: totals }));
  } finally { close_snapshot(growth); close_snapshot(cleanup); }
});


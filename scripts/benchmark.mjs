// Every case runs in a fresh process; peak RSS includes Node and input generation.
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { platform, arch, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { load_snapshot, query_snapshot, close_snapshot } from '../dist/moonheap.mjs';
const [size, shape] = process.argv.slice(2);
if (size) {
  const n = Number(size);
  assert.ok(Number.isInteger(n) && n > 0 && n <= 1000000);
  assert.ok(['chain','shared-dag'].includes(shape));
  const nodes = [], edges = [];
  for (let i = 0; i < n; i++) {
    const targets = [];
    if (i + 1 < n) targets.push(i + 1);
    if (shape === 'shared-dag' && i + 2 < n) targets.push(i + 2);
    nodes.push(i === 0 ? 0 : 1, i === 0 ? 0 : 1, i * 2 + 1, i === 0 ? 0 : 16, targets.length);
    for (const to of targets) edges.push(0, 1, to * 5);
  }
  const input = JSON.stringify({ snapshot: { meta: {
    node_fields: ['type','name','id','self_size','edge_count'],
    node_types: [['synthetic','object'],'string','number','number','number'],
    edge_fields: ['type','name_or_index','to_node'],
    edge_types: [['property'],'string_or_number','node']
  }, node_count: n, edge_count: edges.length / 3 }, nodes, edges, strings: ['root','item'] });
  const start = performance.now();
  const opened = JSON.parse(load_snapshot(input)); assert.equal(opened.ok, true, JSON.stringify(opened));
  const analyzed = performance.now();
  const result = JSON.parse(query_snapshot(opened.data, '{"op":"nodes","order":"retained","limit":25}'));
  assert.equal(result.ok, true); assert.equal(result.data.total, n);
  assert.equal(result.data.items[0].retained_bytes, (n - 1) * 16);
  const queried = performance.now(); close_snapshot(opened.data);
  console.log(JSON.stringify({
    shape, nodes: n, edges: edges.length / 3, input_bytes: Buffer.byteLength(input),
    load_ms: Math.round(analyzed - start), ranking_ms: Math.round(queried - analyzed),
    peak_rss_mib: Math.round(process.resourceUsage().maxRSS / 1024)
  }));
} else {
  const cases = [];
  for (const shape of ['chain','shared-dag']) for (const n of [10000,50000,100000]) {
    const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), String(n), shape], { encoding: 'utf8', timeout: 120000 });
    assert.ifError(p.error); assert.equal(p.status, 0, p.stderr); cases.push(JSON.parse(p.stdout));
  }
  console.log(JSON.stringify({ node: process.version, platform: platform() + '/' + arch(), cpu: cpus()[0].model, cases }, null, 2));
}


// Capture only this dedicated synthetic process, never another application's heap.
import { writeHeapSnapshot } from 'node:v8';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
if (!global.gc) throw new Error('Run with node --expose-gc');
const output = resolve(process.argv[2] ?? 'work/real');
mkdirSync(output, { recursive: true });
class MoonHeapMarker {
  constructor(i) {
    this.label = 'moonheap-item-' + i;
    this.payload = Array.from({ length: 256 }, (_, j) => i * 256 + j);
  }
}
const store = globalThis.moonheapFixture = { cache: [] };
function capture(name) { global.gc(); writeHeapSnapshot(resolve(output, name + '.heapsnapshot')); }
capture('before');
function grow() {
  for (let i = 0; i < 64; i++) store.cache.push(new MoonHeapMarker(i));
  store.cache[0].peer = store.cache[1]; store.cache[1].peer = store.cache[0];
  store.cache[2].shared = store.cache[0].payload;
}
grow();
await new Promise(setImmediate); // Let allocation frames leave the stack.
capture('growth');
store.cache.length = 0;
await new Promise(setImmediate);
capture('cleanup');
writeFileSync(resolve(output, 'provenance.json'), JSON.stringify({
  scenario: '64 MoonHeapMarker instances in a global cache; shared payload and cycle; clear cache',
  same_isolate: true, run_id: randomUUID(), node: process.version, v8: process.versions.v8,
  files: ['before.heapsnapshot', 'growth.heapsnapshot', 'cleanup.heapsnapshot']
}, null, 2) + '\n');
console.log(output);


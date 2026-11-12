import { Session } from 'node:inspector/promises';
import { getHeapSnapshot } from 'node:v8';
import { mkdirSync, openSync, closeSync, writeSync, writeFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
if (!global.gc) throw new Error('Start with --expose-gc');
const [scenarioPath, destination, countArg = '3', tracking = 'false'] = process.argv.slice(2);
const iterations = Number(countArg);
if (!scenarioPath || !destination || !Number.isInteger(iterations) || iterations < 1 || iterations > 10000) throw new Error('Invalid scenario arguments');
const dir = resolve(destination);
mkdirSync(dir,{recursive:true});
for (const name of ['before.heapsnapshot','growth.heapsnapshot','cleanup.heapsnapshot','capture.json']) {
  if (existsSync(resolve(dir,name))) throw new Error('Capture destination already contains ' + name);
}
// Workload logging cannot corrupt the machine-readable result on stdout.
console.log = console.info = console.debug = (...args) => console.error(...args);
const session = new Session(); session.connect();
const snapshots = [];
async function capture(label) {
  await new Promise(setImmediate); global.gc(); await new Promise(setImmediate); global.gc();
  const file = label + '.heapsnapshot', path = resolve(dir,file);
  const fd = openSync(path,'wx');
  // Use V8's binary stream instead of Inspector string-chunk callbacks, which
  // produced overlapping object identities in repeated Node 22 tracked captures.
  try {
    for await (const chunk of getHeapSnapshot()) {
      let offset=0;
      while(offset<chunk.length) {
        const written=writeSync(fd,chunk,offset,chunk.length-offset);
        if(written<=0)throw new Error('Unable to write snapshot');
        offset+=written;
      }
    }
  } finally { closeSync(fd); }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  snapshots.push({label,file,bytes:statSync(path).size,sha256:hash.digest('hex')});
}
try {
  await session.post('HeapProfiler.enable');
  if (tracking === 'true') await session.post('HeapProfiler.startTrackingHeapObjects',{trackAllocations:true});
  const scenario = await import(pathToFileURL(resolve(scenarioPath)).href);
  if (typeof scenario.exercise !== 'function') throw new Error('Scenario must export exercise(context, iteration)');
  const context = typeof scenario.setup === 'function' ? await scenario.setup() : {};
  await capture('before');
  for (let i=0;i<iterations;i++) await scenario.exercise(context,i);
  await capture('growth');
  if (typeof scenario.cleanup === 'function') await scenario.cleanup(context);
  await capture('cleanup');
  const manifest = {schema:'moonheap-capture-v1',run_id:randomUUID(),same_isolate:true,node:process.version,v8:process.versions.v8,
    iterations,allocation_tracking:tracking === 'true',scenario:resolve(scenarioPath),snapshots};
  writeFileSync(resolve(dir,'capture.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({directory:dir,manifest:resolve(dir,'capture.json'),...manifest})+'\n');
} finally { session.disconnect(); }


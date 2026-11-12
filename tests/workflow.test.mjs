import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp,readFile,rm,writeFile,open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFile,unwrap } from '../lib/host.mjs';
import { query_snapshot,close_snapshot,investigate_snapshots,export_report } from '../dist/moonheap.mjs';

test('capture → streamed import → allocation source → surviving-object evidence → complete export', {timeout:120000}, async () => {
  const dir=await mkdtemp(join(tmpdir(),'moonheap-capture-'));
  const handles=[];
  try {
    const r=spawnSync(process.execPath,['bin/moonheap.mjs','capture','--scenario','examples/cache-scenario.mjs','--output-dir',dir,'--iterations','2','--allocation-traces','--json'],{encoding:'utf8',timeout:60000});
    assert.equal(r.status,0,r.stderr);
    const manifest=JSON.parse(r.stdout).data; assert.equal(manifest.allocation_tracking,true);
    for (const stage of ['before','growth','cleanup']) handles.push(await loadFile(join(dir,stage+'.heapsnapshot')));
    const report=unwrap(investigate_snapshots(...handles,'{"same_isolate":true,"query":"MoonHeapCapturedEntry","kind":"object"}'));
    assert.equal(report.total,1);
    assert.deepEqual(report.groups.map(g=>[g.before_count,g.growth_count,g.cleanup_count]),[[0,16,1]]);
    const candidate=report.items[0];
    const source=unwrap(query_snapshot(handles[2],JSON.stringify({op:'source',id:candidate.id,same_isolate:true,fallback_handle:handles[1]})));
    assert.ok(source.available);
    assert.ok(source.frames.some(f=>f.script_name.includes('cache-scenario.mjs') && f.line>0));
    const paths=unwrap(query_snapshot(handles[2],JSON.stringify({op:'paths',id:candidate.id,max_paths:3})));
    assert.ok(paths.paths.length>0);
    const exported=unwrap(export_report(handles[0],JSON.stringify({view:'investigate',growth_handle:handles[1],cleanup_handle:handles[2],same_isolate:true,query:'MoonHeapCapturedEntry',kind:'object',format:'html'})));
    assert.match(exported,/MoonHeapCapturedEntry/);
    assert.ok(!exported.includes('<script'));
  } finally { handles.forEach(close_snapshot); await rm(dir,{recursive:true,force:true}); }
});

test('streaming file budgets allow files beyond old 64 MiB cap without loading the entire text', {timeout:120000}, async () => {
  const dir=await mkdtemp(join(tmpdir(),'moonheap-stream-'));
  let handle;
  try {
    const path=join(dir,'large.heapsnapshot'), file=await open(path,'w');
    const padding=Buffer.alloc(1024*1024,32);
    for(let i=0;i<65;i++) await file.write(padding);
    await file.write(await readFile(new URL('../examples/shared.heapsnapshot',import.meta.url)));
    await file.close();
    await assert.rejects(loadFile(path,{max_mib:64}),e=>e.code==='resource_limit');
    let progress=0;
    handle=await loadFile(path,{max_mib:80},()=>progress++);
    assert.ok(progress>1000);
    assert.equal(unwrap(query_snapshot(handle,'{}')).nodes,4);
  } finally { if(handle!=null) close_snapshot(handle); await rm(dir,{recursive:true,force:true}); }
});

test('CLI reports write complete rows and refuse implicit replacement', async () => {
  const dir=await mkdtemp(join(tmpdir(),'moonheap-report-'));
  try {
    const output=join(dir,'report.csv');
    const args=['bin/moonheap.mjs','report','examples/growth.heapsnapshot','--view','nodes','--format','csv','--output',output,'--json'];
    let r=spawnSync(process.execPath,args,{encoding:'utf8'}); assert.equal(r.status,0,r.stderr);
    assert.equal((await readFile(output,'utf8')).trim().split('\n').length,43);
    r=spawnSync(process.execPath,args,{encoding:'utf8'}); assert.equal(r.status,5);
    r=spawnSync(process.execPath,[...args,'--force'],{encoding:'utf8'}); assert.equal(r.status,0,r.stderr);
  } finally { await rm(dir,{recursive:true,force:true}); }
});


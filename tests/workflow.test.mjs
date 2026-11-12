import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp,readFile,rm,writeFile,open,mkdir,copyFile } from 'node:fs/promises';
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
    const report=unwrap(investigate_snapshots(...handles,'{"same_isolate":true,"exclude_conflicts":true,"query":"MoonHeapCapturedEntry","kind":"object"}'));
    assert.equal(report.total,1);
    assert.deepEqual(report.groups.map(g=>[g.before_count,g.growth_count,g.cleanup_count]),[[0,16,1]]);
    const candidate=report.items[0];
    const denied=JSON.parse(query_snapshot(handles[2],JSON.stringify({op:'source',id:candidate.id,fallback_handle:handles[1]})));
    assert.equal(denied.error.code,'identity_conflict');
    const source=unwrap(query_snapshot(handles[2],JSON.stringify({op:'source',id:candidate.id,same_isolate:true,fallback_handle:handles[1]})));
    // V8 can lose allocation trace IDs during GC even with tracking enabled.
    // Check the actual records, and separately require a real recorded stack.
    const rawStages=await Promise.all(['growth','cleanup'].map(async stage=>JSON.parse(await readFile(join(dir,stage+'.heapsnapshot'),'utf8'))));
    const traceFor=(s,id)=>{const f=s.snapshot.meta.node_fields,w=f.length;for(let n=0;n<s.nodes.length;n+=w)if(String(s.nodes[n+f.indexOf('id')])===id)return s.nodes[n+f.indexOf('trace_node_id')];return 0;};
    assert.equal(source.available,rawStages.some(s=>traceFor(s,candidate.id)>0));
    if(source.available) assert.ok(source.frames.some(f=>f.script_name.includes('cache-scenario.mjs') && f.line>0));
    const raw=rawStages[0],fields=raw.snapshot.meta.node_fields,width=fields.length;
    let recorded=0;
    for(let n=0;n<raw.nodes.length&&recorded<8;n+=width){
      if(raw.nodes[n+fields.indexOf('trace_node_id')]===0)continue;
      const id=String(raw.nodes[n+fields.indexOf('id')]);
      const frame=unwrap(query_snapshot(handles[1],JSON.stringify({op:'source',id})));
      assert.ok(frame.available); assert.ok(frame.frames.length>0); recorded++;
    }
    assert.equal(recorded,8,'tracking must produce actual source records');
    const paths=unwrap(query_snapshot(handles[2],JSON.stringify({op:'paths',id:candidate.id,max_paths:3})));
    assert.ok(paths.paths.length>0);
    const exported=unwrap(export_report(handles[0],JSON.stringify({view:'investigate',growth_handle:handles[1],cleanup_handle:handles[2],same_isolate:true,exclude_conflicts:true,query:'MoonHeapCapturedEntry',kind:'object',format:'html'})));
    assert.match(exported,/MoonHeapCapturedEntry/);
    assert.ok(!exported.includes('<script'));
    const inputs=['before','growth','cleanup'].map(stage=>join(dir,stage+'.heapsnapshot'));
    const cli=spawnSync(process.execPath,['bin/moonheap.mjs','investigate',...inputs,'--manifest',join(dir,'capture.json'),'--exclude-conflicts','--query','MoonHeapCapturedEntry','--kind','object','--json'],{encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr); assert.equal(JSON.parse(cli.stdout).data.total,1);
    const forged=JSON.parse(await readFile(join(dir,'capture.json'),'utf8')); forged.snapshots[0].sha256='0'.repeat(64);
    await writeFile(join(dir,'altered.json'),JSON.stringify(forged));
    const bad=spawnSync(process.execPath,['bin/moonheap.mjs','investigate',...inputs,'--manifest',join(dir,'altered.json'),'--json'],{encoding:'utf8'});
    assert.equal(bad.status,4); assert.equal(JSON.parse(bad.stderr).error.code,'identity_conflict');
    // Browser acceptance uses the same real, allocation-tracked capture.
    await mkdir('work/tracked',{recursive:true});
    for(const stage of ['before','growth','cleanup']) await copyFile(join(dir,stage+'.heapsnapshot'),join('work/tracked',stage+'.heapsnapshot'));
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


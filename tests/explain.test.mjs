import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
function run(...args) {
  const result=spawnSync(process.execPath,['bin/moonheap.mjs',...args],{encoding:'utf8'});
  assert.ifError(result.error);return result;
}
test('object evidence exports exact identities, alternative holders and honest truncation',()=>{
  const result=run('explain','examples/shared.heapsnapshot','--id','7','--json');
  assert.equal(result.status,0,result.stderr);
  const data=JSON.parse(result.stdout).data;
  assert.equal(data.retainers.total,2);assert.equal(data.root_paths.paths.length,2);
  assert.equal(data.complete,true);
  assert.ok(data.retainers.items.some(edge=>edge.source.id==='9007199254740993'));
  const bounded=run('report','examples/shared.heapsnapshot','--view','explain','--id','7','--retainer-limit','1','--format','json');
  assert.equal(bounded.status,0,bounded.stderr);assert.equal(JSON.parse(bounded.stdout).complete,false);
  const html=run('report','examples/shared.heapsnapshot','--view','explain','--id','7','--format','html');
  assert.equal(html.status,0,html.stderr);
  for(const section of ['直接持有者','根路径','支配关系','分配来源'])assert.ok(html.stdout.includes(section));
  assert.equal(run('explain','examples/shared.heapsnapshot','--json').status,2);
});

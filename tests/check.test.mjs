import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const stages = ['before','growth','residual'].map(s => 'examples/' + s + '.heapsnapshot');
function check(extra = [], files = stages) {
  const r = spawnSync(process.execPath, ['bin/moonheap.mjs','check',...files,'--query','PhotoEntry','--kind','object','--json',...extra], {encoding:'utf8'});
  assert.ifError(r.error);
  return { code:r.status, body:JSON.parse(r.stdout || r.stderr) };
}
test('cleanup CI gate returns actionable exit codes and exact threshold boundary results', () => {
  assert.equal(check().code,4);
  const failed = check(['--same-isolate']);
  assert.equal(failed.code,6); assert.equal(failed.body.ok,true);
  assert.equal(failed.body.data.matched_survivors,2);
  assert.equal(failed.body.data.status,'exceeded');
  assert.equal(check(['--same-isolate','--max-survivors','2']).code,0);
  assert.equal(check(['--same-isolate','--max-survivor-bytes',String(failed.body.data.shallow_bytes)]).code,0);
  assert.equal(check(['--same-isolate','--max-survivor-bytes',String(failed.body.data.shallow_bytes-1)]).code,6);
  assert.equal(check(['--same-isolate'], ['before','growth','cleanup'].map(s=>'examples/'+s+'.heapsnapshot')).code,0);
  assert.equal(check(['--same-isolate','--limit','1']).code,2);
  assert.equal(check(['--same-isolate','--max-survivors','-1']).code,2);
});

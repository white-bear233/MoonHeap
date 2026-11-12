#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query_snapshot, diff_snapshots, investigate_snapshots, export_report, close_snapshot } from '../dist/moonheap.mjs';
import { loadFile, unwrap, fail, saveOutput, verifyManifest } from '../lib/host.mjs';

const HELP = `MoonHeap — offline V8 memory investigation
Usage: node bin/moonheap.mjs <command> <snapshot> [options]
       node bin/moonheap.mjs diff <before> <after> [options]
       node bin/moonheap.mjs investigate <baseline> <growth> <cleanup> [options]
       node bin/moonheap.mjs report <snapshot(s)> --view nodes|groups|cycles|diff|investigate --format json|csv|html
       node bin/moonheap.mjs capture --scenario ./scenario.mjs --output-dir ./captures/run1 [--allocation-traces]
Commands: summary, validate, nodes, groups, node, refs, path, paths, source, tree,
          cycles, cycle, dominated, diff, investigate, report, capture
Options:
  --id DECIMAL                 exact object ID for object operations
  --query TEXT --kind TYPE      filter by name / type (full ID also matches objects)
  --order retained|shallow|index
  --offset N --limit N          result page, limit 1..1000
  --group-offset N --change-offset N   independent diff pagination
  --status added|removed|resized|retention_changed
  --min-growth BYTES            minimum group/retained delta
  --min-retained BYTES          minimum object / survivor retained size
  --min-shallow BYTES           minimum object shallow size
  --reachability all|reachable|unreachable
  --all-groups                  include fully recovered groups in investigation
  --outgoing --retaining-only   reference direction / edge filter
  --max-depth N --max-paths N   bounded path enumeration
  --cycle-id N                 inspect a cycle group's members
  --same-isolate                caller assertion for object identity
  --manifest capture.json      verify capture file hashes and common capture provenance
  --max-mib N                  per-file budget, 1..1024 (default 256 MiB)
  --max-work N                 analysis/search work budget
  --max-rows N                 complete report row budget (default 100000)
  --format json|csv|html --view NAME
  --output FILE --force        save output; --force explicitly permits replacement
  --scenario FILE --output-dir DIR --iterations N --allocation-traces --timeout N
  --json                       versioned JSON responses/errors
No network uploads. Growth, cycles and survival are investigation evidence, not automatic leak verdicts.
`;
const args = process.argv.slice(2), json = args.includes('--json'), handles = [];
const root = fileURLToPath(new URL('../',import.meta.url));
function human(data) {
  if (data.policy) return `${data.nodes} objects · ${data.edges} references\n${data.total_shallow_bytes} reported bytes · ${data.reachable_bytes} reachable bytes\n${data.unreachable_nodes} unreachable objects · ${data.conditional_weakmap_edges} conditional WeakMap edges\nPolicy: ${data.policy}\n${data.interpretation}`;
  return JSON.stringify(data,null,2);
}
try {
  if (!args.length || args.includes('--help') || args.includes('-h')) console.log(HELP);
  else if (args[0] === '--version') console.log('0.2.0');
  else {
    const command = args.shift(), files = [], options = {}, flags = new Set();
    const strings = {'--id':'id','--query':'query','--kind':'kind','--order':'order','--status':'status','--reachability':'reachability',
      '--format':'format','--view':'view','--output':'output','--manifest':'manifest','--scenario':'scenario','--output-dir':'output_dir'};
    const numbers = {'--limit':'limit','--offset':'offset','--max-depth':'max_depth','--max-paths':'max_paths',
      '--cycle-id':'cycle_id','--group-offset':'group_offset','--change-offset':'change_offset','--min-growth':'min_growth',
      '--min-retained':'min_retained','--min-shallow':'min_shallow','--max-mib':'max_mib','--max-work':'max_work','--max-rows':'max_rows','--iterations':'iterations','--timeout':'timeout'};
    const booleans = {'--same-isolate':['same_isolate',true],'--outgoing':['incoming',false],'--retaining-only':['retaining_only',true],
      '--all-groups':['residual_only',false],'--force':['force',true],'--allocation-traces':['allocation_traces',true]};
    for (let i=0;i<args.length;i++) {
      const arg=args[i]; if (!arg.startsWith('--')) { files.push(arg); continue; }
      if (flags.has(arg)) fail('invalid_input','Duplicate option: '+arg); flags.add(arg);
      if (arg==='--json') continue;
      if (arg in booleans) { const [k,v]=booleans[arg]; options[k]=v; continue; }
      if (!(arg in strings) && !(arg in numbers)) fail('invalid_input','Unknown option: '+arg);
      const value=args[++i]; if (value===undefined || value.startsWith('--')) fail('invalid_input','Missing value for '+arg);
      if (arg in numbers) {
        const cap=['--min-growth','--min-retained','--min-shallow'].includes(arg)?Number.MAX_SAFE_INTEGER:2147483647;
        if (!/^\d+$/.test(value) || Number(value)>cap) fail('invalid_input','Invalid integer for '+arg);
        options[numbers[arg]]=Number(value);
      } else options[strings[arg]]=value;
    }
    const commands=['summary','validate','nodes','groups','node','refs','path','paths','source','tree','cycles','cycle','dominated','diff','investigate','report','capture'];
    if (!commands.includes(command)) fail('invalid_input','Unknown command: '+command);
    const operation=command==='report'?(options.view??'nodes'):command;
    const needed=command==='capture'?0:operation==='investigate'?3:operation==='diff'?2:1;
    if (files.length!==needed) fail('invalid_input','Wrong number of input files');
    if (options.same_isolate && !['diff','investigate'].includes(operation)) fail('invalid_input','--same-isolate applies to diff or investigate');
    if (['node','refs','path','paths','source','dominated'].includes(operation) && !options.id) fail('invalid_input','--id is required');
    if (options.id && !/^(0|[1-9]\d*)$/.test(options.id)) fail('invalid_input','Object ID must be a decimal string');
    let data, raw, output;
    if (command==='capture') {
      if (!options.scenario || !options.output_dir) fail('invalid_input','capture requires --scenario and --output-dir');
      const timeout=options.timeout??120000;
      if (timeout<100 || timeout>3600000) fail('invalid_input','timeout must be in 100..3600000 milliseconds');
      const run=spawnSync(process.execPath,['--expose-gc',resolve(root,'scripts/capture-scenario.mjs'),resolve(options.scenario),
        resolve(options.output_dir),String(options.iterations??3),String(options.allocation_traces??false)],
        {encoding:'utf8',timeout,maxBuffer:16*1024*1024,windowsHide:true});
      if (run.error) fail('io_error',run.error.message);
      if (run.status!==0) fail('io_error',run.stderr.trim()||'Capture process failed');
      data=JSON.parse(run.stdout); raw=JSON.stringify({api_version:1,ok:true,data}); output=json?raw:JSON.stringify(data,null,2);
    } else {
      if (options.manifest) { options.provenance_run_id=await verifyManifest(options.manifest,files); options.same_isolate=true; }
      for (const path of files) handles.push(await loadFile(path,options));
      if (command==='report') {
        if (handles.length===2) options.after_handle=handles[1];
        if (handles.length===3) { options.growth_handle=handles[1]; options.cleanup_handle=handles[2]; }
        options.sources=files; options.generated_at=new Date().toISOString();
        output=unwrap(export_report(handles[0],JSON.stringify(options)));
      } else {
        raw=command==='diff'?diff_snapshots(handles[0],handles[1],JSON.stringify(options)):
          command==='investigate'?investigate_snapshots(handles[0],handles[1],handles[2],JSON.stringify(options)):
          query_snapshot(handles[0],JSON.stringify({...options,op:command==='refs'?'references':command==='validate'?'summary':command}));
        data=unwrap(raw); output=json?raw:human(data);
      }
    }
    if (options.output) {
      await saveOutput(options.output,output+'\n',options.force);
      console.log(json?JSON.stringify({api_version:1,ok:true,data:{file:resolve(options.output),bytes:Buffer.byteLength(output)+1}}):'Saved '+resolve(options.output));
    } else console.log(output);
  }
} catch (e) {
  const code=['invalid_input','resource_limit','not_found','identity_conflict','io_error'].includes(e.code)?e.code:'io_error';
  console.error(json?JSON.stringify({api_version:1,ok:false,error:{code,message:e.message}}):'MoonHeap: '+e.message);
  process.exitCode={resource_limit:3,identity_conflict:4,io_error:5}[code]??2;
} finally { for (const handle of handles) close_snapshot(handle); }


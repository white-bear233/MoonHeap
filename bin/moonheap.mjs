#!/usr/bin/env node
import { open } from 'node:fs/promises';
import { load_snapshot, query_snapshot, diff_snapshots, close_snapshot } from '../dist/moonheap.mjs';

const HELP = `MoonHeap 0.1.0 — offline V8 heap graph analysis
Usage: node bin/moonheap.mjs <command> <snapshot> [options]
       node bin/moonheap.mjs diff <before> <after> [options]
Commands: summary, validate, nodes, groups, node, refs, path, dominated, diff
Options:
  --id DECIMAL          exact object ID (node/refs/path/dominated)
  --query TEXT          case-sensitive name filter (or exact ID for nodes)
  --kind TYPE           filter nodes by V8 type
  --order retained|shallow|index
  --limit N             page size 1..1000 (default 100)
  --offset N            zero-based result offset
  --outgoing            show outgoing refs (default incoming)
  --retaining-only      exclude non-retaining references
  --max-depth N         root-path budget (default 1024)
  --same-isolate        assert both diff files came from the same V8 isolate
  --json                emit versioned JSON (errors on stderr)
Input limit: 64 MiB per file. Analysis stays on this machine.
Retention is snapshot-strong-v1 graph retention, not RSS or proof of a leak.
`;
const args = process.argv.slice(2);
const json = args.includes('--json');
const handles = [];
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function unwrap(raw) {
  const r = JSON.parse(raw);
  if (!r.ok) fail(r.error.code, r.error.message);
  return r.data;
}
async function readBounded(path) {
  const max = 64 * 1024 * 1024;
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) fail('invalid_input', 'Input must be a regular file');
    if (stat.size > max) fail('resource_limit', 'Input exceeds 64 MiB');
    const chunks = []; let size = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(65536, max + 1 - size));
      const { bytesRead } = await file.read(buffer);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > max) fail('resource_limit', 'Input grew beyond 64 MiB');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)); }
    catch { fail('invalid_input', 'Input is not valid UTF-8'); }
  } finally { await file.close(); }
}
function human(data) {
  if (data.policy) return `${data.nodes} objects · ${data.edges} references\n${data.total_shallow_bytes} reported bytes · ${data.reachable_bytes} reachable bytes\n${data.unreachable_nodes} unreachable objects · ${data.conditional_weakmap_edges} conditional WeakMap edges\nPolicy: ${data.policy}\n${data.interpretation}`;
  return JSON.stringify(data, null, 2);
}
try {
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(HELP); }
  else if (args[0] === '--version') { console.log('0.1.0'); }
  else {
    const command = args.shift();
    if (!['summary','validate','nodes','groups','node','refs','path','dominated','diff'].includes(command)) fail('invalid_input', `Unknown command: ${command}`);
    const files = []; const options = {};
    const strings = { '--id':'id','--query':'query','--kind':'kind','--order':'order' };
    const numbers = { '--limit':'limit','--offset':'offset','--max-depth':'max_depth' };
    const flags = new Set();
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith('--')) { files.push(arg); continue; }
      if (flags.has(arg)) fail('invalid_input', `Duplicate option: ${arg}`);
      flags.add(arg);
      if (arg === '--json') continue;
      if (arg === '--same-isolate') { options.same_isolate = true; continue; }
      if (arg === '--outgoing') { options.incoming = false; continue; }
      if (arg === '--retaining-only') { options.retaining_only = true; continue; }
      if (!(arg in strings) && !(arg in numbers)) fail('invalid_input', `Unknown option: ${arg}`);
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) fail('invalid_input', `Missing value for ${arg}`);
      if (arg in numbers) {
        if (!/^\d+$/.test(value) || Number(value) > 2147483647) fail('invalid_input', `Invalid integer for ${arg}`);
        options[numbers[arg]] = Number(value);
      } else options[strings[arg]] = value;
    }
    if (files.length !== (command === 'diff' ? 2 : 1)) fail('invalid_input', 'Wrong number of input files');
    if (options.same_isolate && command !== 'diff') fail('invalid_input', '--same-isolate only applies to diff');
    if (['node','refs','path','dominated'].includes(command) && !options.id) fail('invalid_input', '--id is required');
    if (options.id && !/^(0|[1-9]\d*)$/.test(options.id)) fail('invalid_input', 'Object ID must be a decimal string');
    for (const path of files) handles.push(unwrap(load_snapshot(await readBounded(path))));
    const raw = command === 'diff'
      ? diff_snapshots(handles[0], handles[1], JSON.stringify(options))
      : query_snapshot(handles[0], JSON.stringify({ ...options, op: command === 'refs' ? 'references' : command === 'validate' ? 'summary' : command }));
    const data = unwrap(raw);
    console.log(json ? raw : human(data));
  }
} catch (error) {
  const code = error.code && ['invalid_input','resource_limit','not_found','identity_conflict'].includes(error.code) ? error.code : 'io_error';
  console.error(json ? JSON.stringify({ api_version: 1, ok: false, error: { code, message: error.message } }) : `MoonHeap: ${error.message}`);
  process.exitCode = { resource_limit: 3, identity_conflict: 4, io_error: 5 }[code] ?? 2;
} finally { for (const handle of handles) close_snapshot(handle); }

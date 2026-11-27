import { open, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { begin_snapshot, feed_snapshot, finish_snapshot, abort_snapshot } from '../dist/moonheap.mjs';
export function fail(code, message) { throw Object.assign(new Error(message), { code }); }
export function unwrap(raw) { const r = JSON.parse(raw); if (!r.ok) fail(r.error.code,r.error.message); return r.data; }
export async function loadFile(path, options = {}, progress = () => {}, expected = null) {
  const maxMiB = options.max_mib ?? 256;
  if (!Number.isInteger(maxMiB) || maxMiB < 1 || maxMiB > 1024) fail('invalid_input','max_mib must be in 1..1024');
  const max = maxMiB * 1048576;
  const file = await open(path,'r');
  let decoder;
  try {
    const stat = await file.stat();
    if (!stat.isFile()) fail('invalid_input','Input must be a regular file');
    if (stat.size > max) fail('resource_limit','Input exceeds ' + maxMiB + ' MiB');
    decoder = unwrap(begin_snapshot(JSON.stringify(options)));
    const utf8 = new TextDecoder('utf-8',{fatal:true});
    const buffer = Buffer.allocUnsafe(65536);
    const hash = expected ? createHash('sha256') : null;
    let read = 0;
    while (true) {
      const { bytesRead } = await file.read(buffer);
      if (!bytesRead) break;
      read += bytesRead;
      if (read > max) fail('resource_limit','Input grew beyond configured byte limit');
      hash?.update(buffer.subarray(0,bytesRead));
      let text; try { text = utf8.decode(buffer.subarray(0,bytesRead),{stream:true}); }
      catch { fail('invalid_input','Input is not valid UTF-8'); }
      unwrap(feed_snapshot(decoder,text));
      progress({stage:'read',read,total:stat.size});
    }
    let tail; try { tail = utf8.decode(); } catch { fail('invalid_input','Truncated UTF-8 sequence'); }
    if (tail) unwrap(feed_snapshot(decoder,tail));
    if (expected && (read !== expected.bytes || hash.digest('hex') !== expected.sha256)) {
      fail('identity_conflict','Parsed snapshot does not match its capture manifest');
    }
    progress({stage:'analyze',read,total:stat.size});
    return unwrap(finish_snapshot(decoder));
  } finally { if (decoder != null) abort_snapshot(decoder); await file.close(); }
}
export async function saveOutput(path, content, force = false) {
  try { await writeFile(path,content,{encoding:'utf8',flag:force ? 'w' : 'wx'}); }
  catch (e) { if (e.code === 'EEXIST') fail('io_error','Output already exists; use --force to replace it'); throw e; }
}
const canonical = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
export async function readCaptureManifest(path, files) {
  let manifest;
  const bytes = await readFile(path);
  if (bytes.length > 1048576) fail('resource_limit','Capture manifest exceeds 1 MiB');
  try { manifest = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { fail('invalid_input','Capture manifest must contain valid UTF-8 JSON'); }
  if (!manifest || manifest.schema !== 'moonheap-capture-v1' || manifest.same_isolate !== true ||
      typeof manifest.run_id !== 'string' || !manifest.run_id.trim() || manifest.run_id.length > 128 ||
      !Array.isArray(manifest.snapshots) || manifest.snapshots.length !== 3) fail('invalid_input','Invalid capture manifest');
  const stages = ['before','growth','cleanup'], labels = new Set(), paths = new Map();
  for (const entry of manifest.snapshots) {
    if (!entry || !stages.includes(entry.label) || labels.has(entry.label) || typeof entry.file !== 'string' || !entry.file ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      fail('invalid_input','Invalid or duplicate snapshot entry in capture manifest');
    }
    const name = canonical(resolve(dirname(path),entry.file));
    if (paths.has(name)) fail('invalid_input','Capture manifest repeats a snapshot file');
    labels.add(entry.label); paths.set(name,entry);
  }
  const snapshots = []; let previous = -1;
  for (const file of files) {
    const entry = paths.get(canonical(file));
    if (!entry) fail('identity_conflict','Input is not declared in the capture manifest');
    const stage = stages.indexOf(entry.label);
    if (stage <= previous) fail('identity_conflict','Inputs must follow before, growth, cleanup order without repetitions');
    previous = stage; snapshots.push(entry);
  }
  return { run_id: manifest.run_id, snapshots };
}
export async function verifyManifest(path, files) {
  const manifest = await readCaptureManifest(path,files);
  for (let i = 0; i < files.length; i++) {
    const name = files[i], entry = manifest.snapshots[i];
    const f = await open(name,'r'); const hash = createHash('sha256'); let size = 0;
    try { for await (const chunk of f.createReadStream()) { hash.update(chunk); size += chunk.length; } }
    finally { await f.close(); }
    if (size !== entry.bytes || hash.digest('hex') !== entry.sha256) fail('identity_conflict','Snapshot does not match its capture manifest');
  }
  return manifest.run_id;
}

export async function protectInputs(output, inputs) {
  if (!output) return;
  let destination;
  try { destination = await stat(output,{bigint:true}); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const input of inputs) {
    if (canonical(output) === canonical(input)) fail('invalid_input','Output cannot replace an input snapshot or capture manifest');
    if (destination) {
      const source = await stat(input,{bigint:true});
      if (source.dev === destination.dev && source.ino === destination.ino) {
        fail('invalid_input','Output aliases an input file; choose a separate report path');
      }
    }
  }
}


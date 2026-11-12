import { open, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { begin_snapshot, feed_snapshot, finish_snapshot, abort_snapshot } from '../dist/moonheap.mjs';
export function fail(code, message) { throw Object.assign(new Error(message), { code }); }
export function unwrap(raw) { const r = JSON.parse(raw); if (!r.ok) fail(r.error.code,r.error.message); return r.data; }
export async function loadFile(path, options = {}, progress = () => {}) {
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
    let read = 0;
    while (true) {
      const { bytesRead } = await file.read(buffer);
      if (!bytesRead) break;
      read += bytesRead;
      if (read > max) fail('resource_limit','Input grew beyond configured byte limit');
      let text; try { text = utf8.decode(buffer.subarray(0,bytesRead),{stream:true}); }
      catch { fail('invalid_input','Input is not valid UTF-8'); }
      unwrap(feed_snapshot(decoder,text));
      progress({stage:'read',read,total:stat.size});
    }
    let tail; try { tail = utf8.decode(); } catch { fail('invalid_input','Truncated UTF-8 sequence'); }
    if (tail) unwrap(feed_snapshot(decoder,tail));
    progress({stage:'analyze',read,total:stat.size});
    return unwrap(finish_snapshot(decoder));
  } finally { if (decoder != null) abort_snapshot(decoder); await file.close(); }
}
export async function saveOutput(path, content, force = false) {
  try { await writeFile(path,content,{encoding:'utf8',flag:force ? 'w' : 'wx'}); }
  catch (e) { if (e.code === 'EEXIST') fail('io_error','Output already exists; use --force to replace it'); throw e; }
}
export async function verifyManifest(path, files) {
  const manifest = JSON.parse(await readFile(path,'utf8'));
  if (manifest.schema !== 'moonheap-capture-v1' || manifest.same_isolate !== true || !Array.isArray(manifest.snapshots)) fail('invalid_input','Invalid capture manifest');
  for (const name of files) {
    const entry = manifest.snapshots.find(s => resolve(dirname(path),s.file) === resolve(name));
    if (!entry) fail('identity_conflict','Input is not declared in the capture manifest');
    const f = await open(name,'r'); const hash = createHash('sha256'); let size = 0;
    try { for await (const chunk of f.createReadStream()) { hash.update(chunk); size += chunk.length; } }
    finally { await f.close(); }
    if (size !== entry.bytes || hash.digest('hex') !== entry.sha256) fail('identity_conflict','Snapshot does not match its capture manifest');
  }
  return manifest.run_id;
}


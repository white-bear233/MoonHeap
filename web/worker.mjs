import { load_snapshot, query_snapshot, diff_snapshots, close_snapshot } from './engine.mjs';
const handles = [null, null];
let queue = Promise.resolve();
function unwrap(raw) { const value = JSON.parse(raw); if (!value.ok) throw Object.assign(new Error(value.error.message), { code: value.error.code }); return value.data; }
function required(slot) { const h = handles[slot]; if (h == null) throw new Error('请先打开所需快照'); return h; }
async function dispatch({ method, slot, file, request }) {
  if (method === 'load') {
    if (file.size > 64 * 1024 * 1024) throw new Error('文件超过 64 MiB，请使用更小的快照');
    const bytes = await file.arrayBuffer();
    let input;
    try { input = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('快照必须是有效的 UTF-8 文本'); }
    if (handles[slot] != null) close_snapshot(handles[slot]);
    handles[slot] = null;
    handles[slot] = unwrap(load_snapshot(input));
    return unwrap(query_snapshot(handles[slot], '{"op":"summary"}'));
  }
  if (method === 'close') { if (handles[slot] != null) close_snapshot(handles[slot]); handles[slot] = null; return null; }
  if (method === 'query') return unwrap(query_snapshot(required(slot), JSON.stringify(request)));
  if (method === 'diff') return unwrap(diff_snapshots(required(0), required(1), JSON.stringify(request)));
  throw new Error('未知操作');
}
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try { self.postMessage({ id: data.id, data: await dispatch(data) }); }
    catch (error) { self.postMessage({ id: data.id, error: { code: error.code ?? 'invalid_input', message: error.message } }); }
  });
};


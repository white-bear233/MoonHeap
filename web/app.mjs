const $ = id => document.getElementById(id);
const slots = [null, null];
let active = 0, view = 'nodes', offset = 0, selected = null, detailView = 'incoming', detailOffset = 0;
let worker, sequence = 0, generation = 0, busy = false, lastReport = null, workerFailed = false;
const pending = new Map(), PAGE = 25;
function startWorker() {
  workerFailed = false;
  worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id); if (!p) return;
    pending.delete(data.id); data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.data);
  };
  worker.onerror = () => {
    workerFailed = true;
    for (const p of pending.values()) p.reject(new Error('分析进程意外退出，请点击“清空工作区”后重试'));
    pending.clear();
    $('error').textContent = '分析进程未能运行，请确认已经构建项目，再清空工作区重试。'; $('error').hidden = false;
  };
}
startWorker();
function rpc(method, extra = {}) {
  if (workerFailed) return Promise.reject(new Error('请先清空工作区，重新启动分析进程'));
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, method, ...extra }); });
}
function setBusy(value) {
  busy = value; document.body.classList.toggle('is-busy', value); $('busy').hidden = !value;
  // Preserve the controls' own disabled state across asynchronous work.
  for (const el of document.querySelectorAll('button,input,select')) {
    if (el.id === 'cancel') continue;
    if (value) { el.dataset.wasDisabled = String(el.disabled); el.disabled = true; }
    else if ('wasDisabled' in el.dataset) { el.disabled = el.dataset.wasDisabled === 'true'; delete el.dataset.wasDisabled; }
  }
}
async function run(fn, message = '正在分析快照…') {
  if (busy) return;
  const current = generation; $('error').hidden = true; $('busy-text').textContent = message; setBusy(true);
  try { await fn(); } catch (e) { if (current === generation) { $('error').textContent = e.message; $('error').hidden = false; } }
  finally { if (current === generation) { setBusy(false); updateSlots(); updatePager(); } }
}
function setEnabled(id, value) {
  const el = $(id);
  if (busy) el.dataset.wasDisabled = String(!value); else el.disabled = !value;
}
function bytes(value) {
  if (value == null) return '不可达';
  if (value < 0) return '−' + bytes(-value);
  if (value < 1024) return value + ' B';
  if (value < 1048576) return (value / 1024).toFixed(1) + ' KiB';
  return (value / 1048576).toFixed(2) + ' MiB';
}
const number = value => value.toLocaleString('zh-CN');
function elem(tag, text = '', cls = '') { const el = document.createElement(tag); if (text !== '') el.textContent = text; if (cls) el.className = cls; return el; }
function cell(row, value, cls = '') { const td = elem('td', value, cls); row.append(td); return td; }
function numeric(row, n, format = bytes) { const td = cell(row, format(n), 'number'); if (typeof n === 'number') td.title = number(n) + '（原始值）'; return td; }
function nodeLink(n, target = active) {
  const button = elem('button', n.name || '(根)', 'row-link');
  button.title = n.name || '(根)';
  button.addEventListener('click', () => run(async () => {
    if (target !== active) { active = target; await refresh(); }
    await inspect(n.id);
  }, '正在读取对象关系…'));
  return button;
}
function updateSlots() {
  for (let i = 0; i < 2; i++) {
    $('slot' + i).classList.toggle('selected', !!slots[i] && active === i);
    const name = document.querySelector('.snapshot-name[data-slot="' + i + '"]');
    name.textContent = slots[i]?.name ?? '尚未打开'; name.title = slots[i]?.name ?? '';
    if (busy) name.dataset.wasDisabled = String(!slots[i]); else name.disabled = !slots[i];
    document.querySelector('.close-slot[data-slot="' + i + '"]').hidden = !slots[i];
  }
  const s = slots[active]?.summary;
  $('stat-size').textContent = s ? bytes(s.total_shallow_bytes) : '—';
  $('stat-nodes').textContent = s ? number(s.nodes) : '—';
  $('stat-edges').textContent = s ? number(s.edges) + ' 条引用' : '等待快照';
  $('stat-reachable').textContent = s ? bytes(s.reachable_bytes) : '—';
  $('stat-unreachable').textContent = s ? number(s.unreachable_nodes) + ' 个对象从根不可达' : '沿保留引用可达';
  $('stat-active').textContent = s ? (active ? 'B · 对照' : 'A · 基线') : '—';
  $('stat-name').textContent = slots[active]?.name ?? '选择基线或对照';
  $('weakmap-note').textContent = s?.conditional_weakmap_edges ? '当前快照包含 ' + number(s.conditional_weakmap_edges) + ' 条 WeakMap 条件引用，相关保留体积需要结合运行行为判断。' : '';
}
async function load(slot, file) {
  const started = generation;
  if (file.size > 64 * 1024 * 1024) throw new Error('文件超过 64 MiB，请使用更小的快照');
  // A replacement releases the previous snapshot even if the new file is invalid.
  slots[slot] = null; selected = null; $('detail').hidden = true; lastReport = null; $('identity').checked = false;
  try {
    const summary = await rpc('load', { slot, file });
    if (started !== generation) throw new Error('已取消');
    slots[slot] = { name: file.name || 'snapshot.heapsnapshot', summary };
    active = slot; offset = 0;
  } catch (e) {
    if (started !== generation || workerFailed) throw e;
    await rpc('close', { slot }); active = slots[1 - slot] ? 1 - slot : slot;
    await refresh(); throw e;
  }
  updateSlots();
}
async function demo() {
  await run(async () => {
    for (const [i, name] of ['before','growth'].entries()) {
      const response = await fetch('examples/' + name + '.heapsnapshot');
      if (!response.ok) throw new Error('无法读取内置示例');
      await load(i, new File([await response.arrayBuffer()], name + '.heapsnapshot'));
    }
    view = 'nodes'; $('search').value = ''; $('kind').value = ''; $('identity').checked = false;
    await refresh();
    $('notice').textContent = '合成示例：图片缓存从 2 项增长到 18 项。点击 PhotoCache，再查看“最短根路径”。';
  }, '正在载入可重复验证的缓存示例…');
}
function updatePager() {
  const data = lastReport?.data, total = view === 'diff' ? Math.max(data?.total_groups ?? 0, data?.total_changes ?? 0) : data?.total ?? 0;
  setEnabled('prev', offset > 0); setEnabled('next', offset + PAGE < total);
  setEnabled('export', !!lastReport);
}
async function refresh() {
  selected = null; $('detail').hidden = true;
  lastReport = null; $('table-wrap').hidden = true; $('pager').hidden = true; setEnabled('export', false);
  for (const button of document.querySelectorAll('[data-view]')) { const yes = button.dataset.view === view; button.classList.toggle('active', yes); button.setAttribute('aria-pressed', String(yes)); }
  $('sort-label').hidden = view !== 'nodes'; $('kind-label').hidden = view !== 'nodes';
  $('identity-row').hidden = view !== 'diff'; $('changes-wrap').hidden = true;
  updateSlots();
  const available = view === 'diff' ? slots.every(Boolean) : slots[active];
  if (!available) {
    $('empty').hidden = false; $('table-wrap').hidden = true; $('pager').hidden = true; lastReport = null; updatePager();
    $('result-count').textContent = view === 'diff' ? '请打开 A、B 两份快照' : '等待分析';
    return;
  }
  const query = $('search').value.trim(), request = { offset, limit: PAGE, query };
  let data;
  if (view === 'diff') data = await rpc('diff', { request: { ...request, same_isolate: $('identity').checked } });
  else data = await rpc('query', { slot: active, request: { ...request, op: view, order: $('order').value, kind: $('kind').value } });
  lastReport = { format: 'moonheap-report-v1', generated_at: new Date().toISOString(), view, snapshot: slots[active].name, sources: slots.map(s => s?.name ?? null), policy: 'snapshot-strong-v1', summary: slots[active].summary, request: view === 'diff' ? { ...request, same_isolate: $('identity').checked } : { ...request, order: $('order').value, kind: $('kind').value }, data };
  renderTable(data); updatePager();
}
function renderTable(data) {
  $('empty').hidden = true; $('table-wrap').hidden = false; $('pager').hidden = false;
  const labels = view === 'nodes' ? ['对象 / ID','类型','浅体积','保留体积','根距离'] : view === 'groups' ? ['名称','类型','对象数','浅体积合计','最大单对象保留体积'] : ['名称','类型','数量变化','之前浅体积','之后浅体积','体积变化'];
  const head = elem('tr'); for (const label of labels) head.append(elem('th', label)); $('table-head').replaceChildren(head);
  $('table-body').replaceChildren();
  const items = view === 'diff' ? data.groups : data.items;
  for (const n of items) {
    const row = elem('tr'), nameCell = cell(row, '');
    if (view === 'nodes') { nameCell.append(nodeLink(n), elem('span', '@' + n.id, 'subline')); row.dataset.id = n.id; }
    else {
      const b = elem('button', n.name || '(根)', 'row-link'); b.title = n.name;
      b.addEventListener('click', () => run(async () => { if (view === 'diff') active = n.after_count > 0 ? 1 : 0; view = 'nodes'; $('search').value = n.name; $('kind').value = n.kind; offset = 0; await refresh(); }));
      nameCell.append(b);
    }
    cell(row, '').append(elem('span', n.kind, 'type-chip'));
    if (view === 'nodes') { numeric(row, n.shallow_bytes); numeric(row, n.retained_bytes); numeric(row, n.distance, v => v == null ? '—' : String(v)); }
    else if (view === 'groups') { numeric(row, n.count, number); numeric(row, n.shallow_bytes); numeric(row, n.max_retained_bytes); }
    else {
      const count = numeric(row, n.count_delta, v => (v > 0 ? '+' : '') + number(v)); count.classList.add(n.count_delta > 0 ? 'positive' : 'negative');
      numeric(row, n.before_bytes); numeric(row, n.after_bytes);
      const delta = numeric(row, n.bytes_delta, v => (v > 0 ? '+' : '') + bytes(v)); delta.classList.add(n.bytes_delta > 0 ? 'positive' : 'negative');
    }
    $('table-body').append(row);
  }
  if (!items.length) { const row = elem('tr'), td = cell(row, '没有匹配的结果。', 'muted'); td.colSpan = labels.length; $('table-body').append(row); }
  const total = view === 'diff' ? data.total_groups : data.total;
  $('result-count').textContent = number(total) + (view === 'nodes' ? ' 个对象' : ' 个分组');
  $('page-info').textContent = items.length ? '第 ' + (offset + 1) + '–' + (offset + items.length) + ' 项 / 共 ' + number(total) + ' 项' : '没有更多分组';
  if (view === 'diff') {
    $('identity-result').textContent = data.mode === 'aggregate' ? '按类型与名称汇总。浅体积变化不等于进程实际内存变化。' : '按对象 ID：新增 ' + number(data.added) + ' · 消失 ' + number(data.removed) + ' · 存活 ' + number(data.survived);
    $('changes-wrap').hidden = data.mode === 'aggregate';
    $('changes-body').replaceChildren();
    for (const change of data.changes) {
      const row = elem('tr'), c = cell(row, ''); c.append(nodeLink(change, change.status === 'removed' ? 0 : 1), elem('span', '@' + change.id, 'subline'));
      cell(row, ({ added: '新增', removed: '消失', resized: '体积变化' })[change.status]);
      numeric(row, change.before_bytes, v => v == null ? '—' : bytes(v)); numeric(row, change.after_bytes, v => v == null ? '—' : bytes(v));
      $('changes-body').append(row);
    }
    if (data.mode !== 'aggregate') $('page-info').textContent += ' · ID 变化 ' + number(data.total_changes) + ' 项';
  }
  $('notice').textContent = view === 'diff' ? '比较基线 A → 对照 B。点击增长的分组，继续检查具体对象。' : slots[active].name + ' · 点击对象名称，展开引用关系。';
}
async function inspect(id) {
  selected = await rpc('query', { slot: active, request: { op: 'node', id } }); detailOffset = 0;
  $('detail').hidden = false; $('detail-name').textContent = selected.name || '(根)';
  $('detail-meta').textContent = '@' + selected.id + ' · ' + selected.kind + ' · 浅体积 ' + bytes(selected.shallow_bytes) + ' · 保留体积 ' + bytes(selected.retained_bytes) + ' · 支配者 ' + (selected.dominator_id ?? '无');
  for (const row of document.querySelectorAll('#table-body tr')) row.classList.toggle('selected-row', row.dataset.id === selected.id);
  await renderDetail();
  $('detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
async function renderDetail() {
  if (!selected) return;
  for (const b of document.querySelectorAll('[data-detail]')) b.classList.toggle('active', b.dataset.detail === detailView);
  const descriptions = { incoming: '所有指向此对象的引用。灰色边不计入保留体积。点击两端对象可继续追踪。', outgoing: '此对象指向的其他对象，包括弱引用。', path: '从根出发的一条最短保留路径；一条路径不能穷尽所有持有者。', dominated: '所有根路径都必须经过当前对象的直接下级；这是支配树关系，未必是直接引用。' };
  $('detail-description').textContent = descriptions[detailView];
  const op = detailView === 'path' ? 'path' : detailView === 'dominated' ? 'dominated' : 'references';
  const data = await rpc('query', { slot: active, request: { op, id: selected.id, incoming: detailView === 'incoming', offset: detailOffset, limit: PAGE } });
  const container = $('detail-content'); container.replaceChildren();
  const items = detailView === 'path' ? data.edges ?? [] : data.items;
  for (const [i, item] of items.entries()) {
    const row = elem('div', '', 'edge-row');
    if (detailView === 'dominated') { row.append(nodeLink(item), elem('span', '@' + item.id, 'subline'), elem('span', bytes(item.retained_bytes), 'number')); }
    else { row.append(nodeLink(item.source), elem('span', (detailView === 'path' ? (i + 1) + '. ' : '') + item.name + ' → [' + item.kind + ']' + (item.retaining ? '' : ' · 非保留'), 'edge-label' + (item.retaining ? '' : ' weak')), nodeLink(item.target)); }
    container.append(row);
  }
  if (!items.length) container.append(elem('p', detailView === 'path' ? data.reachable ? '当前对象就是根，路径长度为 0。' : '在当前引用策略下，无法从根到达此对象。' : '没有匹配的对象或引用。', 'small muted'));
  $('detail-pager').hidden = detailView === 'path';
  $('detail-page-info').textContent = '显示 ' + items.length + ' 项 / 共 ' + number(data.total ?? items.length) + ' 项';
  setEnabled('detail-prev', detailOffset > 0); setEnabled('detail-next', detailOffset + PAGE < (data.total ?? 0));
}
function reset() {
  generation++; worker.terminate(); for (const p of pending.values()) p.reject(new Error('已取消')); pending.clear(); startWorker();
  slots.fill(null); active = 0; offset = 0; selected = null; lastReport = null; $('detail').hidden = true; setBusy(false);
  $('error').hidden = true; $('notice').textContent = '工作区已清空，可重新打开快照。';
  $('identity').checked = false; refresh();
}
for (const input of document.querySelectorAll('input[type=file]')) input.addEventListener('change', () => { const file = input.files[0]; input.value = ''; if (file) run(async () => { await load(Number(input.dataset.slot), file); await refresh(); }); });
for (const slot of document.querySelectorAll('.slot')) {
  slot.addEventListener('dragover', e => { e.preventDefault(); if (!busy) slot.classList.add('dragging'); });
  slot.addEventListener('dragleave', () => slot.classList.remove('dragging'));
  slot.addEventListener('drop', e => { e.preventDefault(); slot.classList.remove('dragging'); const file = e.dataTransfer.files[0]; if (file) run(async () => { await load(Number(slot.id.slice(-1)), file); await refresh(); }); });
}
for (const b of document.querySelectorAll('.snapshot-name')) b.addEventListener('click', () => run(async () => { active = Number(b.dataset.slot); offset = 0; await refresh(); }));
for (const b of document.querySelectorAll('.close-slot')) b.addEventListener('click', () => run(async () => { const i = Number(b.dataset.slot); await rpc('close', { slot: i }); slots[i] = null; $('identity').checked = false; if (active === i) active = 1 - i; offset = 0; await refresh(); }));
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => run(async () => { view = b.dataset.view; offset = 0; await refresh(); }));
for (const b of document.querySelectorAll('[data-detail]')) b.addEventListener('click', () => run(async () => { detailView = b.dataset.detail; detailOffset = 0; await renderDetail(); }, '正在读取对象关系…'));
$('search-form').addEventListener('submit', e => { e.preventDefault(); run(async () => { offset = 0; await refresh(); }); });
for (const id of ['order','kind','identity']) $(id).addEventListener('change', () => run(async () => { offset = 0; await refresh(); }));
$('prev').onclick = () => run(async () => { offset = Math.max(0, offset - PAGE); await refresh(); });
$('next').onclick = () => run(async () => { offset += PAGE; await refresh(); });
$('detail-prev').onclick = () => run(async () => { detailOffset = Math.max(0, detailOffset - PAGE); await renderDetail(); });
$('detail-next').onclick = () => run(async () => { detailOffset += PAGE; await renderDetail(); });
$('detail-close').onclick = () => { selected = null; $('detail').hidden = true; };
$('demo').onclick = demo; $('demo-empty').onclick = demo; $('cancel').onclick = reset;
$('reset').onclick = reset;
$('export').onclick = () => {
  if (!lastReport) return;
  const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob);
  const a = elem('a'); a.href = url; a.download = 'moonheap-' + view + '-report.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
updateSlots();


const $=id=>document.getElementById(id);
const slots=[null,null,null], PAGE=25, pending=new Map();
let active=0,view='nodes',offset=0,changeOffset=0,treeRoot=null,cycleId=null;
let selected=null,detailView='incoming',detailOffset=0,history=[],historyAt=-1,bookmarks=[];
let worker,sequence=0,generation=0,busy=false,workerFailed=false,lastResult=null;
function element(tag,text='',cls=''){const e=document.createElement(tag);if(text!=='')e.textContent=text;if(cls)e.className=cls;return e;}
function cell(row,value,cls=''){const e=element('td',value,cls);row.append(e);return e;}
const number=n=>n.toLocaleString('zh-CN');
function bytes(n){if(n==null)return '不可达';if(n<0)return '−'+bytes(-n);if(n<1024)return n+' B';if(n<1048576)return(n/1024).toFixed(1)+' KiB';return(n/1048576).toFixed(2)+' MiB';}
function numeric(row,n,format=bytes){const c=cell(row,format(n),'number');if(typeof n==='number')c.title=number(n)+'（原始值）';return c;}
function enabled(id,yes){const e=$(id);if(busy)e.dataset.wasDisabled=String(!yes);else e.disabled=!yes;}
function setBusy(value){
  busy=value;document.body.classList.toggle('is-busy',value);$('busy').hidden=!value;
  for(const e of document.querySelectorAll('button,input,select')){
    if(e.id==='cancel')continue;
    if(value){e.dataset.wasDisabled=String(e.disabled);e.disabled=true;}
    else if('wasDisabled'in e.dataset){e.disabled=e.dataset.wasDisabled==='true';delete e.dataset.wasDisabled;}
  }
}
function startWorker(){
  workerFailed=false;worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    const p=pending.get(data.id);if(!p)return;
    if(data.progress){
      const {stage,read,total}=data.progress;
      if(stage==='read'){$('load-progress').value=total?Math.round(read/total*100):0;$('busy-text').textContent='读取并解析 '+bytes(read)+' / '+bytes(total);}
      else{$('load-progress').removeAttribute('value');$('busy-text').textContent='读取完成，正在计算引用和支配关系…';}
      return;
    }
    pending.delete(data.id);data.error?p.reject(new Error(data.error.message)):p.resolve(data.data);
  };
  worker.onerror=()=>{workerFailed=true;for(const p of pending.values())p.reject(new Error('分析进程意外退出，请清空当前工作区后重试'));pending.clear();$('error').textContent='分析进程未能运行，请确认项目已构建。';$('error').hidden=false;};
}
startWorker();
function rpc(method,extra={}){if(workerFailed)return Promise.reject(new Error('请先清空当前工作区，重启分析进程'));const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,method,...extra});});}
async function run(fn,message='正在查询…'){
  if(busy)return;const gen=generation;$('error').hidden=true;$('busy-text').textContent=message;$('load-progress').removeAttribute('value');setBusy(true);
  try{await fn();}catch(e){if(gen===generation){$('error').textContent=e.message;$('error').hidden=false;}}
  finally{if(gen===generation){setBusy(false);updateSlots();updateControls();}}
}
function settings(){const n=Number($('max-mib').value);if(!Number.isInteger(n)||n<1||n>1024)throw new Error('读取上限应为 1–1024 MiB');return{max_mib:n};}
function filters(){
  const r={query:$('search').value.trim(),kind:$('kind').value,order:$('order').value,offset,limit:PAGE};
  if(view==='nodes')r.reachability=$('reachability').value;
  if(['diff','investigate'].includes(view)){r.same_isolate=$('identity').checked;r.exclude_conflicts=true;}
  if(view==='diff'){r.group_offset=offset;r.change_offset=changeOffset;r.status=$('change-status').value;}
  if(view==='investigate')r.residual_only=!$('all-groups').checked;
  const raw=$('min-size').value;
  if(raw!==''&&['nodes','diff','investigate'].includes(view)){const n=Number(raw);if(!Number.isSafeInteger(n)||n<0)throw new Error('最小体积需要填写非负整数');r[view==='diff'?'min_growth':'min_retained']=n;}
  if(view==='tree'&&treeRoot!=null)r.id=treeRoot;
  if(view==='cycle')r.cycle_id=cycleId;
  return r;
}
function updateSlots(){
  for(let i=0;i<3;i++){
    $('slot'+i).classList.toggle('selected',!!slots[i]&&i===active);
    const b=document.querySelector('.snapshot-name[data-slot="'+i+'"]');
    b.textContent=slots[i]?.name??'尚未打开';b.title=slots[i]?.name??'';
    if(busy)b.dataset.wasDisabled=String(!slots[i]);else b.disabled=!slots[i];
    document.querySelector('.close-slot[data-slot="'+i+'"]').hidden=!slots[i];
  }
  const s=slots[active]?.summary;
  $('stat-size').textContent=s?bytes(s.total_shallow_bytes):'—';$('stat-nodes').textContent=s?number(s.nodes):'—';
  $('stat-edges').textContent=s?number(s.edges)+' 条引用':'等待快照';$('stat-reachable').textContent=s?bytes(s.reachable_bytes):'—';
  $('stat-unreachable').textContent=s?number(s.unreachable_nodes)+' 个对象从根不可达':'沿保留引用可达';
  $('stat-active').textContent=s?['A · 基线','B · 增长','C · 清理后'][active]:'—';$('stat-name').textContent=slots[active]?.name??'选择快照';
  $('weakmap-note').textContent=s?.conditional_weakmap_edges?'当前快照含 '+number(s.conditional_weakmap_edges)+' 条 WeakMap 条件引用；相关保留体积需结合运行行为判断。':'';
}
function totals(){const d=lastResult?.data;return{main:view==='diff'||view==='investigate'?d?.total_groups??0:view==='tree'?d?.children.total??0:d?.total??0,changes:view==='diff'?d?.total_changes??0:view==='investigate'?d?.total??0:0};}
function updateControls(){
  const t=totals();enabled('prev',offset>0);enabled('next',offset+PAGE<t.main);
  enabled('change-prev',changeOffset>0);enabled('change-next',changeOffset+PAGE<t.changes);
  enabled('export',!!lastResult);enabled('save-workspace',slots.some(Boolean));
  enabled('history-back',historyAt>0);enabled('history-forward',historyAt>=0&&historyAt<history.length-1);
}
function clearDetail(){selected=null;$('detail').hidden=true;}
async function load(slot,file){
  const started=generation,opt=settings();if(file.size>opt.max_mib*1048576)throw new Error('文件超过 '+opt.max_mib+' MiB；可在工作区调整读取上限。');
  slots[slot]=null;lastResult=null;clearDetail();history=[];historyAt=-1;bookmarks=bookmarks.filter(b=>b.slot!==slot);$('identity').checked=false;
  try{
    const summary=await rpc('load',{slot,file,options:opt});if(started!==generation)throw new Error('已取消');
    slots[slot]={name:file.name||'snapshot.heapsnapshot',file,summary};active=slot;offset=0;changeOffset=0;treeRoot=null;if(view==='cycle')view='cycles';
  }catch(e){if(started!==generation||workerFailed)throw e;await rpc('close',{slot});active=Math.max(0,slots.findIndex(Boolean));await refresh();throw e;}
  updateSlots();renderBookmarks();
}
function loadFiles(slot,files){const chosen=[...files].slice(0,3-slot);return run(async()=>{for(const file of chosen)await load(slot++,file);await refresh();},'正在打开快照…');}
async function demo(){
  await run(async()=>{
    const started=generation;
    resetFilters();
    for(const[i,name]of ['before','growth','residual'].entries()){const res=await fetch('examples/'+name+'.heapsnapshot');if(!res.ok)throw new Error('无法读取示例');const contents=await res.arrayBuffer();if(started!==generation)throw new Error('已取消');await load(i,new File([contents],name+'.heapsnapshot'));}
    active=1;view='diff';await refresh();
    $('notice').textContent='合成示例：缓存从 2 项增长到 18 项，清理后仍剩 4 项。切换“清理后调查”查看残留。';
  },'正在加载三阶段缓存示例…');
}
function resetFilters(){$('search').value='';$('kind').value='';$('min-size').value='';$('reachability').value='all';$('change-status').value='';$('all-groups').checked=false;offset=0;changeOffset=0;treeRoot=null;cycleId=null;}
function reset(){
  generation++;worker.terminate();for(const p of pending.values())p.reject(new Error('已取消'));pending.clear();startWorker();
  slots.fill(null);active=0;clearDetail();history=[];historyAt=-1;bookmarks=[];lastResult=null;view='nodes';resetFilters();$('identity').checked=false;setBusy(false);
  $('error').hidden=true;$('notice').textContent='当前工作区已清空。已保存的工作区仍可恢复。';renderBookmarks();refresh();
}
function nodeLink(n,slot=active){const b=element('button',n.name||'(根)','row-link');b.title=n.name||'(根)';b.onclick=()=>run(()=>inspect(n.id,slot),'正在读取对象证据…');return b;}
function nameCell(row,n,slot=active){const c=cell(row,'');c.append(nodeLink(n,slot),element('span','@'+n.id,'subline'));return c;}
function typeCell(row,n){cell(row,'').append(element('span',n.kind,'type-chip'));}
function groupLink(n,target=active){
  const b=element('button',n.name||'(根)','row-link');b.title=n.name;
  b.onclick=()=>run(async()=>{active=target;view='nodes';$('search').value=n.name;$('kind').value=n.kind;$('min-size').value='';$('reachability').value='all';offset=changeOffset=0;await refresh();});return b;
}
function tableHead(id,labels){const r=element('tr');for(const label of labels)r.append(element('th',label));$(id).replaceChildren(r);}
function emptyRow(body,cols,text='没有匹配的结果。'){const r=element('tr'),c=cell(r,text,'muted');c.colSpan=cols;$(body).append(r);}
async function refresh(){
  clearDetail();lastResult=null;$('table-wrap').hidden=true;$('pager').hidden=true;$('changes-wrap').hidden=true;$('tree-map').hidden=true;$('cycle-heading').hidden=true;$('investigation-summary').hidden=true;enabled('export',false);
  for(const b of document.querySelectorAll('[data-view]')){const yes=b.dataset.view===(view==='cycle'?'cycles':view);b.classList.toggle('active',yes);b.setAttribute('aria-pressed',String(yes));}
  $('identity-row').hidden=!['diff','investigate'].includes(view);$('sort-label').hidden=view!=='nodes';$('kind-label').hidden=!['nodes','diff','investigate','groups'].includes(view);
  $('size-filter').hidden=!['nodes','diff','investigate'].includes(view);$('reachability-filter').hidden=view!=='nodes';
  $('status-filter').hidden=view!=='diff';$('residual-filter').hidden=view!=='investigate';
  $('search-form').hidden=['tree','cycle'].includes(view);
  updateSlots();
  const available=view==='diff'?slots[0]&&slots[1]:view==='investigate'?slots.every(Boolean):slots[active];
  if(!available){$('empty').hidden=false;$('result-count').textContent=view==='investigate'?'请打开 A、B、C 三份快照':view==='diff'?'请打开 A、B 两份快照':'等待分析';updateControls();return;}
  const request=filters();let data;
  if(view==='diff')data=await rpc('diff',{request});
  else if(view==='investigate'){
    data=await rpc('investigate',{request});
    if(changeOffset!==offset){const alternate=await rpc('investigate',{request:{...request,offset:changeOffset}});data.items=alternate.items;}
  }else data=await rpc('query',{slot:active,request:{...request,op:view}});
  lastResult={data,request,slot:active};render(data);updateControls();
}
function render(data){
  $('empty').hidden=true;$('table-wrap').hidden=false;$('pager').hidden=false;$('table-body').replaceChildren();
  const objects=['nodes','tree','cycle'].includes(view);
  const labels=objects?['对象 / ID','类型','浅体积','保留体积','根距离']:
    view==='groups'?['名称','类型','对象数','浅体积合计','最大单对象保留体积']:
    view==='diff'?['名称','类型','数量变化','之前浅体积','之后浅体积','浅体积变化']:
    view==='investigate'?['名称','类型','基线 / 增长 / 清理后','剩余增量','清理后浅体积']:
    ['循环组','对象数','浅体积合计','代表对象'];
  tableHead('table-head',labels);
  const items=['diff','investigate'].includes(view)?data.groups:view==='tree'?data.children.items:data.items;
  for(const n of items){
    const row=element('tr');
    if(objects){
      nameCell(row,n);typeCell(row,n);numeric(row,n.shallow_bytes);numeric(row,n.retained_bytes);numeric(row,n.distance,v=>v==null?'—':String(v));row.dataset.id=n.id;
      if(view==='tree'&&n.dominated_count>0){const b=element('button','展开 '+n.dominated_count+' 项','tree-action');b.onclick=()=>run(async()=>{treeRoot=n.id;offset=0;await refresh();});row.firstChild.append(b);}
    }else if(view==='cycles'){
      const b=element('button','循环 #'+n.cycle_id,'row-link');b.onclick=()=>run(async()=>{cycleId=n.cycle_id;view='cycle';offset=0;await refresh();});cell(row,'').append(b);
      numeric(row,n.count,number);numeric(row,n.shallow_bytes);cell(row,n.sample.map(x=>x.name||'(根)').slice(0,4).join(' · '));
    }else{
      cell(row,'').append(groupLink(n,view==='diff'?(n.after_count>0?1:0):view==='investigate'?2:active));typeCell(row,n);
      if(view==='groups'){numeric(row,n.count,number);numeric(row,n.shallow_bytes);numeric(row,n.max_retained_bytes);}
      if(view==='diff'){numeric(row,n.count_delta,v=>(v>0?'+':'')+number(v));numeric(row,n.before_bytes);numeric(row,n.after_bytes);numeric(row,n.bytes_delta,v=>(v>0?'+':'')+bytes(v)).classList.add(n.bytes_delta>0?'positive':'negative');}
      if(view==='investigate'){cell(row,[n.before_count,n.growth_count,n.cleanup_count].map(number).join(' → '),'number');numeric(row,n.remaining_count,v=>(v>0?'+':'')+number(v));numeric(row,n.cleanup_bytes);}
    }
    $('table-body').append(row);
  }
  if(!items.length)emptyRow('table-body',labels.length);
  const total=totals().main;$('result-count').textContent=number(total)+(objects?' 个对象':view==='cycles'?' 个循环组':' 个分组');
  $('page-info').textContent=items.length?'第 '+(offset+1)+'–'+(offset+items.length)+' 项 / 共 '+number(total)+' 项':'没有更多结果';
  if(view==='tree')renderTree(data);
  if(view==='cycle'){$('cycle-heading').hidden=false;$('cycle-title').textContent='循环 #'+cycleId+' 的成员；循环本身不证明泄漏。';}
  if(['diff','investigate'].includes(view))renderChanges(data);
  $('notice').textContent=view==='investigate'?'基线 A → 增长 B → 清理 C。重点检查新增后仍存活的对象及其持有者。':view==='diff'?'比较 A → B。类型表看浅体积，身份表同时显示保留体积变化。':slots[active].name+' · 点击对象名称查看引用、路径和分配来源。';
}
function renderChanges(data){
  const identity=data.mode!=='aggregate',investigating=view==='investigate';
  $('changes-wrap').hidden=!identity;
  $('identity-result').textContent=!identity?'聚合模式只比较类型、数量和浅体积；确认同一 V8 实例后，才按 ID 匹配对象。':
    investigating?'全堆新出现 '+number(data.created)+' · 清理后消失 '+number(data.released)+' · 仍存在 '+number(data.survivor_count)+'。下方列表应用当前筛选。':
    '新增 '+number(data.added)+' · 消失 '+number(data.removed)+' · 存活 '+number(data.survived)+'；包含自身大小未变的保留体积变化。';
  if(investigating){$('investigation-summary').hidden=false;$('investigation-summary').replaceChildren(element('strong',identity?number(data.total)+' 个匹配的存活候选':'聚合调查'),element('span','　这些结果是持有关系的调查线索，正常缓存与运行时活动也可能存活。'));}
  if(!identity)return;
  $('changes-title').textContent=investigating?'新增后仍存活的对象':'对象 ID 与保留体积变化';
  if(data.excluded_id_count>0)$('identity-result').textContent+=' ⚠ '+number(data.excluded_id_count)+' 个 ID 的类型或名称矛盾，已从身份计数及候选中排除；聚合统计仍包含这些对象。';
  $('changes-description').textContent=investigating?'候选对象在 A 中不存在、在 B 中出现、在 C 中仍存在。点击后检查清理快照中的引用；来源可回查 B。':'按保留体积增量排序。此表独立分页；“不可达”与“对象不存在”含义不同。';
  tableHead('changes-head',investigating?['对象 / ID','类型','清理后浅体积','清理后保留体积']:['对象 / ID','变化','之前浅体积','之后浅体积','保留体积变化']);
  $('changes-body').replaceChildren();
  const records=investigating?data.items:data.changes;
  for(const n of records){
    const r=element('tr');
    if(investigating){nameCell(r,n,2);typeCell(r,n);numeric(r,n.shallow_bytes);numeric(r,n.retained_bytes);}
    else{
      nameCell(r,n,n.status==='removed'?0:1);cell(r,({added:'新增',removed:'消失',resized:'自身大小变化',retention_changed:'保留体积变化'})[n.status]??n.status);
      numeric(r,n.before_bytes,v=>v==null?'不存在':bytes(v));numeric(r,n.after_bytes,v=>v==null?'不存在':bytes(v));
      numeric(r,n.retained_delta,v=>v==null?'不可比较':(v>0?'+':'')+bytes(v)).title='之前：'+bytes(n.before_retained_bytes)+'；之后：'+bytes(n.after_retained_bytes);
    }
    $('changes-body').append(r);
  }
  if(!records.length)emptyRow('changes-body',5);
  $('change-page-info').textContent='第 '+(records.length?changeOffset+1:0)+'–'+(changeOffset+records.length)+' 项 / 共 '+number(totals().changes)+' 项';
}
function renderTree(data){
  $('tree-map').hidden=false;$('tree-breadcrumbs').replaceChildren();
  for(const n of [...data.ancestors].reverse()){const b=element('button',n.name||'(根)','crumb');b.onclick=()=>run(async()=>{treeRoot=n.id;offset=0;await refresh();});$('tree-breadcrumbs').append(b);}
  const svg=$('treemap');svg.replaceChildren();const total=data.node.retained_bytes??0;if(total<=0)return;
  const pieces=data.children.items.map(n=>({name:n.name||'(根)',size:n.retained_bytes??0,node:n}));
  if(data.node.shallow_bytes>0)pieces.push({name:'当前对象自身',size:data.node.shallow_bytes});
  const remaining=total-pieces.reduce((a,p)=>a+p.size,0);if(remaining>0)pieces.push({name:'其余子树',size:remaining});
  let x=0;const palette=['#c9e6d7','#b1d8ca','#d6e7c1','#d4e5e8','#bfe2d8','#e1eacb'];
  pieces.forEach((p,i)=>{
    const width=p.size/total*1000;if(width<=0)return;
    const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');rect.setAttribute('x',String(x));rect.setAttribute('y','0');rect.setAttribute('width',String(width));rect.setAttribute('height','130');rect.setAttribute('fill',palette[i%palette.length]);
    const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=p.name+' · '+bytes(p.size);rect.append(title);
    if(p.node){rect.setAttribute('tabindex','0');rect.setAttribute('role','button');rect.setAttribute('aria-label',p.name+' '+bytes(p.size));const open=()=>run(async()=>{treeRoot=p.node.id;offset=0;await refresh();});rect.onclick=open;rect.onkeydown=e=>{if(e.key==='Enter')open();};}
    svg.append(rect);
    if(width>90){const label=document.createElementNS(svg.namespaceURI,'text');label.setAttribute('x',String(x+12));label.setAttribute('y','35');label.textContent=p.name.slice(0,Math.floor((width-20)/8));svg.append(label);const size=document.createElementNS(svg.namespaceURI,'text');size.setAttribute('x',String(x+12));size.setAttribute('y','58');size.textContent=bytes(p.size);svg.append(size);}
    x+=width;
  });
}
async function inspect(id,slot=active,record=true){
  if(slot!==active&&!['diff','investigate'].includes(view)){active=slot;offset=0;treeRoot=null;if(view==='cycle')view='cycles';await refresh();}
  const n=await rpc('query',{slot,request:{op:'node',id}});active=slot;selected=n;detailOffset=0;updateSlots();
  if(record){history=history.slice(0,historyAt+1);if(history.at(-1)?.id!==id||history.at(-1)?.slot!==slot)history.push({id,slot});historyAt=history.length-1;}
  $('detail').hidden=false;$('detail-name').textContent=n.name||'(根)';$('detail-meta').textContent=['A','B','C'][slot]+' · @'+n.id+' · '+n.kind+' · 浅体积 '+bytes(n.shallow_bytes)+' · 保留体积 '+bytes(n.retained_bytes)+' · 支配者 '+(n.dominator_id??'无');
  for(const r of document.querySelectorAll('#table-body tr'))r.classList.toggle('selected-row',r.dataset.id===id);
  await renderDetail();updateControls();$('detail').scrollIntoView({block:'nearest',behavior:'smooth'});
}
function edgeRow(e,index=null){const r=element('div','','edge-row');r.append(nodeLink(e.source),element('span',(index==null?'':(index+1)+'. ')+e.name+' → ['+e.kind+']'+(e.retaining?'':' · 非保留'),'edge-label'+(e.retaining?'':' weak')),nodeLink(e.target));return r;}
async function renderDetail(){
  if(!selected)return;
  for(const b of document.querySelectorAll('[data-detail]'))b.classList.toggle('active',b.dataset.detail===detailView);
  const descriptions={incoming:'所有指向此对象的引用。灰色边不参与保留体积计算。',outgoing:'此对象引用的其他对象，包括弱引用。',path:'从根出发的一条最短保留路径；并非唯一持有者。',paths:'搜索多条不重复经过同一节点的根路径，最多 5 条、64 层；是否穷尽会明确显示。',dominated:'支配树的直接子节点，按保留体积排序。',source:'快照记录的对象位置与分配调用栈。没有采集到的信息不会推测填充。'};
  $('detail-description').textContent=descriptions[detailView];
  const op=['path','paths','dominated','source'].includes(detailView)?detailView:'references';
  const request={op,id:selected.id,incoming:detailView==='incoming',offset:detailOffset,limit:PAGE};
  if(op==='source'&&active===2&&slots[1]&&$('identity').checked){request.fallback_slot=1;request.same_isolate=true;}
  const data=await rpc('query',{slot:active,request}),container=$('detail-content');container.replaceChildren();
  $('detail-pager').hidden=['path','paths','source'].includes(detailView);
  if(detailView==='source'){
    if(data.location){const l=data.location;container.append(element('p','对象位置：script '+l.script_id+' · '+(l.line+1)+':'+(l.column+1),'small'));}
    if(data.used_fallback)container.append(element('p','当前快照缺少分配记录，以下来源回查自增长快照 B（已确认同一实例）。','small muted'));
    if(!data.frames.length)container.append(element('p','此对象没有分配调用栈。可使用带 --allocation-traces 的采集命令，再复现一次工作负载。','small muted'));
    for(const f of data.frames){const row=element('div','','source-frame');row.append(element('strong',f.name||'(匿名函数)'),element('small',(f.script_name||'(无脚本信息)')+(f.line>0?' : '+f.line+':'+f.column:'')));container.append(row);}
    if(data.allocation_totals)container.append(element('p','此分配位置记录 '+number(data.allocation_totals.count)+' 次 / '+bytes(data.allocation_totals.bytes)+'；这不是当前对象的大小。','small muted'));
    return;
  }
  if(detailView==='paths'){
    const why={path_limit:'达到路径条数上限',depth_limit:'达到搜索深度上限',work_limit:'达到搜索预算',frontier_limit:'分支数量达到上限',unreachable:'对象从根不可达'};
    container.append(element('p',data.complete?'搜索已穷尽，共 '+data.paths.length+' 条路径。':'搜索未穷尽：'+(why[data.stop_reason]??data.stop_reason)+'；已找到 '+data.paths.length+' 条。','small muted'));
    for(const[p,path]of data.paths.entries()){const section=element('div','','path-block');section.append(element('h4','路径 '+(p+1)+' · '+path.length+' 条边'));for(const[i,e]of path.entries())section.append(edgeRow(e,i));container.append(section);}
    return;
  }
  const items=detailView==='path'?data.edges??[]:data.items;
  for(const[i,n]of items.entries()){
    if(detailView==='dominated'){const r=element('div','','edge-row');r.append(nodeLink(n),element('span','@'+n.id,'subline'),element('span',bytes(n.retained_bytes),'number'));container.append(r);}
    else container.append(edgeRow(n,detailView==='path'?i:null));
  }
  if(!items.length)container.append(element('p',detailView==='path'?data.reachable?'当前对象就是根，路径长度为 0。':'当前策略下无法从根到达此对象。':'没有匹配的对象或引用。','small muted'));
  $('detail-page-info').textContent='显示 '+items.length+' 项 / 共 '+number(data.total??items.length)+' 项';enabled('detail-prev',detailOffset>0);enabled('detail-next',detailOffset+PAGE<(data.total??0));
}
function renderBookmarks(){
  const list=$('bookmark-list');list.replaceChildren();if(!bookmarks.length){list.textContent='尚未收藏对象';return;}
  for(const[bindex,b]of bookmarks.entries()){const row=element('div','','bookmark-row');row.append(nodeLink({id:b.id,name:['A','B','C'][b.slot]+' · '+b.name},b.slot));const del=element('button','×','text-button');del.setAttribute('aria-label','移除书签 '+b.name);del.onclick=()=>{bookmarks.splice(bindex,1);renderBookmarks();};row.append(del);list.append(row);}
}
function database(action,value){
  return new Promise((resolve,reject)=>{const open=indexedDB.open('moonheap-workspace',1);open.onupgradeneeded=()=>open.result.createObjectStore('state');open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{const db=open.result,tx=db.transaction('state',action==='get'?'readonly':'readwrite'),store=tx.objectStore('state');const request=action==='get'?store.get('workspace'):action==='put'?store.put(value,'workspace'):store.delete('workspace');let result;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error??new Error('无法保存工作区'));};};
  });
}
async function saveWorkspace(){
  const state={version:2,slots:slots.map(s=>s?{file:s.file,name:s.name}:null),active,view,treeRoot,cycleId,all_groups:$('all-groups').checked,identity:$('identity').checked,max_mib:settings().max_mib,bookmarks,
    filters:Object.fromEntries(['search','kind','order','min-size','reachability','change-status'].map(id=>[id,$(id).value]))};
  await database('put',state);$('notice').textContent='工作区已保存到当前浏览器，包含原始快照、筛选和书签。';
}
async function restoreWorkspace(){
  const started=generation,saved=await database('get');if(started!==generation)throw new Error('已取消');if(!saved||saved.version!==2)throw new Error('没有可恢复的工作区');
  resetFilters();$('max-mib').value=saved.max_mib??256;
  for(let i=0;i<3;i++){if(saved.slots[i])await load(i,new File([saved.slots[i].file],saved.slots[i].name));else{await rpc('close',{slot:i});slots[i]=null;}}
  active=saved.active;view=saved.view;treeRoot=saved.treeRoot??null;cycleId=saved.cycleId??null;$('all-groups').checked=!!saved.all_groups;$('identity').checked=!!saved.identity;bookmarks=saved.bookmarks??[];
  for(const[id,value]of Object.entries(saved.filters??{}))if($(id))$(id).value=value;
  renderBookmarks();await refresh();$('notice').textContent='已恢复本机保存的快照、筛选和书签。';
}
async function exportAll(){
  if(!lastResult)return;let reportView=view;const request={...lastResult.request,format:$('export-format').value,sources:slots.map(s=>s?.name??null),generated_at:new Date().toISOString(),max_rows:100000};
  if(view==='tree'){reportView='dominated';request.id=lastResult.data.node.id;}
  request.view=reportView;
  const data=await rpc('export',{slot:lastResult.slot,request});
  const format=request.format,type={json:'application/json',csv:'text/csv',html:'text/html'}[format];
  const url=URL.createObjectURL(new Blob([data],{type:type+';charset=utf-8'})),a=element('a');a.href=url;a.download='moonheap-'+view+'-report.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  $('notice').textContent='已导出全部匹配结果。报告超过 100000 行时会要求缩小筛选，不会静默截断。';
}
for(const input of document.querySelectorAll('input[type=file]'))input.onchange=()=>{const files=[...input.files];input.value='';if(files.length)loadFiles(Number(input.dataset.slot),files);};
for(const slot of document.querySelectorAll('.slot')){
  slot.ondragover=e=>{e.preventDefault();if(!busy)slot.classList.add('dragging');};slot.ondragleave=()=>slot.classList.remove('dragging');
  slot.ondrop=e=>{e.preventDefault();slot.classList.remove('dragging');loadFiles(Number(slot.id.slice(-1)),e.dataTransfer.files);};
}
for(const b of document.querySelectorAll('.snapshot-name'))b.onclick=()=>run(async()=>{active=Number(b.dataset.slot);treeRoot=null;if(view==='cycle')view='cycles';offset=0;await refresh();});
for(const b of document.querySelectorAll('.close-slot'))b.onclick=()=>run(async()=>{const i=Number(b.dataset.slot);await rpc('close',{slot:i});slots[i]=null;bookmarks=bookmarks.filter(b=>b.slot!==i);history=[];historyAt=-1;$('identity').checked=false;active=Math.max(0,slots.findIndex(Boolean));treeRoot=null;if(view==='cycle')view='cycles';offset=changeOffset=0;renderBookmarks();await refresh();});
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>run(async()=>{view=b.dataset.view;offset=changeOffset=0;await refresh();});
for(const b of document.querySelectorAll('[data-detail]'))b.onclick=()=>run(async()=>{detailView=b.dataset.detail;detailOffset=0;await renderDetail();});
$('search-form').onsubmit=e=>{e.preventDefault();run(async()=>{offset=changeOffset=0;await refresh();});};
for(const id of ['order','kind','identity','min-size','reachability','change-status','all-groups'])$(id).onchange=()=>run(async()=>{offset=changeOffset=0;await refresh();});
$('prev').onclick=()=>run(async()=>{offset=Math.max(0,offset-PAGE);await refresh();});$('next').onclick=()=>run(async()=>{offset+=PAGE;await refresh();});
$('change-prev').onclick=()=>run(async()=>{changeOffset=Math.max(0,changeOffset-PAGE);await refresh();});$('change-next').onclick=()=>run(async()=>{changeOffset+=PAGE;await refresh();});
$('detail-prev').onclick=()=>run(async()=>{detailOffset=Math.max(0,detailOffset-PAGE);await renderDetail();});$('detail-next').onclick=()=>run(async()=>{detailOffset+=PAGE;await renderDetail();});
$('history-back').onclick=()=>run(async()=>{if(historyAt>0){historyAt--;await inspect(history[historyAt].id,history[historyAt].slot,false);}});
$('history-forward').onclick=()=>run(async()=>{if(historyAt<history.length-1){historyAt++;await inspect(history[historyAt].id,history[historyAt].slot,false);}});
$('bookmark').onclick=()=>{if(selected&&!bookmarks.some(b=>b.slot===active&&b.id===selected.id)){bookmarks.push({slot:active,id:selected.id,name:selected.name||'(根)'});renderBookmarks();}};
$('back-cycles').onclick=()=>run(async()=>{view='cycles';offset=0;await refresh();});$('detail-close').onclick=clearDetail;
$('demo').onclick=demo;$('demo-empty').onclick=demo;$('cancel').onclick=reset;$('reset').onclick=reset;
$('save-workspace').onclick=()=>run(saveWorkspace,'正在将原始快照和调查状态保存到本机…');
$('restore-workspace').onclick=()=>run(restoreWorkspace,'正在恢复本机工作区…');
$('clear-saved').onclick=()=>run(async()=>{await database('delete');$('notice').textContent='已删除本浏览器保存的数据，当前分析与原始文件不受影响。';});
$('export').onclick=()=>run(exportAll,'正在生成全部匹配结果的报告…');
$('help').onclick=()=>$('help-dialog').showModal();$('help-close').onclick=()=>$('help-dialog').close();
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();$('search').focus();}if(e.key==='Escape'&&!busy)clearDetail();});
updateSlots();updateControls();renderBookmarks();


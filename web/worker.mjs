import { query_snapshot, diff_snapshots, close_snapshot, begin_snapshot, feed_snapshot, finish_snapshot, abort_snapshot, investigate_snapshots, export_report } from './engine.mjs';
const handles = [null,null,null];
let queue = Promise.resolve();
function unwrap(raw) { const r=JSON.parse(raw); if(!r.ok) throw Object.assign(new Error(r.error.message),{code:r.error.code}); return r.data; }
function required(slot) { if(!Number.isInteger(slot)||slot<0||slot>2||handles[slot]==null) throw new Error('请先打开所需快照'); return handles[slot]; }
async function dispatch({id,method,slot,file,request={},options={}}) {
  if(method==='load') {
    const limit=(options.max_mib??256)*1048576;
    if(file.size>limit) throw new Error('文件超过设置的读取上限');
    if(handles[slot]!=null) close_snapshot(handles[slot]); handles[slot]=null;
    const decoder=unwrap(begin_snapshot(JSON.stringify(options)));
    const reader=file.stream().getReader(), utf8=new TextDecoder('utf-8',{fatal:true});
    let read=0, last=0;
    try {
      while(true) {
        const {done,value}=await reader.read(); if(done) break;
        read+=value.byteLength; if(read>limit) throw new Error('文件超过读取上限');
        let text; try{text=utf8.decode(value,{stream:true});}catch{throw new Error('快照必须是有效 UTF-8 文本');}
        unwrap(feed_snapshot(decoder,text));
        if(performance.now()-last>80) { self.postMessage({id,progress:{stage:'read',read,total:file.size}}); last=performance.now(); }
      }
      let tail;try{tail=utf8.decode();}catch{throw new Error('快照 UTF-8 数据不完整');}
      if(tail) unwrap(feed_snapshot(decoder,tail));
      self.postMessage({id,progress:{stage:'analyze',read,total:file.size}});
      await new Promise(resolve=>setTimeout(resolve,0));
      handles[slot]=unwrap(finish_snapshot(decoder));
      return unwrap(query_snapshot(handles[slot],'{}'));
    } finally { abort_snapshot(decoder); reader.releaseLock(); }
  }
  if(method==='close') {if(handles[slot]!=null) close_snapshot(handles[slot]);handles[slot]=null;return null;}
  if(method==='query') {
    if(request.fallback_slot!=null) request.fallback_handle=required(request.fallback_slot);
    return unwrap(query_snapshot(required(slot),JSON.stringify(request)));
  }
  if(method==='diff') return unwrap(diff_snapshots(required(0),required(1),JSON.stringify(request)));
  if(method==='investigate') return unwrap(investigate_snapshots(required(0),required(1),required(2),JSON.stringify(request)));
  if(method==='export') {
    if(request.view==='diff') request.after_handle=required(1);
    if(request.view==='investigate') {request.growth_handle=required(1);request.cleanup_handle=required(2);}
    const first=['diff','investigate'].includes(request.view)?0:slot;
    return unwrap(export_report(required(first),JSON.stringify(request)));
  }
  throw new Error('未知操作');
}
self.onmessage=({data})=>{queue=queue.then(async()=>{try{self.postMessage({id:data.id,data:await dispatch(data)});}catch(e){self.postMessage({id:data.id,error:{code:e.code??'invalid_input',message:e.message}});}});};


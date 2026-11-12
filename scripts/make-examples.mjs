import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const folder = fileURLToPath(new URL('../examples/', import.meta.url));
mkdirSync(folder, { recursive: true });
function snapshot(count) {
  const strings = ['', '(GC roots)', 'Window', 'PhotoCache', 'Array', 'PhotoEntry', 'PixelBuffer', 'window', 'photoCache', 'entries', 'pixels', 'ImageMetadata', 'metadata'];
  const records = [
    { type: 0, name: 0, id: 1, size: 0, edges: [[1, 1, 1], [2, 7, 2]] },
    { type: 0, name: 1, id: 3, size: 0, edges: [[1, 7, 2]] },
    { type: 1, name: 2, id: 5, size: 96, edges: [[0, 8, 3], [0, 12, 5]] },
    { type: 1, name: 3, id: 7, size: 48, edges: [[0, 9, 4]] },
    { type: 2, name: 4, id: 9, size: 32 + count * 8, edges: [] },
    { type: 1, name: 11, id: 11, size: 128, edges: [] }
  ];
  for (let i = 0; i < count; i++) {
    const index = records.length;
    records[4].edges.push([3, i, index]);
    records.push({ type: 1, name: 5, id: 13 + i * 4, size: 64, edges: [[0, 10, index + 1], [0, 12, 5]] });
    records.push({ type: 1, name: 6, id: 15 + i * 4, size: 32768, edges: [] });
  }
  return JSON.stringify({
    snapshot: { meta: { node_fields: ['type','name','id','self_size','edge_count'], node_types: [['synthetic','object','array'],'string','number','number','number'], edge_fields: ['type','name_or_index','to_node'], edge_types: [['property','internal','shortcut','element','weak'],'string_or_number','node'] }, node_count: records.length, edge_count: records.reduce((a,n) => a + n.edges.length, 0) },
    nodes: records.flatMap(n => [n.type, n.name, n.id, n.size, n.edges.length]),
    edges: records.flatMap(n => n.edges.flatMap(([type,name,to]) => [type,name,to * 5])), strings
  }) + '\n';
}
for (const [name, count] of [['before',2],['growth',18],['cleanup',0],['residual',4]]) writeFileSync(folder + name + '.heapsnapshot', snapshot(count));
console.log('Wrote deterministic synthetic cache examples.');


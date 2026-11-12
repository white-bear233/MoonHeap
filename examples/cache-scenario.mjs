// Example for "moonheap capture": 8 retained objects per workload iteration.
// Leave one cache entry during cleanup to demonstrate a surviving candidate.
class MoonHeapCapturedEntry {
  constructor(i) { this.label = 'entry-' + i; this.payload = new Array(512).fill(i); }
}
export function setup() { return globalThis.moonheapExampleCache = { entries: [] }; }
export function exercise(context, iteration) {
  for (let i = 0; i < 8; i++) context.entries.push(new MoonHeapCapturedEntry(iteration * 8 + i));
}
export function cleanup(context) { context.entries.splice(1); }


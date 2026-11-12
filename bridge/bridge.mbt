///|
let inspector : @heap.Inspector = @heap.Inspector::new()

///|
#export_name("load_snapshot")
pub fn load_snapshot(input : String) -> String {
  @heap.success(@json.to_json(inspector.open(input))) catch {
    e => @heap.failure(e)
  }
}

///|
#export_name("query_snapshot")
pub fn query_snapshot(handle : Int32, query : String) -> String {
  @heap.success(inspector.query(handle, query)) catch {
    e => @heap.failure(e)
  }
}

///|
#export_name("diff_snapshots")
pub fn diff_snapshots(
  before : Int32,
  after : Int32,
  options : String,
) -> String {
  @heap.success(inspector.diff(before, after, options)) catch {
    e => @heap.failure(e)
  }
}

///|
#export_name("close_snapshot")
pub fn close_snapshot(handle : Int32) -> Unit {
  inspector.close(handle)
}

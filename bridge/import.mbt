///|
let decoders : Map[Int32, @heap.Decoder] = Map([])

///|
let serial : Array[Int32] = [0]

///|
#export_name("export_report")
pub fn export_report(handle : Int32, request : String) -> String {
  @heap.success(@json.to_json(inspector.export_report(handle, request))) catch {
    e => @heap.failure(e)
  }
}

///|
fn current_decoder(handle : Int32) -> @heap.Decoder raise @heap.HeapError {
  match decoders.get(handle) {
    Some(d) => d
    None => raise @heap.HeapError::NotFound("decoder handle")
  }
}

///|
#export_name("begin_snapshot")
pub fn begin_snapshot(options : String) -> String {
  try {
    guard decoders.is_empty() else {
      raise @heap.HeapError::Limit("an import is already active")
    }
    guard serial[0] < 2147483647 else {
      raise @heap.HeapError::Limit("decoder handle limit")
    }
    let d = @heap.decoder_with_options(options)
    serial[0] += 1
    decoders[serial[0]] = d
    @heap.success(@json.to_json(serial[0]))
  } catch {
    e => @heap.failure(e)
  }
}

///|
#export_name("feed_snapshot")
pub fn feed_snapshot(handle : Int32, chunk : String) -> String {
  try {
    let d = current_decoder(handle)
    d.feed(chunk)
    @heap.success(@json.to_json(d.characters_read()))
  } catch {
    e => {
      decoders.remove(handle)
      @heap.failure(e)
    }
  }
}

///|
#export_name("finish_snapshot")
pub fn finish_snapshot(handle : Int32) -> String {
  try {
    let d = current_decoder(handle)
    decoders.remove(handle)
    @heap.success(@json.to_json(inspector.accept(d.finish())))
  } catch {
    e => @heap.failure(e)
  }
}

///|
#export_name("abort_snapshot")
pub fn abort_snapshot(handle : Int32) -> Unit {
  decoders.remove(handle)
}

///|
#export_name("investigate_snapshots")
pub fn investigate_snapshots(
  before : Int32,
  growth : Int32,
  cleanup : Int32,
  options : String,
) -> String {
  @heap.success(inspector.investigate(before, growth, cleanup, options)) catch {
    e => @heap.failure(e)
  }
}

///|
/// Incremental V8 reader: large numeric arrays never become JSON syntax trees.
struct Decoder {
  limits : Limits
  mut state : Int32
  mut key : String
  seen : Map[String, Bool]
  metadata : Map[String, Json]
  nodes : Array[UInt64]
  edges : Array[UInt64]
  strings : Array[String]
  token : StringBuilder
  mut token_length : Int32
  mut token_kind : Int32
  mut quoted : Bool
  mut escaped : Bool
  mut depth : Int32
  mut number : UInt64
  mut digits : Int32
  mut chars : Int32
  mut failed : Bool
  mut finished : Bool
}

///|
pub fn Decoder::new(
  limits~ : Limits = Limits::default(),
) -> Decoder raise HeapError {
  validate_limits(limits)
  {
    limits,
    state: 0,
    key: "",
    seen: Map([]),
    metadata: Map([]),
    nodes: [],
    edges: [],
    strings: [],
    token: StringBuilder(),
    token_length: 0,
    token_kind: 0,
    quoted: false,
    escaped: false,
    depth: 0,
    number: 0UL,
    digits: 0,
    chars: 0,
    failed: false,
    finished: false,
  }
}

///|
fn whitespace(c : Char) -> Bool {
  c == ' ' || c == '\n' || c == '\r' || c == '\t'
}

///|
fn Decoder::write(self : Decoder, c : Char) -> Unit raise HeapError {
  guard self.token_length < 16777216 else {
    raise Limit("single metadata value or string exceeds 16 Mi characters")
  }
  self.token.write_char(c)
  self.token_length += 1
}

///|
fn Decoder::start_token(
  self : Decoder,
  kind : Int32,
  c : Char,
) -> Unit raise HeapError {
  self.token.reset()
  self.token_length = 0
  self.token_kind = kind
  self.quoted = c == '"'
  self.escaped = false
  self.depth = if c == '{' || c == '[' { 1 } else { 0 }
  self.write(c)
  self.state = 9
}

///|
fn Decoder::complete_token(self : Decoder) -> Unit raise HeapError {
  let value = @json.parse(
    self.token.to_string(),
    reject_duplicate_keys=true,
    preserve_number_repr=true,
    max_nesting_depth=64,
  ) catch {
    _ => raise Invalid("invalid JSON field or string")
  }
  if self.token_kind == 1 {
    let key = text(value, "top-level key")
    guard !self.seen.contains(key) else {
      raise Invalid("duplicate JSON key: \{key}")
    }
    self.seen[key] = true
    self.key = key
    self.state = 3
  } else if self.token_kind == 2 {
    guard self.strings.length() < self.limits.max_strings else {
      raise Limit("string table budget exceeded")
    }
    self.strings.push(text(value, "string table"))
    self.state = 7
  } else {
    if self.key == "snapshot" ||
      self.key == "locations" ||
      self.key == "trace_function_infos" ||
      self.key == "trace_tree" {
      self.metadata[self.key] = value
    }
    self.state = 8
  }
  self.token.reset()
}

///|
fn Decoder::complete_number(self : Decoder) -> Unit raise HeapError {
  let target = if self.key == "nodes" { self.nodes } else { self.edges }
  let count = if self.key == "nodes" {
    self.limits.max_nodes
  } else {
    self.limits.max_edges
  }
  guard target.length().to_int64() < count.to_int64() * 32L else {
    raise Limit("numeric record budget exceeded")
  }
  target.push(self.number)
  self.digits = 0
  self.number = 0UL
  self.state = 7
}

///|
fn Decoder::consume(self : Decoder, c : Char) -> Unit raise HeapError {
  let mut again = true
  while again {
    again = false
    match self.state {
      0 => {
        if whitespace(c) {
          continue
        }
        guard c == '{' else { raise Invalid("snapshot must be a JSON object") }
        self.state = 1
      }
      1 | 2 => {
        if whitespace(c) {
          continue
        }
        if c == '}' && self.state == 1 {
          self.state = 10
        } else {
          guard c == '"' else { raise Invalid("expected JSON field name") }
          self.start_token(1, c)
        }
      }
      3 => {
        if whitespace(c) {
          continue
        }
        guard c == ':' else { raise Invalid("expected colon") }
        self.state = 4
      }
      4 => {
        if whitespace(c) {
          continue
        }
        if self.key == "nodes" || self.key == "edges" || self.key == "strings" {
          guard c == '[' else { raise Invalid("\{self.key}: expected array") }
          self.state = 5
        } else {
          guard c != ',' && c != '}' else {
            raise Invalid("missing JSON value")
          }
          self.start_token(3, c)
        }
      }
      5 | 6 => {
        if whitespace(c) {
          continue
        }
        if c == ']' && self.state == 5 {
          self.state = 8
        } else if self.key == "strings" {
          guard c == '"' else { raise Invalid("string table: expected string") }
          self.start_token(2, c)
        } else {
          guard c >= '0' && c <= '9' else {
            raise Invalid("\{self.key}: expected nonnegative decimal integer")
          }
          self.digits = 0
          self.number = 0UL
          self.state = 11
          again = true
        }
      }
      7 => {
        if whitespace(c) {
          continue
        }
        if c == ',' {
          self.state = 6
        } else if c == ']' {
          self.state = 8
        } else {
          raise Invalid("expected array comma or closing bracket")
        }
      }
      8 => {
        if whitespace(c) {
          continue
        }
        if c == ',' {
          self.state = 2
        } else if c == '}' {
          self.state = 10
        } else {
          raise Invalid("expected object comma or closing brace")
        }
      }
      9 => {
        if !self.quoted &&
          self.depth == 0 &&
          (whitespace(c) || c == ',' || c == '}') {
          self.complete_token()
          again = true
          continue
        }
        self.write(c)
        if self.quoted {
          if self.escaped {
            self.escaped = false
          } else if c == '\\' {
            self.escaped = true
          } else if c == '"' {
            self.quoted = false
            if self.depth == 0 {
              self.complete_token()
            }
          }
        } else if c == '"' {
          self.quoted = true
        } else if c == '{' || c == '[' {
          self.depth += 1
          guard self.depth <= 64 else {
            raise Limit("metadata nesting exceeds 64")
          }
        } else if c == '}' || c == ']' {
          self.depth -= 1
          guard self.depth >= 0 else { raise Invalid("unbalanced metadata") }
          if self.depth == 0 {
            self.complete_token()
          }
        }
      }
      10 => if !whitespace(c) { raise Invalid("data after top-level object") }
      11 =>
        if c >= '0' && c <= '9' {
          let digit = (c.to_int() - 48).to_uint64()
          guard !(self.digits > 0 && self.number == 0UL) else {
            raise Invalid("leading zero in integer")
          }
          guard self.number <= (18446744073709551615UL - digit) / 10UL else {
            raise Invalid("integer overflow")
          }
          self.number = self.number * 10UL + digit
          self.digits += 1
        } else {
          self.complete_number()
          again = true
        }
      _ => raise Invalid("invalid decoder state")
    }
  }
}

///|
/// Feed any text chunk. UTF-8 byte decoding belongs to the host.
pub fn Decoder::feed(self : Decoder, chunk : String) -> Unit raise HeapError {
  guard !self.failed && !self.finished else {
    raise Invalid("decoder is closed or failed")
  }
  errdefer {
    self.failed = true
  }
  guard chunk.length() <= self.limits.max_chars - self.chars else {
    raise Limit("input exceeds max_chars")
  }
  self.chars += chunk.length()
  for c in chunk.iter() {
    self.consume(c)
  }
}

///|
pub fn Decoder::finish(self : Decoder) -> Snapshot raise HeapError {
  guard !self.failed && !self.finished else {
    raise Invalid("decoder is closed or failed")
  }
  self.finished = true
  guard self.state == 10 else { raise Invalid("truncated JSON snapshot") }
  for key in ["snapshot", "nodes", "edges", "strings"] {
    guard self.seen.contains(key) else {
      raise Invalid("missing field: \{key}")
    }
  }
  parse_parts(self.metadata, self.nodes, self.edges, self.strings, self.limits)
}

///|
pub fn Decoder::characters_read(self : Decoder) -> Int32 {
  self.chars
}

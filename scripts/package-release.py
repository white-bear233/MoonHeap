"""Build a source + precompiled Node/browser distribution from tracked files."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
prefix = f"MoonHeap-v{version}"
destination = root / "dist" / f"{prefix}.zip"
tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
files = sorted(set(filter(None, tracked)) | {"dist/moonheap.mjs", "web/engine.mjs"})
destination.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in files:
        source = (root / name).resolve()
        if not source.is_relative_to(root) or not source.is_file():
            raise RuntimeError(f"Missing or out-of-tree release input: {name}")
        archive.write(source, f"{prefix}/{name}")
digest = hashlib.sha256(destination.read_bytes()).hexdigest()
destination.with_suffix(".zip.sha256").write_text(f"{digest}  {destination.name}\n", encoding="utf-8")
print(destination)
print(f"{len(files)} files; {destination.stat().st_size} bytes; SHA-256 {digest}")


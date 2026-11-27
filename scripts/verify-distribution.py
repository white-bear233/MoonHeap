"""Verify the release archive in a fresh directory, using only packaged files."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
archive = root / "dist" / f"MoonHeap-v{version}.zip"
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
assert digest == archive.with_suffix(".zip.sha256").read_text().split()[0], "ZIP digest mismatch"
with tempfile.TemporaryDirectory(prefix="moonheap-distribution-") as directory:
    destination = Path(directory).resolve()
    with zipfile.ZipFile(archive) as package:
        for name in package.namelist():
            assert (destination / name).resolve().is_relative_to(destination), "ZIP path escapes destination"
        package.extractall(destination)
    checkout = destination / f"MoonHeap-v{version}"

    def cli(*args, code=0):
        run = subprocess.run(["node", "bin/moonheap.mjs", *args], cwd=checkout, capture_output=True,
                             text=True, encoding="utf-8", timeout=60)
        assert run.returncode == code, run.stderr or run.stdout
        return run.stdout

    assert cli("--version").strip() == version
    summary = json.loads(cli("summary", "examples/shared.heapsnapshot", "--json"))["data"]
    assert summary["reachable_bytes"] == 60 and summary["nodes"] == 4
    evidence = json.loads(cli("explain", "examples/shared.heapsnapshot", "--id", "7", "--json"))["data"]
    assert evidence["complete"] and len(evidence["root_paths"]["paths"]) == 2
    inputs = ["examples/before.heapsnapshot", "examples/growth.heapsnapshot", "examples/residual.heapsnapshot"]
    args = ["check", *inputs, "--same-isolate", "--query", "PhotoEntry", "--kind", "object", "--json"]
    assert json.loads(cli(*args, code=6))["data"]["matched_survivors"] == 2
    assert json.loads(cli(*args, "--max-survivors", "2"))["data"]["passed"]
    report = cli("report", "examples/shared.heapsnapshot", "--view", "explain", "--id", "7", "--format", "html")
    assert "直接持有者" in report and "<script" not in report
    assert (checkout / "web/engine.mjs").is_file()
print(json.dumps({"version": version, "sha256": digest, "distribution": "passed"}))

import json
import subprocess
import time
import urllib.request
from pathlib import Path

EXE = Path(r"C:\Program Files\cpolar\cpolar.exe")
OUT = Path(__file__).resolve().parent / "out" / "cpolar-debug.txt"
lines = []

# help
for args in (["help"], ["http", "--help"], ["version"]):
    try:
        r = subprocess.run([str(EXE), *args], capture_output=True, text=True, timeout=10)
        lines.append(f"=== {' '.join(args)} code={r.returncode} ===")
        lines.append((r.stdout or "")[:2000])
        lines.append((r.stderr or "")[:1000])
    except Exception as e:
        lines.append(f"=== {' '.join(args)} ERR {e} ===")

# probe local APIs while asking user to have tunnel? start short tunnel
log = Path(__file__).resolve().parent / "out" / "logs" / "cpolar-debug.log"
log.parent.mkdir(parents=True, exist_ok=True)
err = log.with_suffix(".err.log")
for p in (log, err):
    if p.exists():
        p.unlink()

proc = subprocess.Popen(
    [str(EXE), "http", "5173"],
    stdout=log.open("w", encoding="utf-8", errors="replace"),
    stderr=err.open("w", encoding="utf-8", errors="replace"),
    creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
)
lines.append(f"started pid={proc.pid}")

apis = [
    "http://127.0.0.1:4040/api/tunnels",
    "http://127.0.0.1:4040/api/status",
    "http://127.0.0.1:4040/status",
    "http://127.0.0.1:4040/",
    "http://127.0.0.1:9200/api/tunnels",
    "http://localhost:4040/api/tunnels",
]

found = None
for i in range(20):
    time.sleep(1)
    for api in apis:
        try:
            with urllib.request.urlopen(api, timeout=2) as resp:
                body = resp.read(4000).decode("utf-8", "replace")
                lines.append(f"[{i}s] OK {api} -> {body[:500]}")
                if "http" in body.lower():
                    found = body
                    break
        except Exception as e:
            if i in (0, 5, 10, 19):
                lines.append(f"[{i}s] fail {api}: {type(e).__name__}")
    if found:
        break
    # also peek logs
    for p in (log, err):
        if p.exists() and p.stat().st_size:
            lines.append(f"log {p.name}: {p.read_text(encoding='utf-8', errors='replace')[:800]}")

try:
    proc.terminate()
except Exception:
    pass

OUT.write_text("\n".join(lines), encoding="utf-8")
print(OUT.read_text(encoding="utf-8")[:4000])

import re
import subprocess
import time
import urllib.request
from pathlib import Path

EXE = Path(r"C:\Program Files\cpolar\cpolar.exe")
OUTDIR = Path(__file__).resolve().parent / "out"
OUTDIR.mkdir(exist_ok=True)

subprocess.run("taskkill /F /IM cpolar.exe", shell=True, capture_output=True)

# Start with a real new console window (minimized), NO stdout redirect
# CREATE_NEW_CONSOLE=0x00000010, CREATE_NO_WINDOW would hide output
CREATE_NEW_CONSOLE = 0x00000010
proc = subprocess.Popen(
    [str(EXE), "http", "5173"],
    creationflags=CREATE_NEW_CONSOLE,
)
print("pid", proc.pid)

# give it time to open UI
time.sleep(5)

notes = []
# dump interesting local endpoints + static js urls
for path in [
    "/",
    "/api/tunnels",
    "/api/tunnels/",
    "/static/js/angular.js",
]:
    try:
        with urllib.request.urlopen("http://127.0.0.1:4040" + path, timeout=3) as r:
            body = r.read()
            notes.append(f"{path} status=200 len={len(body)} ctype={r.headers.get('Content-Type')}")
            if path.startswith("/api") or path == "/":
                text = body.decode("utf-8", "replace")
                notes.append(text[:1200])
                # find script srcs
                for m in re.findall(r'src="([^"]+)"', text):
                    notes.append("script " + m)
    except Exception as e:
        notes.append(f"{path} ERR {e}")

# try to find app js
try:
    with urllib.request.urlopen("http://127.0.0.1:4040/", timeout=3) as r:
        html = r.read().decode("utf-8", "replace")
    for m in re.findall(r'src="(/static/js/[^"]+)"', html):
        if "angular" in m or "jquery" in m or "bootstrap" in m or "highlight" in m or "vkbeautify" in m or "timeago" in m:
            continue
        try:
            with urllib.request.urlopen("http://127.0.0.1:4040" + m, timeout=3) as r2:
                js = r2.read().decode("utf-8", "replace")
            notes.append(f"JS {m} len={len(js)}")
            # search api paths
            apis = sorted(set(re.findall(r"[\"'](/api/[^\"']+)[\"']", js)))
            notes.append("apis=" + ",".join(apis[:40]))
            urls = re.findall(r"https://[a-zA-Z0-9.-]*cpolar[a-zA-Z0-9.-]*", js)
            notes.append("urls_in_js=" + ",".join(urls[:20]))
        except Exception as e:
            notes.append(f"JS {m} ERR {e}")
except Exception as e:
    notes.append(f"html ERR {e}")

# wait more and re-check api
for i in range(15):
    time.sleep(2)
    try:
        with urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels", timeout=2) as r:
            body = r.read().decode("utf-8", "replace")
        notes.append(f"poll {i} len={len(body)} {body[:500]!r}")
        if body.strip():
            break
    except Exception as e:
        notes.append(f"poll {i} ERR {e}")
    if proc.poll() is not None:
        notes.append(f"process exited code={proc.returncode}")
        break

(OUTDIR / "cpolar-ui.txt").write_text("\n".join(notes), encoding="utf-8")
print("\n".join(notes[-40:]))
# leave cpolar running briefly for manual check? kill
subprocess.run("taskkill /F /IM cpolar.exe", shell=True, capture_output=True)

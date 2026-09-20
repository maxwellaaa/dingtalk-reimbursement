import json
import re
import subprocess
import time
import urllib.request
from pathlib import Path

EXE = Path(r"C:\Program Files\cpolar\cpolar.exe")
OUT = Path(__file__).resolve().parent / "out" / "cpolar-tunnel-wait.txt"
notes = []

subprocess.run("taskkill /F /IM cpolar.exe", shell=True, capture_output=True)
time.sleep(1)

# network probe to cpolar cloud
for host in ("dashboard.cpolar.com", "www.cpolar.com", "cpolar.com"):
    try:
        with urllib.request.urlopen(f"https://{host}/", timeout=8) as r:
            notes.append(f"net {host} -> {r.status}")
    except Exception as e:
        notes.append(f"net {host} FAIL {e}")

CREATE_NEW_CONSOLE = 0x00000010
proc = subprocess.Popen([str(EXE), "http", "5173"], creationflags=CREATE_NEW_CONSOLE)
notes.append(f"started {proc.pid}")

public = None
for i in range(40):
    time.sleep(1)
    try:
        with urllib.request.urlopen("http://127.0.0.1:4040/", timeout=2) as r:
            html = r.read().decode("utf-8", "replace")
        m = re.search(r'window\.data\s*=\s*JSON\.parse\("(.+?)"\);', html)
        if not m:
            notes.append(f"{i}s no window.data")
            continue
        raw = m.group(1).encode("utf-8").decode("unicode_escape")
        data = json.loads(raw)
        tunnels = (data.get("UiState") or {}).get("Tunnels") or []
        notes.append(f"{i}s tunnels={len(tunnels)} data={json.dumps(data, ensure_ascii=False)[:400]}")
        for t in tunnels:
            # typical fields: PublicUrl / URL / Addr
            for k, v in (t.items() if isinstance(t, dict) else []):
                if isinstance(v, str) and v.startswith("http"):
                    public = v
            if isinstance(t, dict):
                for k in ("PublicUrl", "public_url", "Url", "URL", "Addr", "addr"):
                    if t.get(k) and str(t.get(k)).startswith("http"):
                        public = str(t.get(k))
        if public:
            break
    except Exception as e:
        notes.append(f"{i}s err {e}")
    if proc.poll() is not None:
        notes.append(f"exited {proc.returncode}")
        break

notes.append(f"PUBLIC={public}")
OUT.write_text("\n".join(notes), encoding="utf-8")
print("\n".join(notes[-25:]))
subprocess.run("taskkill /F /IM cpolar.exe", shell=True, capture_output=True)

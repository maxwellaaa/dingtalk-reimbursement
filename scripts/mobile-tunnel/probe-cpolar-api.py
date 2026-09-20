import json
import subprocess
import time
import urllib.request
from pathlib import Path

EXE = Path(r"C:\Program Files\cpolar\cpolar.exe")
# kill previous?
subprocess.run(["taskkill", "/F", "/IM", "cpolar.exe"], capture_output=True)

proc = subprocess.Popen(
    [str(EXE), "http", "5173"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    creationflags=0x08000000,  # CREATE_NO_WINDOW
)

public = None
raws = []
for i in range(30):
    time.sleep(1)
    try:
        with urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels", timeout=2) as resp:
            body = resp.read().decode("utf-8", "replace")
            raws.append(f"{i}s len={len(body)} body={body[:1000]!r}")
            if body.strip():
                try:
                    data = json.loads(body)
                    raws.append(json.dumps(data, ensure_ascii=False, indent=2)[:2000])
                    tunnels = data.get("tunnels") or data.get("Tunnels") or []
                    if isinstance(data, list):
                        tunnels = data
                    for t in tunnels:
                        if isinstance(t, dict):
                            for k in ("public_url", "PublicUrl", "url", "URL", "addr"):
                                u = t.get(k)
                                if u and str(u).startswith("http"):
                                    public = str(u)
                                    break
                        if public:
                            break
                except json.JSONDecodeError:
                    # maybe plain text urls
                    import re
                    m = re.search(r"https://[^\s\"']+", body)
                    if m:
                        public = m.group(0)
        if public:
            break
    except Exception as e:
        raws.append(f"{i}s err={e}")

# also try inspect html for urls
try:
    with urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels", timeout=2) as resp:
        raws.append("FINAL=" + resp.read().decode("utf-8", "replace")[:3000])
except Exception as e:
    raws.append(f"FINAL err={e}")

out = Path(__file__).resolve().parent / "out" / "cpolar-api.txt"
out.write_text("\n".join(raws) + f"\nPUBLIC={public}\n", encoding="utf-8")
print(out.read_text(encoding="utf-8")[-2500:])
print("PUBLIC=", public)
try:
    proc.terminate()
except Exception:
    pass

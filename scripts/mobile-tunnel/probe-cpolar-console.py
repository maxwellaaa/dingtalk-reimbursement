import re
import subprocess
import time
import urllib.request
from pathlib import Path

EXE = Path(r"C:\Program Files\cpolar\cpolar.exe")
OUT = Path(__file__).resolve().parent / "out" / "cpolar-console.txt"
log = Path(__file__).resolve().parent / "out" / "logs" / "cpolar-console.log"
log.parent.mkdir(parents=True, exist_ok=True)
if log.exists():
    log.unlink()

subprocess.run(["taskkill", "/F", "/IM", "cpolar.exe"], capture_output=True)

# Start in NEW console so cpolar can print; also ask it to log if supported
# Try several flag variants
cmds = [
    [str(EXE), "http", "5173", "-log=stdout"],
    [str(EXE), "http", "5173"],
]

# Use cmd.exe start /min to keep a console, redirect to file
cmd = f'"{EXE}" http 5173 > "{log}" 2>&1'
proc = subprocess.Popen(
    f'start "cpolar-tunnel" /MIN cmd /c "{EXE}" http 5173 ^> "{log}" 2^>^&1',
    shell=True,
)
# start returns immediately; find cpolar
time.sleep(2)

lines = [f"cmd={cmd}"]
public = None
for i in range(25):
    time.sleep(1)
    text = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
    size = log.stat().st_size if log.exists() else 0
    lines.append(f"{i}s log_size={size}")
    if text.strip():
        lines.append(text[:1500])
        m = re.findall(r"https://[a-zA-Z0-9.-]+\.(?:cpolar\.[a-z.]+|ngrok[^\s]*)", text)
        if m:
            public = m[-1]
            break
    # scrape UI html for urls
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:4040/",
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html"},
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            html = resp.read().decode("utf-8", "replace")
        # fetch js that might list tunnels
        for path in ("/api/tunnels", "/api/tunnels/", "/http/in", "/inspect/http"):
            try:
                with urllib.request.urlopen("http://127.0.0.1:4040" + path, timeout=2) as r2:
                    b = r2.read().decode("utf-8", "replace")
                    if b.strip():
                        lines.append(f"API {path}: {b[:800]}")
                        m = re.findall(r"https://[^\s\"'<>]+", b)
                        https = [x for x in m if "cpolar" in x or "ngrok" in x]
                        if https:
                            public = https[0]
                            break
            except Exception:
                pass
        if public:
            break
    except Exception as e:
        lines.append(f"{i}s ui err={e}")

lines.append(f"PUBLIC={public}")
OUT.write_text("\n".join(lines), encoding="utf-8")
print(OUT.read_text(encoding="utf-8")[-3000:])
subprocess.run(["taskkill", "/F", "/IM", "cpolar.exe"], capture_output=True)

import os
import subprocess
from pathlib import Path

exe = Path(r"C:\Program Files\cpolar\cpolar.exe")
out = Path(__file__).resolve().parent / "out" / "cpolar-ver.txt"
lines = []
if exe.is_file():
    lines.append(f"EXE={exe}")
    try:
        r = subprocess.run([str(exe), "version"], capture_output=True, text=True, timeout=15)
        lines.append("STDOUT=" + (r.stdout or "").strip())
        lines.append("STDERR=" + (r.stderr or "").strip())
        lines.append(f"CODE={r.returncode}")
    except Exception as e:
        lines.append(f"ERR={e}")
else:
    lines.append("EXE missing")

cfg = Path.home() / ".cpolar"
lines.append(f"CFG_DIR={cfg} exists={cfg.is_dir()}")
if cfg.is_dir():
    for p in cfg.iterdir():
        lines.append(f"  {p.name}")
        if p.suffix in (".yml", ".yaml") and p.is_file():
            text = p.read_text(encoding="utf-8", errors="replace")
            # redact token
            redacted = []
            for line in text.splitlines():
                if "authtoken" in line.lower() or "token" in line.lower():
                    redacted.append(line.split(":")[0] + ": ***REDACTED***")
                else:
                    redacted.append(line)
            lines.append("\n".join(redacted))

out.write_text("\n".join(lines), encoding="utf-8")
print(out.read_text(encoding="utf-8"))

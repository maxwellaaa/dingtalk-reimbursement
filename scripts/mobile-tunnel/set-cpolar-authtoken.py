"""Set cpolar authtoken without writing token into repo files. Usage: python set-cpolar-authtoken.py <token>"""
import subprocess
import sys
from pathlib import Path

EXE = Path(r"C:\Program Files\cpolar\cpolar.exe")

def main():
    if len(sys.argv) < 2:
        print("Usage: python set-cpolar-authtoken.py <authtoken>")
        return 1
    token = sys.argv[1].strip()
    if not EXE.is_file():
        print(f"cpolar not found: {EXE}")
        return 1
    r = subprocess.run([str(EXE), "authtoken", token], capture_output=True, text=True, timeout=30)
    print((r.stdout or "").strip())
    if r.stderr:
        print((r.stderr or "").strip())
    print(f"exit={r.returncode}")
    return r.returncode

if __name__ == "__main__":
    raise SystemExit(main())

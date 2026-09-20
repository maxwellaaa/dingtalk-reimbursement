import os
from pathlib import Path

cands = []
checks = [
    Path.home() / "cpolar" / "cpolar.exe",
    Path(os.environ.get("LOCALAPPDATA", "")) / "cpolar" / "cpolar.exe",
    Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "cpolar" / "cpolar.exe",
    Path(r"C:\cpolar\cpolar.exe"),
    Path(r"C:\Program Files\cpolar\cpolar.exe"),
    Path(r"C:\Program Files (x86)\cpolar\cpolar.exe"),
    Path.home() / "Downloads" / "cpolar.exe",
    Path.home() / "Desktop" / "cpolar.exe",
    Path.home() / "Downloads" / "cpolar" / "cpolar.exe",
]

home = Path.home()
try:
    for name in os.listdir(home):
        if "cpolar" not in name.lower():
            continue
        p = home / name
        checks.append(p / "cpolar.exe")
        if p.is_dir():
            for root, _dirs, files in os.walk(p):
                if "cpolar.exe" in files:
                    cands.append(str(Path(root) / "cpolar.exe"))
except OSError:
    pass

for c in checks:
    try:
        if c.is_file():
            cands.append(str(c))
    except OSError:
        pass

for p in os.environ.get("PATH", "").split(";"):
    f = Path(p.strip().strip('"')) / "cpolar.exe"
    if f.is_file():
        cands.append(str(f))

try:
    import winreg

    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            key = winreg.OpenKey(
                hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\cpolar.exe"
            )
            val, _ = winreg.QueryValueEx(key, None)
            if val:
                cands.append(val)
        except OSError:
            pass
except Exception:
    pass

# Start Menu shortcuts
for base in (
    Path(os.environ.get("APPDATA", "")) / r"Microsoft\Windows\Start Menu\Programs",
    Path(os.environ.get("ProgramData", "")) / r"Microsoft\Windows\Start Menu\Programs",
):
    if not base.is_dir():
        continue
    for lnk in base.rglob("*cpolar*"):
        cands.append(str(lnk))

uniq = list(dict.fromkeys([c for c in cands if c]))
out = Path(__file__).resolve().parent / "out" / "cpolar-find.txt"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text("\n".join(uniq) if uniq else "NONE", encoding="utf-8")
print("FOUND:" if uniq else "NONE")
for c in uniq:
    print(c)

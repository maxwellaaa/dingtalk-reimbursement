import subprocess
import time
import urllib.request
import json
from pathlib import Path

# kill port 3000
try:
    out = subprocess.check_output(
        'netstat -ano | findstr :3000 | findstr LISTENING',
        shell=True, text=True, errors='replace'
    )
    pids = set()
    for line in out.splitlines():
        parts = line.split()
        if parts:
            pids.add(parts[-1])
    for pid in pids:
        subprocess.run(f'taskkill /F /PID {pid}', shell=True, capture_output=True)
        print('killed', pid)
except Exception as e:
    print('no listener or', e)

time.sleep(1)
backend = Path(r'F:\obsidian知识库\cursor\dingtalk-reimbursement\backend')
subprocess.Popen(
    'npm run dev',
    cwd=str(backend),
    shell=True,
    creationflags=subprocess.CREATE_NEW_CONSOLE,
)
print('started backend')

for i in range(20):
    time.sleep(1)
    try:
        with urllib.request.urlopen('http://127.0.0.1:3000/api/auth/config', timeout=3) as r:
            data = json.loads(r.read().decode())
            print('config', data)
            break
    except Exception as e:
        if i == 19:
            print('fail', e)
        pass

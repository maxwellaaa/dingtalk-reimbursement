import json
import urllib.request
import urllib.error
from pathlib import Path

def load_env(path):
    env = {}
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip()
    return env

env = load_env(r'F:\obsidian知识库\cursor\dingtalk-reimbursement\backend\.env')
out = []

# local health / config
for url in ('http://127.0.0.1:3000/api/health', 'http://127.0.0.1:3000/api/auth/config'):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            out.append(f'{url} -> {r.read().decode()[:300]}')
    except Exception as e:
        out.append(f'{url} FAIL {e}')

# tunnel
fu = env.get('FRONTEND_URL', '').rstrip('/')
if fu:
    for path in ('/api/health', '/h5/'):
        try:
            with urllib.request.urlopen(fu + path, timeout=8) as r:
                out.append(f'{fu}{path} -> {r.status} len={len(r.read())}')
        except Exception as e:
            out.append(f'{fu}{path} FAIL {e}')

# dingtalk gettoken
appkey = env.get('DINGTALK_APP_KEY', '')
secret = env.get('DINGTALK_APP_SECRET', '')
corp = env.get('DINGTALK_CORP_ID', '')
out.append(f'corpId={corp}')
out.append(f'appKey={appkey[:8]}... len_secret={len(secret)}')

url = f'https://oapi.dingtalk.com/gettoken?appkey={urllib.parse.quote(appkey)}&appsecret={urllib.parse.quote(secret)}'
import urllib.parse
url = f'https://oapi.dingtalk.com/gettoken?appkey={urllib.parse.quote(appkey)}&appsecret={urllib.parse.quote(secret)}'
try:
    # ignore SSL issues in some corp networks
    import ssl
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(url, timeout=15, context=ctx) as r:
            body = r.read().decode()
    except ssl.SSLError:
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(url, timeout=15, context=ctx) as r:
            body = r.read().decode()
    data = json.loads(body)
    out.append(f'gettoken errcode={data.get("errcode")} errmsg={data.get("errmsg")} has_token={bool(data.get("access_token"))}')
except Exception as e:
    out.append(f'gettoken FAIL {e}')

Path(r'F:\obsidian知识库\cursor\dingtalk-reimbursement\scripts\mobile-tunnel\out\login-diag.txt').write_text('\n'.join(out), encoding='utf-8')
print('\n'.join(out))

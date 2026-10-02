# Shared prelude for provider metadata probes, embedded by Rust before the provider script.
# No user turn is sent. One deadline covers startup and all requests; every child is reaped.
import base64, json, os, re, signal, subprocess, sys, threading, urllib.request
from pathlib import Path

children = []

def start(args, **kwargs):
    p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, text=True, start_new_session=True, **kwargs)
    children.append(p)
    return p

def send(p, value):
    p.stdin.write(json.dumps(value) + '\n')
    p.stdin.flush()

def receive(p, match):
    for line in p.stdout:
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if match(value):
            return value
    raise RuntimeError('Provider exited before answering')

def rpc(p, rid, method, params):
    send(p, {'id': rid, 'method': method, 'params': params})
    value = receive(p, lambda v: v.get('id') == rid and 'method' not in v)
    if 'error' in value:
        raise RuntimeError('Provider rejected metadata request')
    return value['result']

def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return {}

def http_server(bin, cwd):
    password = os.urandom(24).hex()
    p = start([bin, 'serve', '--hostname', '127.0.0.1', '--port', '0'], cwd=cwd,
              env=dict(os.environ, OPENCODE_SERVER_PASSWORD=password))
    for line in p.stdout:
        url = re.search(r'https?://[\w.:\[\]-]+', line)
        if url and 'listening' in line:
            break
    else:
        raise RuntimeError('Provider server did not start')
    def drain():
        for _ in p.stdout:
            pass
    threading.Thread(target=drain, daemon=True).start()
    auth = 'Basic ' + base64.b64encode(('opencode:' + password).encode()).decode()
    def get(path):
        request = urllib.request.Request(url[0] + path, headers={'Authorization': auth})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)
    return get

def deadline(*_):
    raise TimeoutError('Provider metadata timed out')

def main():
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(15)
    try:
        print(json.dumps(probe(*sys.argv[1:])))
    except Exception:
        # Don't forward configuration, auth details or CLI output to the webview.
        print('{}')
    finally:
        signal.alarm(0)
        for p in children:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            p.wait()

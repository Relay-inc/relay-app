import json, subprocess, sys, os
S = sys.argv[1]
env = {k: v for k, v in os.environ.items() if k != 'ANTHROPIC_API_KEY'}
p = subprocess.Popen(['claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--model', 'haiku', '--permission-mode', 'default', '--mcp-config', f'{S}/mcp-allow.json',
    '--permission-prompt-tool', 'mcp__vaultperm__approve', '-n', 'spike2-multiturn'],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env)
def say(t):
    p.stdin.write(json.dumps({'type': 'user', 'message': {'role': 'user', 'content': t}}) + '\n'); p.stdin.flush()
    for line in p.stdout:
        e = json.loads(line)
        if e.get('type') == 'system' and e.get('subtype') == 'init': print('session', e['session_id'], 'AskUserQuestion in tools:', 'AskUserQuestion' in e.get('tools', []))
        if e.get('type') == 'assistant':
            for c in e['message']['content']:
                if c.get('type') == 'tool_use': print('  tool:', c['name'])
        if e.get('type') == 'result':
            print('  result:', repr(e.get('result'))[:160]); return e['session_id']
sid = say('Onthoud het getal 4172. Antwoord enkel met: genoteerd.')
say('Welk getal vroeg ik je te onthouden? Antwoord enkel met het getal.')
say('Gebruik de AskUserQuestion-tool om me te vragen of ik thee of koffie wil (twee opties: Thee, Koffie). Zeg daarna in één zin wat ik koos.')
p.stdin.close(); p.wait(timeout=60)
open(f'{S}/sid.txt', 'w').write(sid)

def probe(bin, cwd, _):
    env = dict(os.environ)
    env.pop('ANTHROPIC_API_KEY', None)
    p = start([bin, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
               '--settings', '{"disableAllHooks":true}', '--no-session-persistence'], cwd=cwd, env=env)
    send(p, {'type': 'control_request', 'request_id': 'init', 'request': {'subtype': 'initialize'}})
    data = receive(p, lambda v: v.get('type') == 'control_response')['response']['response']
    return data.get('commands', [])

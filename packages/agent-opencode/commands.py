def probe(bin, cwd, _):
    commands = http_server(bin, cwd)('/command')
    return [{'name': c['name'], 'description': c.get('description') or '',
             'argumentHint': ' '.join(c.get('hints') or [])} for c in commands]

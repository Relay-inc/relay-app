def probe(bin, cwd, _):
    p = start([bin, 'app-server'], cwd=cwd)
    rpc(p, 0, 'initialize', {'clientInfo': {'name': 'relay', 'version': '0.1.0'}})
    send(p, {'method': 'initialized'})
    result = rpc(p, 1, 'skills/list', {'cwds': [cwd], 'forceReload': True})
    commands = [{'name': 'compact', 'description': 'Compact the conversation context'},
                {'name': 'review', 'description': 'Review uncommitted changes'}]
    names = {c['name'] for c in commands}
    for group in result.get('data', []):
        for skill in group.get('skills', []):
            name = 'skill:' + skill['name']
            if skill.get('enabled', True) and name not in names:
                names.add(name)
                commands.append({'name': name, 'description': skill.get('description') or '', 'argumentHint': '<instructions>'})
    return commands

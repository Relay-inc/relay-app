def probe(bin, cwd, _):
    p = start([bin, '--mode', 'rpc', '--no-session'], cwd=cwd)
    send(p, {'type': 'get_commands', 'id': 'commands'})
    result = receive(p, lambda v: v.get('id') == 'commands')
    if not result.get('success'):
        return []
    commands = [{'name': 'compact', 'description': 'Compact the conversation context', 'argumentHint': '[instructions]'}]
    commands.extend({'name': c['name'], 'description': c.get('description') or ''}
                    for c in result['data'].get('commands', []) if c['name'] != 'compact')
    return commands

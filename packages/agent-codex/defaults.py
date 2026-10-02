def probe(bin, cwd, selected):
    p = start([bin, 'app-server'], cwd=cwd)
    rpc(p, 0, 'initialize', {'clientInfo': {'name': 'relay', 'version': '0.1.0'}})
    send(p, {'method': 'initialized'})
    config = rpc(p, 1, 'config/read', {'includeLayers': False, 'cwd': cwd})['config']
    models, cursor, rid = [], None, 2
    while True:
        result = rpc(p, rid, 'model/list', {'limit': 100, 'cursor': cursor})
        models.extend(result['data'])
        cursor, rid = result.get('nextCursor'), rid + 1
        if not cursor:
            break
    default = config.get('model') or next((m['model'] for m in models if m.get('isDefault')), None)
    model = next((m for m in models if m['model'] == (selected or default)), {})
    return {'model': default, 'effort': config.get('model_reasoning_effort') or model.get('defaultReasoningEffort')}

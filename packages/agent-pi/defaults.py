def probe(bin, cwd, selected):
    p = start([bin, '--mode', 'rpc', '--no-session'], cwd=cwd)
    send(p, {'type': 'get_state', 'id': 'default'})
    state = receive(p, lambda v: v.get('id') == 'default')['data']
    model = state.get('model') or {}
    default = model.get('provider', '') + '/' + model.get('id', '') if model else None
    if selected and selected != default:
        # A --model override is transient; set_model would persist the user's settings.
        p = start([bin, '--mode', 'rpc', '--no-session', '--model', selected], cwd=cwd)
        send(p, {'type': 'get_state', 'id': 'selected'})
        state = receive(p, lambda v: v.get('id') == 'selected')['data']
    return {'model': default, 'effort': state.get('thinkingLevel')}

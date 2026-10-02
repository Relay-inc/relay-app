def probe(bin, cwd, selected):
    get = http_server(bin, cwd)
    config, catalog, agents = get('/config'), get('/config/providers'), get('/agent')
    agent = next((a for a in agents if a['name'] == config.get('default_agent', 'build')), {})
    own = agent.get('model') or {}
    default = (own['providerID'] + '/' + own['modelID']) if own else config.get('model')
    providers = {p['id']: p for p in catalog.get('providers', [])}
    if not default:
        state = Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state'))) / 'opencode/model.json'
        recent = read_json(state).get('recent', [])
        default = next((m['providerID'] + '/' + m['modelID'] for m in recent
                        if m.get('modelID') in providers.get(m.get('providerID'), {}).get('models', {})), None)
    if not default:
        configured = config.get('provider') or {}
        provider = next((p for p in providers if not configured or p in configured), None)
        mid = catalog.get('default', {}).get(provider)
        default = provider + '/' + mid if provider and mid else None
    # Without a variant OpenCode uses the model/provider's base options, not the first variant.
    effort = None
    if default:
        provider, mid = (selected or default).split('/', 1)
        options = config.get('provider', {}).get(provider, {}).get('models', {}).get(mid, {}).get('options', {})
        effort = options.get('reasoningEffort') or 'base'
        if own and own.get('providerID') == provider and own.get('modelID') == mid:
            effort = agent.get('variant') or effort
    return {'model': default, 'effort': effort}

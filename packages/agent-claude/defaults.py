# Claude's initialize catalog resolves aliases/account defaults without a model request.
# Effort precedence: https://code.claude.com/docs/en/model-config#adjust-effort-level

def resolve(settings, catalog, selected, environ):
    merged = {}
    for setting in settings:
        merged.update(setting)
    configured = environ.get('ANTHROPIC_MODEL') or merged.get('model') or 'default'
    def entry(value):
        exact = next((m for m in catalog if value in (m.get('value'), m.get('resolvedModel'))), None)
        return exact or next((m for m in catalog if value in ('fable', 'opus', 'sonnet', 'haiku')
                             and m.get('resolvedModel', '').startswith('claude-' + value + '-')), {})
    default = entry(configured).get('resolvedModel') or (configured if configured != 'default' else None)
    active = entry(selected or configured)
    model = active.get('resolvedModel') or selected or default
    effort = None
    if active.get('supportsEffort'):
        effort = 'medium' if model in ('claude-opus-5-5', 'claude-sonnet-5-5') else 'xhigh' if model == 'claude-opus-4-7' else 'high'
        for index, setting in enumerate(settings):
            per_model = setting.get('modelSettings', {}).get(model, {}).get('effortLevel')
            legacy = setting.get('effortLevel')
            if index == 0 and model in ('claude-opus-5-5', 'claude-sonnet-5-5'):
                legacy = None
            effort = per_model or legacy or effort
        env_effort = environ.get('CLAUDE_CODE_EFFORT_LEVEL')
        if env_effort and env_effort != 'auto':
            effort = env_effort
        levels = ['low', 'medium', 'high', 'xhigh', 'max']
        supported = active.get('supportedEffortLevels', levels)
        cap = merged.get('maxEffortLevel')
        if effort in levels:
            limit = min(levels.index(effort), levels.index(cap) if cap in levels else 4)
            effort = next((v for v in reversed(levels[:limit + 1]) if v in supported), None)
    elif active:
        effort = 'off'
    return {'model': default, 'effort': effort}

def probe(bin, cwd, selected):
    env = dict(os.environ)
    env.pop('ANTHROPIC_API_KEY', None)
    p = start([bin, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
               '--settings', '{"disableAllHooks":true}', '--no-session-persistence'], cwd=cwd, env=env)
    send(p, {'type': 'control_request', 'request_id': 'init', 'request': {'subtype': 'initialize'}})
    data = receive(p, lambda v: v.get('type') == 'control_response')['response']['response']
    home = Path(os.environ.get('CLAUDE_CONFIG_DIR', str(Path.home() / '.claude')))
    settings = [read_json(home / 'settings.json'), read_json(Path(cwd) / '.claude/settings.json'),
                read_json(Path(cwd) / '.claude/settings.local.json'),
                read_json('/Library/Application Support/ClaudeCode/managed-settings.json')]
    return resolve(settings, data.get('models', []), selected, os.environ)

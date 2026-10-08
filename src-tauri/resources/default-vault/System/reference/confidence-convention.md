# Confidence Flagging Convention

Referenced by research skills and agents. Not auto-loaded.

## Levels

| Level | Criteria | Presentation |
|-------|----------|-------------|
| **HIGH** | Primary source verified (official docs, code inspection, API response, direct observation) | State as fact |
| **MEDIUM** | Multiple secondary sources agree, or reasonable inference from observed patterns | "Based on {source}..." |
| **LOW** | Single unverified source, training data only, extrapolation from partial evidence | Flag explicitly: "[LOW] needs validation" |

## Inline format

```
[HIGH] The auth middleware uses JWT with RS256 (verified in src/middleware/auth.ts:23)
[MEDIUM] Based on package.json and tsconfig, the project targets Node 20+ (no explicit engine field)
[LOW] The deployment likely uses AWS Lambda, needs validation against infra config
```

## Source hierarchy

Highest confidence first:

1. **Codebase:** actual source files, configs, tests
2. **Official documentation:** framework and library docs, API references
3. **Multiple secondary sources** that agree
4. **Single secondary source**
5. **Training data or general knowledge:** no specific source

## Aggregate confidence

For research summaries covering multiple findings:

- **Overall confidence** = lowest-confidence finding that materially affects the conclusion.
- 8 HIGH findings and 1 LOW finding that does not change the recommendation: overall stays HIGH.
- 1 LOW finding that undermines the core conclusion: overall drops to LOW.
- Always name which findings are LOW.

## Valid result: "Couldn't determine"

"Couldn't determine with confidence" is a legitimate outcome. Report what was searched, why it was inconclusive, and what would resolve it (a specific file to check, person to ask, test to run).

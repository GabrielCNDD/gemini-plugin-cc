---
description: Check Gemini runtime readiness, verify GEMINI_API_KEY, and optionally set a default model
argument-hint: '[--model <model>]'
allowed-tools: Bash(node:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json $ARGUMENTS
```

Output rules:
- Present the final setup output to the user.
- Preserve readiness, API key status, selected default model, and next-step guidance.

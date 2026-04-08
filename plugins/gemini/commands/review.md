---
description: Run a Gemini second-opinion code or strategy review from local git state
argument-hint: '[--wait|--background] [--base <ref>] [--scope <path>] [--model <model>] [--effort <none|minimal|low|medium|high|xhigh>] [focus ...]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" review $ARGUMENTS`

Present the full command output to the user. Do not summarize or condense it.

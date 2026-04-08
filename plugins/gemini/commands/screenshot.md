---
description: Analyze screenshot or image files with Gemini multimodal input
argument-hint: '[--wait|--background] [--model <model>] [--image <path> ...] [analysis prompt]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" screenshot $ARGUMENTS`

Present the full command output to the user. Do not summarize or condense it.

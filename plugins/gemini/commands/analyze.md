---
description: Send text and optional local image files to Gemini for multimodal analysis
argument-hint: '[--wait|--background] [--model <model>] [--image <path> ...] [--effort <none|minimal|low|medium|high|xhigh>] [prompt]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task $ARGUMENTS`

Present the full command output to the user. Do not summarize or condense it.

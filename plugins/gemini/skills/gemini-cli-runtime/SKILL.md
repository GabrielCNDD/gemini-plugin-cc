---
name: gemini-cli-runtime
description: Internal helper contract for calling the gemini-companion runtime from Claude Code
user-invocable: false
---

# Gemini Runtime

Use this skill only inside the `gemini:gemini-rescue` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task "<raw arguments>"`

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.
- Prefer the helper over hand-rolled `git` commands or any other Bash activity.
- Do not call `setup`, `review`, `status`, `result`, or `cancel` from `gemini:gemini-rescue`.
- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.
- Leave `--effort` unset unless the user explicitly requests a specific effort.
- Leave model unset by default. Add `--model` only when the user explicitly asks for one.

Command selection:
- Use exactly one `task` invocation per rescue handoff.
- If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control only. Strip it before calling `task`, and do not treat it as part of the natural-language task text.
- If the forwarded request includes `--model`, pass it through to `task`.
- If the forwarded request includes `--effort`, pass it through to `task`.
- `--effort`: accepted values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`.

Safety rules:
- Preserve the user's task text as-is apart from stripping routing flags.
- Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own.
- Return the stdout of the `task` command exactly as-is.
- If the Bash call fails or Gemini cannot be invoked, return nothing.

# Gemini Plugin for Claude Code

A Claude Code plugin that lets you run Google Gemini from slash commands, with a Codex-style companion runtime.

## What it does

- Multimodal analysis: send text plus local image files to Gemini.
- Bulk content processing: run large prompt payloads or long-form analysis tasks through the companion runtime.
- Second-opinion review: run code/strategy review from your git working tree or branch diff.
- Rescue delegation: route implementation/investigation work to a thin Gemini rescue subagent.
- Background jobs: start long Gemini runs and check them later with status/result commands.
- Screenshot analysis: inspect one or more screenshots with Gemini vision input.

## Available commands

- `/gemini:setup`
  - Verify runtime and `GEMINI_API_KEY`, optionally set default model.
  - Example: `/gemini:setup --model gemini-2.5-pro`
- `/gemini:analyze`
  - Run general multimodal tasks.
  - Example: `/gemini:analyze --image ./tmp/screen.png "Find UX issues in this flow"`
- `/gemini:review`
  - Send git diff context to Gemini for a second-opinion review.
  - Example: `/gemini:review --base main --scope src "Focus on regressions"`
- `/gemini:rescue`
  - Delegate a larger task to the `gemini-rescue` subagent.
  - Example: `/gemini:rescue --model gemini-2.5-pro "Refactor this module and explain tradeoffs"`
- `/gemini:screenshot`
  - Analyze screenshots/images directly.
  - Example: `/gemini:screenshot --image ./tmp/ui.png "Identify layout and accessibility issues"`
- `/gemini:status`
  - Check active/recent jobs and inspect a specific job.
  - Example: `/gemini:status` or `/gemini:status <job-id> --wait`

## Installation

From Claude Code:

1. Add local marketplace/repo source:

```bash
/plugin marketplace add /Users/gabrielc/CND-OS/gemini-plugin-cc
```

2. Install plugin:

```bash
/plugin install gemini
```

## Configuration

Set `GEMINI_API_KEY` in your project `.env.local` (or shell environment used by Claude Code):

```bash
GEMINI_API_KEY=your_key_here
```

Then run:

```bash
/gemini:setup
```

## Models

- `gemini-2.5-flash` (default, free-tier friendly)
- `gemini-2.5-pro`
- `gemini-3.1-pro-preview`

You can override per command:

```bash
/gemini:analyze --model gemini-2.5-pro "Deep analysis prompt"
```

#!/usr/bin/env node

import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 180000;
const VALID_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

function usage() {
  console.log(
    [
      "Usage:",
      "  node scripts/gemini-companion.mjs setup [--model <model>] [--json]",
      "  node scripts/gemini-companion.mjs task [--wait|--background] [--model <model>] [--image <path> ...] [--effort <none|minimal|low|medium|high|xhigh>] [--timeout-ms <ms>] [--json] [prompt]",
      "  node scripts/gemini-companion.mjs review [--wait|--background] [--base <ref>] [--scope <path>] [--model <model>] [--effort <none|minimal|low|medium|high|xhigh>] [--timeout-ms <ms>] [--json] [focus text]",
      "  node scripts/gemini-companion.mjs screenshot [--wait|--background] [--model <model>] [--image <path> ...] [--timeout-ms <ms>] [--json] [analysis prompt]",
      "  node scripts/gemini-companion.mjs status [job-id] [--wait] [--timeout-ms <ms>] [--all] [--json]",
      "  node scripts/gemini-companion.mjs result [job-id] [--json]",
      "  node scripts/gemini-companion.mjs cancel [job-id] [--json]"
    ].join("\n")
  );
}

function splitRawArgumentString(raw) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return [];
  }
  const matches = text.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\S+/g) ?? [];
  return matches.map((token) => {
    if (
      (token.startsWith("\"") && token.endsWith("\"")) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [single] = argv;
    if (!single || !single.trim()) {
      return [];
    }
    return splitRawArgumentString(single);
  }
  return argv;
}

function parseArgs(argv, config = {}) {
  const args = normalizeArgv(argv);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const valueOptions = new Set(config.valueOptions ?? []);
  const multiValueOptions = new Set(config.multiValueOptions ?? []);
  const options = {};
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const eqIndex = token.indexOf("=");
    const key = token.slice(2, eqIndex >= 0 ? eqIndex : undefined);
    const valueInToken = eqIndex >= 0 ? token.slice(eqIndex + 1) : undefined;

    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }

    if (valueOptions.has(key) || multiValueOptions.has(key)) {
      const nextValue = valueInToken !== undefined ? valueInToken : args[i + 1];
      if (nextValue === undefined || nextValue.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      if (valueInToken === undefined) {
        i += 1;
      }
      if (multiValueOptions.has(key)) {
        options[key] = options[key] ?? [];
        options[key].push(nextValue);
      } else {
        options[key] = nextValue;
      }
      continue;
    }

    positionals.push(token);
  }

  return { options, positionals };
}

function output(value, asJson = false) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === "string") {
    process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function getWorkspaceRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8"
  });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return cwd;
}

function getStatePaths(cwd) {
  const workspaceRoot = getWorkspaceRoot(cwd);
  const root = path.join(workspaceRoot, ".claude", "gemini-plugin-state");
  const jobsDir = path.join(root, "jobs");
  const configFile = path.join(root, "config.json");
  return { workspaceRoot, root, jobsDir, configFile };
}

function ensureStateDirs(cwd) {
  const paths = getStatePaths(cwd);
  fs.mkdirSync(paths.jobsDir, { recursive: true });
  return paths;
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

function generateJobId(prefix = "gemini") {
  const rand = Math.random().toString(36).slice(2, 8);
  const stamp = Date.now().toString(36);
  return `${prefix}-${stamp}-${rand}`;
}

function getConfig(cwd) {
  const { configFile } = ensureStateDirs(cwd);
  return readJsonFile(configFile, { defaultModel: DEFAULT_MODEL });
}

function setConfig(cwd, patch) {
  const { configFile } = ensureStateDirs(cwd);
  const config = getConfig(cwd);
  const next = { ...config, ...patch };
  writeJsonFile(configFile, next);
  return next;
}

function getJobPath(cwd, jobId) {
  const { jobsDir } = ensureStateDirs(cwd);
  return path.join(jobsDir, `${jobId}.json`);
}

function saveJob(cwd, job) {
  writeJsonFile(getJobPath(cwd, job.id), job);
}

function loadJob(cwd, jobId) {
  return readJsonFile(getJobPath(cwd, jobId), null);
}

function listJobs(cwd) {
  const { jobsDir } = ensureStateDirs(cwd);
  const files = fs.existsSync(jobsDir) ? fs.readdirSync(jobsDir) : [];
  return files
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJsonFile(path.join(jobsDir, name), null))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.createdAt ?? 0) - Date.parse(a.createdAt ?? 0));
}

function requireApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error("GEMINI_API_KEY is missing. Add it to your .env.local and restart Claude Code.");
  }
  return apiKey.trim();
}

function normalizeEffort(effort) {
  if (effort == null) {
    return null;
  }
  const normalized = String(effort).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!VALID_EFFORTS.has(normalized)) {
    throw new Error(
      `Unsupported effort \"${effort}\". Use one of: none, minimal, low, medium, high, xhigh.`
    );
  }
  return normalized;
}

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    default:
      return "application/octet-stream";
  }
}

function buildImagePart(filePath, cwd) {
  const resolved = path.resolve(cwd, filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Image file not found: ${filePath}`);
  }
  const bytes = fs.readFileSync(resolved);
  return {
    inline_data: {
      mime_type: detectMimeType(resolved),
      data: bytes.toString("base64")
    }
  };
}

function readStdinIfPiped() {
  if (process.stdin.isTTY) {
    return "";
  }
  return fs.readFileSync(0, "utf8");
}

function buildUserParts({ prompt, imagePaths, cwd, effort }) {
  const parts = [];
  if (prompt && prompt.trim()) {
    parts.push({ text: prompt.trim() });
  }
  for (const imagePath of imagePaths ?? []) {
    parts.push(buildImagePart(imagePath, cwd));
  }
  if (effort) {
    parts.unshift({ text: `Reasoning effort request: ${effort}.` });
  }
  if (parts.length === 0) {
    throw new Error("No prompt or image input provided.");
  }
  return parts;
}

async function generateContent({ model, parts, timeoutMs }) {
  const apiKey = requireApiKey();
  const endpoint = `${API_ROOT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts
          }
        ]
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `Gemini API request failed with HTTP ${response.status}.`;
      throw new Error(message);
    }

    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const first = candidates[0];
    const responseParts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
    const text = responseParts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();

    if (!text) {
      const blockReason = payload?.promptFeedback?.blockReason;
      if (blockReason) {
        throw new Error(`Gemini returned no text output. Block reason: ${blockReason}`);
      }
      throw new Error("Gemini returned no text output.");
    }

    return {
      model,
      text,
      raw: payload
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Gemini request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args.join(" ")} failed.`);
  }
  return result.stdout;
}

function collectWorkingTreeDiff(cwd, scopePath = null) {
  const statusArgs = ["status", "--short", "--untracked-files=all"];
  const stagedArgs = ["diff", "--cached", "--no-color"];
  const unstagedArgs = ["diff", "--no-color"];

  if (scopePath) {
    statusArgs.push("--", scopePath);
    stagedArgs.push("--", scopePath);
    unstagedArgs.push("--", scopePath);
  }

  const status = runGit(statusArgs, cwd).trim();
  const staged = runGit(stagedArgs, cwd);
  const unstaged = runGit(unstagedArgs, cwd);
  const hasAny = Boolean(status || staged.trim() || unstaged.trim());
  if (!hasAny) {
    if (scopePath) {
      throw new Error(`No local changes found for review in scope: ${scopePath}`);
    }
    throw new Error("No local changes found for review.");
  }
  return [
    "# Git status",
    status || "(empty)",
    "",
    "# Staged diff",
    staged || "(empty)",
    "",
    "# Unstaged diff",
    unstaged || "(empty)"
  ].join("\n");
}

function collectBranchDiff(cwd, base, scopePath = null) {
  if (!base) {
    throw new Error("Branch review requires --base <ref>.");
  }
  const args = ["diff", "--no-color", `${base}...HEAD`];
  if (scopePath) {
    args.push("--", scopePath);
  }
  const diff = runGit(args, cwd);
  if (!diff.trim()) {
    if (scopePath) {
      throw new Error(`No diff found between ${base}...HEAD in scope: ${scopePath}`);
    }
    throw new Error(`No diff found between ${base}...HEAD.`);
  }
  return diff;
}

function buildReviewPrompt({ focusText, diffText, scopeLabel }) {
  const focus = focusText?.trim() ? `Additional focus: ${focusText.trim()}` : "Additional focus: none";
  return [
    "You are providing a second-opinion review for a code change.",
    "Return findings ordered by severity: critical, high, medium, low.",
    "For each finding include file path, rough location, impact, and a concrete fix.",
    "Call out regressions, missing tests, architecture risks, and unclear assumptions.",
    focus,
    `Review scope: ${scopeLabel}`,
    "",
    "Diff:",
    diffText
  ].join("\n");
}

function createJob(cwd, payload) {
  const now = nowIso();
  const job = {
    id: generateJobId(payload.kind || "job"),
    kind: payload.kind || "task",
    status: "queued",
    model: payload.model,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    pid: null,
    request: payload,
    result: null,
    error: null,
    cancelled: false
  };
  saveJob(cwd, job);
  return job;
}

function summarize(text, max = 100) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}

function buildTaskRequestFromArgs(argv, cwd) {
  const { options, positionals } = parseArgs(argv, {
    booleanOptions: ["background", "wait", "json"],
    valueOptions: ["model", "effort", "timeout-ms"],
    multiValueOptions: ["image"]
  });

  const config = getConfig(cwd);
  const model = options.model || config.defaultModel || DEFAULT_MODEL;
  const effort = normalizeEffort(options.effort);
  const prompt = `${positionals.join(" ")} ${readStdinIfPiped()}`.trim();
  const imagePaths = options.image ?? [];
  const timeoutMs = Number(options["timeout-ms"] || DEFAULT_TIMEOUT_MS);

  return {
    options,
    request: {
      kind: "task",
      cwd,
      model,
      prompt,
      imagePaths,
      effort,
      timeoutMs,
      summary: summarize(prompt || imagePaths.join(" ") || "Gemini task")
    }
  };
}

function buildScreenshotRequestFromArgs(argv, cwd) {
  const { options, positionals } = parseArgs(argv, {
    booleanOptions: ["background", "wait", "json"],
    valueOptions: ["model", "timeout-ms"],
    multiValueOptions: ["image"]
  });

  const config = getConfig(cwd);
  const model = options.model || config.defaultModel || DEFAULT_MODEL;
  const prompt = positionals.join(" ").trim() || "Analyze these screenshots and explain key findings, issues, and recommendations.";
  const imagePaths = options.image ?? [];
  if (!imagePaths.length) {
    throw new Error("screenshot requires at least one --image <path>.");
  }

  return {
    options,
    request: {
      kind: "screenshot",
      cwd,
      model,
      prompt,
      imagePaths,
      effort: null,
      timeoutMs: Number(options["timeout-ms"] || DEFAULT_TIMEOUT_MS),
      summary: summarize(`screenshot: ${prompt}`)
    }
  };
}

function buildReviewRequestFromArgs(argv, cwd) {
  const { options, positionals } = parseArgs(argv, {
    booleanOptions: ["background", "wait", "json"],
    valueOptions: ["base", "scope", "model", "effort", "timeout-ms"]
  });

  const scopePath = options.scope ? String(options.scope).trim() : null;

  const diffText =
    options.base
      ? collectBranchDiff(cwd, options.base, scopePath)
      : collectWorkingTreeDiff(cwd, scopePath);

  const focusText = positionals.join(" ").trim();
  const config = getConfig(cwd);
  const model = options.model || config.defaultModel || DEFAULT_MODEL;
  const effort = normalizeEffort(options.effort);
  const scopeLabel = options.base
    ? `${options.base}...HEAD${scopePath ? ` (path: ${scopePath})` : ""}`
    : `working-tree${scopePath ? ` (path: ${scopePath})` : ""}`;

  const prompt = buildReviewPrompt({
    focusText,
    diffText,
    scopeLabel
  });

  return {
    options,
    request: {
      kind: "review",
      cwd,
      model,
      prompt,
      imagePaths: [],
      effort,
      timeoutMs: Number(options["timeout-ms"] || DEFAULT_TIMEOUT_MS),
      summary: summarize(
        `review${options.base ? ` ${options.base}...HEAD` : " working-tree"}${scopePath ? ` ${scopePath}` : ""}`
      )
    }
  };
}

async function runGeminiRequest(request) {
  const parts = buildUserParts({
    prompt: request.prompt,
    imagePaths: request.imagePaths,
    cwd: request.cwd,
    effort: request.effort
  });
  return generateContent({ model: request.model, parts, timeoutMs: request.timeoutMs || DEFAULT_TIMEOUT_MS });
}

function spawnWorker(cwd, jobId) {
  const child = spawn(process.execPath, [__filename, "task-worker", "--cwd", cwd, "--job-id", jobId], {
    cwd,
    detached: true,
    stdio: "ignore",
    env: process.env,
    windowsHide: true
  });
  child.unref();
  return child.pid;
}

async function runForeground(request, asJson) {
  const startedAt = nowIso();
  const result = await runGeminiRequest(request);
  const finishedAt = nowIso();

  const payload = {
    kind: request.kind,
    model: result.model,
    startedAt,
    finishedAt,
    text: result.text
  };

  if (asJson) {
    output(payload, true);
    return;
  }

  output(result.text, false);
}

async function runBackground(cwd, request, asJson) {
  const job = createJob(cwd, request);
  const pid = spawnWorker(cwd, job.id);
  const next = {
    ...job,
    pid,
    updatedAt: nowIso()
  };
  saveJob(cwd, next);

  const payload = {
    jobId: job.id,
    status: "queued",
    kind: request.kind,
    model: request.model,
    summary: request.summary
  };

  if (asJson) {
    output(payload, true);
    return;
  }

  output(`Gemini ${request.kind} started in the background as ${job.id}. Check /gemini:status ${job.id} for progress.`);
}

async function handleTaskLikeCommand(builder, argv, cwd) {
  const { options, request } = builder(argv, cwd);
  const asJson = Boolean(options.json);
  const background = Boolean(options.background) && !Boolean(options.wait);

  if (background) {
    await runBackground(cwd, request, asJson);
    return;
  }

  await runForeground(request, asJson);
}

function msSince(iso) {
  if (!iso) {
    return "";
  }
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) {
    return "";
  }
  const sec = Math.floor(ms / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

async function waitForJob(cwd, jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = loadJob(cwd, jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    if (!["queued", "running"].includes(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return loadJob(cwd, jobId);
}

function renderJobsTable(jobs) {
  const header = "| Job ID | Kind | Status | Model | Age | Summary |\n|---|---|---|---|---|---|";
  const rows = jobs.map((job) => {
    const summary = summarize(job.request?.summary || "", 80).replace(/\|/g, "\\|");
    return `| ${job.id} | ${job.kind} | ${job.status} | ${job.model || ""} | ${msSince(job.createdAt)} | ${summary} |`;
  });
  return `${header}\n${rows.join("\n")}`;
}

async function handleStatus(argv, cwd) {
  const { options, positionals } = parseArgs(argv, {
    booleanOptions: ["json", "wait", "all"],
    valueOptions: ["timeout-ms"]
  });
  const asJson = Boolean(options.json);
  const timeoutMs = Number(options["timeout-ms"] || DEFAULT_TIMEOUT_MS);
  const jobId = positionals[0];

  if (jobId) {
    const job = options.wait ? await waitForJob(cwd, jobId, timeoutMs) : loadJob(cwd, jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    if (asJson) {
      output(job, true);
      return;
    }
    output(
      [
        `Job: ${job.id}`,
        `Kind: ${job.kind}`,
        `Status: ${job.status}`,
        `Model: ${job.model || ""}`,
        `Created: ${job.createdAt || ""}`,
        `Started: ${job.startedAt || ""}`,
        `Finished: ${job.finishedAt || ""}`,
        "",
        job.status === "completed" ? "Use /gemini:result <job-id> for full output." : ""
      ]
        .filter(Boolean)
        .join("\n")
    );
    return;
  }

  let jobs = listJobs(cwd);
  if (!options.all) {
    jobs = jobs.slice(0, 15);
  }

  if (asJson) {
    output({ jobs }, true);
    return;
  }

  if (!jobs.length) {
    output("No Gemini jobs found for this repository.");
    return;
  }

  output(renderJobsTable(jobs));
}

function handleResult(argv, cwd) {
  const { options, positionals } = parseArgs(argv, {
    booleanOptions: ["json"]
  });
  const asJson = Boolean(options.json);
  const jobId = positionals[0];

  if (!jobId) {
    throw new Error("result requires a job-id.");
  }

  const job = loadJob(cwd, jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (asJson) {
    output(job, true);
    return;
  }

  if (job.status === "completed") {
    output(job.result?.text || "(empty result)");
    return;
  }

  if (job.status === "failed") {
    output(`Job failed: ${job.error || "Unknown error"}`);
    return;
  }

  if (job.status === "cancelled") {
    output("Job was cancelled.");
    return;
  }

  output(`Job ${job.id} is ${job.status}. Check /gemini:status ${job.id}.`);
}

function handleCancel(argv, cwd) {
  const { options, positionals } = parseArgs(argv, {
    booleanOptions: ["json"]
  });
  const asJson = Boolean(options.json);
  const jobId = positionals[0];

  if (!jobId) {
    throw new Error("cancel requires a job-id.");
  }

  const job = loadJob(cwd, jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  let killed = false;
  if (job.pid && ["queued", "running"].includes(job.status)) {
    try {
      process.kill(job.pid, "SIGTERM");
      killed = true;
    } catch {
      killed = false;
    }
  }

  const updated = {
    ...job,
    status: "cancelled",
    cancelled: true,
    updatedAt: nowIso(),
    finishedAt: job.finishedAt || nowIso(),
    error: job.error || "Cancelled by user"
  };
  saveJob(cwd, updated);

  const payload = {
    jobId,
    status: updated.status,
    killed
  };

  if (asJson) {
    output(payload, true);
    return;
  }

  output(killed ? `Cancelled ${jobId}.` : `Marked ${jobId} as cancelled.`);
}

function buildSetupReport(cwd, requestedModel = null) {
  const config = requestedModel ? setConfig(cwd, { defaultModel: requestedModel }) : getConfig(cwd);
  const hasNode = spawnSync("node", ["--version"], { encoding: "utf8" }).status === 0;
  const apiKeyPresent = Boolean(process.env.GEMINI_API_KEY && String(process.env.GEMINI_API_KEY).trim());

  const nextSteps = [];
  if (!apiKeyPresent) {
    nextSteps.push("Add GEMINI_API_KEY to .env.local, then restart Claude Code.");
  }
  if (!requestedModel) {
    nextSteps.push("Optional: set a default model with `/gemini:setup --model gemini-2.5-pro`." );
  }

  return {
    ready: hasNode && apiKeyPresent,
    nodeAvailable: hasNode,
    apiKeyPresent,
    defaultModel: config.defaultModel || DEFAULT_MODEL,
    workspace: getWorkspaceRoot(cwd),
    nextSteps
  };
}

function renderSetup(report) {
  return [
    `Ready: ${report.ready ? "yes" : "no"}`,
    `Node: ${report.nodeAvailable ? "available" : "missing"}`,
    `GEMINI_API_KEY: ${report.apiKeyPresent ? "present" : "missing"}`,
    `Default model: ${report.defaultModel}`,
    "",
    ...(report.nextSteps.length ? ["Next steps:", ...report.nextSteps.map((step) => `- ${step}`)] : [])
  ]
    .filter(Boolean)
    .join("\n");
}

function handleSetup(argv, cwd) {
  const { options } = parseArgs(argv, {
    booleanOptions: ["json"],
    valueOptions: ["model"]
  });
  const report = buildSetupReport(cwd, options.model || null);
  output(options.json ? report : renderSetup(report), Boolean(options.json));
}

function handleSessionStartHook(cwd) {
  const apiKeyPresent = Boolean(process.env.GEMINI_API_KEY && String(process.env.GEMINI_API_KEY).trim());
  if (!apiKeyPresent) {
    output("[gemini] GEMINI_API_KEY is missing. Run /gemini:setup after loading .env.local.");
    return;
  }
  output("[gemini] Runtime check passed.");
}

async function handleTaskWorker(argv) {
  const { options } = parseArgs(argv, {
    valueOptions: ["cwd", "job-id"]
  });
  const cwd = path.resolve(options.cwd || process.cwd());
  const jobId = options["job-id"];

  if (!jobId) {
    throw new Error("task-worker requires --job-id <id>");
  }

  const job = loadJob(cwd, jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (job.cancelled) {
    return;
  }

  const running = {
    ...job,
    status: "running",
    startedAt: nowIso(),
    updatedAt: nowIso()
  };
  saveJob(cwd, running);

  try {
    const result = await runGeminiRequest(running.request);
    const completed = {
      ...running,
      status: "completed",
      finishedAt: nowIso(),
      updatedAt: nowIso(),
      result: {
        model: result.model,
        text: result.text
      },
      error: null
    };
    saveJob(cwd, completed);
  } catch (error) {
    const failed = {
      ...running,
      status: "failed",
      finishedAt: nowIso(),
      updatedAt: nowIso(),
      error: error instanceof Error ? error.message : String(error)
    };
    saveJob(cwd, failed);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rest = argv.slice(1);
  const cwd = process.cwd();

  if (!command || command === "-h" || command === "--help" || command === "help") {
    usage();
    return;
  }

  if (command === "task-worker") {
    await handleTaskWorker(rest);
    return;
  }

  try {
    switch (command) {
      case "setup":
        handleSetup(rest, cwd);
        return;
      case "hook-session-start":
        handleSessionStartHook(cwd);
        return;
      case "task":
        await handleTaskLikeCommand(buildTaskRequestFromArgs, rest, cwd);
        return;
      case "review":
        await handleTaskLikeCommand(buildReviewRequestFromArgs, rest, cwd);
        return;
      case "screenshot":
        await handleTaskLikeCommand(buildScreenshotRequestFromArgs, rest, cwd);
        return;
      case "status":
        await handleStatus(rest, cwd);
        return;
      case "result":
        handleResult(rest, cwd);
        return;
      case "cancel":
        handleCancel(rest, cwd);
        return;
      default:
        usage();
        process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  }
}

main();

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { transcriptPath, newestTranscript, TranscriptWatcher } = require("./transcript");
const { PtySession } = require("./pty-session");
const { formatText } = require("./output/text");
const { buildResult } = require("./output/json");
const streamJson = require("./output/stream-json");

const DEFAULT_TIMEOUT_MS = 600000;
const QUIET_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function runHeadless(parsed, realClaude) {
  const cwd = process.cwd();

  if (parsed.resumeNoValue) {
    process.stderr.write("claude-wrapper: --resume requires an explicit session ID in -p mode\n");
    return 1;
  }

  const stdinText = await readStdin();
  let prompt = parsed.prompt;
  if (stdinText.trim()) prompt = prompt ? `${stdinText}\n\n${prompt}` : stdinText;
  if (!prompt || !prompt.trim()) {
    process.stderr.write("claude-wrapper: no prompt given; pass it as an argument or via stdin\n");
    return 1;
  }

  const extraArgs = [];
  let sessionId;
  if (parsed.continue) {
    const newest = newestTranscript(cwd);
    if (!newest) {
      process.stderr.write("claude-wrapper: no conversation found to continue in this directory\n");
      return 1;
    }
    sessionId = path.basename(newest, ".jsonl");
  } else if (parsed.sessionId || parsed.resume) {
    sessionId = parsed.sessionId || parsed.resume;
  } else {
    sessionId = crypto.randomUUID();
    extraArgs.push("--session-id", sessionId);
  }
  const targetPath = transcriptPath(cwd, sessionId);

  if (!parsed.permissionMode && !parsed.skipPermissions) {
    // emulate -p: tools without pre-approval are denied instead of prompting
    extraArgs.push("--permission-mode", "dontAsk");
  }

  const env = { ...process.env };
  let sentinelPath = null;
  if (!parsed.settings) {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-wrapper-"));
    sentinelPath = path.join(runDir, "stop.sentinel");
    const settingsPath = path.join(runDir, "settings.json");
    const hookCommand =
      "node -e \"require('fs').writeFileSync(process.env.CLAUDE_WRAPPER_SENTINEL, String(Date.now()))\"";
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: hookCommand }] }] } }),
      "utf8"
    );
    extraArgs.push("--settings", settingsPath);
    env.CLAUDE_WRAPPER_SENTINEL = sentinelPath;
  }

  const format = parsed.outputFormat;
  const watcher = new TranscriptWatcher(targetPath);
  watcher.skipExisting();

  let emittedInit = false;
  const emitInit = (model) => {
    if (emittedInit) return;
    emittedInit = true;
    process.stdout.write(JSON.stringify(streamJson.initEvent({ sessionId, cwd, model })) + "\n");
  };
  watcher.onEntry = (entry) => {
    if (format !== "stream-json" || !streamJson.isEmittable(entry)) return;
    emitInit((entry.message && entry.message.model) || parsed.model);
    process.stdout.write(JSON.stringify(streamJson.messageEvent(entry, sessionId)) + "\n");
  };

  const session = new PtySession({
    command: realClaude,
    args: [...parsed.passthrough, ...extraArgs],
    cwd,
    env,
  });
  let exitInfo = null;
  session.onExit((info) => {
    exitInfo = info;
  });

  const startedAt = Date.now();
  const timeoutMs = Number(process.env.CLAUDE_WRAPPER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  let sentinelFired = false;

  session.start();
  watcher.start();
  try {
    await session.waitReady();
    if (!exitInfo) {
      session.sendPrompt(prompt);
      for (;;) {
        await sleep(150);
        if (sentinelPath && fs.existsSync(sentinelPath)) {
          sentinelFired = true;
          break;
        }
        if (watcher.turnLooksComplete() && watcher.idleMs() >= QUIET_MS) break;
        if (watcher.apiError && watcher.idleMs() >= QUIET_MS) break;
        if (exitInfo) break;
        if (Date.now() - startedAt > timeoutMs) {
          timedOut = true;
          break;
        }
      }
      await sleep(300); // let trailing transcript lines land
      watcher.poll();
    }
  } finally {
    watcher.stop();
    session.kill();
  }

  const durationMs = Date.now() - startedAt;
  const completed = !watcher.apiError && !timedOut && (sentinelFired || watcher.turnLooksComplete());
  const isError = !completed;
  let errorMessage = null;
  if (isError) {
    if (watcher.apiError) errorMessage = watcher.apiError;
    else if (timedOut) errorMessage = `claude-wrapper: timed out after ${timeoutMs}ms`;
    else if (exitInfo) {
      errorMessage =
        `claude exited before completing the turn ` +
        `(code=${exitInfo.exitCode}, signal=${exitInfo.signal}): ${session.recentPlain().slice(-300)}`;
    } else errorMessage = "claude-wrapper: turn did not complete";
  }

  if (format === "text") {
    if (isError) {
      process.stderr.write(errorMessage + "\n");
      return 1;
    }
    process.stdout.write(formatText(watcher.entries).trim() + "\n");
    return 0;
  }

  const result = buildResult({ entries: watcher.entries, sessionId, durationMs, isError, errorMessage });
  if (format === "stream-json") emitInit(parsed.model);
  process.stdout.write(JSON.stringify(result) + "\n");
  return isError ? 1 : 0;
}

module.exports = { runHeadless };
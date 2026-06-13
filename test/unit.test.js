"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { parseArgs } = require("../src/args");
const { resolveRealClaudeLauncher } = require("../src/real-claude");
const { spawnCommandForPty } = require("../src/pty-session");
const { projectDirSlug, transcriptPath, TranscriptWatcher } = require("../src/transcript");
const { formatText } = require("../src/output/text");
const { buildResult } = require("../src/output/json");
const streamJson = require("../src/output/stream-json");

test("parseArgs: basic -p with prompt and passthrough flags", () => {
  const r = parseArgs(["-p", "hello world", "--model", "opus"]);
  assert.equal(r.print, true);
  assert.equal(r.prompt, "hello world");
  assert.equal(r.model, "opus");
  assert.deepEqual(r.passthrough, ["--model", "opus"]);
  assert.equal(r.outputFormat, "text");
});

test("parseArgs: --output-format consumed, inline form supported", () => {
  const r1 = parseArgs(["-p", "--output-format", "json", "hi"]);
  assert.equal(r1.outputFormat, "json");
  assert.deepEqual(r1.passthrough, []);
  const r2 = parseArgs(["-p", "--output-format=stream-json", "hi"]);
  assert.equal(r2.outputFormat, "stream-json");
});

test("parseArgs: unsupported flags collected", () => {
  const r = parseArgs(["-p", "--include-partial-messages", "--fallback-model", "haiku", "hi"]);
  assert.deepEqual(r.unsupported, ["--include-partial-messages", "--fallback-model"]);
  assert.equal(r.prompt, "hi");
});

test("parseArgs: session flags observed and passed through", () => {
  const r = parseArgs(["-p", "--resume", "abc-123", "hi"]);
  assert.equal(r.resume, "abc-123");
  assert.deepEqual(r.passthrough, ["--resume", "abc-123"]);

  const r2 = parseArgs(["-p", "--resume", "--output-format", "json", "hi"]);
  assert.equal(r2.resumeNoValue, true);

  const r3 = parseArgs(["-p", "-c", "hi"]);
  assert.equal(r3.continue, true);
});

test("parseArgs: variadic flag values are not mistaken for the prompt", () => {
  const r = parseArgs(["-p", "do it", "--allowedTools", "Bash(git *)", "Edit"]);
  assert.equal(r.prompt, "do it");
  assert.deepEqual(r.passthrough, ["--allowedTools", "Bash(git *)", "Edit"]);
});

test("parseArgs: no -p means plain interactive invocation", () => {
  const r = parseArgs(["--continue"]);
  assert.equal(r.print, false);
});

test("resolveRealClaude: Windows prefers npm command shim over bundled exe", { skip: process.platform !== "win32" }, () => {
  const exeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-real-claude-exe-"));
  const cmdDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-real-claude-cmd-"));
  const packageRoot = path.join(cmdDir, "node_modules", "@anthropic-ai", "claude-code");
  const nativeRoot = path.join(packageRoot, "node_modules", "@anthropic-ai", `claude-code-win32-${process.arch}`);
  const nativeBinary = path.join(nativeRoot, "claude.exe");
  fs.writeFileSync(path.join(exeDir, "claude.exe"), "");
  fs.mkdirSync(nativeRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "package.json"), "{}");
  fs.writeFileSync(path.join(nativeRoot, "package.json"), "{}");
  fs.writeFileSync(nativeBinary, "");
  fs.writeFileSync(path.join(cmdDir, "claude.cmd"), "");
  const oldPath = process.env.PATH;
  try {
    process.env.PATH = [exeDir, cmdDir].join(path.delimiter);
    assert.deepEqual(resolveRealClaudeLauncher(), { command: nativeBinary, args: [] });
  } finally {
    process.env.PATH = oldPath;
  }
});

test("spawnCommandForPty: Windows command shims run through cmd.exe", { skip: process.platform !== "win32" }, () => {
  const spec = spawnCommandForPty("C:\\Program Files\\Claude\\claude.cmd", ["--session-id", "abc 123"]);
  assert.match(path.basename(spec.command).toLowerCase(), /^cmd(\.exe)?$/);
  assert.deepEqual(spec.args, [
    "/d",
    "/c",
    "call",
    "C:\\Program Files\\Claude\\claude.cmd",
    "--session-id",
    "abc 123",
  ]);
});

test("projectDirSlug matches claude's project dir naming", () => {
  if (process.platform === "win32") {
    assert.equal(projectDirSlug("C:\\Users\\foo\\git\\claude-wrapper"), "C--Users-foo-git-claude-wrapper");
    assert.equal(projectDirSlug("C:\\Users\\foo\\my_app.v2"), "C--Users-foo-my-app-v2");
  } else {
    assert.equal(projectDirSlug("/Users/foo/git/claude-wrapper"), "-Users-foo-git-claude-wrapper");
    assert.equal(projectDirSlug("/Users/foo/my_app.v2"), "-Users-foo-my-app-v2");
  }
});

test("transcriptPath layout", () => {
  const cwd =
    process.platform === "win32"
      ? "C:\\Users\\foo\\bar"
      : "/Users/foo/bar";
  const p = transcriptPath(cwd, "abc");
  assert.equal(path.basename(p), "abc.jsonl");
  assert.equal(path.basename(path.dirname(p)), projectDirSlug(cwd));
  assert.equal(path.basename(path.dirname(path.dirname(p))), "projects");
  assert.equal(path.basename(path.dirname(path.dirname(path.dirname(p)))), ".claude");
});

function entry(type, id, blocks, extra = {}) {
  return { type, message: { id, role: type, content: blocks, ...extra.message }, ...extra.top };
}

test("formatText: joins text blocks of the final assistant message only", () => {
  const entries = [
    entry("user", null, [{ type: "text", text: "q" }]),
    entry("assistant", "m1", [{ type: "text", text: "old answer" }]),
    entry("user", null, [{ type: "tool_result", content: "..." }]),
    entry("assistant", "m2", [{ type: "text", text: "Hello " }]),
    entry("assistant", "m2", [{ type: "text", text: "world" }]),
  ];
  assert.equal(formatText(entries), "Hello world");
});

test("buildResult: usage deduped by message id, num_turns counted", () => {
  const usage = { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 3, output_tokens: 7 };
  const entries = [
    { type: "assistant", message: { id: "m1", usage, content: [{ type: "text", text: "a" }] } },
    { type: "assistant", message: { id: "m1", usage, content: [{ type: "tool_use", id: "t" }] } },
    { type: "assistant", message: { id: "m2", usage, content: [{ type: "text", text: "done" }] } },
  ];
  const r = buildResult({ entries, sessionId: "s", durationMs: 123, isError: false, errorMessage: null });
  assert.equal(r.type, "result");
  assert.equal(r.subtype, "success");
  assert.equal(r.is_error, false);
  assert.equal(r.num_turns, 2);
  assert.equal(r.usage.input_tokens, 20);
  assert.equal(r.usage.output_tokens, 14);
  assert.equal(r.result, "done");
  assert.equal(r.total_cost_usd, 0);
  assert.equal(r.session_id, "s");
});

test("buildResult: error shape", () => {
  const r = buildResult({ entries: [], sessionId: "s", durationMs: 1, isError: true, errorMessage: "boom" });
  assert.equal(r.subtype, "error_during_execution");
  assert.equal(r.is_error, true);
  assert.equal(r.result, "boom");
});

test("stream-json: emittable filtering and event shape", () => {
  assert.equal(streamJson.isEmittable({ type: "assistant", message: {} }), true);
  assert.equal(streamJson.isEmittable({ type: "user", message: {}, isMeta: true }), false);
  assert.equal(streamJson.isEmittable({ type: "hook_success" }), false);
  const ev = streamJson.messageEvent({ type: "assistant", message: { id: "m" }, uuid: "u1" }, "sess");
  assert.equal(ev.session_id, "sess");
  assert.equal(ev.uuid, "u1");
});

test("TranscriptWatcher: parses appended lines, detects completion and api errors", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-test-"));
  const file = path.join(dir, "s.jsonl");
  fs.writeFileSync(file, JSON.stringify({ type: "user", message: { content: "old" } }) + "\n");

  const w = new TranscriptWatcher(file);
  w.skipExisting();

  fs.appendFileSync(
    file,
    JSON.stringify({ type: "assistant", message: { id: "m", stop_reason: "tool_use", content: [] } }) + "\n"
  );
  w.poll();
  assert.equal(w.entries.length, 1);
  assert.equal(w.turnLooksComplete(), false);

  fs.appendFileSync(
    file,
    JSON.stringify({ type: "assistant", message: { id: "m2", stop_reason: "end_turn", content: [] } }) + "\n"
  );
  w.poll();
  assert.equal(w.turnLooksComplete(), true);
  assert.equal(w.apiError, null);

  fs.appendFileSync(
    file,
    JSON.stringify({ type: "user", isApiErrorMessage: true, message: { content: [{ type: "text", text: "API Error: 529" }] } }) + "\n"
  );
  w.poll();
  assert.equal(w.apiError, "API Error: 529");
});

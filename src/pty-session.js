"use strict";

const fs = require("fs");
const path = require("path");

// node-pty's spawn-helper can lose its executable bit when installed from
// some package mirrors (same workaround as claude-proxy's dispatcher).
function ensureNodePtySpawnHelperExecutable() {
  const prebuildsDir = path.join(__dirname, "..", "node_modules", "node-pty", "prebuilds");
  if (!fs.existsSync(prebuildsDir)) return;
  for (const platformDir of fs.readdirSync(prebuildsDir)) {
    const helperPath = path.join(prebuildsDir, platformDir, "spawn-helper");
    if (!fs.existsSync(helperPath)) continue;
    try {
      const mode = fs.statSync(helperPath).mode;
      if ((mode & 0o111) === 0) {
        fs.chmodSync(helperPath, mode | 0o755);
      }
    } catch (_err) {
      // node-pty will surface a clear spawn error if chmod is not allowed.
    }
  }
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, " ").replace(/\x1b\][^\x07]*\x07/g, " ");
}

class PtySession {
  constructor({
    command,
    args,
    cwd,
    env,
    inputDelayMs = 1500,
    fallbackInputDelayMs = 8000,
    submitDelayMs = 750,
  }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.inputDelayMs = inputDelayMs;
    this.fallbackInputDelayMs = fallbackInputDelayMs;
    this.submitDelayMs = submitDelayMs;
    this.child = null;
    this.recent = "";
    this.trustConfirmed = false;
    this.exitInfo = null;
    this.exitCallbacks = [];
    this.readyPromise = null;
  }

  start() {
    ensureNodePtySpawnHelperExecutable();
    const pty = require("node-pty");
    this.child = pty.spawn(this.command, this.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: this.cwd,
      env: this.env,
    });

    let readyResolve;
    this.readyPromise = new Promise((resolve) => {
      readyResolve = resolve;
    });
    let readyScheduled = false;
    const scheduleReady = (delayMs) => {
      if (readyScheduled) return;
      readyScheduled = true;
      const timer = setTimeout(readyResolve, delayMs);
      if (timer.unref) timer.unref();
    };

    this.child.onData((data) => {
      this.recent = (this.recent + data).slice(-12000);
      const plain = stripAnsi(this.recent);

      if (!this.trustConfirmed && /Yes,?\s*I\s*trust\s*this\s*folder/i.test(plain)) {
        this.trustConfirmed = true;
        this.child.write("\r");
        return;
      }
      if (/Claude\s*Code/i.test(plain) && /for\s*shortcuts/i.test(plain)) {
        scheduleReady(this.inputDelayMs);
      }
    });

    this.child.onExit((event) => {
      this.exitInfo = { exitCode: event.exitCode, signal: event.signal };
      readyResolve();
      for (const cb of this.exitCallbacks) cb(this.exitInfo);
    });

    const fallbackTimer = setTimeout(() => scheduleReady(0), this.fallbackInputDelayMs);
    if (fallbackTimer.unref) fallbackTimer.unref();
  }

  waitReady() {
    return this.readyPromise;
  }

  sendPrompt(text) {
    if (!this.child || this.exitInfo) return;
    this.child.write("\x1b[200~" + text + "\x1b[201~");
    const timer = setTimeout(() => {
      if (this.child && !this.exitInfo) this.child.write("\r");
    }, this.submitDelayMs);
    if (timer.unref) timer.unref();
  }

  onExit(cb) {
    this.exitCallbacks.push(cb);
    if (this.exitInfo) cb(this.exitInfo);
  }

  recentPlain() {
    return stripAnsi(this.recent).replace(/\s+/g, " ").trim();
  }

  kill() {
    try {
      if (this.child && !this.exitInfo) this.child.kill();
    } catch (_err) {
      // already gone
    }
  }
}

module.exports = { PtySession, stripAnsi };
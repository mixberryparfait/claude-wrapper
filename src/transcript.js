"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function projectDirSlug(cwd) {
  return path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, "-");
}

function projectDir(cwd) {
  return path.join(os.homedir(), ".claude", "projects", projectDirSlug(cwd));
}

function transcriptPath(cwd, sessionId) {
  return path.join(projectDir(cwd), `${sessionId}.jsonl`);
}

function newestTranscript(cwd) {
  const dir = projectDir(cwd);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_err) {
    return null;
  }
  let newest = null;
  let newestMtime = -1;
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (_err) {
      continue;
    }
    if (stat.mtimeMs > newestMtime) {
      newestMtime = stat.mtimeMs;
      newest = full;
    }
  }
  return newest;
}

function extractText(entry) {
  const content = entry && entry.message && entry.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text")
    .map((block) => block.text)
    .join("");
}

// Polls a session transcript and parses lines appended after skipExisting().
class TranscriptWatcher {
  constructor(filePath, { pollMs = 150, onEntry = null } = {}) {
    this.filePath = filePath;
    this.pollMs = pollMs;
    this.onEntry = onEntry;
    this.offset = 0;
    this.buffer = "";
    this.entries = [];
    this.lastAssistant = null;
    this.lastChangeAt = Date.now();
    this.apiError = null;
    this.timer = null;
  }

  skipExisting() {
    try {
      this.offset = fs.statSync(this.filePath).size;
    } catch (_err) {
      this.offset = 0;
    }
  }

  start() {
    this.timer = setInterval(() => this.poll(), this.pollMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  poll() {
    let stat;
    try {
      stat = fs.statSync(this.filePath);
    } catch (_err) {
      return;
    }
    if (stat.size <= this.offset) return;

    let fd;
    try {
      fd = fs.openSync(this.filePath, "r");
      const length = stat.size - this.offset;
      const buf = Buffer.alloc(length);
      const bytesRead = fs.readSync(fd, buf, 0, length, this.offset);
      this.offset += bytesRead;
      this.buffer += buf.toString("utf8", 0, bytesRead);
    } catch (_err) {
      return;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    this.lastChangeAt = Date.now();

    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (_err) {
        continue;
      }
      this.handleEntry(entry);
    }
  }

  handleEntry(entry) {
    this.entries.push(entry);
    if (entry.isApiErrorMessage) {
      this.apiError = extractText(entry) || "API error reported in session transcript";
    }
    if (entry.type === "assistant" && entry.message) {
      this.lastAssistant = entry;
      if (entry.message.stop_reason === "refusal") {
        this.apiError = this.apiError || "Claude refused to continue (stop_reason: refusal)";
      }
    }
    if (this.onEntry) this.onEntry(entry);
  }

  idleMs() {
    return Date.now() - this.lastChangeAt;
  }

  turnLooksComplete() {
    const message = this.lastAssistant && this.lastAssistant.message;
    return !!(message && message.stop_reason && message.stop_reason !== "tool_use");
  }
}

module.exports = {
  projectDirSlug,
  projectDir,
  transcriptPath,
  newestTranscript,
  extractText,
  TranscriptWatcher,
};
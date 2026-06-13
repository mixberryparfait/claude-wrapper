"use strict";

const fs = require("fs");
const path = require("path");

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch (_err) {
    return null;
  }
}

// Find the real claude executable, skipping this wrapper itself even when the
// wrapper is installed in PATH under the name `claude`.
function resolveRealClaude() {
  const override = process.env.CLAUDE_WRAPPER_REAL_CLAUDE;
  if (override) return override;

  const self = realpathOrNull(process.argv[1]);
  const names =
    process.platform === "win32"
      ? ["claude.exe", "claude.cmd", "claude.bat", "claude"]
      : ["claude"];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(candidate);
      } catch (_err) {
        continue;
      }
      if (!stat.isFile()) continue;
      const real = realpathOrNull(candidate);
      if (self && real === self) continue;
      if (real && path.basename(real) === "claude-wrapper.js") continue;
      return candidate;
    }
  }
  return null;
}

module.exports = { resolveRealClaude };
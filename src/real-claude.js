"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch (_err) {
    return null;
  }
}

function claudeCodePackageRootFor(candidate) {
  if (process.platform !== "win32") return null;

  const base = path.basename(candidate).toLowerCase();
  let packageRoot = null;
  if (["claude", "claude.cmd", "claude.bat", "claude.ps1"].includes(base)) {
    packageRoot = path.join(
      path.dirname(candidate),
      "node_modules",
      "@anthropic-ai",
      "claude-code"
    );
  } else if (base === "claude.exe" && path.basename(path.dirname(candidate)).toLowerCase() === "bin") {
    packageRoot = path.dirname(path.dirname(candidate));
  }

  return packageRoot && fs.existsSync(path.join(packageRoot, "package.json")) ? packageRoot : null;
}

function claudeCodeNativeBinaryFor(candidate) {
  const packageRoot = claudeCodePackageRootFor(candidate);
  if (!packageRoot) return null;

  const platformPackage = `@anthropic-ai/claude-code-win32-${os.arch()}`;
  try {
    const packageJson = require.resolve(`${platformPackage}/package.json`, { paths: [packageRoot] });
    const binaryPath = path.join(path.dirname(packageJson), "claude.exe");
    return fs.existsSync(binaryPath) ? binaryPath : null;
  } catch (_err) {
    return null;
  }
}

function launcherForCandidate(candidate) {
  const nativeBinary = claudeCodeNativeBinaryFor(candidate);
  if (nativeBinary) {
    return { command: nativeBinary, args: [] };
  }
  return { command: candidate, args: [] };
}

// Find the real claude executable, skipping this wrapper itself even when the
// wrapper is installed in PATH under the name `claude`.
function resolveRealClaudeLauncher() {
  const override = process.env.CLAUDE_WRAPPER_REAL_CLAUDE;
  if (override) return { command: override, args: [] };

  const self = realpathOrNull(process.argv[1]);
  const names =
    process.platform === "win32"
      ? ["claude.cmd", "claude.bat", "claude", "claude.exe"]
      : ["claude"];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);

  const candidates =
    process.platform === "win32"
      ? names.flatMap((name) => dirs.map((dir) => ({ dir, name })))
      : dirs.flatMap((dir) => names.map((name) => ({ dir, name })));

  for (const { dir, name } of candidates) {
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
      return launcherForCandidate(candidate);
  }
  return null;
}

function resolveRealClaude() {
  const launcher = resolveRealClaudeLauncher();
  return launcher && launcher.command;
}

module.exports = { resolveRealClaude, resolveRealClaudeLauncher, claudeCodeNativeBinaryFor };

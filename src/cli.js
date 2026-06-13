"use strict";

const { spawn } = require("child_process");
const { parseArgs } = require("./args");
const { resolveRealClaudeLauncher } = require("./real-claude");

const VALID_FORMATS = ["text", "json", "stream-json"];

function passthrough(realClaude, argv) {
  return new Promise((resolve) => {
    const command = realClaude.command || realClaude;
    const args = [...(realClaude.args || []), ...argv];
    const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const child = spawn(command, args, { stdio: "inherit", shell: needsShell });
    child.on("exit", (code, signal) => resolve(signal ? 1 : code === null ? 1 : code));
    child.on("error", (err) => {
      process.stderr.write(`claude-wrapper: failed to launch claude: ${err.message}\n`);
      resolve(1);
    });
  });
}

async function main(argv) {
  const parsed = parseArgs(argv);
  const realClaude = resolveRealClaudeLauncher();
  if (!realClaude) {
    process.stderr.write(
      "claude-wrapper: real claude executable not found in PATH " +
        "(set CLAUDE_WRAPPER_REAL_CLAUDE to override)\n"
    );
    return 1;
  }

  if (!parsed.print) {
    // interactive use: hand over verbatim
    return passthrough(realClaude, argv);
  }

  if (parsed.unsupported.length > 0) {
    process.stderr.write(
      `claude-wrapper: unsupported flag(s) in -p mode: ${parsed.unsupported.join(", ")}\n`
    );
    return 1;
  }
  if (!VALID_FORMATS.includes(parsed.outputFormat)) {
    process.stderr.write(
      `claude-wrapper: invalid --output-format "${parsed.outputFormat}" ` +
        `(choices: ${VALID_FORMATS.join(", ")})\n`
    );
    return 1;
  }

  const { runHeadless } = require("./headless-runner");
  return runHeadless(parsed, realClaude);
}

module.exports = { main };

"use strict";

// Flag table for claude 2.1.153.
// kind:
//   consume     - handled by the wrapper, NOT passed to the underlying claude
//   unsupported - rejected in -p mode (print-only features we don't emulate yet)
//   observe     - recorded by the wrapper AND passed through to claude
//   (absent)    - passed through untouched
// args: "none" | "one" | "optional" | "variadic"
const FLAG_SPECS = {
  "-p": { kind: "consume", id: "print", args: "none" },
  "--print": { kind: "consume", id: "print", args: "none" },
  "--output-format": { kind: "consume", id: "outputFormat", args: "one" },

  "--input-format": { kind: "unsupported", args: "one" },
  "--include-partial-messages": { kind: "unsupported", args: "none" },
  "--replay-user-messages": { kind: "unsupported", args: "none" },
  "--include-hook-events": { kind: "unsupported", args: "none" },
  "--no-session-persistence": { kind: "unsupported", args: "none" },
  "--fallback-model": { kind: "unsupported", args: "one" },
  "--max-budget-usd": { kind: "unsupported", args: "one" },
  "--json-schema": { kind: "unsupported", args: "one" },
  // would require directory watching to find the forked transcript
  "--fork-session": { kind: "unsupported", args: "none" },

  "--session-id": { kind: "observe", id: "sessionId", args: "one" },
  "-r": { kind: "observe", id: "resume", args: "optional" },
  "--resume": { kind: "observe", id: "resume", args: "optional" },
  "-c": { kind: "observe", id: "continue", args: "none" },
  "--continue": { kind: "observe", id: "continue", args: "none" },
  "--permission-mode": { kind: "observe", id: "permissionMode", args: "one" },
  "--dangerously-skip-permissions": { kind: "observe", id: "skipPermissions", args: "none" },
  "--allow-dangerously-skip-permissions": { kind: "observe", id: "skipPermissions", args: "none" },
  "--settings": { kind: "observe", id: "settings", args: "one" },
  "--model": { kind: "observe", id: "model", args: "one" },

  // passthrough flags that take values (so their values aren't mistaken for the prompt)
  "--add-dir": { args: "variadic" },
  "--agent": { args: "one" },
  "--agents": { args: "one" },
  "--allowedTools": { args: "variadic" },
  "--allowed-tools": { args: "variadic" },
  "--append-system-prompt": { args: "one" },
  "--append-system-prompt-file": { args: "one" },
  "--betas": { args: "variadic" },
  "-d": { args: "optional" },
  "--debug": { args: "optional" },
  "--debug-file": { args: "one" },
  "--disallowedTools": { args: "variadic" },
  "--disallowed-tools": { args: "variadic" },
  "--effort": { args: "one" },
  "--file": { args: "variadic" },
  "--from-pr": { args: "optional" },
  "--mcp-config": { args: "variadic" },
  "-n": { args: "one" },
  "--name": { args: "one" },
  "--plugin-dir": { args: "one" },
  "--plugin-url": { args: "one" },
  "--remote-control": { args: "optional" },
  "--remote-control-session-name-prefix": { args: "one" },
  "--setting-sources": { args: "one" },
  "--system-prompt": { args: "one" },
  "--system-prompt-file": { args: "one" },
  "--tools": { args: "variadic" },
};

function parseArgs(argv) {
  const result = {
    print: false,
    outputFormat: "text",
    sessionId: null,
    resume: null,
    resumeNoValue: false,
    continue: false,
    permissionMode: null,
    skipPermissions: false,
    settings: null,
    model: null,
    prompt: "",
    promptParts: [],
    passthrough: [],
    unsupported: [],
  };

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];

    if (!token.startsWith("-")) {
      result.promptParts.push(token);
      i += 1;
      continue;
    }

    let flag = token;
    let inlineValue = null;
    const eq = token.indexOf("=");
    if (token.startsWith("--") && eq > 0) {
      flag = token.slice(0, eq);
      inlineValue = token.slice(eq + 1);
    }
    const spec = FLAG_SPECS[flag] || null;

    const values = [];
    const consumedTokens = [token];
    i += 1;
    if (inlineValue !== null) {
      values.push(inlineValue);
    } else {
      const arity = spec ? spec.args : "none";
      if (arity === "one") {
        if (i < argv.length) {
          values.push(argv[i]);
          consumedTokens.push(argv[i]);
          i += 1;
        }
      } else if (arity === "optional") {
        if (i < argv.length && !argv[i].startsWith("-")) {
          values.push(argv[i]);
          consumedTokens.push(argv[i]);
          i += 1;
        }
      } else if (arity === "variadic") {
        while (i < argv.length && !argv[i].startsWith("-")) {
          values.push(argv[i]);
          consumedTokens.push(argv[i]);
          i += 1;
        }
      }
    }

    const kind = spec && spec.kind ? spec.kind : "passthrough";
    if (kind === "consume") {
      if (spec.id === "print") result.print = true;
      else if (spec.id === "outputFormat") result.outputFormat = values[0] || "text";
      continue;
    }
    if (kind === "unsupported") {
      result.unsupported.push(flag);
      continue;
    }
    if (kind === "observe") {
      switch (spec.id) {
        case "sessionId":
          result.sessionId = values[0] || null;
          break;
        case "resume":
          if (values[0]) result.resume = values[0];
          else result.resumeNoValue = true;
          break;
        case "continue":
          result.continue = true;
          break;
        case "permissionMode":
          result.permissionMode = values[0] || null;
          break;
        case "skipPermissions":
          result.skipPermissions = true;
          break;
        case "settings":
          result.settings = values[0] || null;
          break;
        case "model":
          result.model = values[0] || null;
          break;
      }
      result.passthrough.push(...consumedTokens);
      continue;
    }
    result.passthrough.push(...consumedTokens);
  }

  result.prompt = result.promptParts.join(" ");
  return result;
}

module.exports = { parseArgs, FLAG_SPECS };
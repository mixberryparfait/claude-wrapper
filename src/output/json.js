"use strict";

const crypto = require("crypto");
const { formatText } = require("./text");

// Reconstruct the single result object that `claude -p --output-format json`
// prints, from transcript entries. total_cost_usd is fixed to 0: transcripts
// carry no cost data and subscription runs have no marginal cost.
function buildResult({ entries, sessionId, durationMs, isError, errorMessage }) {
  const assistants = entries.filter((e) => e.type === "assistant" && e.message);

  const usageById = new Map();
  for (const e of assistants) {
    if (e.message.id && e.message.usage && !usageById.has(e.message.id)) {
      usageById.set(e.message.id, e.message.usage);
    }
  }
  const usage = {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  };
  for (const u of usageById.values()) {
    usage.input_tokens += u.input_tokens || 0;
    usage.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
    usage.cache_read_input_tokens += u.cache_read_input_tokens || 0;
    usage.output_tokens += u.output_tokens || 0;
  }

  const text = formatText(entries);
  return {
    type: "result",
    subtype: isError ? "error_during_execution" : "success",
    is_error: !!isError,
    duration_ms: durationMs,
    num_turns: usageById.size,
    result: isError && errorMessage ? errorMessage : text,
    session_id: sessionId,
    total_cost_usd: 0,
    usage,
    uuid: crypto.randomUUID(),
  };
}

module.exports = { buildResult };
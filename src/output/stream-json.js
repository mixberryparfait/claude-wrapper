"use strict";

const crypto = require("crypto");

function initEvent({ sessionId, cwd, model }) {
  return {
    type: "system",
    subtype: "init",
    cwd,
    session_id: sessionId,
    model: model || null,
    tools: [],
    uuid: crypto.randomUUID(),
  };
}

// Transcript user/assistant lines are nearly the same shape as the events
// `claude -p --output-format stream-json` emits.
function messageEvent(entry, sessionId) {
  return {
    type: entry.type,
    message: entry.message,
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: entry.uuid || crypto.randomUUID(),
  };
}

function isEmittable(entry) {
  return (entry.type === "user" || entry.type === "assistant") && !!entry.message && !entry.isMeta;
}

module.exports = { initEvent, messageEvent, isEmittable };
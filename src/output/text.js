"use strict";

const { extractText } = require("../transcript");

// `claude -p` text output: the text of the final assistant message.
// Transcripts store one content block per line, sharing message.id within
// one API response, so join the text blocks of the last message id.
function formatText(entries) {
  const assistants = entries.filter((e) => e.type === "assistant" && e.message);
  if (assistants.length === 0) return "";
  const lastId = assistants[assistants.length - 1].message.id;
  return assistants
    .filter((e) => e.message.id === lastId)
    .map((e) => extractText(e))
    .join("");
}

module.exports = { formatText };
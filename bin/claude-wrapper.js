#!/usr/bin/env node
"use strict";

require("../src/cli")
  .main(process.argv.slice(2))
  .then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`claude-wrapper: ${(err && err.stack) || err}\n`);
      process.exit(1);
    }
  );
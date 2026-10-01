#!/usr/bin/env node
import { main } from "./application/entrypoint.js";

process.exitCode = main(process.argv.slice(2), {
  err: (line) => {
    console.error(line);
  },
});

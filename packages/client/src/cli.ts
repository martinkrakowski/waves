#!/usr/bin/env node
import { main } from "./index.js";

main(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    // Nothing about the failure is printed: a message is the one part of a
    // crash that could carry something the user did not mean to print.
    console.error("waves: unexpected failure");
    process.exitCode = 1;
  });

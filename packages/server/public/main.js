import { boot } from "./app.js";

export const app = boot({
  doc: document,
  location,
  fetch,
  setTimer: setTimeout,
  clearTimer: clearTimeout,
  clock: Date.now,
});

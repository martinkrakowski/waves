import { boot } from "./app.js";

export const app = boot({
  doc: document,
  location,
  history,
  win: window,
  fetch,
  setTimer: setTimeout,
  clearTimer: clearTimeout,
  clock: Date.now,
});

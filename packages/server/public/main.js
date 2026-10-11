import { boot } from "./app.js";

export const app = boot({
  doc: document,
  location,
  history,
  win: window,
  fetch,
  credentials: navigator.credentials,
  crypto,
  // `navigator.clipboard` is undefined outside a secure context, which the page
  // says as a copy that could not be made.
  clipboard: navigator.clipboard,
  setTimer: setTimeout,
  clearTimer: clearTimeout,
  clock: Date.now,
});

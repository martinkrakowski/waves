import { wavePanel } from "../wave.js";

/**
 * One project's page: its waves, the wave the reader is looking at, and that
 * wave's lanes. The data has already passed the shape checks, and the handlers
 * are the app's own, so the panel only draws and reports.
 *
 * K5 replaces this body with the lane table across every wave; the signature is
 * what stays.
 */

export function renderProject(model, nowMs, handlers) {
  return wavePanel(model, nowMs, handlers);
}

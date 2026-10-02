import type { ProjectLanesView } from "../src/application/read-model.js";

/**
 * Whether a `GET /api/v1/projects/<id>/lanes` response is one the project page
 * can draw: every id in it a path the page owns, and every field it renders
 * present with the type the read model gives it.
 */
export declare function drawableProjectLanes(
  view: unknown,
): view is ProjectLanesView;

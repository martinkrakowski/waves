import type { AttentionView } from "../src/application/read-model.js";
import type { ProjectCard } from "./api.js";
import type { Route } from "./app.js";

export interface ShellModel {
  readonly route: Route;
  /** The project list, or undefined before the first successful load. */
  readonly projects: readonly ProjectCard[] | undefined;
  /** What the lanes are asking for, or undefined before the first load. */
  readonly attention: AttentionView | undefined;
  /**
   * Whether the reader has asked for the waves past retention. A link the shell
   * draws to a project carries it, so leaving the page does not quietly drop it.
   */
  readonly all: boolean;
  /** Whether the reader has the projects menu open; it is drawn closed otherwise. */
  readonly menuOpen: boolean;
  /** "" or the offline note. */
  readonly note: string;
  /**
   * The app's clock, in ms, at the moment the last load answered; undefined until
   * one has. The sync pill formats it and says `syncing…` while it is undefined.
   */
  readonly syncedAt: number | undefined;
  /** Whether a pass the reader asked for is in flight, so the arrow can spin. */
  readonly syncing: boolean;
}

/** The one thing the frame does on its own: ask the app for a pass. */
export interface ShellHandlers {
  readonly onRefresh: () => void;
}

export declare function shell(
  model: ShellModel,
  body: Node,
  handlers: ShellHandlers,
): HTMLElement;

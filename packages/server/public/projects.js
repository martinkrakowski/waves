import { el, internalLink, repoLink, stamp, text } from "./dom.js";
import { waveCountText } from "./format.js";

const PROJECT_PREFIX = "/p/";
const NO_REPO = "no repository registered";

export function projectPath(projectId) {
  return `${PROJECT_PREFIX}${encodeURIComponent(projectId)}`;
}

function pushTime(lastPush, nowMs) {
  return lastPush === undefined ? text("never") : stamp(lastPush, nowMs);
}

function fact(term, value) {
  return el("div", {
    attrs: { class: "fact" },
    children: [el("dt", { text: term }), el("dd", { children: [value] })],
  });
}

function present(project) {
  return project !== null && project !== undefined;
}

/**
 * Whether a response is a list this view can draw at all. A list holding a hole
 * is not a list of projects: it is a broken endpoint, and the app says so
 * rather than replacing a page that was right with one that claims the
 * registry is empty.
 */
export function drawableProjects(projects) {
  return (
    Array.isArray(projects) && projects.every((project) => present(project))
  );
}

function card(project, nowMs) {
  const name = el("h2", {
    attrs: { class: "card-name" },
    children: [internalLink(project.name, projectPath(project.id))],
  });
  if (project.stale === true) {
    name.append(el("span", { attrs: { class: "badge stale" }, text: "stale" }));
  }
  return el("li", {
    attrs: { class: "card" },
    children: [
      name,
      el("dl", {
        attrs: { class: "facts" },
        children: [
          fact("id", el("code", { text: project.id })),
          fact("repo", repoLink(project.repo ?? NO_REPO, project.repo)),
          fact("waves", text(waveCountText(project.waves))),
          fact("last push", pushTime(project.lastPush, nowMs)),
        ],
      }),
    ],
  });
}

export function projectList(projects, nowMs) {
  const cards = projects.filter(present);
  const heading = [el("h1", { text: "waves" })];
  if (cards.length > 0) {
    heading.push(
      el("p", {
        attrs: { class: "count" },
        text: cards.length === 1 ? "1 project" : `${cards.length} projects`,
      }),
    );
  }
  const body =
    cards.length === 0
      ? el("p", {
          attrs: { class: "empty" },
          text: "No projects registered yet.",
        })
      : el("ul", {
          attrs: { class: "cards" },
          children: cards.map((project) => card(project, nowMs)),
        });
  return el("section", {
    attrs: { class: "view" },
    children: [...heading, body],
  });
}

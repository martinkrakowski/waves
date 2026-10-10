/**
 * The two list builders a project's inbox page draws below its three groups:
 * the history of decisions that left the inbox after fourteen days, and the
 * project's notice events. They live here rather than in `project-inbox.js`
 * to keep that view under its line budget, and because the two have no need
 * of the inbox's group block or count line.
 *
 * A history head is the question that was decided, the state the card gave
 * it, and the date it reached that state, linked back to the decision. An
 * event is its notice: when it was received, what topic it carried, and the
 * words the writer wrote, with an optional detail and optional refs.
 */

import { calendarDate } from "../format.js";
import { el, internalLink, text } from "../dom.js";
import { pathFor } from "./project.js";

/** The words the inbox card gives each decision state on its way to history. */
const HISTORY_STATE_WORD = {
  approved: "reported as approved",
  declined: "reported as declined",
  answered: "reported as answered",
  withdrawn: "withdrawn by a session",
  superseded: "replaced by a later decision",
};

/** The most events the listing answers with. */
const MAX_EVENTS = 200;

/**
 * One history line: the question as an internal link, the state in the card's
 * own words, and the date the head reached that state, joined by " · ". A
 * `from` head links to its raiser, because the decision lives at the project
 * that raised it.
 */
function historyHeadLine(head, project) {
  const target = head.from !== undefined ? head.from : project;
  return el("p", {
    attrs: { class: "project-inbox-history-line" },
    children: [
      internalLink(head.question, `/p/${target}/d/${head.id}`),
      text(" · "),
      text(HISTORY_STATE_WORD[head.state]),
      text(" · "),
      text(calendarDate(head.at)),
    ],
  });
}

/**
 * The history block: a collapsed `<details>` that replaces the old count
 * line. Each head appears one per line, newest `at` first — the reader looks
 * for the most recent first. Returns nothing when there are no history heads,
 * so the caller can push the return value and filter it like the group blocks.
 */
export function historyHeads(heads, project) {
  if (heads.length === 0) {
    return undefined;
  }
  const sorted = [...heads].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const noun = sorted.length === 1 ? "decision" : "decisions";
  return el("details", {
    attrs: { class: "project-inbox-history" },
    children: [
      el("summary", {
        text: `${sorted.length} ${noun} left the inbox after 14 days.`,
      }),
      ...sorted.map((head) => historyHeadLine(head, project)),
    ],
  });
}

/**
 * The `refs` line beneath an event: one part per ref the event carried, only
 * the ones present, joined by " · ". A wave ref is a link to that wave's own
 * page, because the page it names exists; a lane ref and a PR number stay
 * plain text, because this page has no checked URL for either.
 */
function eventRefs(refs, project) {
  const parts = [];
  if (refs.wave !== undefined) {
    parts.push(internalLink(`wave ${refs.wave}`, pathFor(project, refs.wave)));
  }
  if (refs.lane !== undefined) {
    parts.push(text(`lane ${refs.lane}`));
  }
  if (refs.pr !== undefined) {
    parts.push(text(`PR #${refs.pr}`));
  }
  return parts.length === 0
    ? undefined
    : el("p", {
        attrs: { class: "project-event-refs" },
        children: parts.flatMap((part, at) =>
          at === 0 ? [part] : [text(" · "), part],
        ),
      });
}

/**
 * One event: a single element holding everything the event said, so a reader
 * can see which detail and which refs belong to which line. The line reads
 * `<date> · <topic> · <text>` with each field in an element of its own, the
 * `detail` beneath when present, and the refs beneath when present.
 */
function eventLine(event, project) {
  const children = [
    el("p", {
      attrs: { class: "project-event-line" },
      children: [
        el("span", {
          attrs: { class: "project-event-date" },
          text: calendarDate(event.receivedAt),
        }),
        text(" · "),
        el("span", {
          attrs: { class: "project-event-topic" },
          text: event.event.topic,
        }),
        text(" · "),
        el("span", {
          attrs: { class: "project-event-text" },
          text: event.event.text,
        }),
      ],
    }),
  ];
  if (event.event.detail !== undefined) {
    children.push(
      el("p", {
        attrs: { class: "project-event-detail" },
        text: event.event.detail,
      }),
    );
  }
  const refs = event.event.refs;
  if (refs !== undefined) {
    const line = eventRefs(refs, project);
    if (line !== undefined) {
      children.push(line);
    }
  }
  return el("article", {
    attrs: { class: "project-event" },
    children,
  });
}

/**
 * The events section: always drawn, under the "Events" heading. Empty shows
 * "No events."; otherwise one element per event in the order given (newest
 * first, as the API answers), each holding its own detail and refs, and a
 * line noting the cap when exactly 200 are shown.
 */
export function eventsList(events, project) {
  const children = [el("h3", { text: "Events" })];
  if (events.length === 0) {
    children.push(
      el("p", {
        attrs: { class: "project-inbox-events-empty" },
        text: "No events.",
      }),
    );
  } else {
    for (const event of events) {
      children.push(eventLine(event, project));
    }
    if (events.length === MAX_EVENTS) {
      children.push(
        el("p", {
          attrs: { class: "project-inbox-events-limit" },
          text: "Showing the newest 200.",
        }),
      );
    }
  }
  return el("section", {
    attrs: { class: "inbox-events" },
    children,
  });
}

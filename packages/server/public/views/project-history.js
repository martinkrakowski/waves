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
 * One event line: the date, topic and text, with refs appended when present,
 * each field separated by " · ". Ref parts appear only when present: "wave w-1",
 * "lane l-1", "PR #42" — only the ones the event carried.
 */
function eventLine(event) {
  const parts = [
    calendarDate(event.receivedAt),
    event.event.topic,
    event.event.text,
  ];
  const refs = event.event.refs;
  if (refs !== undefined) {
    const refParts = [];
    if (refs.wave !== undefined) {
      refParts.push(`wave ${refs.wave}`);
    }
    if (refs.lane !== undefined) {
      refParts.push(`lane ${refs.lane}`);
    }
    if (refs.pr !== undefined) {
      refParts.push(`PR #${refs.pr}`);
    }
    if (refParts.length > 0) {
      parts.push(refParts.join(" · "));
    }
  }
  return el("p", {
    attrs: { class: "project-event" },
    text: parts.join(" · "),
  });
}

/**
 * The events section: always drawn, under the "Events" heading. Empty shows
 * "No events."; otherwise one line per event in the order given (newest first,
 * as the API answers), a `detail` on its own line beneath when it carried one,
 * and a line noting the cap when exactly 200 are shown.
 */
export function eventsList(events) {
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
      children.push(eventLine(event));
      if (event.event.detail !== undefined) {
        children.push(
          el("p", {
            attrs: { class: "project-event-detail" },
            text: event.event.detail,
          }),
        );
      }
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

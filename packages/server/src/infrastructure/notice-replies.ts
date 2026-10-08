import {
  MAX_DECISIONS_PER_PROJECT,
  MAX_REVISIONS_PER_DECISION,
} from "@hexagen-monaco/waves-contract";

import type {
  PostEvent,
  PostState,
  RaiseDecision,
} from "../application/notice-write-model.js";
import { jsonReply, type Reply } from "./http-security.js";

/**
 * Pure mappings from a notice-write-model result to its reply, pulled out of the
 * HTTP handler so the 409 bound cases (the 500-decision ceiling and the 20-revision
 * cap, which are too costly to drive through the rate-limited write path in a test)
 * can be covered directly. The handler wraps the reply it returns with `afterRead`.
 */

export function raiseReply(result: RaiseDecision): Reply {
  switch (result.kind) {
    case "stored":
      return jsonReply(200, {
        revision: result.revision,
        textSha256: result.textSha256,
        created: result.created,
        entries: result.entries,
      });
    case "ceiling":
      return jsonReply(409, {
        error: `at most ${MAX_DECISIONS_PER_PROJECT} decisions per project`,
      });
    case "tooManyRevisions":
      return jsonReply(409, {
        error: `at most ${MAX_REVISIONS_PER_DECISION} revisions per decision`,
      });
    case "conflict":
      return jsonReply(409, { error: "the decision changed; re-read it" });
    case "invalid":
      return jsonReply(400, { errors: result.errors });
  }
}

export function stateReply(result: PostState): Reply {
  switch (result.kind) {
    case "posted":
      return jsonReply(201, { index: result.index });
    case "notFound":
      return jsonReply(404, { error: "not found" });
    case "conflict":
      return jsonReply(409, {
        error: result.error,
        revision: result.revision,
        textSha256: result.textSha256,
        entries: result.entries,
      });
    case "invalid":
      return jsonReply(400, { errors: result.errors });
  }
}

export function eventReply(result: PostEvent): Reply {
  switch (result.kind) {
    case "posted":
      return jsonReply(201, { id: result.id, dropped: result.dropped });
    case "invalid":
      return jsonReply(400, { errors: result.errors });
  }
}

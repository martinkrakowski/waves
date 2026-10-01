import {
  isRetained,
  isStale,
  staleAfterMs,
} from "@hexagen-monaco/waves-contract";

import type { StalenessPort } from "../application/ports/staleness.js";

/**
 * The one adapter of the staleness port: the contract owns the rules, this only
 * hands them to the application layer, which may not import the contract.
 */
export const contractStaleness: StalenessPort = {
  staleAfterMs,
  isStale,
  isRetained,
};

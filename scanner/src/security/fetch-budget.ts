/**
 * A bound on the requests one check makes with `fetch` (session fix-a4, review finding 25). A Durable
 * Object on the free plan may make 50 subrequests per invocation. The quick check fetches three chains
 * (the redirect check, the homepage, the Impressum), each with up to five redirects, and every new host
 * of a redirect costs two DNS-over-HTTPS requests: a site with a new host at every step needs 52. With one
 * budget for all of them, the name lookups included, a quick check makes at most `QUICK_CHECK_FETCHES`
 * requests; with the object's own trace request (one per object) that is at most 45.
 *
 * The homepage and the redirect check together need at most 34, so they always finish; a site that uses
 * the budget up loses the rest of its Impressum chain, and the Impressum is then "bitte manuell prüfen".
 */
export const QUICK_CHECK_FETCHES = 44;

export const FETCH_BUDGET_ERROR = 'the check made more requests than one check may';

export interface FetchBudget {
  /** Counts a request and passes it on, or throws once the budget is used up. */
  fetch: typeof fetch;
  /** Requests passed on. */
  used(): number;
  /** Requests refused because the budget was used up. */
  refused(): number;
}

export function createFetchBudget(max: number, fetchFn: typeof fetch = globalThis.fetch): FetchBudget {
  let used = 0;
  let refused = 0;
  const counting = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (used >= max) {
      refused += 1;
      throw new Error(FETCH_BUDGET_ERROR);
    }
    used += 1;
    return fetchFn(input, init);
  }) as typeof fetch;
  return { fetch: counting, used: () => used, refused: () => refused };
}

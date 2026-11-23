import { createApi, type ApiDeps } from '../src/api/router.ts';
import { answerResponse, parseStartInput, startScan, type StartDeps } from '../src/api/start.ts';

/**
 * The API with the start in the same process (session A5 part 5): the router of the API Worker, and behind
 * it the start as the queue object runs it (`POST /start`: the hand-over is serialized and checked with
 * `parseStartInput`, the answer comes back as the object's response). For the unit tests on the local D1.
 */
export function localApi(
  input: Omit<StartDeps, 'dailyGate' | 'dispatch'> & Partial<Pick<StartDeps, 'dailyGate' | 'dispatch'>> & Pick<ApiDeps, 'position' | 'ratePerHour' | 'force'> & { exempt?: (url: URL) => boolean },
): (request: Request) => Promise<Response> {
  const { position, ratePerHour, force, exempt, ...start } = input;
  const deps: StartDeps = { dailyGate: { until: 0 }, ...start, ...(exempt !== undefined ? { exempt } : {}) };
  return createApi({
    db: input.db,
    start: async (handOver) => {
      const parsed = parseStartInput(JSON.parse(JSON.stringify(handOver)) as unknown, exempt);
      if (parsed === null) return new Response('{"error":"bad-request"}', { status: 500 });
      return answerResponse(await startScan(parsed, deps));
    },
    ...(position !== undefined ? { position } : {}),
    ...(ratePerHour !== undefined ? { ratePerHour } : {}),
    ...(force !== undefined ? { force } : {}),
    ...(exempt !== undefined ? { exempt } : {}),
  });
}

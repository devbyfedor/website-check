/**
 * Cloudflare Worker entry point.
 *
 * Session A1 only creates the workspace. The Browser Run capture adapter comes in A2,
 * the API, storage and orchestration in A5. Until then every request gets 501.
 */
export default {
  async fetch(_request: Request): Promise<Response> {
    return Response.json(
      { error: 'not_implemented', message: 'The API is built in stage A5.' },
      { status: 501, headers: { 'cache-control': 'no-store' } },
    );
  },
} satisfies ExportedHandler;

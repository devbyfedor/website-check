/**
 * Unit tests only (session fix-a5, review finding 31): the part of `cloudflare:workers` that the queue object
 * uses, so `worker/src/queue/object.ts` itself runs in Node. The worker's vitest config maps the module here.
 */
export class DurableObject<Env = unknown> {
  protected ctx: DurableObjectState;
  protected env: Env;
  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RouteContext } from "../app.ts";
import { fail } from "../http.ts";

/**
 * Read-only market discovery. Authenticated and restricted to APPROVED
 * accounts, but intentionally free of write/execution semantics: it only
 * surfaces what a data source reports, with a freshness timestamp.
 */
export function registerMarketRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  const { authenticate, marketSearch } = ctx;

  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply);
    if (reply.sent) return;
    if (req.authUser?.status !== "APPROVED") {
      await fail(reply, 403, "account_not_approved");
    }
  };

  app.get("/market/search", { preHandler: guard }, async (req, reply) => {
    const { q } = req.query as { q?: string };
    const query = (q ?? "").trim();
    if (query.length < 2) {
      return fail(reply, 400, "query_too_short");
    }
    const results = await marketSearch(query);
    return reply.send({
      source: "dexscreener",
      query,
      fetchedAt: ctx.now(),
      count: results.length,
      pairs: results,
    });
  });
}

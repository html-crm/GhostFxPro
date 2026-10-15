import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { detectTokenChain } from "@ghostfx/bot";
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
  const { authenticate, marketSearch, marketTokenProfile } = ctx;

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

  /**
   * Token lookup by contract address. Paste a contract, get its identity,
   * on-chain decimals, and best observable market so a form can auto-fill.
   * Read-only; it never places an order.
   */
  app.get("/market/token/:address", { preHandler: guard }, async (req, reply) => {
    const { address } = req.params as { address: string };
    const trimmed = (address ?? "").trim();
    if (!detectTokenChain(trimmed)) {
      return fail(reply, 400, "invalid_address");
    }
    const profile = await marketTokenProfile(trimmed);
    if (!profile) {
      return fail(reply, 404, "token_not_found");
    }
    return reply.send({
      source: "dexscreener",
      fetchedAt: ctx.now(),
      profile,
    });
  });
}

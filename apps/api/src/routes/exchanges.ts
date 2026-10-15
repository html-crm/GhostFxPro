import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RouteContext } from "../app.ts";
import { fail } from "../http.ts";
import { getExchangeStatus } from "../services/exchanges.ts";

/**
 * Exchange integration status surface.
 *
 * Read-only: it reports which official venues exist, why each is unusable, and
 * what would unblock it. There is deliberately no order, quote, or transfer
 * route here — this deployment cannot place a real order.
 */
export function registerExchangeRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    await ctx.authenticate(req, reply);
    if (reply.sent) return;
    if (req.authUser?.status !== "APPROVED") {
      await fail(reply, 403, "account_not_approved");
    }
  };

  app.get("/exchange/status", { preHandler: guard }, async (_req, reply) => {
    return reply.send({ status: getExchangeStatus() });
  });
}

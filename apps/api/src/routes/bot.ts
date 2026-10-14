import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PERMISSIONS } from "@ghostfx/security";
import type { RouteContext } from "../app.ts";
import { fail } from "../http.ts";

/**
 * Bot-engine control surface.
 *
 *   * Status is readable by any approved trader (so they can see the engine is
 *     live and when it last acted).
 *   * Start/stop change a *global* engine that evaluates every user's paper
 *     positions, so they are gated behind the operator permission
 *     `trading.diagnostics` (ADMIN and above).
 *
 * The engine is dry-run only. These routes never enable live trading.
 */
export function registerBotRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  const { bot } = ctx;

  const guardApproved = async (req: FastifyRequest, reply: FastifyReply) => {
    await ctx.authenticate(req, reply);
    if (reply.sent) return;
    if (req.authUser?.status !== "APPROVED") {
      await fail(reply, 403, "account_not_approved");
    }
  };

  const guardControl = async (req: FastifyRequest, reply: FastifyReply) => {
    await ctx.authenticate(req, reply);
    if (reply.sent) return;
    await ctx.requirePermission(PERMISSIONS.TRADING_DIAGNOSTICS)(req, reply);
  };

  app.get("/trading/bot/status", { preHandler: guardApproved }, async (_req, reply) => {
    return reply.send({ bot: bot.status() });
  });

  app.post("/trading/bot/start", { preHandler: guardControl }, async (_req, reply) => {
    return reply.send({ bot: bot.start() });
  });

  app.post("/trading/bot/stop", { preHandler: guardControl }, async (_req, reply) => {
    return reply.send({ bot: bot.stop() });
  });
}

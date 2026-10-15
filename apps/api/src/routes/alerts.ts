import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RouteContext } from "../app.ts";
import { fail } from "../http.ts";
import {
  createAlert,
  deleteAlert,
  evaluateAlerts,
  listAlertEvents,
  listAlerts,
  updateAlert,
  validateAlertInput,
  type AlertUpdate,
} from "../services/alerts.ts";

/**
 * Alert management surface. Alerts are passive observations: creating or
 * firing one never places an order, moves funds, or changes a position.
 *
 * Every route requires a session and an APPROVED account, and is strictly
 * scoped to the caller's own alerts (ownership is enforced in the queries).
 */
export function registerAlertRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db, market, now } = ctx;

  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    await ctx.authenticate(req, reply);
    if (reply.sent) return;
    if (req.authUser?.status !== "APPROVED") {
      await fail(reply, 403, "account_not_approved");
    }
  };

  app.get("/alerts", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const alerts = await listAlerts(db, user.user_id);
    return reply.send({ alerts });
  });

  app.get("/alerts/events", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const { limit } = req.query as { limit?: string };
    const parsed = limit ? Number(limit) : 50;
    const events = await listAlertEvents(db, user.user_id, parsed);
    return reply.send({ events });
  });

  app.post("/alerts", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    try {
      const input = validateAlertInput(req.body);
      const alert = await createAlert(db, user.user_id, input, market);
      return reply.code(201).send({ alert });
    } catch (err) {
      return fail(reply, 400, (err as Error).message);
    }
  });

  app.patch("/alerts/:id", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as AlertUpdate;
    try {
      const updated = await updateAlert(db, user.user_id, id, {
        ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
        ...(body.threshold !== undefined ? { threshold: body.threshold } : {}),
        ...(body.pct !== undefined ? { pct: body.pct } : {}),
        ...(body.baselinePrice !== undefined ? { baselinePrice: body.baselinePrice } : {}),
        ...(body.oneShot !== undefined ? { oneShot: Boolean(body.oneShot) } : {}),
        ...(body.cooldownMs !== undefined ? { cooldownMs: Number(body.cooldownMs) } : {}),
      });
      if (!updated) return fail(reply, 404, "alert_not_found");
      return reply.send({ alert: updated });
    } catch (err) {
      return fail(reply, 400, (err as Error).message);
    }
  });

  app.delete("/alerts/:id", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const { id } = req.params as { id: string };
    const deleted = await deleteAlert(db, user.user_id, id);
    if (!deleted) return fail(reply, 404, "alert_not_found");
    return reply.send({ deleted: true });
  });

  /** Runs a one-off evaluation now and reports how many alerts fired. */
  app.post("/alerts/evaluate", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const triggered = await evaluateAlerts(db, market, user.user_id, now());
    return reply.send({ triggered });
  });
}

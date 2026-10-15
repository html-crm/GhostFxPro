import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RouteContext } from "../app.ts";
import { fail } from "../http.ts";
import {
  activateVersion,
  compareToActive,
  createVersion,
  deleteVersion,
  getVersion,
  listStrategies,
  updateVersionNote,
} from "../services/strategies.ts";

/**
 * Strategy management surface.
 *
 * A strategy version is an immutable config. These routes let an owner list
 * versions, draft a new one, compare it against the active version, activate a
 * version (including rolling back to an older one), annotate, and delete
 * unused drafts. Nothing here places an order; activation only changes which
 * config future trades open under.
 *
 * Every route requires a session and an APPROVED account, and is scoped to the
 * caller's own strategies (ownership enforced in the queries).
 */
export function registerStrategyRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  const { db } = ctx;

  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    await ctx.authenticate(req, reply);
    if (reply.sent) return;
    if (req.authUser?.status !== "APPROVED") {
      await fail(reply, 403, "account_not_approved");
    }
  };

  app.get("/strategies", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const strategies = await listStrategies(db, user.user_id);
    return reply.send({ strategies });
  });

  app.get(
    "/strategies/versions/:id",
    { preHandler: guard },
    async (req, reply) => {
      const user = req.authUser!;
      const { id } = req.params as { id: string };
      const version = await getVersion(db, user.user_id, id);
      if (!version) return fail(reply, 404, "version_not_found");
      return reply.send({ version });
    },
  );

  app.get(
    "/strategies/versions/:id/compare",
    { preHandler: guard },
    async (req, reply) => {
      const user = req.authUser!;
      const { id } = req.params as { id: string };
      const result = await compareToActive(db, user.user_id, id);
      if (!result) return fail(reply, 404, "version_not_found");
      return reply.send(result);
    },
  );

  app.post("/strategies/versions", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const body = (req.body ?? {}) as { config?: unknown; note?: unknown };
    const note = typeof body.note === "string" ? body.note : undefined;
    try {
      const result = await createVersion(db, user.user_id, body.config, note);
      return reply.code(201).send(result);
    } catch (err) {
      const code = (err as Error).message;
      if (code === "duplicate_version") return fail(reply, 409, code);
      return fail(reply, 400, code);
    }
  });

  app.patch(
    "/strategies/versions/:id",
    { preHandler: guard },
    async (req, reply) => {
      const user = req.authUser!;
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { note?: unknown };
      const note = body.note === null ? null : typeof body.note === "string" ? body.note : null;
      const updated = await updateVersionNote(db, user.user_id, id, note);
      if (!updated) return fail(reply, 404, "version_not_found");
      return reply.send({ version: updated });
    },
  );

  app.post(
    "/strategies/versions/:id/activate",
    { preHandler: guard },
    async (req, reply) => {
      const user = req.authUser!;
      const { id } = req.params as { id: string };
      const result = await activateVersion(db, user.user_id, id);
      if (!result) return fail(reply, 404, "version_not_found");
      return reply.send(result);
    },
  );

  app.delete(
    "/strategies/versions/:id",
    { preHandler: guard },
    async (req, reply) => {
      const user = req.authUser!;
      const { id } = req.params as { id: string };
      try {
        const deleted = await deleteVersion(db, user.user_id, id);
        if (!deleted) return fail(reply, 404, "version_not_found");
        return reply.send({ deleted: true });
      } catch (err) {
        return fail(reply, 409, (err as Error).message);
      }
    },
  );
}

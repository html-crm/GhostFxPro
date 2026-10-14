import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PERMISSIONS, type Role, type UserStatus } from "@ghostfx/security";
import type { RouteContext } from "../app.ts";
import { fail } from "../http.ts";
import { toAuthUser, type UserRow } from "../db.ts";
import {
  listUsers,
  setUserStatus,
  changeRole,
  findUserById,
} from "../services/users.ts";
import { revokeAllSessions } from "../services/sessions.ts";

const ROLES: readonly Role[] = ["USER", "ADMIN", "SUPER_ADMIN"];

function adminView(u: UserRow) {
  return {
    ...toAuthUser(u),
    created_at: u.created_at,
    password_set: u.password_hash !== null,
  };
}

export function registerAdminRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db, authenticate, requirePermission } = ctx;
  const guard = (permission: Parameters<typeof requirePermission>[0]) => [
    authenticate,
    requirePermission(permission),
  ];

  app.get(
    "/admin/users",
    { preHandler: guard(PERMISSIONS.USERS_READ) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { status } = req.query as { status?: UserStatus };
      const users = await listUsers(db, status);
      return reply.send({ users: users.map(adminView) });
    },
  );

  app.get(
    "/admin/users/pending",
    { preHandler: guard(PERMISSIONS.USERS_READ) },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const users = await listUsers(db, "PENDING");
      return reply.send({ users: users.map(adminView) });
    },
  );

  const transition = (status: UserStatus) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const actor = req.authUser!;
      try {
        const user = await setUserStatus(db, actor.user_id, id, status);
        return reply.send({ user: adminView(user) });
      } catch (err) {
        if (err instanceof Error && err.message === "user_not_found") {
          return fail(reply, 404, "user_not_found");
        }
        throw err;
      }
    };

  app.post(
    "/admin/users/:id/approve",
    { preHandler: guard(PERMISSIONS.USERS_APPROVE) },
    transition("APPROVED"),
  );
  app.post(
    "/admin/users/:id/reject",
    { preHandler: guard(PERMISSIONS.USERS_REJECT) },
    transition("REJECTED"),
  );
  app.post(
    "/admin/users/:id/suspend",
    {
      preHandler: [
        authenticate,
        requirePermission(PERMISSIONS.USERS_SUSPEND),
        requirePermission(PERMISSIONS.SESSIONS_REVOKE),
      ],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const actor = req.authUser!;
      const user = await setUserStatus(db, actor.user_id, id, "SUSPENDED");
      await revokeAllSessions(db, id);
      return reply.send({ user: adminView(user) });
    },
  );
  app.post(
    "/admin/users/:id/restore",
    { preHandler: guard(PERMISSIONS.USERS_RESTORE) },
    transition("APPROVED"),
  );

  app.post(
    "/admin/users/:id/role",
    { preHandler: guard(PERMISSIONS.ROLES_MANAGE) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { role?: string };
      if (!body?.role || !ROLES.includes(body.role as Role)) {
        return fail(reply, 400, "invalid_role");
      }
      const actor = req.authUser!;
      const user = await changeRole(db, actor.user_id, id, body.role as Role);
      return reply.send({ user: adminView(user) });
    },
  );

  app.post(
    "/admin/users/:id/revoke-sessions",
    { preHandler: guard(PERMISSIONS.SESSIONS_REVOKE) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const target = await findUserById(db, id);
      if (!target) return fail(reply, 404, "user_not_found");
      await revokeAllSessions(db, id);
      return reply.send({ revoked: true });
    },
  );

  app.get(
    "/admin/audit",
    { preHandler: guard(PERMISSIONS.AUDIT_READ) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { limit } = req.query as { limit?: string };
      const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
      const res = await db.query(
        `SELECT audit_id, actor_id, action, target_type, target_id, metadata, created_at
         FROM audit_log ORDER BY created_at DESC LIMIT $1`,
        [n],
      );
      return reply.send({ entries: res.rows });
    },
  );

  app.get(
    "/admin/health",
    { preHandler: guard(PERMISSIONS.SYSTEM_HEALTH) },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const res = await db.query<{ one: number }>(`SELECT 1 AS one`);
      return reply.send({
        status: "ok",
        database: res.rows.length === 1,
        time: new Date().toISOString(),
      });
    },
  );
}

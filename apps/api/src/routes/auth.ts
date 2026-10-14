import type { FastifyInstance } from "fastify";
import {
  registerUser,
  verifyLogin,
  acceptInvitation,
} from "../services/users.ts";
import { createSession, revokeSessionByToken } from "../services/sessions.ts";
import { logAudit } from "../audit.ts";
import { fail, isUniqueViolation } from "../http.ts";
import type { RouteContext } from "../app.ts";
import { setupMfa, confirmMfa, verifyUserMfa } from "../services/mfa.ts";
import { toAuthUser } from "../db.ts";

export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db, config, authenticate } = ctx;

  app.post("/auth/register", async (req, reply) => {
    const body = req.body as {
      email?: string;
      displayName?: string;
      password?: string;
    };
    if (!body?.email || !body?.displayName || !body?.password) {
      return fail(reply, 400, "missing_fields");
    }
    try {
      const user = await registerUser(db, {
        email: body.email,
        displayName: body.displayName,
        password: body.password,
      });
      return reply.code(201).send({ user: toAuthUser(user) });
    } catch (err) {
      if (isUniqueViolation(err, "users_email_unique")) {
        return fail(reply, 409, "email_taken");
      }
      if (err instanceof Error && err.message === "invalid_email") {
        return fail(reply, 400, "invalid_email");
      }
      if (err instanceof Error && err.message.includes("at least 8")) {
        return fail(reply, 400, "weak_password");
      }
      throw err;
    }
  });

  app.post("/auth/login", async (req, reply) => {
    const body = req.body as {
      email?: string;
      password?: string;
      totp?: string;
    };
    if (!body?.email || !body?.password) {
      return fail(reply, 400, "missing_fields");
    }
    const user = await verifyLogin(db, body.email, body.password);
    if (!user) return fail(reply, 401, "invalid_credentials");

    if (user.status === "SUSPENDED" || user.status === "REJECTED") {
      return fail(reply, 403, `account_${user.status.toLowerCase()}`);
    }

    if (user.mfa_enabled) {
      if (!body.totp) return fail(reply, 401, "mfa_required");
      const ok = await verifyUserMfa(db, user.user_id, body.totp, config.mfaEncryptionKey);
      if (!ok) return fail(reply, 401, "mfa_invalid");
    }

    const session = await createSession(db, user.user_id, {
      mfaSatisfied: user.mfa_enabled,
      ttlMs: config.sessionTtlMs,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    await logAudit(db, {
      actorId: user.user_id,
      action: "auth.login",
      targetType: "user",
      targetId: user.user_id,
    });
    return reply.send({
      token: session.token,
      expiresAt: session.expiresAt,
      user: toAuthUser(user),
    });
  });

  app.post("/auth/logout", { preHandler: authenticate }, async (req, reply) => {
    if (req.sessionToken) await revokeSessionByToken(db, req.sessionToken);
    return reply.code(204).send();
  });

  app.get("/auth/me", { preHandler: authenticate }, async (req, reply) => {
    return reply.send({ user: req.authUser });
  });

  app.post("/auth/mfa/setup", { preHandler: authenticate }, async (req, reply) => {
    const user = req.authUser!;
    const setup = await setupMfa(db, user.user_id, config.mfaEncryptionKey, user.email);
    return reply.send(setup);
  });

  app.post("/auth/mfa/confirm", { preHandler: authenticate }, async (req, reply) => {
    const user = req.authUser!;
    const body = req.body as { code?: string };
    if (!body?.code) return fail(reply, 400, "missing_code");
    const ok = await confirmMfa(db, user.user_id, body.code, config.mfaEncryptionKey);
    if (!ok) return fail(reply, 400, "invalid_code");
    return reply.send({ mfa_enabled: true });
  });

  app.post("/auth/invitations/accept", async (req, reply) => {
    const body = req.body as { token?: string; password?: string };
    if (!body?.token || !body?.password) {
      return fail(reply, 400, "missing_fields");
    }
    try {
      const result = await acceptInvitation(db, body.token, body.password);
      return reply.send({ userId: result.userId, email: result.email });
    } catch (err) {
      if (err instanceof Error) return fail(reply, 400, err.message);
      throw err;
    }
  });
}

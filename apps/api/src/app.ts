import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { isAuthorized, type Permission, type Role, type UserStatus } from "@ghostfx/security";
import { toAuthUser, type SqlExecutor } from "./db.ts";
import { authenticateSession } from "./services/sessions.ts";
import { bearer, fail } from "./http.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerAdminRoutes } from "./routes/admin.ts";

export interface AppConfig {
  sessionTtlMs: number;
  mfaEncryptionKey: Buffer;
}

export interface AppDeps {
  db: SqlExecutor;
  config: AppConfig;
}

export type PreHandler = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

export interface RouteContext {
  db: SqlExecutor;
  config: AppConfig;
  authenticate: PreHandler;
  requirePermission: (permission: Permission) => PreHandler;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const { db, config } = deps;

  const authenticate: PreHandler = async (req, reply) => {
    const token = bearer(req);
    if (!token) {
      await fail(reply, 401, "unauthenticated");
      return;
    }
    const result = await authenticateSession(db, token);
    if (!result) {
      await fail(reply, 401, "invalid_session");
      return;
    }
    req.authUser = toAuthUser(result.user);
    req.sessionToken = token;
  };

  const requirePermission = (permission: Permission): PreHandler =>
    async (req, reply) => {
      const user = req.authUser;
      if (!user) {
        await fail(reply, 401, "unauthenticated");
        return;
      }
      if (!isAuthorized(user.role as Role, user.status as UserStatus, permission)) {
        await fail(reply, 403, "forbidden");
      }
    };

  const ctx: RouteContext = { db, config, authenticate, requirePermission };

  app.get("/health", async () => ({ status: "ok" }));

  registerAuthRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  return app;
}

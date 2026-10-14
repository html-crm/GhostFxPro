import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { isAuthorized, type Permission, type Role, type UserStatus } from "@ghostfx/security";
import { DexScreenerProvider, type MarketDataProvider } from "@ghostfx/bot";
import { toAuthUser, type SqlExecutor } from "./db.ts";
import { authenticateSession } from "./services/sessions.ts";
import { bearer, fail } from "./http.ts";
import { BotRunner } from "./services/bot-runner.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerTradingRoutes } from "./routes/trading.ts";
import { registerBotRoutes } from "./routes/bot.ts";

export interface AppConfig {
  sessionTtlMs: number;
  mfaEncryptionKey: Buffer;
}

export interface AppDeps {
  db: SqlExecutor;
  config: AppConfig;
  /** Market-data source for paper trading. Defaults to DEX Screener. */
  market?: MarketDataProvider;
  /** Injected clock for deterministic tests. */
  now?: () => number;
  /** Bot engine. Defaults to a global runner over the provided market data. */
  bot?: BotRunner;
  /** Interval for the default bot runner (ms). Default 30s. */
  botIntervalMs?: number;
}

export type PreHandler = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

export interface RouteContext {
  db: SqlExecutor;
  config: AppConfig;
  market: MarketDataProvider;
  now: () => number;
  bot: BotRunner;
  authenticate: PreHandler;
  requirePermission: (permission: Permission) => PreHandler;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const { db, config } = deps;
  const market = deps.market ?? new DexScreenerProvider();
  const now = deps.now ?? (() => Date.now());
  const bot =
    deps.bot ??
    new BotRunner({
      db,
      provider: market,
      intervalMs: deps.botIntervalMs,
      now,
    });

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

  const ctx: RouteContext = { db, config, market, now, bot, authenticate, requirePermission };

  app.get("/health", async () => ({ status: "ok" }));

  registerAuthRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerTradingRoutes(app, ctx);
  registerBotRoutes(app, ctx);

  return app;
}

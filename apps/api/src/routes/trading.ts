import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MarketDataProvider, Quote } from "@ghostfx/bot";
import type { RouteContext } from "../app.ts";
import { fail } from "../http.ts";
import { toScaled } from "../services/decimal.ts";
import {
  closePaperPosition,
  evaluateTrade,
  getOrCreatePaperAccount,
  listPositions,
  openPaperPosition,
  portfolioSummary,
  runTick,
  upsertToken,
  type ChainKind,
  type TokenInput,
} from "../services/paper.ts";

const CHAINS: readonly ChainKind[] = ["SOLANA", "BNB", "ROBINHOOD"];

function parseTokenInput(raw: unknown): TokenInput {
  const t = raw as Partial<TokenInput> | undefined;
  if (!t || !t.chain || !CHAINS.includes(t.chain)) throw new Error("invalid_chain");
  if (!t.address || !t.address.trim()) throw new Error("invalid_address");
  if (!t.symbol || !t.symbol.trim()) throw new Error("invalid_symbol");
  if (t.decimals === undefined || !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36) {
    throw new Error("invalid_decimals");
  }
  return {
    chain: t.chain,
    address: t.address.trim(),
    symbol: t.symbol.trim(),
    name: t.name?.trim(),
    decimals: t.decimals,
  };
}

function positiveDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`invalid_${field}`);
  }
  const scaled = toScaled(value);
  if (scaled <= 0n) throw new Error(`invalid_${field}`);
  return typeof value === "string" ? value.trim() : String(value);
}

export function registerTradingRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  const { db, authenticate, market } = ctx;

  // Every trading route requires a session and an APPROVED account.
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply);
    if (reply.sent) return;
    if (req.authUser?.status !== "APPROVED") {
      await fail(reply, 403, "account_not_approved");
    }
  };

  app.get("/trading/account", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const summary = await portfolioSummary(db, user.user_id);
    return reply.send({ account: summary });
  });

  app.get("/trading/positions", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const { status } = req.query as { status?: string };
    const filter =
      status === "CLOSED" || status === "ALL" ? status : ("OPEN" as const);
    const positions = await listPositions(db, user.user_id, filter);
    return reply.send({ positions });
  });

  app.get("/trading/tokens", { preHandler: guard }, async (_req, reply) => {
    const res = await db.query(
      `SELECT token_id, chain, contract_address, symbol, name, decimals
       FROM tokens ORDER BY symbol ASC`,
    );
    return reply.send({ tokens: res.rows });
  });

  app.post("/trading/tokens", { preHandler: guard }, async (req, reply) => {
    try {
      const token = parseTokenInput(req.body);
      const resolved = await upsertToken(db, token);
      return reply.send({ token: { ...token, tokenId: resolved.tokenId } });
    } catch (err) {
      return fail(reply, 400, (err as Error).message);
    }
  });

  app.post("/trading/positions", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    try {
      const body = req.body as Record<string, unknown>;
      const token = parseTokenInput(body.token);
      const notionalQuote = positiveDecimal(body.notionalQuote, "notional");
      const pricePerToken = positiveDecimal(body.pricePerToken, "price");
      const note = typeof body.note === "string" ? body.note : undefined;
      const position = await openPaperPosition(db, user.user_id, {
        token,
        notionalQuote,
        pricePerToken,
        note,
      });
      return reply.code(201).send({ position });
    } catch (err) {
      const message = (err as Error).message;
      const status = message === "insufficient_funds" ? 400 : 400;
      return fail(reply, status, message);
    }
  });

  app.post(
    "/trading/positions/:id/evaluate",
    { preHandler: guard },
    async (req, reply) => {
      const user = req.authUser!;
      const { id } = req.params as { id: string };
      const owns = await ownsTrade(db, id, user.user_id);
      if (!owns) return fail(reply, 404, "position_not_found");

      try {
        const quote = await resolveQuote(db, market, id, req.body, ctx.now);
        if (!quote) return fail(reply, 409, "no_quote_available");
        const outcome = await evaluateTrade(db, id, quote, { now: ctx.now() });
        return reply.send({
          evaluation: outcome.evaluation,
          closed: outcome.closed,
        });
      } catch (err) {
        const message = (err as Error).message;
        const status = message === "trade_not_open" ? 409 : 400;
        return fail(reply, status, message);
      }
    },
  );

  app.post(
    "/trading/positions/:id/close",
    { preHandler: guard },
    async (req, reply) => {
      const user = req.authUser!;
      const { id } = req.params as { id: string };
      const owns = await ownsTrade(db, id, user.user_id);
      if (!owns) return fail(reply, 404, "position_not_found");
      try {
        const body = req.body as Record<string, unknown>;
        const priceStr = positiveDecimal(body.price, "price");
        await closePaperPosition(db, id, Number(priceStr), "manual_close");
        return reply.send({ closed: true });
      } catch (err) {
        const message = (err as Error).message;
        const status = message === "trade_not_open" ? 409 : 400;
        return fail(reply, status, message);
      }
    },
  );

  app.post("/trading/tick", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const result = await runTick(db, market, user.user_id, { now: ctx.now() });
    const summary = await portfolioSummary(db, user.user_id);
    return reply.send({ tick: result, account: summary });
  });
}

async function ownsTrade(
  db: RouteContext["db"],
  tradeId: string,
  userId: string,
): Promise<boolean> {
  const res = await db.query(`SELECT 1 FROM trades WHERE trade_id = $1 AND user_id = $2`, [
    tradeId,
    userId,
  ]);
  return res.rows.length === 1;
}

/**
 * A quote is either supplied explicitly (manual price, for deterministic
 * dry-runs) or fetched from the market provider. It is never fabricated.
 */
async function resolveQuote(
  db: RouteContext["db"],
  provider: MarketDataProvider,
  tradeId: string,
  body: unknown,
  now: () => number,
): Promise<Quote | null> {
  const b = body as { price?: unknown };
  if (b?.price !== undefined) {
    const price = positiveDecimal(b.price, "price");
    return { price: Number(price), ts: now(), source: "manual" };
  }
  const res = await db.query<{ chain: ChainKind; contract_address: string }>(
    `SELECT t.chain, tok.contract_address
     FROM trades t JOIN tokens tok ON tok.token_id = t.token_id
     WHERE t.trade_id = $1`,
    [tradeId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return provider.getQuote({ chain: row.chain, address: row.contract_address });
}

// Ensure account exists whenever a user first touches trading.
export async function ensureTradingAccount(
  db: RouteContext["db"],
  userId: string,
): Promise<void> {
  await getOrCreatePaperAccount(db, userId);
}

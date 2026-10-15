import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RouteContext } from "../app.ts";
import { fail } from "../http.ts";
import {
  createWallet,
  deleteWallet,
  getWallet,
  listWallets,
  loadBalancesForWallet,
  loadWalletBalances,
  updateWallet,
  validateWalletInput,
} from "../services/wallets.ts";

/**
 * Watch-only wallet surface. A wallet is a public address; the API never
 * accepts, stores, or returns key material (seed phrases / private keys).
 * Balances are read-only observations from public RPC endpoints.
 *
 * Every route requires a session and an APPROVED account, and is scoped to the
 * caller's own wallets (ownership enforced in the queries).
 */
export function registerWalletRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  const { db, walletBalances } = ctx;

  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    await ctx.authenticate(req, reply);
    if (reply.sent) return;
    if (req.authUser?.status !== "APPROVED") {
      await fail(reply, 403, "account_not_approved");
    }
  };

  app.get("/wallets", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const wallets = await listWallets(db, user.user_id);
    return reply.send({ wallets });
  });

  app.post("/wallets", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    try {
      const input = validateWalletInput(req.body);
      const wallet = await createWallet(db, user.user_id, input);
      return reply.code(201).send({ wallet });
    } catch (err) {
      const code = (err as Error).message;
      if (code === "wallet_exists") return fail(reply, 409, code);
      return fail(reply, 400, code);
    }
  });

  app.patch("/wallets/:id", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { label?: unknown };
    try {
      const updated = await updateWallet(db, user.user_id, id, {
        ...(body.label !== undefined
          ? { label: body.label === null ? null : String(body.label) }
          : {}),
      });
      if (!updated) return fail(reply, 404, "wallet_not_found");
      return reply.send({ wallet: updated });
    } catch (err) {
      return fail(reply, 400, (err as Error).message);
    }
  });

  app.delete("/wallets/:id", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const { id } = req.params as { id: string };
    const deleted = await deleteWallet(db, user.user_id, id);
    if (!deleted) return fail(reply, 404, "wallet_not_found");
    return reply.send({ deleted: true });
  });

  /** Live balances for one wallet, with a freshness timestamp. */
  app.get("/wallets/:id/balances", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const { id } = req.params as { id: string };
    const wallet = await getWallet(db, user.user_id, id);
    if (!wallet) return fail(reply, 404, "wallet_not_found");
    const balances = await loadBalancesForWallet(db, walletBalances, wallet);
    return reply.send({ wallet, balances, fetchedAt: ctx.now() });
  });

  /** Live balances for every wallet the user owns. */
  app.get("/wallets/balances", { preHandler: guard }, async (req, reply) => {
    const user = req.authUser!;
    const results = await loadWalletBalances(db, walletBalances, user.user_id);
    return reply.send({
      source: walletBalances.name,
      fetchedAt: ctx.now(),
      wallets: results.map((r) => ({ ...r.wallet, balances: r.balances })),
    });
  });
}

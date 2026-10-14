import type { FastifyReply, FastifyRequest } from "fastify";

export function fail(
  reply: FastifyReply,
  status: number,
  code: string,
  message?: string,
) {
  return reply.code(status).send({ error: code, message: message ?? code });
}

export function bearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

type PgError = { code?: string; constraint?: string };

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as PgError;
  if (e?.code !== "23505") return false;
  return constraint ? e.constraint === constraint : true;
}

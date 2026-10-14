import "fastify";
import type { AuthUser } from "./db.ts";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
    sessionToken?: string;
  }
}

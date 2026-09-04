import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

export type Db = PrismaClient;

/**
 * Prisma 7 требует driver adapter: строка подключения живёт в приложении,
 * а не в schema.prisma.
 */
export function createDb(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
}

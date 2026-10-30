import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// query logging floods the pm2 log in production (every poll of every route) —
// keep it for dev only, or opt back in with DEBUG_PRISMA=1
const wantQueryLog =
  process.env.NODE_ENV !== "production" || process.env.DEBUG_PRISMA === "1"

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: wantQueryLog ? ['query', 'error', 'warn'] : ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

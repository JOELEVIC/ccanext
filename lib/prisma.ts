import { PrismaClient } from "@prisma/client";
import { config } from "@/config/env";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  global.prisma ??
  new PrismaClient({
    log: config.isDevelopment ? ["query", "error", "warn"] : ["error"],
  });

if (config.isDevelopment) {
  global.prisma = prisma;
}

// Skip eager connect during build and on Vercel (serverless connects on first query)
if (!process.env.VERCEL && !process.env.NEXT_PHASE?.startsWith("phase_")) {
  prisma.$connect().catch((err) => {
    console.error("Failed to connect to database:", err);
    if (process.env.NODE_ENV === "development") process.exit(1);
  });
}

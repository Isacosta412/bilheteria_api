import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * Singleton do PrismaClient. Só os repositories importam este arquivo.
 * Guardamos a instância no globalThis para que o `tsx watch` não abra uma nova conexão a cada reload.
 */
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalParaPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalParaPrisma.prisma = prisma;
}

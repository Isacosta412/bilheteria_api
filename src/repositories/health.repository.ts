import { prisma } from '../config/prisma';

/** Acesso ao banco para a verificação de saúde. Só consulta, sem regra. */
export const healthRepository = {
  async ping(): Promise<void> {
    await prisma.$queryRaw`SELECT 1`;
  },
};

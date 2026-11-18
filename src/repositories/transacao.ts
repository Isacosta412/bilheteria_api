import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * Cliente usado pelos repositories: o PrismaClient normal ou o cliente de uma transação.
 * Todo método de repository recebe um `cliente` opcional; o service passa o `tx` quando a
 * operação faz parte de uma transação.
 */
export type ClienteBanco = Prisma.TransactionClient;

export const clientePadrao: ClienteBanco = prisma;

/**
 * Executa `fn` dentro de uma transação. Quem decide o que é atômico é o SERVICE:
 *
 *   await emTransacao(async (tx) => {
 *     const sala = await salaRepository.criar(dados, tx);
 *     await assentoRepository.criarVarios(assentos, tx);
 *   });
 *
 * Qualquer erro lançado dentro de `fn` (inclusive um AppError) desfaz tudo (rollback).
 */
export function emTransacao<T>(fn: (tx: ClienteBanco) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 15_000 });
}

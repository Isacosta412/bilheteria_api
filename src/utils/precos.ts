import { Prisma } from '@prisma/client';

/** Meia-entrada: metade do preço da sessão, arredondada para centavos (meio centavo sobe). */
export function precoMeia(preco: Prisma.Decimal): Prisma.Decimal {
  return preco.div(2).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Total da reserva: (quantidade − meias) inteiras + meias com o preço de meia. */
export function totalDaReserva(preco: Prisma.Decimal, quantidade: number, meias: number): Prisma.Decimal {
  return preco.mul(quantidade - meias).add(precoMeia(preco).mul(meias));
}

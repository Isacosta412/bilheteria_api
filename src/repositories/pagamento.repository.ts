import type { MetodoPagamento, Prisma } from '@prisma/client';
import type { ClienteBanco } from './transacao';

export const pagamentoRepository = {
  /** UNIQUE(reserva_id): uma reserva nunca tem dois pagamentos, nem que o service falhe. */
  async criar(
    dados: { reservaId: number; metodo: MetodoPagamento; valor: Prisma.Decimal },
    cliente: ClienteBanco,
  ): Promise<void> {
    await cliente.pagamento.create({ data: dados });
  },
};

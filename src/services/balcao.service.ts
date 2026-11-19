import { CanalReserva } from '@prisma/client';
import { AppError } from '../errors';
import { emTransacao } from '../repositories/transacao';
import type { VenderBalcaoEntrada } from '../schemas/balcao.schema';
import type { UsuarioAutenticado } from '../types/express';
import type { CompraDTO } from '../types/ingresso';
import { montarCompra, pagarNaTransacao } from './pagamento.service';
import { reservarNaTransacao } from './reserva.service';

export const balcaoService = {
  /**
   * Venda no balcão (regra 9): reserva + pagamento em UMA ÚNICA transação, reaproveitando os
   * MESMOS núcleos do app (reservarNaTransacao e pagarNaTransacao): o controle de concorrência
   * não é duplicado. Se algum assento estiver ocupado, o 409 desfaz tudo: nada é cobrado nem emitido.
   */
  async vender(operador: UsuarioAutenticado, entrada: VenderBalcaoEntrada): Promise<CompraDTO> {
    const resultado = await emTransacao(async (tx) => {
      const reservaId = await reservarNaTransacao(
        tx,
        operador,
        { sessaoId: entrada.sessaoId, assentoIds: entrada.assentoIds },
        { canal: CanalReserva.BALCAO, nomeComprador: entrada.nomeComprador },
      );
      return pagarNaTransacao(tx, reservaId, entrada.metodo);
    });

    if (resultado.tipo !== 'pago') {
      // A reserva acabou de ser criada na mesma transação: não há como estar vencida.
      throw new AppError('ERRO_INTERNO', 'Não foi possível concluir a venda. Tente novamente.', 500);
    }
    return montarCompra(resultado.reservaId);
  },
};

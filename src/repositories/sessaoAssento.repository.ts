import { Prisma, type StatusAssento, type TipoAssento } from '@prisma/client';
import { clientePadrao, type ClienteBanco } from './transacao';

/** Linha do mapa como sai do banco. `donoReservaId` e `reservadoAte` ficam só no service (nunca vão para a resposta). */
export interface LinhaMapa {
  assentoId: number;
  fila: string;
  numero: number;
  tipo: TipoAssento;
  status: StatusAssento;
  reservadoAte: Date | null;
  donoReservaId: number | null;
}

export interface AssentoDaReserva {
  assentoId: number;
  fila: string;
  numero: number;
  tipo: TipoAssento;
}

export const sessaoAssentoRepository = {
  async listarMapa(sessaoId: number, cliente: ClienteBanco = clientePadrao): Promise<LinhaMapa[]> {
    const linhas = await cliente.sessaoAssento.findMany({
      where: { sessaoId },
      select: {
        status: true,
        reservadoAte: true,
        assento: { select: { id: true, fila: true, numero: true, tipo: true } },
        reserva: { select: { usuarioId: true } },
      },
    });
    return linhas.map((l) => ({
      assentoId: l.assento.id,
      fila: l.assento.fila,
      numero: l.assento.numero,
      tipo: l.assento.tipo,
      status: l.status,
      reservadoAte: l.reservadoAte,
      donoReservaId: l.reserva?.usuarioId ?? null,
    }));
  },

  /**
   * Passo 3 da reserva: trava as linhas dos assentos pedidos SEMPRE em ordem crescente de
   * assento_id (SELECT ... FOR UPDATE). Duas transações com conjuntos que se cruzam
   * (ex.: {5,6} e {6,5}) pedem os locks na mesma ordem, então não há espera circular (deadlock).
   * Devolve os assento_id encontrados nesta sessão (ids de outra sala simplesmente não aparecem).
   */
  async travarEmOrdem(sessaoId: number, assentoIds: number[], cliente: ClienteBanco): Promise<number[]> {
    const linhas = await cliente.$queryRaw<{ assento_id: number }[]>(Prisma.sql`
      SELECT assento_id
        FROM sessao_assento
       WHERE sessao_id = ${sessaoId}
         AND assento_id = ANY(${assentoIds}::int[])
       ORDER BY assento_id
         FOR UPDATE`);
    return linhas.map((l) => l.assento_id);
  },

  /**
   * Passo 4 da reserva: o UPDATE condicional atômico da regra 3 do CLAUDE.md.
   * Só marca como RESERVADO os assentos que estão LIVRE ou com reserva vencida, e devolve
   * quantas linhas mudou. Quem decide o que fazer com essa contagem é o service.
   *
   * Por que é seguro (READ COMMITTED): se outra transação já marcou o assento e ainda não
   * terminou, este UPDATE ESPERA o lock da linha. Quando ela faz COMMIT, o PostgreSQL reavalia
   * o WHERE na versão nova da linha (agora RESERVADO, com prazo no futuro): a condição é falsa e
   * a linha não é afetada. Se ela fizer ROLLBACK, a linha continua LIVRE e este UPDATE a pega.
   */
  marcarReservados(
    sessaoId: number,
    assentoIds: number[],
    reservaId: number,
    reservadoAte: Date,
    cliente: ClienteBanco,
  ): Promise<number> {
    return cliente.$executeRaw(Prisma.sql`
      UPDATE sessao_assento
         SET status = 'RESERVADO', reserva_id = ${reservaId}, reservado_ate = ${reservadoAte}
       WHERE sessao_id = ${sessaoId}
         AND assento_id = ANY(${assentoIds}::int[])
         AND (status = 'LIVRE' OR (status = 'RESERVADO' AND reservado_ate < now()))`);
  },

  /** Assentos que pertencem à reserva agora (RESERVADO ou VENDIDO). */
  async listarDaReserva(reservaId: number, cliente: ClienteBanco = clientePadrao): Promise<AssentoDaReserva[]> {
    const linhas = await cliente.sessaoAssento.findMany({
      where: { reservaId },
      select: { assento: { select: { id: true, fila: true, numero: true, tipo: true } } },
    });
    return linhas.map((l) => ({ assentoId: l.assento.id, fila: l.assento.fila, numero: l.assento.numero, tipo: l.assento.tipo }));
  },

  /** Devolve para LIVRE os assentos ainda RESERVADO pela reserva. */
  liberarDaReserva(reservaId: number, cliente: ClienteBanco): Promise<number> {
    return cliente.$executeRaw(Prisma.sql`
      UPDATE sessao_assento
         SET status = 'LIVRE', reserva_id = NULL, reservado_ate = NULL
       WHERE reserva_id = ${reservaId} AND status = 'RESERVADO'`);
  },
};

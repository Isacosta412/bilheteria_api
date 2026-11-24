import { Prisma, StatusAssento, type FormatoSessao, type IdiomaSessao } from '@prisma/client';
import { clientePadrao, type ClienteBanco } from './transacao';

/** Relações e contagem de assentos livres no instante `agora`. */
function incluirDetalhes(agora: Date) {
  return {
    filme: { select: { id: true, titulo: true, duracaoMinutos: true, classificacao: true, posterUrl: true } },
    sala: { select: { id: true, nome: true } },
    _count: {
      select: {
        assentos: {
          where: {
            OR: [
              { status: StatusAssento.LIVRE },
              { status: StatusAssento.RESERVADO, reservadoAte: { lt: agora } },
            ],
          },
        },
      },
    },
  } satisfies Prisma.SessaoInclude;
}

export type SessaoComDetalhes = Prisma.SessaoGetPayload<{ include: ReturnType<typeof incluirDetalhes> }>;

export interface FiltroSessoes {
  filmeId?: number | undefined;
  salaId?: number | undefined;
  /** dataHora >= de */
  de?: Date | undefined;
  /** dataHora < ate */
  ate?: Date | undefined;
  incluirCanceladas: boolean;
}

export interface NovaSessao {
  filmeId: number;
  salaId: number;
  dataHora: Date;
  preco: Prisma.Decimal;
  formato: FormatoSessao;
  idioma: IdiomaSessao;
}

/** Sessão da agenda de uma sala, com a duração do filme (para o cálculo de sobreposição no service). */
export interface SessaoAgenda {
  id: number;
  dataHora: Date;
  filme: { titulo: string; duracaoMinutos: number };
}

export const sessaoRepository = {
  listar(filtro: FiltroSessoes, agora: Date, cliente: ClienteBanco = clientePadrao): Promise<SessaoComDetalhes[]> {
    const where: Prisma.SessaoWhereInput = {};
    if (filtro.filmeId !== undefined) where.filmeId = filtro.filmeId;
    if (filtro.salaId !== undefined) where.salaId = filtro.salaId;
    if (!filtro.incluirCanceladas) where.cancelada = false;
    if (filtro.de !== undefined || filtro.ate !== undefined) {
      where.dataHora = {
        ...(filtro.de !== undefined && { gte: filtro.de }),
        ...(filtro.ate !== undefined && { lt: filtro.ate }),
      };
    }
    return cliente.sessao.findMany({ where, include: incluirDetalhes(agora), orderBy: { dataHora: 'asc' } });
  },

  buscarPorId(id: number, agora: Date, cliente: ClienteBanco = clientePadrao): Promise<SessaoComDetalhes | null> {
    return cliente.sessao.findUnique({ where: { id }, include: incluirDetalhes(agora) });
  },

  /** O INSERT dispara a trigger trg_gerar_assentos_sessao, que cria os sessao_assento. */
  async criar(dados: NovaSessao, cliente: ClienteBanco = clientePadrao): Promise<number> {
    const sessao = await cliente.sessao.create({ data: dados, select: { id: true } });
    return sessao.id;
  },

  async atualizar(
    id: number,
    dados: { formato?: FormatoSessao | undefined; idioma?: IdiomaSessao | undefined },
    cliente: ClienteBanco = clientePadrao,
  ): Promise<boolean> {
    const { count } = await cliente.sessao.updateMany({
      where: { id },
      data: {
        ...(dados.formato !== undefined && { formato: dados.formato }),
        ...(dados.idioma !== undefined && { idioma: dados.idioma }),
      },
    });
    return count > 0;
  },

  /** Sessões não canceladas da sala com início em [de, ate). */
  listarAgendaDaSala(salaId: number, de: Date, ate: Date, cliente: ClienteBanco = clientePadrao): Promise<SessaoAgenda[]> {
    return cliente.sessao.findMany({
      where: { salaId, cancelada: false, dataHora: { gte: de, lt: ate } },
      select: { id: true, dataHora: true, filme: { select: { titulo: true, duracaoMinutos: true } } },
      orderBy: { dataHora: 'asc' },
    });
  },

  /** Trava a linha da sessão até o fim da transação. Devolve null se não existe. */
  async travar(id: number, cliente: ClienteBanco): Promise<{ id: number; cancelada: boolean } | null> {
    const linhas = await cliente.$queryRaw<{ id: number; cancelada: boolean }[]>`
      SELECT id, cancelada FROM sessao WHERE id = ${id} FOR UPDATE`;
    return linhas[0] ?? null;
  },

  /**
   * Cancela as reservas PENDENTE da sessão e libera os assentos delas, em um único comando.
   * O UPDATE em reserva espera o lock de um pagamento em andamento (SELECT ... FOR UPDATE).
   * Devolve quantas reservas foram canceladas.
   */
  async cancelarReservasPendentes(sessaoId: number, cliente: ClienteBanco): Promise<number> {
    const [resultado] = await cliente.$queryRaw<{ qtd: number }[]>`
      WITH canceladas AS (
        UPDATE reserva SET status = 'CANCELADA'
         WHERE sessao_id = ${sessaoId} AND status = 'PENDENTE'
        RETURNING id
      ), liberados AS (
        UPDATE sessao_assento sa
           SET status = 'LIVRE', reserva_id = NULL, reservado_ate = NULL
          FROM canceladas c
         WHERE sa.reserva_id = c.id AND sa.status = 'RESERVADO'
        RETURNING sa.id
      )
      SELECT count(*)::INTEGER AS qtd FROM canceladas`;
    return resultado?.qtd ?? 0;
  },

  contarIngressos(sessaoId: number, cliente: ClienteBanco = clientePadrao): Promise<number> {
    return cliente.ingresso.count({ where: { sessaoAssento: { sessaoId } } });
  },

  async marcarCancelada(id: number, cliente: ClienteBanco): Promise<void> {
    await cliente.sessao.update({ where: { id }, data: { cancelada: true } });
  },
};

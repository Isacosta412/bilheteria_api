import { Prisma } from '@prisma/client';
import { clientePadrao, type ClienteBanco } from './transacao';

const comDetalhes = {
  reserva: { select: { usuarioId: true } },
  sessaoAssento: {
    select: {
      assento: { select: { fila: true, numero: true, tipo: true } },
      sessao: {
        select: {
          id: true,
          dataHora: true,
          filme: { select: { id: true, titulo: true, classificacao: true, duracaoMinutos: true } },
          sala: { select: { id: true, nome: true } },
        },
      },
    },
  },
} satisfies Prisma.IngressoInclude;

export type IngressoComDetalhes = Prisma.IngressoGetPayload<{ include: typeof comDetalhes }>;

export const ingressoRepository = {
  /** Quais destes códigos já existem (para gerar de novo os que colidirem antes do INSERT). */
  async codigosExistentes(codigos: string[], cliente: ClienteBanco = clientePadrao): Promise<string[]> {
    const linhas = await cliente.ingresso.findMany({ where: { codigo: { in: codigos } }, select: { codigo: true } });
    return linhas.map((l) => l.codigo);
  },

  /** UNIQUE(sessao_assento_id): um assento de uma sessão nunca gera dois ingressos. */
  async criarVarios(
    dados: { codigo: string; reservaId: number; sessaoAssentoId: number }[],
    cliente: ClienteBanco,
  ): Promise<void> {
    await cliente.ingresso.createMany({ data: dados });
  },

  listarDaReserva(reservaId: number, cliente: ClienteBanco = clientePadrao): Promise<IngressoComDetalhes[]> {
    return cliente.ingresso.findMany({ where: { reservaId }, include: comDetalhes, orderBy: { sessaoAssentoId: 'asc' } });
  },

  listarDoUsuario(usuarioId: number, cliente: ClienteBanco = clientePadrao): Promise<IngressoComDetalhes[]> {
    return cliente.ingresso.findMany({
      where: { reserva: { usuarioId } },
      include: comDetalhes,
      orderBy: [{ sessaoAssento: { sessao: { dataHora: 'asc' } } }, { sessaoAssentoId: 'asc' }],
    });
  },

  buscarPorCodigo(codigo: string, cliente: ClienteBanco = clientePadrao): Promise<IngressoComDetalhes | null> {
    return cliente.ingresso.findUnique({ where: { codigo }, include: comDetalhes });
  },

  /**
   * Validação na entrada (regra 6): UPDATE condicional atômico. Só marca se ainda não foi usado
   * (`utilizado_em IS NULL`). Duas validações simultâneas do mesmo código: a segunda espera o lock
   * da linha, reavalia o WHERE (agora utilizado_em preenchido) e afeta 0 linhas.
   */
  marcarUtilizado(codigo: string, operadorId: number, cliente: ClienteBanco = clientePadrao): Promise<number> {
    return cliente.$executeRaw(Prisma.sql`
      UPDATE ingresso
         SET utilizado_em = now(), validado_por_id = ${operadorId}
       WHERE codigo = ${codigo} AND utilizado_em IS NULL`);
  },
};

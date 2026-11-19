import { Prisma } from '@prisma/client';
import type { Agrupamento, GrupoVendasRow, RelatorioSessaoRow } from '../types/relatorio';
import { clientePadrao, type ClienteBanco } from './transacao';

export interface FiltroRelatorioSessoes {
  de: Date;
  ate: Date;
  filmeId?: number | undefined;
  salaId?: number | undefined;
}

/**
 * Fragmentos FIXOS de agrupamento: o valor vindo do usuário só escolhe uma das chaves deste mapa
 * (validado pelo zod) e nunca é concatenado no SQL.
 */
const AGRUPAMENTOS: Record<Agrupamento, { chave: Prisma.Sql; rotulo: Prisma.Sql; grupo: Prisma.Sql; ordem: Prisma.Sql }> = {
  dia: {
    chave: Prisma.sql`to_char(pago_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`,
    rotulo: Prisma.sql`to_char(pago_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')`,
    grupo: Prisma.sql`1, 2`,
    ordem: Prisma.sql`1`,
  },
  filme: {
    chave: Prisma.sql`filme_id::text`,
    rotulo: Prisma.sql`filme_titulo`,
    grupo: Prisma.sql`filme_id, filme_titulo`,
    ordem: Prisma.sql`receita DESC, rotulo`,
  },
  metodo: {
    chave: Prisma.sql`metodo::text`,
    rotulo: Prisma.sql`metodo::text`,
    grupo: Prisma.sql`metodo`,
    ordem: Prisma.sql`receita DESC, rotulo`,
  },
};

export const relatorioRepository = {
  /**
   * Relatório por sessão: lê a VIEW vw_relatorio_sessoes (sessao + filme + sala + sessao_assento +
   * ingresso). Filtros opcionais são fragmentos Prisma.sql/Prisma.empty: tudo parametrizado.
   */
  listarSessoes(filtro: FiltroRelatorioSessoes, cliente: ClienteBanco = clientePadrao): Promise<RelatorioSessaoRow[]> {
    const porFilme = filtro.filmeId !== undefined ? Prisma.sql`AND filme_id = ${filtro.filmeId}` : Prisma.empty;
    const porSala = filtro.salaId !== undefined ? Prisma.sql`AND sala_id = ${filtro.salaId}` : Prisma.empty;

    return cliente.$queryRaw<RelatorioSessaoRow[]>(Prisma.sql`
      SELECT sessao_id, filme_id, filme_titulo, sala_id, sala_nome, data_hora, preco, cancelada,
             capacidade, vendidos, reservados, livres, taxa_ocupacao, receita
        FROM vw_relatorio_sessoes
       WHERE data_hora >= ${filtro.de}
         AND data_hora < ${filtro.ate}
         AND NOT cancelada
         ${porFilme}
         ${porSala}
       ORDER BY data_hora, sala_nome`);
  },

  /**
   * Vendas agrupadas: junta pagamento + reserva + sessao + filme (e conta os ingressos de cada
   * venda em ingresso), filtrando pela data do pagamento, com receita e ingressos por canal.
   * Contagens com ::int (nunca bigint); somas de dinheiro voltam como Decimal.
   */
  vendas(de: Date, ate: Date, agrupar: Agrupamento, cliente: ClienteBanco = clientePadrao): Promise<GrupoVendasRow[]> {
    const a = AGRUPAMENTOS[agrupar];
    return cliente.$queryRaw<GrupoVendasRow[]>(Prisma.sql`
      WITH vendas AS (
        SELECT p.metodo, p.valor, p.pago_em, r.canal,
               f.id AS filme_id, f.titulo AS filme_titulo,
               (SELECT count(*) FROM ingresso i WHERE i.reserva_id = r.id)::int AS ingressos
          FROM pagamento p
          JOIN reserva r ON r.id = p.reserva_id
          JOIN sessao  s ON s.id = r.sessao_id
          JOIN filme   f ON f.id = s.filme_id
         WHERE p.pago_em >= ${de}
           AND p.pago_em < ${ate}
      )
      SELECT ${a.chave} AS chave,
             ${a.rotulo} AS rotulo,
             count(*)::int AS vendas,
             sum(ingressos)::int AS ingressos,
             sum(valor) AS receita,
             coalesce(sum(ingressos) FILTER (WHERE canal = 'APP'), 0)::int    AS ingressos_app,
             coalesce(sum(valor)     FILTER (WHERE canal = 'APP'), 0)         AS receita_app,
             coalesce(sum(ingressos) FILTER (WHERE canal = 'BALCAO'), 0)::int AS ingressos_balcao,
             coalesce(sum(valor)     FILTER (WHERE canal = 'BALCAO'), 0)      AS receita_balcao
        FROM vendas
       GROUP BY ${a.grupo}
       ORDER BY ${a.ordem}`);
  },
};

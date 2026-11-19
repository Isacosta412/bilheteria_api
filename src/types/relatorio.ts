import type { Prisma } from '@prisma/client';

/** Linha da view vw_relatorio_sessoes como volta do $queryRaw (nomes da view, snake_case). */
export interface RelatorioSessaoRow {
  sessao_id: number;
  filme_id: number;
  filme_titulo: string;
  sala_id: number;
  sala_nome: string;
  data_hora: Date;
  preco: Prisma.Decimal;
  cancelada: boolean;
  capacidade: number;
  vendidos: number;
  reservados: number;
  livres: number;
  taxa_ocupacao: Prisma.Decimal;
  receita: Prisma.Decimal;
}

export interface RelatorioSessaoDTO {
  sessaoId: number;
  filmeId: number;
  filmeTitulo: string;
  salaId: number;
  salaNome: string;
  dataHora: string;
  preco: string;
  cancelada: boolean;
  capacidade: number;
  vendidos: number;
  reservados: number;
  livres: number;
  /** Percentual com 2 casas: "30.00". */
  taxaOcupacao: string;
  receita: string;
}

export interface PeriodoDTO {
  inicio: string;
  fim: string;
}

export interface RelatorioSessoesDTO {
  periodo: PeriodoDTO;
  totais: {
    quantidadeSessoes: number;
    capacidadeTotal: number;
    ingressosVendidos: number;
    assentosReservados: number;
    receitaTotal: string;
    /** Σ vendidos ÷ Σ capacidade × 100 (salas maiores pesam mais). */
    ocupacaoMediaPonderada: string;
  };
  sessoes: RelatorioSessaoDTO[];
}

export type Agrupamento = 'dia' | 'filme' | 'metodo';

/** Linha agrupada das vendas como volta do $queryRaw. */
export interface GrupoVendasRow {
  chave: string;
  rotulo: string;
  vendas: number;
  ingressos: number;
  receita: Prisma.Decimal;
  ingressos_app: number;
  receita_app: Prisma.Decimal;
  ingressos_balcao: number;
  receita_balcao: Prisma.Decimal;
}

export interface CanalDTO {
  ingressos: number;
  receita: string;
}

export interface GrupoVendasDTO {
  chave: string;
  rotulo: string;
  vendas: number;
  ingressos: number;
  receita: string;
  app: CanalDTO;
  balcao: CanalDTO;
}

export interface RelatorioVendasDTO {
  periodo: PeriodoDTO;
  agrupamento: Agrupamento;
  totais: Omit<GrupoVendasDTO, 'chave' | 'rotulo'>;
  grupos: GrupoVendasDTO[];
}

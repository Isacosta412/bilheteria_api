import { Prisma } from '@prisma/client';
import { RegraNegocio } from '../errors';
import { relatorioRepository } from '../repositories/relatorio.repository';
import type { RelatorioSessoesQuery, RelatorioVendasQuery } from '../schemas/relatorio.schema';
import type {
  GrupoVendasDTO,
  GrupoVendasRow,
  RelatorioSessaoDTO,
  RelatorioSessaoRow,
  RelatorioSessoesDTO,
  RelatorioVendasDTO,
} from '../types/relatorio';
import { dataHoraPtBr, decimalPtBr, gerarCsv } from '../utils/csv';
import { resolverPeriodo, type Periodo } from '../utils/periodo';

const MAX_DIAS = 366;
const ZERO = new Prisma.Decimal(0);

/** Regra: período coerente e de no máximo 1 ano. */
function validarPeriodo(inicio?: string, fim?: string): Periodo {
  const periodo = resolverPeriodo(inicio, fim);
  if (periodo.inicio > periodo.fim) {
    throw new RegraNegocio('PERIODO_INVALIDO', 'A data inicial precisa ser anterior ou igual à data final.', {
      inicio: periodo.inicio,
      fim: periodo.fim,
    });
  }
  if (periodo.dias > MAX_DIAS) {
    throw new RegraNegocio('PERIODO_MUITO_LONGO', 'O período máximo do relatório é de 1 ano.', { dias: periodo.dias });
  }
  return periodo;
}

function paraSessaoDTO(linha: RelatorioSessaoRow): RelatorioSessaoDTO {
  return {
    sessaoId: linha.sessao_id,
    filmeId: linha.filme_id,
    filmeTitulo: linha.filme_titulo,
    salaId: linha.sala_id,
    salaNome: linha.sala_nome,
    dataHora: linha.data_hora.toISOString(),
    preco: linha.preco.toFixed(2),
    cancelada: linha.cancelada,
    capacidade: linha.capacidade,
    vendidos: linha.vendidos,
    reservados: linha.reservados,
    livres: linha.livres,
    taxaOcupacao: linha.taxa_ocupacao.toFixed(2),
    receita: linha.receita.toFixed(2),
  };
}

function paraGrupoDTO(linha: GrupoVendasRow): GrupoVendasDTO {
  return {
    chave: linha.chave,
    rotulo: linha.rotulo,
    vendas: linha.vendas,
    ingressos: linha.ingressos,
    receita: linha.receita.toFixed(2),
    app: { ingressos: linha.ingressos_app, receita: linha.receita_app.toFixed(2) },
    balcao: { ingressos: linha.ingressos_balcao, receita: linha.receita_balcao.toFixed(2) },
  };
}

export const relatorioService = {
  /** Ocupação e receita por sessão (view vw_relatorio_sessoes) + totais do período. */
  async sessoes(filtro: RelatorioSessoesQuery): Promise<RelatorioSessoesDTO> {
    const periodo = validarPeriodo(filtro.inicio, filtro.fim);
    const linhas = await relatorioRepository.listarSessoes({
      de: periodo.de,
      ate: periodo.ate,
      filmeId: filtro.filmeId,
      salaId: filtro.salaId,
    });

    let capacidade = 0;
    let vendidos = 0;
    let reservados = 0;
    let receita = ZERO;
    for (const l of linhas) {
      capacidade += l.capacidade;
      vendidos += l.vendidos;
      reservados += l.reservados;
      receita = receita.add(l.receita);
    }
    // Média PONDERADA pela capacidade: uma sala de 200 lugares pesa mais que uma de 20.
    const ocupacao = capacidade > 0 ? new Prisma.Decimal(vendidos).mul(100).div(capacidade) : ZERO;

    return {
      periodo: { inicio: periodo.inicio, fim: periodo.fim },
      totais: {
        quantidadeSessoes: linhas.length,
        capacidadeTotal: capacidade,
        ingressosVendidos: vendidos,
        assentosReservados: reservados,
        receitaTotal: receita.toFixed(2),
        ocupacaoMediaPonderada: ocupacao.toFixed(2),
      },
      sessoes: linhas.map(paraSessaoDTO),
    };
  },

  /** O mesmo relatório em CSV para o Excel pt-BR (separador ";", decimal com vírgula). */
  async sessoesCsv(filtro: RelatorioSessoesQuery): Promise<{ nomeArquivo: string; conteudo: string }> {
    const relatorio = await this.sessoes(filtro);
    const cabecalho = [
      'Data/hora',
      'Filme',
      'Sala',
      'Preço (R$)',
      'Capacidade',
      'Vendidos',
      'Reservados',
      'Livres',
      'Ocupação (%)',
      'Receita (R$)',
    ];
    const linhas = relatorio.sessoes.map((s) => [
      dataHoraPtBr(s.dataHora),
      s.filmeTitulo,
      s.salaNome,
      decimalPtBr(s.preco),
      s.capacidade,
      s.vendidos,
      s.reservados,
      s.livres,
      decimalPtBr(s.taxaOcupacao),
      decimalPtBr(s.receita),
    ]);
    const t = relatorio.totais;
    const rodape = [
      [],
      [
        'TOTAL',
        `${t.quantidadeSessoes} sessão(ões)`,
        '',
        '',
        t.capacidadeTotal,
        t.ingressosVendidos,
        t.assentosReservados,
        '',
        decimalPtBr(t.ocupacaoMediaPonderada),
        decimalPtBr(t.receitaTotal),
      ],
    ];
    return {
      nomeArquivo: `relatorio-sessoes-${relatorio.periodo.inicio}-a-${relatorio.periodo.fim}.csv`,
      conteudo: gerarCsv(cabecalho, [...linhas, ...rodape]),
    };
  },

  /** Vendas do período (pela data do pagamento) agrupadas por dia, filme ou método, separadas por canal. */
  async vendas(filtro: RelatorioVendasQuery): Promise<RelatorioVendasDTO> {
    const periodo = validarPeriodo(filtro.inicio, filtro.fim);
    const linhas = await relatorioRepository.vendas(periodo.de, periodo.ate, filtro.agrupar);

    const soma = { vendas: 0, ingressos: 0, receita: ZERO, ingApp: 0, recApp: ZERO, ingBalcao: 0, recBalcao: ZERO };
    for (const l of linhas) {
      soma.vendas += l.vendas;
      soma.ingressos += l.ingressos;
      soma.receita = soma.receita.add(l.receita);
      soma.ingApp += l.ingressos_app;
      soma.recApp = soma.recApp.add(l.receita_app);
      soma.ingBalcao += l.ingressos_balcao;
      soma.recBalcao = soma.recBalcao.add(l.receita_balcao);
    }

    return {
      periodo: { inicio: periodo.inicio, fim: periodo.fim },
      agrupamento: filtro.agrupar,
      totais: {
        vendas: soma.vendas,
        ingressos: soma.ingressos,
        receita: soma.receita.toFixed(2),
        app: { ingressos: soma.ingApp, receita: soma.recApp.toFixed(2) },
        balcao: { ingressos: soma.ingBalcao, receita: soma.recBalcao.toFixed(2) },
      },
      grupos: linhas.map(paraGrupoDTO),
    };
  },
};

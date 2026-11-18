import { Prisma } from '@prisma/client';
import { DURACAO_MAXIMA_MINUTOS, FUSO_HORARIO, LIMPEZA_MINUTOS } from '../config/constantes';
import { Conflito, NaoEncontrado, RegraNegocio } from '../errors';
import { filmeRepository } from '../repositories/filme.repository';
import { salaRepository } from '../repositories/sala.repository';
import { sessaoRepository, type SessaoComDetalhes } from '../repositories/sessao.repository';
import { emTransacao } from '../repositories/transacao';
import type { CriarSessaoEntrada, ListarSessoesQuery } from '../schemas/sessao.schema';
import type { SessaoDTO } from '../types/sessao';

const MINUTO_MS = 60_000;
const DIA_MS = 24 * 60 * MINUTO_MS;

const somarMinutos = (data: Date, minutos: number): Date => new Date(data.getTime() + minutos * MINUTO_MS);

/** Intervalo em que a sala fica ocupada: do início até o fim do filme + limpeza. */
function fimOcupacao(inicio: Date, duracaoMinutos: number): Date {
  return somarMinutos(inicio, duracaoMinutos + LIMPEZA_MINUTOS);
}

function paraSessaoDTO(sessao: SessaoComDetalhes): SessaoDTO {
  return {
    id: sessao.id,
    dataHora: sessao.dataHora.toISOString(),
    terminoPrevisto: somarMinutos(sessao.dataHora, sessao.filme.duracaoMinutos).toISOString(),
    preco: sessao.preco.toFixed(2),
    cancelada: sessao.cancelada,
    assentosLivres: sessao._count.assentos,
    filme: sessao.filme,
    sala: sessao.sala,
  };
}

async function buscarOuFalhar(id: number): Promise<SessaoDTO> {
  const sessao = await sessaoRepository.buscarPorId(id, new Date());
  if (!sessao) {
    throw new NaoEncontrado('Sessão não encontrada.', 'SESSAO_NAO_ENCONTRADA');
  }
  return paraSessaoDTO(sessao);
}

export const sessaoService = {
  async listar(filtro: ListarSessoesQuery): Promise<SessaoDTO[]> {
    const agora = new Date();
    let de: Date | undefined;
    let ate: Date | undefined;

    if (filtro.data) {
      de = new Date(`${filtro.data}T00:00:00${FUSO_HORARIO}`);
      ate = new Date(de.getTime() + DIA_MS);
    }
    // Por padrão o catálogo só mostra sessões que ainda vão começar.
    if (!filtro.incluirPassadas && (de === undefined || de < agora)) {
      de = agora;
    }

    const sessoes = await sessaoRepository.listar(
      { filmeId: filtro.filmeId, salaId: filtro.salaId, de, ate, incluirCanceladas: filtro.incluirCanceladas },
      agora,
    );
    return sessoes.map(paraSessaoDTO);
  },

  buscarPorId(id: number): Promise<SessaoDTO> {
    return buscarOuFalhar(id);
  },

  /**
   * Regra 7. Valida no service e decide; o repository só consulta e grava.
   * A checagem de sobreposição e o INSERT acontecem na mesma transação, com a sala travada
   * (SELECT ... FOR UPDATE): duas criações simultâneas na mesma sala são executadas uma após a
   * outra, e a segunda já enxerga a sessão criada pela primeira.
   */
  async criar(entrada: CriarSessaoEntrada): Promise<SessaoDTO> {
    if (entrada.dataHora.getTime() <= Date.now()) {
      throw new RegraNegocio('SESSAO_NO_PASSADO', 'A data e hora da sessão precisam estar no futuro.');
    }

    const filme = await filmeRepository.buscarPorId(entrada.filmeId);
    if (!filme) {
      throw new NaoEncontrado('Filme não encontrado.', 'FILME_NAO_ENCONTRADO');
    }
    if (!filme.ativo) {
      throw new RegraNegocio('FILME_INATIVO', 'O filme está desativado e não pode receber novas sessões.');
    }

    const inicio = entrada.dataHora;
    const fim = fimOcupacao(inicio, filme.duracaoMinutos);

    const sessaoId = await emTransacao(async (tx) => {
      if (!(await salaRepository.travar(entrada.salaId, tx))) {
        throw new NaoEncontrado('Sala não encontrada.', 'SALA_NAO_ENCONTRADA');
      }
      const sala = await salaRepository.buscarResumo(entrada.salaId, tx);
      if (!sala?.ativa) {
        throw new RegraNegocio('SALA_INATIVA', 'A sala está desativada e não pode receber novas sessões.');
      }
      if ((await salaRepository.contarAssentos(entrada.salaId, tx)) === 0) {
        throw new RegraNegocio('SALA_SEM_ASSENTOS', 'A sala não tem assentos cadastrados.');
      }

      // Qualquer sessão que comece até (duração máxima + limpeza) antes do início pode invadir o horário.
      const janelaInicio = somarMinutos(inicio, -(DURACAO_MAXIMA_MINUTOS + LIMPEZA_MINUTOS));
      const agenda = await sessaoRepository.listarAgendaDaSala(entrada.salaId, janelaInicio, fim, tx);
      const conflito = agenda.find((existente) => {
        const fimExistente = fimOcupacao(existente.dataHora, existente.filme.duracaoMinutos);
        return inicio < fimExistente && existente.dataHora < fim;
      });
      if (conflito) {
        const liberaEm = fimOcupacao(conflito.dataHora, conflito.filme.duracaoMinutos);
        throw new RegraNegocio(
          'SESSAO_SOBREPOSTA',
          `A sala já tem uma sessão de "${conflito.filme.titulo}" nesse horário ` +
            `(considerando ${LIMPEZA_MINUTOS} minutos de limpeza).`,
          {
            sessaoConflitanteId: conflito.id,
            inicio: conflito.dataHora.toISOString(),
            salaLiberadaEm: liberaEm.toISOString(),
          },
        );
      }

      return sessaoRepository.criar(
        { filmeId: filme.id, salaId: sala.id, dataHora: inicio, preco: new Prisma.Decimal(entrada.preco.toFixed(2)) },
        tx,
      );
    });

    return buscarOuFalhar(sessaoId);
  },

  /**
   * Cancela a sessão se nenhum ingresso foi vendido. Tudo em uma transação:
   * 1) trava a sessão; 2) cancela as reservas pendentes (esperando qualquer pagamento em andamento);
   * 3) só então confere os ingressos. Se houver venda, o erro faz rollback do passo 2.
   * Contar depois de travar as reservas fecha a janela em que um pagamento concluiria entre a
   * checagem e o cancelamento.
   */
  async cancelar(id: number): Promise<SessaoDTO> {
    await emTransacao(async (tx) => {
      const sessao = await sessaoRepository.travar(id, tx);
      if (!sessao) {
        throw new NaoEncontrado('Sessão não encontrada.', 'SESSAO_NAO_ENCONTRADA');
      }
      if (sessao.cancelada) {
        throw new Conflito('SESSAO_JA_CANCELADA', 'Esta sessão já está cancelada.');
      }

      await sessaoRepository.cancelarReservasPendentes(id, tx);

      const ingressos = await sessaoRepository.contarIngressos(id, tx);
      if (ingressos > 0) {
        throw new RegraNegocio(
          'SESSAO_COM_INGRESSOS',
          `A sessão não pode ser cancelada: ${ingressos} ingresso(s) já foram vendidos.`,
        );
      }

      await sessaoRepository.marcarCancelada(id, tx);
    });

    return buscarOuFalhar(id);
  },
};

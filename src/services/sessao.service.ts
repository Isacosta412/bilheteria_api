import { Prisma, StatusAssento } from '@prisma/client';
import { DURACAO_MAXIMA_MINUTOS, FUSO_HORARIO, LIMPEZA_MINUTOS } from '../config/constantes';
import { Conflito, NaoEncontrado, RegraNegocio } from '../errors';
import { filmeRepository } from '../repositories/filme.repository';
import { salaRepository } from '../repositories/sala.repository';
import { sessaoRepository, type SessaoComDetalhes } from '../repositories/sessao.repository';
import { sessaoAssentoRepository, type LinhaMapa } from '../repositories/sessaoAssento.repository';
import { emTransacao } from '../repositories/transacao';
import type { AtualizarSessaoEntrada, CriarSessaoEntrada, ListarSessoesQuery } from '../schemas/sessao.schema';
import { precoMeia } from '../utils/precos';
import type { FilaMapaDTO, MapaAssentosDTO } from '../types/mapa';
import type { SessaoDTO } from '../types/sessao';
import { compararFilas } from '../utils/filas';

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
    precoMeia: precoMeia(sessao.preco).toFixed(2),
    formato: sessao.formato,
    idioma: sessao.idioma,
    cancelada: sessao.cancelada,
    assentosLivres: sessao._count.assentos,
    filme: sessao.filme,
    sala: sessao.sala,
  };
}

/**
 * Status que o cliente deve ver AGORA: um assento RESERVADO cujo prazo já passou está livre
 * para nova reserva (o UPDATE da reserva aceita esse caso), mesmo que o job de expiração
 * ainda não tenha rodado.
 */
function statusEfetivo(linha: LinhaMapa, agora: Date): StatusAssento {
  if (linha.status === StatusAssento.RESERVADO && linha.reservadoAte !== null && linha.reservadoAte < agora) {
    return StatusAssento.LIVRE;
  }
  return linha.status;
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
   * Mapa de assentos da sessão. `usuarioId` (opcional) marca os assentos que o próprio usuário
   * reservou. Nada que identifique outros clientes (reservaId, dono, prazo) sai daqui.
   */
  async mapaAssentos(id: number, usuarioId?: number): Promise<MapaAssentosDTO> {
    const sessao = await buscarOuFalhar(id);
    const agora = new Date();
    const linhas = await sessaoAssentoRepository.listarMapa(id);

    const resumo = { livres: 0, reservados: 0, vendidos: 0 };
    const porFila = new Map<string, FilaMapaDTO>();

    for (const linha of linhas) {
      const status = statusEfetivo(linha, agora);
      if (status === StatusAssento.LIVRE) resumo.livres++;
      else if (status === StatusAssento.RESERVADO) resumo.reservados++;
      else resumo.vendidos++;

      const fila = porFila.get(linha.fila) ?? { fila: linha.fila, assentos: [] };
      fila.assentos.push({
        assentoId: linha.assentoId,
        numero: linha.numero,
        tipo: linha.tipo,
        status,
        minhaReserva:
          status === StatusAssento.RESERVADO && usuarioId !== undefined && linha.donoReservaId === usuarioId,
      });
      porFila.set(linha.fila, fila);
    }

    const filas = [...porFila.values()]
      .sort((a, b) => compararFilas(a.fila, b.fila))
      .map((f) => ({ ...f, assentos: f.assentos.sort((a, b) => a.numero - b.numero) }));

    return { sessao, filas, resumo };
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
        {
          filmeId: filme.id,
          salaId: sala.id,
          dataHora: inicio,
          preco: new Prisma.Decimal(entrada.preco.toFixed(2)),
          formato: entrada.formato,
          idioma: entrada.idioma,
        },
        tx,
      );
    });

    return buscarOuFalhar(sessaoId);
  },

  /** Muda o formato (2D/3D) e/ou o idioma (dublado/legendado) da sessão. */
  async atualizar(id: number, entrada: AtualizarSessaoEntrada): Promise<SessaoDTO> {
    if (!(await sessaoRepository.atualizar(id, entrada))) {
      throw new NaoEncontrado('Sessão não encontrada.', 'SESSAO_NAO_ENCONTRADA');
    }
    return buscarOuFalhar(id);
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

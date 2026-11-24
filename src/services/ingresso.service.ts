import { Papel } from '@prisma/client';
import { env } from '../config/env';
import { Conflito, NaoEncontrado, RegraNegocio } from '../errors';
import { ingressoRepository, type IngressoComDetalhes } from '../repositories/ingresso.repository';
import type { UsuarioAutenticado } from '../types/express';
import type { IngressoDTO, IngressosDaSessaoDTO, StatusIngresso, ValidacaoDTO } from '../types/ingresso';
import { normalizarCodigo } from './codigoIngresso';

const MINUTO_MS = 60_000;

/** Fim do filme (início + duração): até aqui o ingresso vale. */
function fimDaSessao(ingresso: IngressoComDetalhes): Date {
  const { sessao } = ingresso.sessaoAssento;
  return new Date(sessao.dataHora.getTime() + sessao.filme.duracaoMinutos * MINUTO_MS);
}

function statusDoIngresso(ingresso: IngressoComDetalhes, agora: Date): StatusIngresso {
  if (ingresso.utilizadoEm) return 'UTILIZADO';
  if (agora > fimDaSessao(ingresso)) return 'SESSAO_ENCERRADA';
  return 'VALIDO';
}

export function paraIngressoDTO(ingresso: IngressoComDetalhes, agora = new Date()): IngressoDTO {
  const { assento, sessao } = ingresso.sessaoAssento;
  return {
    codigo: ingresso.codigo,
    status: statusDoIngresso(ingresso, agora),
    fila: assento.fila,
    numero: assento.numero,
    tipo: assento.tipo,
    tipoIngresso: ingresso.tipo,
    valor: ingresso.valor.toFixed(2),
    dataHora: sessao.dataHora.toISOString(),
    sessao: {
      id: sessao.id,
      dataHora: sessao.dataHora.toISOString(),
      terminoPrevisto: fimDaSessao(ingresso).toISOString(),
      formato: sessao.formato,
      idioma: sessao.idioma,
    },
    filme: { id: sessao.filme.id, titulo: sessao.filme.titulo, classificacao: sessao.filme.classificacao },
    sala: { id: sessao.sala.id, nome: sessao.sala.nome },
    emitidoEm: ingresso.emitidoEm.toISOString(),
    utilizadoEm: ingresso.utilizadoEm?.toISOString() ?? null,
  };
}

/** Hora no fuso de Brasília para as mensagens ("19:12"). */
function horaBrasilia(data: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(data);
}

function dataHoraBrasilia(data: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(data);
}

function jaUtilizado(utilizadoEm: Date): Conflito {
  return new Conflito('INGRESSO_JA_UTILIZADO', `Ingresso já utilizado às ${horaBrasilia(utilizadoEm)}.`, {
    utilizadoEm: utilizadoEm.toISOString(),
  });
}

const ingressoInvalido = (): NaoEncontrado => new NaoEncontrado('Ingresso inválido.', 'INGRESSO_INVALIDO');

export const ingressoService = {
  /** Ingressos do usuário agrupados por sessão: próximas primeiro (mais perto no topo), depois as passadas. */
  async listarMeus(usuarioId: number): Promise<IngressosDaSessaoDTO[]> {
    const agora = new Date();
    const ingressos = await ingressoRepository.listarDoUsuario(usuarioId);

    const grupos = new Map<number, IngressosDaSessaoDTO>();
    for (const ingresso of ingressos) {
      const dto = paraIngressoDTO(ingresso, agora);
      const grupo = grupos.get(dto.sessao.id) ?? {
        sessao: { ...dto.sessao, filme: dto.filme, sala: dto.sala },
        ingressos: [],
      };
      grupo.ingressos.push(dto);
      grupos.set(dto.sessao.id, grupo);
    }

    const lista = [...grupos.values()];
    const termina = (g: IngressosDaSessaoDTO) => new Date(g.sessao.terminoPrevisto).getTime();
    const inicio = (g: IngressosDaSessaoDTO) => new Date(g.sessao.dataHora).getTime();
    const futuras = lista.filter((g) => termina(g) >= agora.getTime()).sort((a, b) => inicio(a) - inicio(b));
    const passadas = lista.filter((g) => termina(g) < agora.getTime()).sort((a, b) => inicio(b) - inicio(a));
    return [...futuras, ...passadas];
  },

  /** Dono do ingresso (usuário da reserva) ou operador. Para outros, 404 (não confirma que o código existe). */
  async buscarPorCodigo(usuario: UsuarioAutenticado, codigo: string): Promise<IngressoDTO> {
    const ingresso = await ingressoRepository.buscarPorCodigo(normalizarCodigo(codigo));
    if (!ingresso || (usuario.papel !== Papel.OPERADOR && ingresso.reserva.usuarioId !== usuario.id)) {
      throw ingressoInvalido();
    }
    return paraIngressoDTO(ingresso);
  },

  /**
   * Validação na entrada (regra 6).
   *  1. busca o ingresso → inexistente: 404 INGRESSO_INVALIDO;
   *  2. já usado → 409 INGRESSO_JA_UTILIZADO (informando quando);
   *  3. fora da janela (de VALIDACAO_ANTECEDENCIA_MINUTOS antes do início até o fim do filme) → 422.
   *     É conferida ANTES de marcar, para um ingresso fora do horário não ficar como usado;
   *     depende só do relógio, então não abre condição de corrida;
   *  4. UPDATE condicional `WHERE utilizado_em IS NULL`: é ele que garante o uso único. Se afetar
   *     0 linhas, outro operador validou no mesmo instante → 409 com o horário da outra validação.
   */
  async validar(operador: UsuarioAutenticado, codigoDigitado: string): Promise<ValidacaoDTO> {
    const codigo = normalizarCodigo(codigoDigitado);
    const ingresso = await ingressoRepository.buscarPorCodigo(codigo);
    if (!ingresso) throw ingressoInvalido();
    if (ingresso.utilizadoEm) throw jaUtilizado(ingresso.utilizadoEm);

    const agora = new Date();
    const abre = new Date(ingresso.sessaoAssento.sessao.dataHora.getTime() - env.VALIDACAO_ANTECEDENCIA_MINUTOS * MINUTO_MS);
    const fecha = fimDaSessao(ingresso);
    if (agora < abre || agora > fecha) {
      throw new RegraNegocio(
        'INGRESSO_FORA_DO_HORARIO',
        agora < abre
          ? `Fora do horário da sessão: a entrada abre em ${dataHoraBrasilia(abre)}.`
          : 'Fora do horário da sessão: a sessão já terminou.',
        { abre: abre.toISOString(), fecha: fecha.toISOString() },
      );
    }

    const marcados = await ingressoRepository.marcarUtilizado(codigo, operador.id);
    const atualizado = await ingressoRepository.buscarPorCodigo(codigo);
    if (!atualizado) throw ingressoInvalido();
    if (marcados === 0) {
      // Perdeu a corrida para outra validação simultânea.
      throw jaUtilizado(atualizado.utilizadoEm ?? agora);
    }
    return { valido: true, ingresso: paraIngressoDTO(atualizado) };
  },
};

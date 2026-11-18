import { CanalReserva, Papel, StatusReserva } from '@prisma/client';
import { env } from '../config/env';
import { Conflito, NaoEncontrado, RegraNegocio } from '../errors';
import { reservaRepository, type ReservaComDetalhes } from '../repositories/reserva.repository';
import { sessaoAssentoRepository, type AssentoDaReserva } from '../repositories/sessaoAssento.repository';
import { emTransacao } from '../repositories/transacao';
import type { CriarReservaEntrada } from '../schemas/reserva.schema';
import type { UsuarioAutenticado } from '../types/express';
import type { ReservaDTO } from '../types/reserva';

/** Uma PENDENTE com prazo vencido já está expirada, mesmo que o job ainda não tenha rodado. */
function statusEfetivo(reserva: { status: StatusReserva; expiraEm: Date }, agora: Date): StatusReserva {
  if (reserva.status === StatusReserva.PENDENTE && reserva.expiraEm < agora) {
    return StatusReserva.EXPIRADA;
  }
  return reserva.status;
}

function paraReservaDTO(reserva: ReservaComDetalhes, agora = new Date(), assentos?: AssentoDaReserva[]): ReservaDTO {
  return {
    reservaId: reserva.id,
    status: statusEfetivo(reserva, agora),
    canal: reserva.canal,
    total: reserva.total.toFixed(2),
    expiraEm: reserva.expiraEm.toISOString(),
    criadoEm: reserva.criadoEm.toISOString(),
    sessao: {
      id: reserva.sessao.id,
      dataHora: reserva.sessao.dataHora.toISOString(),
      filmeTitulo: reserva.sessao.filme.titulo,
      salaNome: reserva.sessao.sala.nome,
    },
    assentos:
      assentos ??
      reserva.assentos.map((sa) => ({
        assentoId: sa.assento.id,
        fila: sa.assento.fila,
        numero: sa.assento.numero,
        tipo: sa.assento.tipo,
      })),
  };
}

const reservaNaoEncontrada = (): NaoEncontrado => new NaoEncontrado('Reserva não encontrada.', 'RESERVA_NAO_ENCONTRADA');

/**
 * Dono ou operador podem ver/cancelar. Para outro cliente respondemos 404 (e não 403):
 * os ids são sequenciais e um 403 confirmaria que a reserva existe.
 */
function podeAcessar(usuario: UsuarioAutenticado, donoId: number): boolean {
  return usuario.papel === Papel.OPERADOR || usuario.id === donoId;
}

async function buscarDTO(id: number): Promise<ReservaDTO> {
  const reserva = await reservaRepository.buscarPorId(id);
  if (!reserva) throw reservaNaoEncontrada();
  return paraReservaDTO(reserva);
}

export const reservaService = {
  /**
   * Reserva temporária (regras 2 e 3). Tudo em UMA transação; qualquer erro lançado aqui dentro
   * desfaz tudo (rollback): nem a reserva nem os assentos ficam gravados.
   *
   *  1. trava a sessão com FOR SHARE e valida (existe, não cancelada, não começou);
   *  2. cria a reserva PENDENTE com expiraEm e total calculados aqui;
   *  3. trava os assentos pedidos em ordem de assento_id (evita deadlock) e confere se são da sala;
   *  4. UPDATE condicional atômico: só marca os que estão LIVRE ou com reserva vencida;
   *  5. se a contagem de linhas afetadas for menor que a pedida, alguém pegou um dos assentos
   *     antes → Conflito ASSENTO_INDISPONIVEL (409) e rollback.
   *
   * Por que dois pedidos simultâneos nunca levam o mesmo assento (READ COMMITTED):
   * o primeiro a chegar no passo 3/4 trava a linha do assento. O segundo ESPERA esse lock.
   * Quando o primeiro faz COMMIT, o PostgreSQL reavalia o WHERE do UPDATE do segundo na versão
   * nova da linha (agora RESERVADO, com prazo no futuro): a condição é falsa, 0 linhas são
   * afetadas e o segundo recebe 409. Se o primeiro desse ROLLBACK, o segundo pegaria o assento.
   */
  async reservar(usuario: UsuarioAutenticado, entrada: CriarReservaEntrada): Promise<ReservaDTO> {
    const assentoIds = [...entrada.assentoIds].sort((a, b) => a - b);

    const reservaId = await emTransacao(async (tx) => {
      // 1. sessão
      const sessao = await reservaRepository.travarSessaoCompartilhada(entrada.sessaoId, tx);
      if (!sessao) {
        throw new NaoEncontrado('Sessão não encontrada.', 'SESSAO_NAO_ENCONTRADA');
      }
      if (sessao.cancelada) {
        throw new RegraNegocio('SESSAO_CANCELADA', 'Esta sessão foi cancelada.');
      }
      const agora = new Date();
      if (sessao.dataHora <= agora) {
        throw new RegraNegocio('SESSAO_ENCERRADA', 'Esta sessão já começou; não é mais possível reservar.');
      }

      // Regra opcional "1 reserva pendente por sessão" (só clientes): enfileira os pedidos do
      // mesmo cliente para esta sessão, para a checagem do final não ter condição de corrida.
      const ehCliente = usuario.papel === Papel.CLIENTE;
      if (ehCliente) {
        await reservaRepository.travarClienteNaSessao(usuario.id, sessao.id, tx);
      }

      // 2. reserva PENDENTE: prazo e total SEMPRE calculados no servidor (regra 5)
      const expiraEm = new Date(agora.getTime() + env.RESERVA_MINUTOS * 60_000);
      const reserva = await reservaRepository.criar(
        {
          usuarioId: usuario.id,
          sessaoId: sessao.id,
          total: sessao.preco.mul(assentoIds.length),
          expiraEm,
          canal: CanalReserva.APP,
        },
        tx,
      );

      // 3. trava as linhas em ordem fixa e confere se todos os assentos são da sala da sessão
      const encontrados = await sessaoAssentoRepository.travarEmOrdem(sessao.id, assentoIds, tx);
      if (encontrados.length !== assentoIds.length) {
        const validos = new Set(encontrados);
        throw new RegraNegocio('ASSENTO_INVALIDO', 'Um ou mais assentos não pertencem à sala desta sessão.', {
          assentoIds: assentoIds.filter((id) => !validos.has(id)),
        });
      }

      // 4 e 5. UPDATE condicional atômico + decisão pela contagem
      const afetados = await sessaoAssentoRepository.marcarReservados(sessao.id, assentoIds, reserva.id, expiraEm, tx);
      if (afetados !== assentoIds.length) {
        throw new Conflito(
          'ASSENTO_INDISPONIVEL',
          'Um ou mais assentos escolhidos acabaram de ser reservados por outra pessoa. Escolha outros assentos.',
        );
      }

      // Checada DEPOIS do UPDATE: quem perde a disputa por um assento recebe sempre 409.
      if (ehCliente) {
        const outras = await reservaRepository.contarOutrasPendentesValidas(usuario.id, sessao.id, reserva.id, agora, tx);
        if (outras > 0) {
          throw new RegraNegocio(
            'RESERVA_PENDENTE_EXISTENTE',
            'Você já tem uma reserva pendente nesta sessão. Pague ou cancele a reserva atual antes de fazer outra.',
          );
        }
      }

      return reserva.id;
    });

    return buscarDTO(reservaId);
  },

  async listarMinhas(usuarioId: number): Promise<ReservaDTO[]> {
    const agora = new Date();
    const reservas = await reservaRepository.listarDoUsuario(usuarioId);
    return reservas.map((r) => paraReservaDTO(r, agora));
  },

  async buscarPorId(usuario: UsuarioAutenticado, id: number): Promise<ReservaDTO> {
    const reserva = await reservaRepository.buscarPorId(id);
    if (!reserva || !podeAcessar(usuario, reserva.usuarioId)) {
      throw reservaNaoEncontrada();
    }
    return paraReservaDTO(reserva);
  },

  /** Regra 10: cancela uma reserva PENDENTE (do próprio cliente, ou por um operador) e libera os assentos. */
  async cancelar(usuario: UsuarioAutenticado, id: number): Promise<ReservaDTO> {
    const assentosLiberados = await emTransacao(async (tx) => {
      // Trava a reserva: um pagamento simultâneo (que também trava a reserva) espera ou é esperado.
      const reserva = await reservaRepository.travar(id, tx);
      if (!reserva || !podeAcessar(usuario, reserva.usuarioId)) {
        throw reservaNaoEncontrada();
      }
      const status = statusEfetivo(reserva, new Date());
      if (status !== StatusReserva.PENDENTE) {
        throw new RegraNegocio(
          'RESERVA_NAO_PENDENTE',
          `Só reservas pendentes podem ser canceladas (esta está ${status.toLowerCase()}).`,
          { status },
        );
      }

      const assentos = await sessaoAssentoRepository.listarDaReserva(id, tx);
      await reservaRepository.marcarCancelada(id, tx);
      await sessaoAssentoRepository.liberarDaReserva(id, tx);
      return assentos;
    });

    const reserva = await reservaRepository.buscarPorId(id);
    if (!reserva) throw reservaNaoEncontrada();
    // Mostra quais assentos foram liberados (depois do cancelamento eles não pertencem mais à reserva).
    return paraReservaDTO(reserva, new Date(), assentosLiberados);
  },

  /** Chamado pelo job a cada minuto: executa a stored procedure sp_expirar_reservas. */
  expirarVencidas(): Promise<number> {
    return reservaRepository.expirarVencidas();
  },
};

import { MetodoPagamento, StatusReserva } from '@prisma/client';
import { AppError, Conflito, NaoEncontrado, RegraNegocio } from '../errors';
import { ingressoRepository } from '../repositories/ingresso.repository';
import { pagamentoRepository } from '../repositories/pagamento.repository';
import { reservaRepository } from '../repositories/reserva.repository';
import { sessaoAssentoRepository } from '../repositories/sessaoAssento.repository';
import { emTransacao, type ClienteBanco } from '../repositories/transacao';
import type { PagarReservaEntrada } from '../schemas/pagamento.schema';
import type { UsuarioAutenticado } from '../types/express';
import type { CompraDTO } from '../types/ingresso';
import { gerarCodigoIngresso } from './codigoIngresso';
import { paraIngressoDTO } from './ingresso.service';
import { buscarReservaDTO } from './reserva.service';

export interface OpcoesPagamento {
  /** Fluxo do app: só o dono paga. No balcão a reserva acabou de ser criada pelo próprio operador. */
  donoId?: number;
  /** Só fora de produção: lança um erro no fim para demonstrar o rollback. */
  simularFalha?: boolean;
}

/** Resultado da transação. "expirada" não lança dentro dela, para a expiração ser gravada (ver pagar). */
export type ResultadoPagamento = { tipo: 'pago'; reservaId: number } | { tipo: 'expirada' };

/** Gera um código por assento, sem repetir entre si nem com os já existentes no banco. */
async function gerarCodigosUnicos(quantidade: number, tx: ClienteBanco): Promise<string[]> {
  const codigos = new Set<string>();
  for (let tentativa = 0; tentativa < 5 && codigos.size < quantidade; tentativa++) {
    while (codigos.size < quantidade) codigos.add(gerarCodigoIngresso());
    for (const repetido of await ingressoRepository.codigosExistentes([...codigos], tx)) {
      codigos.delete(repetido);
    }
  }
  if (codigos.size < quantidade) {
    throw new AppError('ERRO_INTERNO', 'Não foi possível gerar os códigos dos ingressos. Tente novamente.', 500);
  }
  return [...codigos];
}

/**
 * Núcleo do pagamento simulado (regra 4), executado DENTRO de uma transação recebida.
 * Reaproveitado pelo app (pagar) e pelo balcão (balcaoService.vender).
 *
 *  1. trava a reserva (SELECT ... FOR UPDATE): um 2º pagamento simultâneo espera aqui e, quando
 *     o 1º faz COMMIT, lê o status PAGA e recebe 409;
 *  2. valida dono, status, prazo e horário da sessão;
 *  3. cria o Pagamento com valor = total da reserva (nunca vem do cliente);
 *  4. RESERVADO → VENDIDO; a contagem precisa bater com a quantidade comprada;
 *  5. emite 1 ingresso por assento, com código único e não sequencial;
 *  6. reserva → PAGA.
 * Barreiras no banco: UNIQUE(pagamento.reserva_id) e UNIQUE(ingresso.sessao_assento_id).
 */
export async function pagarNaTransacao(
  tx: ClienteBanco,
  reservaId: number,
  metodo: MetodoPagamento,
  opcoes: OpcoesPagamento = {},
): Promise<ResultadoPagamento> {
  // 1
  const reserva = await reservaRepository.travarParaPagamento(reservaId, tx);
  if (!reserva || (opcoes.donoId !== undefined && reserva.usuarioId !== opcoes.donoId)) {
    throw new NaoEncontrado('Reserva não encontrada.', 'RESERVA_NAO_ENCONTRADA');
  }

  // 2
  if (reserva.status === StatusReserva.PAGA) {
    throw new Conflito('RESERVA_JA_PAGA', 'Esta reserva já foi paga.');
  }
  if (reserva.status === StatusReserva.CANCELADA) {
    throw new Conflito('RESERVA_CANCELADA', 'Esta reserva foi cancelada.');
  }
  if (reserva.status === StatusReserva.EXPIRADA) {
    throw new RegraNegocio('RESERVA_EXPIRADA', 'O tempo da reserva acabou. Escolha os assentos novamente.');
  }
  const agora = new Date();
  if (reserva.expiraEm <= agora) {
    // Venceu, mas o job ainda não rodou: expira agora e libera os assentos (sem lançar aqui dentro).
    await reservaRepository.marcarExpirada(reserva.id, tx);
    await sessaoAssentoRepository.liberarDaReserva(reserva.id, tx);
    return { tipo: 'expirada' };
  }
  if (reserva.dataHoraSessao <= agora) {
    throw new RegraNegocio('SESSAO_ENCERRADA', 'Esta sessão já começou; não é mais possível pagar.');
  }

  // 3
  await pagamentoRepository.criar({ reservaId: reserva.id, metodo, valor: reserva.total }, tx);

  // 4
  const quantidade = reserva.total.div(reserva.precoSessao).toNumber();
  const vendidos = await sessaoAssentoRepository.marcarVendidos(reserva.id, tx);
  if (!Number.isInteger(quantidade) || vendidos !== quantidade) {
    throw new Conflito(
      'ASSENTOS_DIVERGENTES',
      'Os assentos desta reserva mudaram. Faça uma nova reserva.',
      { esperados: quantidade, vendidos },
    );
  }

  // 5
  const sessaoAssentoIds = await sessaoAssentoRepository.listarVendidosDaReserva(reserva.id, tx);
  const codigos = await gerarCodigosUnicos(sessaoAssentoIds.length, tx);
  await ingressoRepository.criarVarios(
    sessaoAssentoIds.map((sessaoAssentoId, i) => ({ codigo: codigos[i]!, reservaId: reserva.id, sessaoAssentoId })),
    tx,
  );

  if (opcoes.simularFalha) {
    // Tudo acima (pagamento, VENDIDO, ingressos) é desfeito pelo rollback.
    throw new AppError('FALHA_SIMULADA', 'Falha simulada no pagamento: nada foi gravado (rollback).', 500);
  }

  // 6
  await reservaRepository.marcarPaga(reserva.id, tx);
  return { tipo: 'pago', reservaId: reserva.id };
}

/** Monta a resposta { reserva, ingressos } depois do COMMIT. */
export async function montarCompra(reservaId: number): Promise<CompraDTO> {
  const agora = new Date();
  const [reserva, ingressos] = await Promise.all([
    buscarReservaDTO(reservaId),
    ingressoRepository.listarDaReserva(reservaId),
  ]);
  return { reserva, ingressos: ingressos.map((i) => paraIngressoDTO(i, agora)) };
}

export const pagamentoService = {
  /** Pagamento pelo app (só o dono). */
  async pagar(usuario: UsuarioAutenticado, reservaId: number, entrada: PagarReservaEntrada): Promise<CompraDTO> {
    const resultado = await emTransacao((tx) =>
      pagarNaTransacao(tx, reservaId, entrada.metodo, { donoId: usuario.id, simularFalha: entrada.simularFalha }),
    );

    if (resultado.tipo === 'expirada') {
      // Lançado só DEPOIS do COMMIT: a reserva fica EXPIRADA e os assentos LIVRE no banco.
      throw new RegraNegocio('RESERVA_EXPIRADA', 'O tempo da reserva acabou e os assentos foram liberados. Escolha novamente.');
    }
    return montarCompra(resultado.reservaId);
  },
};

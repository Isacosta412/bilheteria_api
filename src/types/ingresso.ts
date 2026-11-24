import type { Classificacao, FormatoSessao, IdiomaSessao, TipoAssento, TipoIngresso } from '@prisma/client';
import type { ReservaDTO } from './reserva';

export type StatusIngresso = 'VALIDO' | 'UTILIZADO' | 'SESSAO_ENCERRADA';

/** Ingresso devolvido pela API. Não expõe reservaId, quem validou nem dados do comprador. */
export interface IngressoDTO {
  codigo: string;
  status: StatusIngresso;
  fila: string;
  numero: number;
  tipo: TipoAssento;
  /** Inteira ou meia-entrada. */
  tipoIngresso: TipoIngresso;
  /** Valor pago por este ingresso, em reais ("12.50"). */
  valor: string;
  /** Início da sessão (repetido aqui para facilitar a exibição). */
  dataHora: string;
  sessao: { id: number; dataHora: string; terminoPrevisto: string; formato: FormatoSessao; idioma: IdiomaSessao };
  filme: { id: number; titulo: string; classificacao: Classificacao };
  sala: { id: number; nome: string };
  emitidoEm: string;
  utilizadoEm: string | null;
}

export interface IngressosDaSessaoDTO {
  sessao: {
    id: number;
    dataHora: string;
    terminoPrevisto: string;
    filme: IngressoDTO['filme'];
    sala: IngressoDTO['sala'];
  };
  ingressos: IngressoDTO[];
}

/** Resposta do pagamento e da venda no balcão. */
export interface CompraDTO {
  reserva: ReservaDTO;
  ingressos: IngressoDTO[];
}

export interface ValidacaoDTO {
  valido: true;
  ingresso: IngressoDTO;
}

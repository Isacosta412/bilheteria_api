import type { CanalReserva, StatusReserva, TipoAssento } from '@prisma/client';

export interface AssentoReservaDTO {
  assentoId: number;
  fila: string;
  numero: number;
  tipo: TipoAssento;
}

export interface ReservaDTO {
  reservaId: number;
  /** Status efetivo: uma PENDENTE com prazo vencido aparece como EXPIRADA. */
  status: StatusReserva;
  canal: CanalReserva;
  /** Só nas vendas de balcão, quando o operador informa. */
  nomeComprador: string | null;
  /** Em reais, calculado no servidor: quantidade × preço da sessão. */
  total: string;
  expiraEm: string;
  criadoEm: string;
  sessao: {
    id: number;
    dataHora: string;
    filmeTitulo: string;
    salaNome: string;
  };
  /** Assentos que a reserva prende (PENDENTE) ou comprou (PAGA). Vazio quando expirada/cancelada. */
  assentos: AssentoReservaDTO[];
}

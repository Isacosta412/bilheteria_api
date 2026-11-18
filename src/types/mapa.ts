import type { StatusAssento, TipoAssento } from '@prisma/client';
import type { SessaoDTO } from './sessao';

/** Assento no mapa. Nunca expõe reservaId nem dados de quem reservou. */
export interface AssentoMapaDTO {
  assentoId: number;
  numero: number;
  tipo: TipoAssento;
  /** Status efetivo: um RESERVADO com prazo vencido aparece como LIVRE. */
  status: StatusAssento;
  /** true só para o usuário logado que reservou este assento. */
  minhaReserva: boolean;
}

export interface FilaMapaDTO {
  fila: string;
  assentos: AssentoMapaDTO[];
}

export interface MapaAssentosDTO {
  sessao: SessaoDTO;
  filas: FilaMapaDTO[];
  resumo: { livres: number; reservados: number; vendidos: number };
}

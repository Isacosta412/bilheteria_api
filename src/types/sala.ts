import type { TipoAssento } from '@prisma/client';

export interface SalaDTO {
  id: number;
  nome: string;
  ativa: boolean;
  capacidade: number;
  qtdFilas: number;
  criadoEm: string;
  atualizadoEm: string;
}

export interface AssentoLayoutDTO {
  id: number;
  numero: number;
  tipo: TipoAssento;
}

export interface FilaLayoutDTO {
  fila: string;
  assentos: AssentoLayoutDTO[];
}

export interface SalaDetalheDTO extends SalaDTO {
  layout: FilaLayoutDTO[];
}

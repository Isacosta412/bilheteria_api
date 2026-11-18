import type { Classificacao } from '@prisma/client';

export interface FilmeDTO {
  id: number;
  titulo: string;
  sinopse: string;
  duracaoMinutos: number;
  classificacao: Classificacao;
  genero: string;
  posterUrl: string | null;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

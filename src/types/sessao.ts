import type { Classificacao } from '@prisma/client';

export interface SessaoDTO {
  id: number;
  dataHora: string;
  /** Fim do filme (sem o intervalo de limpeza). */
  terminoPrevisto: string;
  /** Em reais, com 2 casas: "30.00". */
  preco: string;
  cancelada: boolean;
  /** Livres agora: LIVRE + RESERVADO com prazo vencido. */
  assentosLivres: number;
  filme: {
    id: number;
    titulo: string;
    duracaoMinutos: number;
    classificacao: Classificacao;
    posterUrl: string | null;
  };
  sala: {
    id: number;
    nome: string;
  };
}

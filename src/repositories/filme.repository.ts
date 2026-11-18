import type { Classificacao, Filme, Prisma } from '@prisma/client';
import { clientePadrao, type ClienteBanco } from './transacao';

export interface DadosFilme {
  titulo: string;
  sinopse: string;
  duracaoMinutos: number;
  classificacao: Classificacao;
  genero: string;
  posterUrl: string | null;
}

export interface FiltroFilmes {
  ativo?: boolean;
  busca?: string;
}

export const filmeRepository = {
  listar(filtro: FiltroFilmes, cliente: ClienteBanco = clientePadrao): Promise<Filme[]> {
    const where: Prisma.FilmeWhereInput = {};
    if (filtro.ativo !== undefined) where.ativo = filtro.ativo;
    if (filtro.busca !== undefined) where.titulo = { contains: filtro.busca, mode: 'insensitive' };
    return cliente.filme.findMany({ where, orderBy: { titulo: 'asc' } });
  },

  buscarPorId(id: number, cliente: ClienteBanco = clientePadrao): Promise<Filme | null> {
    return cliente.filme.findUnique({ where: { id } });
  },

  criar(dados: DadosFilme, cliente: ClienteBanco = clientePadrao): Promise<Filme> {
    return cliente.filme.create({ data: dados });
  },

  atualizar(id: number, dados: DadosFilme, cliente: ClienteBanco = clientePadrao): Promise<Filme> {
    return cliente.filme.update({ where: { id }, data: dados });
  },

  definirAtivo(id: number, ativo: boolean, cliente: ClienteBanco = clientePadrao): Promise<Filme> {
    return cliente.filme.update({ where: { id }, data: { ativo } });
  },

  contarSessoes(id: number, cliente: ClienteBanco = clientePadrao): Promise<number> {
    return cliente.sessao.count({ where: { filmeId: id } });
  },

  async excluir(id: number, cliente: ClienteBanco = clientePadrao): Promise<void> {
    await cliente.filme.delete({ where: { id } });
  },
};

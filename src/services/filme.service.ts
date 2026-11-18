import type { Filme } from '@prisma/client';
import { NaoEncontrado, RegraNegocio } from '../errors';
import { filmeRepository, type DadosFilme } from '../repositories/filme.repository';
import type { FilmeEntrada, ListarFilmesQuery } from '../schemas/filme.schema';
import type { FilmeDTO } from '../types/filme';

function paraFilmeDTO(filme: Filme): FilmeDTO {
  return {
    id: filme.id,
    titulo: filme.titulo,
    sinopse: filme.sinopse,
    duracaoMinutos: filme.duracaoMinutos,
    classificacao: filme.classificacao,
    genero: filme.genero,
    posterUrl: filme.posterUrl,
    ativo: filme.ativo,
    criadoEm: filme.criadoEm.toISOString(),
    atualizadoEm: filme.atualizadoEm.toISOString(),
  };
}

/** PUT é substituição completa: posterUrl ausente vira null. */
function paraDados(entrada: FilmeEntrada): DadosFilme {
  return { ...entrada, posterUrl: entrada.posterUrl ?? null };
}

async function buscarOuFalhar(id: number): Promise<Filme> {
  const filme = await filmeRepository.buscarPorId(id);
  if (!filme) {
    throw new NaoEncontrado('Filme não encontrado.', 'FILME_NAO_ENCONTRADO');
  }
  return filme;
}

export const filmeService = {
  async listar(filtro: ListarFilmesQuery): Promise<FilmeDTO[]> {
    const filmes = await filmeRepository.listar(filtro);
    return filmes.map(paraFilmeDTO);
  },

  async buscarPorId(id: number): Promise<FilmeDTO> {
    return paraFilmeDTO(await buscarOuFalhar(id));
  },

  async criar(entrada: FilmeEntrada): Promise<FilmeDTO> {
    return paraFilmeDTO(await filmeRepository.criar(paraDados(entrada)));
  },

  async atualizar(id: number, entrada: FilmeEntrada): Promise<FilmeDTO> {
    await buscarOuFalhar(id);
    return paraFilmeDTO(await filmeRepository.atualizar(id, paraDados(entrada)));
  },

  async definirAtivo(id: number, ativo: boolean): Promise<FilmeDTO> {
    await buscarOuFalhar(id);
    return paraFilmeDTO(await filmeRepository.definirAtivo(id, ativo));
  },

  /** Exclusão física só para filmes sem nenhuma sessão; com histórico, o caminho é desativar. */
  async excluir(id: number): Promise<void> {
    await buscarOuFalhar(id);
    const sessoes = await filmeRepository.contarSessoes(id);
    if (sessoes > 0) {
      throw new RegraNegocio(
        'FILME_COM_SESSOES',
        `O filme tem ${sessoes} sessão(ões) cadastrada(s) e não pode ser excluído. Desative-o em vez de excluir.`,
      );
    }
    // Se uma sessão for criada entre a checagem e o DELETE, a FK sessao → filme (RESTRICT)
    // recusa a exclusão (P2003) e o errorHandler devolve 409.
    await filmeRepository.excluir(id);
  },
};

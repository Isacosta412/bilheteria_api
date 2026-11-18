import type { Request, Response } from 'express';
import { lerBody, lerParams, lerQuery } from '../middlewares/validar';
import type { IdParam } from '../schemas/comum';
import type { AlterarAtivoEntrada, FilmeEntrada, ListarFilmesQuery } from '../schemas/filme.schema';
import { filmeService } from '../services/filme.service';
import type { FilmeDTO } from '../types/filme';

export const filmeController = {
  async listar(req: Request, res: Response<FilmeDTO[]>): Promise<void> {
    res.json(await filmeService.listar(lerQuery<ListarFilmesQuery>(req)));
  },

  async buscarPorId(req: Request, res: Response<FilmeDTO>): Promise<void> {
    res.json(await filmeService.buscarPorId(lerParams<IdParam>(req).id));
  },

  async criar(req: Request, res: Response<FilmeDTO>): Promise<void> {
    res.status(201).json(await filmeService.criar(lerBody<FilmeEntrada>(req)));
  },

  async atualizar(req: Request, res: Response<FilmeDTO>): Promise<void> {
    res.json(await filmeService.atualizar(lerParams<IdParam>(req).id, lerBody<FilmeEntrada>(req)));
  },

  async definirAtivo(req: Request, res: Response<FilmeDTO>): Promise<void> {
    const { ativo } = lerBody<AlterarAtivoEntrada>(req);
    res.json(await filmeService.definirAtivo(lerParams<IdParam>(req).id, ativo));
  },

  async excluir(req: Request, res: Response): Promise<void> {
    await filmeService.excluir(lerParams<IdParam>(req).id);
    res.status(204).end();
  },
};

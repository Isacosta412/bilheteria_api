import type { Request, Response } from 'express';
import { lerBody, lerParams } from '../middlewares/validar';
import type { IdParam } from '../schemas/comum';
import type { AtualizarSalaEntrada, CriarSalaEntrada } from '../schemas/sala.schema';
import { salaService } from '../services/sala.service';
import type { SalaDetalheDTO, SalaDTO } from '../types/sala';

export const salaController = {
  async listar(_req: Request, res: Response<SalaDTO[]>): Promise<void> {
    res.json(await salaService.listar());
  },

  async buscarPorId(req: Request, res: Response<SalaDetalheDTO>): Promise<void> {
    res.json(await salaService.buscarPorId(lerParams<IdParam>(req).id));
  },

  async criar(req: Request, res: Response<SalaDetalheDTO>): Promise<void> {
    res.status(201).json(await salaService.criar(lerBody<CriarSalaEntrada>(req)));
  },

  async atualizar(req: Request, res: Response<SalaDetalheDTO>): Promise<void> {
    res.json(await salaService.atualizar(lerParams<IdParam>(req).id, lerBody<AtualizarSalaEntrada>(req)));
  },
};

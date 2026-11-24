import type { Request, Response } from 'express';
import { lerBody, lerParams, lerQuery } from '../middlewares/validar';
import type { IdParam } from '../schemas/comum';
import type { AtualizarSessaoEntrada, CriarSessaoEntrada, ListarSessoesQuery } from '../schemas/sessao.schema';
import { sessaoService } from '../services/sessao.service';
import type { MapaAssentosDTO } from '../types/mapa';
import type { SessaoDTO } from '../types/sessao';

export const sessaoController = {
  async listar(req: Request, res: Response<SessaoDTO[]>): Promise<void> {
    res.json(await sessaoService.listar(lerQuery<ListarSessoesQuery>(req)));
  },

  async buscarPorId(req: Request, res: Response<SessaoDTO>): Promise<void> {
    res.json(await sessaoService.buscarPorId(lerParams<IdParam>(req).id));
  },

  async mapaAssentos(req: Request, res: Response<MapaAssentosDTO>): Promise<void> {
    res.json(await sessaoService.mapaAssentos(lerParams<IdParam>(req).id, req.usuario?.id));
  },

  async criar(req: Request, res: Response<SessaoDTO>): Promise<void> {
    res.status(201).json(await sessaoService.criar(lerBody<CriarSessaoEntrada>(req)));
  },

  async atualizar(req: Request, res: Response<SessaoDTO>): Promise<void> {
    res.json(await sessaoService.atualizar(lerParams<IdParam>(req).id, lerBody<AtualizarSessaoEntrada>(req)));
  },

  async cancelar(req: Request, res: Response<SessaoDTO>): Promise<void> {
    res.json(await sessaoService.cancelar(lerParams<IdParam>(req).id));
  },
};

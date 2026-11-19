import type { Request, Response } from 'express';
import { usuarioLogado } from '../middlewares/autenticacao';
import { lerBody, lerParams } from '../middlewares/validar';
import type { CodigoParam, ValidarIngressoEntrada } from '../schemas/ingresso.schema';
import { ingressoService } from '../services/ingresso.service';
import type { IngressoDTO, IngressosDaSessaoDTO, ValidacaoDTO } from '../types/ingresso';

export const ingressoController = {
  async listarMeus(req: Request, res: Response<IngressosDaSessaoDTO[]>): Promise<void> {
    res.json(await ingressoService.listarMeus(usuarioLogado(req).id));
  },

  async buscarPorCodigo(req: Request, res: Response<IngressoDTO>): Promise<void> {
    res.json(await ingressoService.buscarPorCodigo(usuarioLogado(req), lerParams<CodigoParam>(req).codigo));
  },

  async validar(req: Request, res: Response<ValidacaoDTO>): Promise<void> {
    res.json(await ingressoService.validar(usuarioLogado(req), lerBody<ValidarIngressoEntrada>(req).codigo));
  },
};

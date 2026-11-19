import type { Request, Response } from 'express';
import { usuarioLogado } from '../middlewares/autenticacao';
import { lerBody } from '../middlewares/validar';
import type { VenderBalcaoEntrada } from '../schemas/balcao.schema';
import { balcaoService } from '../services/balcao.service';
import type { CompraDTO } from '../types/ingresso';

export const balcaoController = {
  async vender(req: Request, res: Response<CompraDTO>): Promise<void> {
    res.status(201).json(await balcaoService.vender(usuarioLogado(req), lerBody<VenderBalcaoEntrada>(req)));
  },
};

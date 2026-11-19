import type { Request, Response } from 'express';
import { usuarioLogado } from '../middlewares/autenticacao';
import { lerBody, lerParams } from '../middlewares/validar';
import type { IdParam } from '../schemas/comum';
import type { PagarReservaEntrada } from '../schemas/pagamento.schema';
import { pagamentoService } from '../services/pagamento.service';
import type { CompraDTO } from '../types/ingresso';

export const pagamentoController = {
  async pagar(req: Request, res: Response<CompraDTO>): Promise<void> {
    const compra = await pagamentoService.pagar(usuarioLogado(req), lerParams<IdParam>(req).id, lerBody<PagarReservaEntrada>(req));
    res.status(201).json(compra);
  },
};

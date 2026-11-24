import type { Request, Response } from 'express';
import { usuarioLogado } from '../middlewares/autenticacao';
import { lerBody, lerParams } from '../middlewares/validar';
import type { IdParam } from '../schemas/comum';
import type { AlterarMeiasEntrada, CriarReservaEntrada } from '../schemas/reserva.schema';
import { reservaService } from '../services/reserva.service';
import type { ReservaDTO } from '../types/reserva';

export const reservaController = {
  async reservar(req: Request, res: Response<ReservaDTO>): Promise<void> {
    const reserva = await reservaService.reservar(usuarioLogado(req), lerBody<CriarReservaEntrada>(req));
    res.status(201).json(reserva);
  },

  async listarMinhas(req: Request, res: Response<ReservaDTO[]>): Promise<void> {
    res.json(await reservaService.listarMinhas(usuarioLogado(req).id));
  },

  async buscarPorId(req: Request, res: Response<ReservaDTO>): Promise<void> {
    res.json(await reservaService.buscarPorId(usuarioLogado(req), lerParams<IdParam>(req).id));
  },

  async alterarMeias(req: Request, res: Response<ReservaDTO>): Promise<void> {
    res.json(
      await reservaService.alterarMeias(usuarioLogado(req), lerParams<IdParam>(req).id, lerBody<AlterarMeiasEntrada>(req)),
    );
  },

  async cancelar(req: Request, res: Response<ReservaDTO>): Promise<void> {
    res.json(await reservaService.cancelar(usuarioLogado(req), lerParams<IdParam>(req).id));
  },
};

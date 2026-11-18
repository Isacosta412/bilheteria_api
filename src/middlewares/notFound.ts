import type { RequestHandler } from 'express';
import { NaoEncontrado } from '../errors';

/** Qualquer rota não registrada cai aqui e vira 404 no formato padrão. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(new NaoEncontrado(`Rota ${req.method} ${req.path} não encontrada.`, 'ROTA_NAO_ENCONTRADA'));
};

import { Router } from 'express';
import { Papel } from '@prisma/client';
import { ingressoController } from '../controllers/ingresso.controller';
import { autenticar, autorizar } from '../middlewares/autenticacao';
import { validar } from '../middlewares/validar';
import { codigoParamSchema, validarIngressoSchema } from '../schemas/ingresso.schema';

export const ingressoRoutes: Router = Router();
ingressoRoutes.use(autenticar);

// "/meus" e "/validar" antes de "/:codigo", para não serem lidos como código.
ingressoRoutes.get('/meus', ingressoController.listarMeus);
ingressoRoutes.post(
  '/validar',
  autorizar(Papel.OPERADOR),
  validar({ body: validarIngressoSchema }),
  ingressoController.validar,
);
ingressoRoutes.get('/:codigo', validar({ params: codigoParamSchema }), ingressoController.buscarPorCodigo);

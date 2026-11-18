import { Router } from 'express';
import { Papel } from '@prisma/client';
import { reservaController } from '../controllers/reserva.controller';
import { autenticar, autorizar } from '../middlewares/autenticacao';
import { validar } from '../middlewares/validar';
import { idParamSchema } from '../schemas/comum';
import { criarReservaSchema } from '../schemas/reserva.schema';

// Todas as rotas de reserva exigem login (CLIENTE ou OPERADOR).
export const reservaRoutes: Router = Router();
reservaRoutes.use(autenticar, autorizar(Papel.CLIENTE, Papel.OPERADOR));

reservaRoutes.post('/', validar({ body: criarReservaSchema }), reservaController.reservar);
// "/minhas" vem antes de "/:id" para não ser lido como um id.
reservaRoutes.get('/minhas', reservaController.listarMinhas);
reservaRoutes.get('/:id', validar({ params: idParamSchema }), reservaController.buscarPorId);
reservaRoutes.delete('/:id', validar({ params: idParamSchema }), reservaController.cancelar);

import { Router } from 'express';
import { Papel } from '@prisma/client';
import { pagamentoController } from '../controllers/pagamento.controller';
import { reservaController } from '../controllers/reserva.controller';
import { pagarReservaSchema } from '../schemas/pagamento.schema';
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
// Pagamento simulado: só o dono (o service responde 404 para outros usuários).
reservaRoutes.post(
  '/:id/pagamento',
  validar({ params: idParamSchema, body: pagarReservaSchema }),
  pagamentoController.pagar,
);

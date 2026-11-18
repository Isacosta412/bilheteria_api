import { Router } from 'express';
import { Papel } from '@prisma/client';
import { salaController } from '../controllers/sala.controller';
import { autenticar, autorizar } from '../middlewares/autenticacao';
import { validar } from '../middlewares/validar';
import { idParamSchema } from '../schemas/comum';
import { atualizarSalaSchema, criarSalaSchema } from '../schemas/sala.schema';

// Salas são gestão interna: todas as rotas exigem OPERADOR.
export const salaRoutes: Router = Router();
salaRoutes.use(autenticar, autorizar(Papel.OPERADOR));

salaRoutes.get('/', salaController.listar);
salaRoutes.get('/:id', validar({ params: idParamSchema }), salaController.buscarPorId);
salaRoutes.post('/', validar({ body: criarSalaSchema }), salaController.criar);
salaRoutes.put('/:id', validar({ params: idParamSchema, body: atualizarSalaSchema }), salaController.atualizar);

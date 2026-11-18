import { Router } from 'express';
import { Papel } from '@prisma/client';
import { sessaoController } from '../controllers/sessao.controller';
import { autenticar, autorizar } from '../middlewares/autenticacao';
import { validar } from '../middlewares/validar';
import { idParamSchema } from '../schemas/comum';
import { criarSessaoSchema, listarSessoesQuerySchema } from '../schemas/sessao.schema';

export const sessaoRoutes: Router = Router();
const somenteOperador = [autenticar, autorizar(Papel.OPERADOR)];

// Leitura pública (catálogo)
sessaoRoutes.get('/', validar({ query: listarSessoesQuerySchema }), sessaoController.listar);
sessaoRoutes.get('/:id', validar({ params: idParamSchema }), sessaoController.buscarPorId);

// Escrita: somente OPERADOR
sessaoRoutes.post('/', ...somenteOperador, validar({ body: criarSessaoSchema }), sessaoController.criar);
sessaoRoutes.patch('/:id/cancelar', ...somenteOperador, validar({ params: idParamSchema }), sessaoController.cancelar);

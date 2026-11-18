import { Router } from 'express';
import { Papel } from '@prisma/client';
import { filmeController } from '../controllers/filme.controller';
import { autenticar, autorizar } from '../middlewares/autenticacao';
import { validar } from '../middlewares/validar';
import { idParamSchema } from '../schemas/comum';
import { alterarAtivoSchema, filmeSchema, listarFilmesQuerySchema } from '../schemas/filme.schema';

export const filmeRoutes: Router = Router();
const somenteOperador = [autenticar, autorizar(Papel.OPERADOR)];

// Leitura pública (catálogo)
filmeRoutes.get('/', validar({ query: listarFilmesQuerySchema }), filmeController.listar);
filmeRoutes.get('/:id', validar({ params: idParamSchema }), filmeController.buscarPorId);

// Escrita: somente OPERADOR
filmeRoutes.post('/', ...somenteOperador, validar({ body: filmeSchema }), filmeController.criar);
filmeRoutes.put('/:id', ...somenteOperador, validar({ params: idParamSchema, body: filmeSchema }), filmeController.atualizar);
filmeRoutes.patch(
  '/:id/ativo',
  ...somenteOperador,
  validar({ params: idParamSchema, body: alterarAtivoSchema }),
  filmeController.definirAtivo,
);
filmeRoutes.delete('/:id', ...somenteOperador, validar({ params: idParamSchema }), filmeController.excluir);

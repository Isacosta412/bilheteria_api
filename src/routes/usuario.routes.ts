import { Router } from 'express';
import { Papel } from '@prisma/client';
import { usuarioController } from '../controllers/usuario.controller';
import { autenticar, autorizar } from '../middlewares/autenticacao';
import { validar } from '../middlewares/validar';
import { criarOperadorSchema } from '../schemas/auth.schema';

export const usuarioRoutes: Router = Router();

usuarioRoutes.post(
  '/operadores',
  autenticar,
  autorizar(Papel.OPERADOR),
  validar({ body: criarOperadorSchema }),
  usuarioController.criarOperador,
);

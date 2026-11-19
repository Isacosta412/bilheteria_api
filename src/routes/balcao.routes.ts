import { Router } from 'express';
import { Papel } from '@prisma/client';
import { balcaoController } from '../controllers/balcao.controller';
import { autenticar, autorizar } from '../middlewares/autenticacao';
import { validar } from '../middlewares/validar';
import { venderBalcaoSchema } from '../schemas/balcao.schema';

export const balcaoRoutes: Router = Router();
balcaoRoutes.use(autenticar, autorizar(Papel.OPERADOR));

balcaoRoutes.post('/vendas', validar({ body: venderBalcaoSchema }), balcaoController.vender);

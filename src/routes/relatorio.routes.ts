import { Router } from 'express';
import { Papel } from '@prisma/client';
import { relatorioController } from '../controllers/relatorio.controller';
import { autenticar, autorizar } from '../middlewares/autenticacao';
import { validar } from '../middlewares/validar';
import { relatorioSessoesQuerySchema, relatorioVendasQuerySchema } from '../schemas/relatorio.schema';

// Relatórios gerenciais: somente OPERADOR.
export const relatorioRoutes: Router = Router();
relatorioRoutes.use(autenticar, autorizar(Papel.OPERADOR));

// "/sessoes.csv" antes de "/sessoes".
relatorioRoutes.get('/sessoes.csv', validar({ query: relatorioSessoesQuerySchema }), relatorioController.sessoesCsv);
relatorioRoutes.get('/sessoes', validar({ query: relatorioSessoesQuerySchema }), relatorioController.sessoes);
relatorioRoutes.get('/vendas', validar({ query: relatorioVendasQuerySchema }), relatorioController.vendas);

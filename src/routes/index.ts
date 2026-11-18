import { Router } from 'express';
import { healthRoutes } from './health.routes';

/** Agrega todas as rotas da API. Novos módulos (auth, filmes, sessoes...) são registrados aqui. */
export const routes: Router = Router();

routes.use('/health', healthRoutes);

import { Router } from 'express';
import { authRoutes } from './auth.routes';
import { filmeRoutes } from './filme.routes';
import { healthRoutes } from './health.routes';
import { reservaRoutes } from './reserva.routes';
import { salaRoutes } from './sala.routes';
import { sessaoRoutes } from './sessao.routes';
import { usuarioRoutes } from './usuario.routes';

/** Agrega todas as rotas da API. */
export const routes: Router = Router();

routes.use('/health', healthRoutes);
routes.use('/auth', authRoutes);
routes.use('/usuarios', usuarioRoutes);
routes.use('/filmes', filmeRoutes);
routes.use('/salas', salaRoutes);
routes.use('/sessoes', sessaoRoutes);
routes.use('/reservas', reservaRoutes);

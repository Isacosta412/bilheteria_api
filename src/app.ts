import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { routes } from './routes';
import { limiteAutenticacao } from './middlewares/rateLimit';
import { notFound } from './middlewares/notFound';
import { errorHandler } from './middlewares/errorHandler';

/** Monta o app Express (sem `listen`, para poder ser usado pelo supertest). */
export function criarApp(): Express {
  const app = express();

  // Atrás do proxy do provedor de nuvem, para o rate limit enxergar o IP real do cliente.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '100kb' }));

  // Rate limit aplicado a todas as rotas de autenticação (registradas na etapa B04).
  app.use('/auth', limiteAutenticacao);

  app.use(routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export const app = criarApp();

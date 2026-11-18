import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { autenticar } from '../middlewares/autenticacao';
import { validar } from '../middlewares/validar';
import { loginSchema, registrarSchema } from '../schemas/auth.schema';

// O rate limit de /auth é aplicado no app.ts, antes deste router.
export const authRoutes: Router = Router();

authRoutes.post('/registrar', validar({ body: registrarSchema }), authController.registrar);
authRoutes.post('/login', validar({ body: loginSchema }), authController.login);
authRoutes.get('/me', autenticar, authController.me);

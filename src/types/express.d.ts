import type { Papel } from '@prisma/client';

/** Usuário extraído do JWT pelo middleware `autenticar`. */
export interface UsuarioAutenticado {
  id: number;
  papel: Papel;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
    }
  }
}

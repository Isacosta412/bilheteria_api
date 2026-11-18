import jwt, { type SignOptions } from 'jsonwebtoken';
import { Papel } from '@prisma/client';
import { env } from '../config/env';
import { NaoAutenticado } from '../errors';
import type { UsuarioAutenticado } from '../types/express';

const ALGORITMO = 'HS256';

export const tokenService = {
  gerar(usuario: UsuarioAutenticado): string {
    return jwt.sign({ papel: usuario.papel }, env.JWT_SECRET, {
      subject: String(usuario.id),
      algorithm: ALGORITMO,
      // O env valida o formato (ex.: 1d, 12h, 3600); o tipo do jsonwebtoken é mais estreito que string.
      expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    });
  },

  verificar(token: string): UsuarioAutenticado {
    let conteudo: string | jwt.JwtPayload;
    try {
      conteudo = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITMO] });
    } catch {
      throw new NaoAutenticado('Sessão inválida ou expirada. Faça login novamente.', 'TOKEN_INVALIDO');
    }

    const id = typeof conteudo === 'object' ? Number(conteudo.sub) : Number.NaN;
    const papel: unknown = typeof conteudo === 'object' ? conteudo['papel'] : undefined;
    if (!Number.isInteger(id) || id <= 0 || (papel !== Papel.CLIENTE && papel !== Papel.OPERADOR)) {
      throw new NaoAutenticado('Sessão inválida ou expirada. Faça login novamente.', 'TOKEN_INVALIDO');
    }
    return { id, papel };
  },
};

import type { Papel } from '@prisma/client';

/** Usuário devolvido pela API. Nunca inclui senhaHash. */
export interface UsuarioDTO {
  id: number;
  nome: string;
  email: string;
  papel: Papel;
  criadoEm: string;
}

export interface LoginDTO {
  token: string;
  usuario: UsuarioDTO;
}

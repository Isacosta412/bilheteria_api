import type { Papel, Prisma } from '@prisma/client';
import { clientePadrao, type ClienteBanco } from './transacao';

/** Campos públicos do usuário: o select explícito garante que senha_hash nunca sai daqui por engano. */
const camposPublicos = {
  id: true,
  nome: true,
  email: true,
  papel: true,
  criadoEm: true,
} satisfies Prisma.UsuarioSelect;

export type UsuarioPublico = Prisma.UsuarioGetPayload<{ select: typeof camposPublicos }>;

export interface UsuarioComSenha extends UsuarioPublico {
  senhaHash: string;
}

export interface NovoUsuario {
  nome: string;
  email: string;
  senhaHash: string;
  papel: Papel;
}

export const usuarioRepository = {
  criar(dados: NovoUsuario, cliente: ClienteBanco = clientePadrao): Promise<UsuarioPublico> {
    return cliente.usuario.create({ data: dados, select: camposPublicos });
  },

  buscarPorId(id: number, cliente: ClienteBanco = clientePadrao): Promise<UsuarioPublico | null> {
    return cliente.usuario.findUnique({ where: { id }, select: camposPublicos });
  },

  async existeEmail(email: string, cliente: ClienteBanco = clientePadrao): Promise<boolean> {
    const encontrado = await cliente.usuario.findUnique({ where: { email }, select: { id: true } });
    return encontrado !== null;
  },

  /** Único método que devolve o hash da senha: usado só para conferir o login. */
  buscarComSenhaPorEmail(email: string, cliente: ClienteBanco = clientePadrao): Promise<UsuarioComSenha | null> {
    return cliente.usuario.findUnique({
      where: { email },
      select: { ...camposPublicos, senhaHash: true },
    });
  },
};

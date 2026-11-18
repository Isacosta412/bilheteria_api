import type { Request, Response } from 'express';
import { usuarioLogado } from '../middlewares/autenticacao';
import { lerBody } from '../middlewares/validar';
import type { LoginEntrada, RegistrarEntrada } from '../schemas/auth.schema';
import { authService } from '../services/auth.service';
import { usuarioService } from '../services/usuario.service';
import type { LoginDTO, UsuarioDTO } from '../types/usuario';

export const authController = {
  async registrar(req: Request, res: Response<UsuarioDTO>): Promise<void> {
    const usuario = await usuarioService.registrarCliente(lerBody<RegistrarEntrada>(req));
    res.status(201).json(usuario);
  },

  async login(req: Request, res: Response<LoginDTO>): Promise<void> {
    res.json(await authService.login(lerBody<LoginEntrada>(req)));
  },

  async me(req: Request, res: Response<UsuarioDTO>): Promise<void> {
    res.json(await authService.usuarioAtual(usuarioLogado(req).id));
  },
};

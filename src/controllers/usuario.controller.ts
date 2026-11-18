import type { Request, Response } from 'express';
import { lerBody } from '../middlewares/validar';
import type { CriarOperadorEntrada } from '../schemas/auth.schema';
import { usuarioService } from '../services/usuario.service';
import type { UsuarioDTO } from '../types/usuario';

export const usuarioController = {
  async criarOperador(req: Request, res: Response<UsuarioDTO>): Promise<void> {
    const operador = await usuarioService.criarOperador(lerBody<CriarOperadorEntrada>(req));
    res.status(201).json(operador);
  },
};

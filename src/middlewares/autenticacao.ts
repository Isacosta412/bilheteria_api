import type { Request, RequestHandler } from 'express';
import type { Papel } from '@prisma/client';
import { NaoAutenticado, SemPermissao } from '../errors';
import { tokenService } from '../services/token.service';
import type { UsuarioAutenticado } from '../types/express';

/** Exige `Authorization: Bearer <token>` válido e preenche `req.usuario`. */
export const autenticar: RequestHandler = (req, _res, next) => {
  const cabecalho = req.headers.authorization;
  const [tipo, token] = cabecalho?.split(' ') ?? [];
  if (tipo !== 'Bearer' || !token) {
    throw new NaoAutenticado('Faça login para continuar.');
  }
  req.usuario = tokenService.verificar(token);
  next();
};

/**
 * Login opcional: sem cabeçalho, segue anônimo; com token, ele precisa ser válido
 * (um token vencido devolve 401 para o app saber que precisa logar de novo).
 */
export const autenticacaoOpcional: RequestHandler = (req, res, next) => {
  if (!req.headers.authorization) {
    next();
    return;
  }
  autenticar(req, res, next);
};

/** Exige que o usuário autenticado tenha um dos papéis informados. Use depois de `autenticar`. */
export function autorizar(...papeis: Papel[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.usuario) {
      throw new NaoAutenticado('Faça login para continuar.');
    }
    if (!papeis.includes(req.usuario.papel)) {
      throw new SemPermissao();
    }
    next();
  };
}

/** Usuário autenticado de uma rota protegida por `autenticar`. */
export function usuarioLogado(req: Request): UsuarioAutenticado {
  if (!req.usuario) {
    throw new NaoAutenticado('Faça login para continuar.');
  }
  return req.usuario;
}

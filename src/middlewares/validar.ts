import type { Request, RequestHandler } from 'express';
import type { ZodType } from 'zod';

export interface SchemasRequisicao {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/**
 * Valida body, params e/ou query com zod e substitui os valores pelos dados já convertidos
 * (ex.: strings de query viram números). Em caso de erro, o ZodError segue para o errorHandler (400).
 *
 * Uso: router.post('/sessoes', validar({ body: criarSessaoSchema }), controller.criar)
 */
export function validar(schemas: SchemasRequisicao): RequestHandler {
  return (req, _res, next) => {
    if (schemas.params) {
      req.params = schemas.params.parse(req.params) as typeof req.params;
    }
    if (schemas.query) {
      // No Express 5, req.query é um getter: redefinimos a propriedade com o valor validado.
      Object.defineProperty(req, 'query', {
        value: schemas.query.parse(req.query),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    if (schemas.body) {
      req.body = schemas.body.parse(req.body ?? {});
    }
    next();
  };
}

/*
 * Leitura tipada dos dados já validados.
 * Os tipos do Express dizem que body é `any` e params/query são strings; depois do `validar`
 * eles já têm o formato do schema (números convertidos, defaults aplicados). Estes helpers
 * concentram o único cast em um lugar só, e só devem ser usados em rotas que passaram pelo `validar`.
 */
export function lerBody<T>(req: Request): T {
  return req.body as T;
}

export function lerParams<T>(req: Request): T {
  return req.params as unknown as T;
}

export function lerQuery<T>(req: Request): T {
  return req.query as unknown as T;
}

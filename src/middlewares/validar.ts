import type { RequestHandler } from 'express';
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

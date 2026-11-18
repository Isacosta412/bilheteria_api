import type { ErrorRequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { AppError } from '../errors';
import type { RespostaErro } from '../types/erro';

function responder(
  res: Response,
  statusHttp: number,
  codigo: string,
  mensagem: string,
  detalhes?: unknown,
): void {
  const corpo: RespostaErro = { erro: { codigo, mensagem } };
  if (detalhes !== undefined) {
    corpo.erro.detalhes = detalhes;
  }
  res.status(statusHttp).json(corpo);
}

/** Erros lançados pelo body-parser do express.json (JSON malformado, corpo grande demais...). */
interface ErroBodyParser {
  type: string;
  status: number;
}

function ehErroBodyParser(erro: unknown): erro is ErroBodyParser {
  return (
    typeof erro === 'object' &&
    erro !== null &&
    'type' in erro &&
    typeof erro.type === 'string' &&
    'status' in erro &&
    typeof erro.status === 'number'
  );
}

function camposDoAlvo(meta: Record<string, unknown> | undefined): string[] {
  const alvo = meta?.['target'];
  if (Array.isArray(alvo)) {
    return alvo.filter((campo): campo is string => typeof campo === 'string');
  }
  return typeof alvo === 'string' ? [alvo] : [];
}

function tratarErroPrisma(res: Response, erro: Prisma.PrismaClientKnownRequestError): boolean {
  switch (erro.code) {
    case 'P2002': {
      const campos = camposDoAlvo(erro.meta);
      responder(
        res,
        409,
        'REGISTRO_DUPLICADO',
        campos.length > 0
          ? `Já existe um registro com o mesmo valor em: ${campos.join(', ')}.`
          : 'Já existe um registro com esses dados.',
        campos.length > 0 ? { campos } : undefined,
      );
      return true;
    }
    case 'P2025':
      responder(res, 404, 'NAO_ENCONTRADO', 'Registro não encontrado.');
      return true;
    case 'P2003':
      responder(
        res,
        409,
        'VIOLACAO_CHAVE_ESTRANGEIRA',
        'A operação viola um relacionamento entre registros (referência inexistente ou em uso).',
      );
      return true;
    default:
      return false;
  }
}

/**
 * Converte qualquer erro no formato `{ erro: { codigo, mensagem, detalhes? } }`.
 * Nunca devolve stack trace em produção.
 */
export const errorHandler: ErrorRequestHandler = (erro: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(erro);
    return;
  }

  if (erro instanceof AppError) {
    responder(res, erro.statusHttp, erro.codigo, erro.message, erro.detalhes);
    return;
  }

  if (erro instanceof ZodError) {
    responder(
      res,
      400,
      'DADOS_INVALIDOS',
      'Os dados enviados são inválidos.',
      erro.issues.map((issue) => ({
        campo: issue.path.map(String).join('.'),
        mensagem: issue.message,
      })),
    );
    return;
  }

  if (ehErroBodyParser(erro)) {
    if (erro.type === 'entity.parse.failed') {
      responder(res, 400, 'JSON_INVALIDO', 'O corpo da requisição não é um JSON válido.');
      return;
    }
    if (erro.type === 'entity.too.large') {
      responder(res, 413, 'CORPO_MUITO_GRANDE', 'O corpo da requisição é grande demais.');
      return;
    }
  }

  if (erro instanceof Prisma.PrismaClientKnownRequestError && tratarErroPrisma(res, erro)) {
    return;
  }

  console.error('[erro não tratado]', erro);
  const detalhes =
    env.NODE_ENV !== 'production' && erro instanceof Error
      ? { mensagem: erro.message, stack: erro.stack }
      : undefined;
  responder(res, 500, 'ERRO_INTERNO', 'Erro interno do servidor.', detalhes);
};

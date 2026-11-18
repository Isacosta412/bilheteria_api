import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { Conflito, RegraNegocio } from '../src/errors';
import { errorHandler } from '../src/middlewares/errorHandler';
import { validar } from '../src/middlewares/validar';

/** App mínimo só para exercitar o errorHandler e o validar. */
function appDeTeste(): express.Express {
  const teste = express();
  teste.use(express.json());

  teste.get('/conflito', () => {
    throw new Conflito('ASSENTO_INDISPONIVEL', 'Um ou mais assentos não estão disponíveis.');
  });
  teste.get('/regra', async () => {
    throw new RegraNegocio('SESSAO_NO_PASSADO', 'Não é possível criar sessão no passado.');
  });
  teste.get('/prisma-p2002', () => {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'teste',
      meta: { target: ['email'] },
    });
  });
  teste.get('/inesperado', () => {
    throw new Error('falha inesperada');
  });
  teste.post(
    '/itens/:id',
    validar({
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({ pagina: z.coerce.number().int().min(1).default(1) }),
      body: z.object({ nome: z.string().min(1) }),
    }),
    (req, res) => {
      res.json({ params: req.params, query: req.query, body: req.body });
    },
  );

  teste.use(errorHandler);
  return teste;
}

describe('tratamento de erros', () => {
  it('rota inexistente → 404 ROTA_NAO_ENCONTRADA', async () => {
    const resposta = await request(app).get('/nao-existe');

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({
      erro: { codigo: 'ROTA_NAO_ENCONTRADA', mensagem: 'Rota GET /nao-existe não encontrada.' },
    });
  });

  it('JSON malformado → 400 JSON_INVALIDO', async () => {
    const resposta = await request(app)
      .post('/qualquer')
      .set('Content-Type', 'application/json')
      .send('{"nome": ');

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe('JSON_INVALIDO');
  });

  it('AppError síncrono e assíncrono usam o próprio status e código', async () => {
    const conflito = await request(appDeTeste()).get('/conflito');
    expect(conflito.status).toBe(409);
    expect(conflito.body.erro.codigo).toBe('ASSENTO_INDISPONIVEL');

    const regra = await request(appDeTeste()).get('/regra');
    expect(regra.status).toBe(422);
    expect(regra.body.erro.codigo).toBe('SESSAO_NO_PASSADO');
  });

  it('Prisma P2002 → 409 REGISTRO_DUPLICADO com os campos', async () => {
    const resposta = await request(appDeTeste()).get('/prisma-p2002');

    expect(resposta.status).toBe(409);
    expect(resposta.body.erro.codigo).toBe('REGISTRO_DUPLICADO');
    expect(resposta.body.erro.detalhes).toEqual({ campos: ['email'] });
  });

  it('erro inesperado → 500 ERRO_INTERNO', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const resposta = await request(appDeTeste()).get('/inesperado');

    expect(resposta.status).toBe(500);
    expect(resposta.body.erro.codigo).toBe('ERRO_INTERNO');
    expect(resposta.body.erro.mensagem).toBe('Erro interno do servidor.');
  });
});

describe('middleware validar', () => {
  it('converte params, query e body válidos', async () => {
    const resposta = await request(appDeTeste()).post('/itens/7?pagina=2').send({ nome: 'Sala 1' });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ params: { id: 7 }, query: { pagina: 2 }, body: { nome: 'Sala 1' } });
  });

  it('dados inválidos → 400 DADOS_INVALIDOS com a lista de campos', async () => {
    const resposta = await request(appDeTeste()).post('/itens/abc').send({ nome: '' });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe('DADOS_INVALIDOS');
    expect(resposta.body.erro.detalhes).toEqual(
      expect.arrayContaining([expect.objectContaining({ campo: 'id' })]),
    );
  });
});

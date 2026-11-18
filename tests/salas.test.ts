import request from 'supertest';
import { Papel } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { criarFilme, criarSala, criarSessao, criarUsuario, daquiA, limparBanco, type UsuarioTeste } from './helpers/banco';

let operador: UsuarioTeste;

beforeEach(async () => {
  await limparBanco();
  operador = await criarUsuario(Papel.OPERADOR);
});

describe('POST /salas', () => {
  it('com qtdFilas: o service gera filas × assentos, com PCD e VIP marcados', async () => {
    const resposta = await request(app)
      .post('/salas')
      .set(operador.auth)
      .send({
        nome: 'Sala 1',
        qtdFilas: 3,
        assentosPorFila: 4,
        assentosPcd: [{ fila: 'A', numero: 1 }],
        assentosVip: [{ fila: 'C', numero: 4 }],
      });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ nome: 'Sala 1', capacidade: 12, qtdFilas: 3, ativa: true });
    expect(resposta.body.layout.map((f: { fila: string }) => f.fila)).toEqual(['A', 'B', 'C']);
    expect(resposta.body.layout[0].assentos[0]).toMatchObject({ numero: 1, tipo: 'PCD' });
    expect(resposta.body.layout[2].assentos[3]).toMatchObject({ numero: 4, tipo: 'VIP' });
    expect(await prisma.assento.count({ where: { salaId: resposta.body.id } })).toBe(12);
  });

  it('com a lista de filas', async () => {
    const resposta = await request(app)
      .post('/salas')
      .set(operador.auth)
      .send({ nome: 'Sala 2', filas: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], assentosPorFila: 12 });

    expect(resposta.status).toBe(201);
    expect(resposta.body.capacidade).toBe(120);
    expect(resposta.body.layout).toHaveLength(10);
  });

  it('exige exatamente um entre filas e qtdFilas (400)', async () => {
    const ambos = await request(app)
      .post('/salas')
      .set(operador.auth)
      .send({ nome: 'X', filas: ['A'], qtdFilas: 2, assentosPorFila: 5 });
    const nenhum = await request(app).post('/salas').set(operador.auth).send({ nome: 'Y', assentosPorFila: 5 });

    expect(ambos.status).toBe(400);
    expect(nenhum.status).toBe(400);
  });

  it('PCD fora do layout → 422 e nada é gravado', async () => {
    const resposta = await request(app)
      .post('/salas')
      .set(operador.auth)
      .send({ nome: 'Sala 3', qtdFilas: 2, assentosPorFila: 5, assentosPcd: [{ fila: 'Z', numero: 1 }] });

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro.codigo).toBe('ASSENTO_FORA_DO_LAYOUT');
    expect(await prisma.sala.count()).toBe(0);
  });

  it('nome repetido → 409', async () => {
    await request(app).post('/salas').set(operador.auth).send({ nome: 'Sala 1', qtdFilas: 1, assentosPorFila: 1 });
    const resposta = await request(app).post('/salas').set(operador.auth).send({ nome: 'sala 1', qtdFilas: 1, assentosPorFila: 1 });

    expect(resposta.status).toBe(409);
    expect(resposta.body.erro.codigo).toBe('SALA_NOME_EM_USO');
  });

  it('cliente não acessa salas (403)', async () => {
    const cliente = await criarUsuario(Papel.CLIENTE);
    expect((await request(app).get('/salas').set(cliente.auth)).status).toBe(403);
  });
});

describe('PUT /salas/:id', () => {
  it('sem sessões: troca a estrutura', async () => {
    const sala = await criarSala(2, 5);
    const resposta = await request(app)
      .put(`/salas/${sala.id}`)
      .set(operador.auth)
      .send({ nome: 'Sala Reformada', ativa: true, estrutura: { qtdFilas: 4, assentosPorFila: 6 } });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ nome: 'Sala Reformada', capacidade: 24 });
  });

  it('com sessão futura: estrutura bloqueada (422), mas renomear continua permitido', async () => {
    const sala = await criarSala(2, 5);
    const filme = await criarFilme();
    await criarSessao(filme.id, sala.id, daquiA(24));

    const estrutura = await request(app)
      .put(`/salas/${sala.id}`)
      .set(operador.auth)
      .send({ nome: sala.nome, ativa: true, estrutura: { qtdFilas: 3, assentosPorFila: 5 } });
    expect(estrutura.status).toBe(422);
    expect(estrutura.body.erro.codigo).toBe('SALA_COM_SESSOES_FUTURAS');
    expect(await prisma.assento.count({ where: { salaId: sala.id } })).toBe(10);

    const renomear = await request(app)
      .put(`/salas/${sala.id}`)
      .set(operador.auth)
      .send({ nome: 'Novo Nome', ativa: true });
    expect(renomear.status).toBe(200);
    expect(renomear.body.nome).toBe('Novo Nome');
  });

  it('só com sessões passadas: estrutura bloqueada por histórico (422)', async () => {
    const sala = await criarSala(2, 5);
    const filme = await criarFilme();
    await criarSessao(filme.id, sala.id, daquiA(-48));

    const resposta = await request(app)
      .put(`/salas/${sala.id}`)
      .set(operador.auth)
      .send({ nome: sala.nome, ativa: true, estrutura: { qtdFilas: 3, assentosPorFila: 5 } });

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro.codigo).toBe('SALA_COM_HISTORICO');
  });
});

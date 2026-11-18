import request from 'supertest';
import { Papel } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import {
  criarFilme,
  criarSala,
  criarSessao,
  criarUsuario,
  daquiA,
  limparBanco,
  venderUmAssento,
  type UsuarioTeste,
} from './helpers/banco';

let operador: UsuarioTeste;

beforeEach(async () => {
  await limparBanco();
  operador = await criarUsuario(Papel.OPERADOR);
});

const minutosDepois = (data: Date, minutos: number): Date => new Date(data.getTime() + minutos * 60_000);

describe('POST /sessoes', () => {
  it('cria a sessão (201) e a trigger gera um sessao_assento LIVRE por assento da sala', async () => {
    const filme = await criarFilme({ duracaoMinutos: 120 });
    const sala = await criarSala(4, 8); // 32 lugares
    const dataHora = daquiA(24);

    const resposta = await request(app)
      .post('/sessoes')
      .set(operador.auth)
      .send({ filmeId: filme.id, salaId: sala.id, dataHora: dataHora.toISOString(), preco: 32.5 });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({
      preco: '32.50',
      cancelada: false,
      assentosLivres: 32,
      dataHora: dataHora.toISOString(),
      terminoPrevisto: minutosDepois(dataHora, 120).toISOString(),
      filme: { id: filme.id },
      sala: { id: sala.id },
    });

    const linhas = await prisma.sessaoAssento.findMany({ where: { sessaoId: resposta.body.id } });
    expect(linhas).toHaveLength(32);
    expect(linhas.every((l) => l.status === 'LIVRE')).toBe(true);
  });

  it('sobreposição na mesma sala (duração + 15 min de limpeza) → 422 SESSAO_SOBREPOSTA', async () => {
    const filme = await criarFilme({ duracaoMinutos: 120 });
    const sala = await criarSala();
    const primeira = daquiA(24);
    const corpo = { filmeId: filme.id, salaId: sala.id, preco: 30 };

    expect((await request(app).post('/sessoes').set(operador.auth).send({ ...corpo, dataHora: primeira.toISOString() })).status).toBe(201);

    // começa 130 min depois: o filme acabou (120), mas a limpeza (15) ainda não
    const sobreposta = await request(app)
      .post('/sessoes')
      .set(operador.auth)
      .send({ ...corpo, dataHora: minutosDepois(primeira, 130).toISOString() });
    expect(sobreposta.status).toBe(422);
    expect(sobreposta.body.erro.codigo).toBe('SESSAO_SOBREPOSTA');
    expect(sobreposta.body.erro.detalhes.salaLiberadaEm).toBe(minutosDepois(primeira, 135).toISOString());

    // começa 30 min ANTES da primeira: invadiria o horário dela
    const antes = await request(app)
      .post('/sessoes')
      .set(operador.auth)
      .send({ ...corpo, dataHora: minutosDepois(primeira, -30).toISOString() });
    expect(antes.status).toBe(422);

    // exatamente quando a sala é liberada (120 + 15): permitido
    const seguinte = await request(app)
      .post('/sessoes')
      .set(operador.auth)
      .send({ ...corpo, dataHora: minutosDepois(primeira, 135).toISOString() });
    expect(seguinte.status).toBe(201);
  });

  it('o mesmo horário em OUTRA sala é permitido', async () => {
    const filme = await criarFilme();
    const sala1 = await criarSala();
    const sala2 = await criarSala();
    const dataHora = daquiA(24).toISOString();

    const r1 = await request(app).post('/sessoes').set(operador.auth).send({ filmeId: filme.id, salaId: sala1.id, dataHora, preco: 30 });
    const r2 = await request(app).post('/sessoes').set(operador.auth).send({ filmeId: filme.id, salaId: sala2.id, dataHora, preco: 30 });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
  });

  it('regras: passado, filme inativo, sala inativa e sala sem assentos → 422', async () => {
    const filme = await criarFilme();
    const filmeInativo = await criarFilme({ ativo: false });
    const sala = await criarSala();
    const salaInativa = await criarSala(2, 5, false);
    const salaVazia = await criarSala(0, 0);
    const futuro = daquiA(24).toISOString();

    const casos = [
      { corpo: { filmeId: filme.id, salaId: sala.id, dataHora: daquiA(-1).toISOString() }, codigo: 'SESSAO_NO_PASSADO' },
      { corpo: { filmeId: filmeInativo.id, salaId: sala.id, dataHora: futuro }, codigo: 'FILME_INATIVO' },
      { corpo: { filmeId: filme.id, salaId: salaInativa.id, dataHora: futuro }, codigo: 'SALA_INATIVA' },
      { corpo: { filmeId: filme.id, salaId: salaVazia.id, dataHora: futuro }, codigo: 'SALA_SEM_ASSENTOS' },
    ];
    for (const caso of casos) {
      const resposta = await request(app).post('/sessoes').set(operador.auth).send({ ...caso.corpo, preco: 30 });
      expect(resposta.status, caso.codigo).toBe(422);
      expect(resposta.body.erro.codigo).toBe(caso.codigo);
    }
    expect(await prisma.sessao.count()).toBe(0);
  });

  it('preço com mais de 2 casas ou dataHora sem fuso → 400', async () => {
    const filme = await criarFilme();
    const sala = await criarSala();

    const preco = await request(app)
      .post('/sessoes')
      .set(operador.auth)
      .send({ filmeId: filme.id, salaId: sala.id, dataHora: daquiA(24).toISOString(), preco: 10.999 });
    const semFuso = await request(app)
      .post('/sessoes')
      .set(operador.auth)
      .send({ filmeId: filme.id, salaId: sala.id, dataHora: '2030-01-01T20:00:00', preco: 10 });

    expect(preco.status).toBe(400);
    expect(semFuso.status).toBe(400);
  });

  it('cliente não cria sessão (403)', async () => {
    const cliente = await criarUsuario(Papel.CLIENTE);
    const resposta = await request(app).post('/sessoes').set(cliente.auth).send({});
    expect(resposta.status).toBe(403);
  });
});

describe('GET /sessoes (público)', () => {
  it('por padrão mostra só futuras e não canceladas; filtros opcionais', async () => {
    const filmeA = await criarFilme({ titulo: 'A' });
    const filmeB = await criarFilme({ titulo: 'B' });
    const sala = await criarSala();
    const futura = await criarSessao(filmeA.id, sala.id, daquiA(24));
    const outraFutura = await criarSessao(filmeB.id, sala.id, daquiA(48));
    await criarSessao(filmeA.id, sala.id, daquiA(-24)); // passada
    const cancelada = await criarSessao(filmeA.id, sala.id, daquiA(72));
    await prisma.sessao.update({ where: { id: cancelada.id }, data: { cancelada: true } });

    const padrao = await request(app).get('/sessoes');
    expect(padrao.status).toBe(200);
    expect(padrao.body.map((s: { id: number }) => s.id)).toEqual([futura.id, outraFutura.id]);

    const porFilme = await request(app).get(`/sessoes?filmeId=${filmeB.id}`);
    expect(porFilme.body.map((s: { id: number }) => s.id)).toEqual([outraFutura.id]);

    const todas = await request(app).get('/sessoes?incluirPassadas=true&incluirCanceladas=true');
    expect(todas.body).toHaveLength(4);
  });
});

describe('PATCH /sessoes/:id/cancelar', () => {
  it('com ingresso vendido → 422 e nada muda (rollback)', async () => {
    const cliente = await criarUsuario(Papel.CLIENTE);
    const filme = await criarFilme();
    const sala = await criarSala();
    const sessao = await criarSessao(filme.id, sala.id, daquiA(24));
    await venderUmAssento(sessao.id, cliente.id);
    const pendente = await prisma.reserva.create({
      data: { usuarioId: cliente.id, sessaoId: sessao.id, total: 30, expiraEm: daquiA(1) },
    });

    const resposta = await request(app).patch(`/sessoes/${sessao.id}/cancelar`).set(operador.auth);

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro.codigo).toBe('SESSAO_COM_INGRESSOS');
    expect((await prisma.sessao.findUniqueOrThrow({ where: { id: sessao.id } })).cancelada).toBe(false);
    // a reserva pendente cancelada no meio da transação voltou ao estado original
    expect((await prisma.reserva.findUniqueOrThrow({ where: { id: pendente.id } })).status).toBe('PENDENTE');
  });

  it('sem ingressos: cancela a sessão, cancela as reservas pendentes e libera os assentos', async () => {
    const cliente = await criarUsuario(Papel.CLIENTE);
    const filme = await criarFilme();
    const sala = await criarSala();
    const sessao = await criarSessao(filme.id, sala.id, daquiA(24));
    const reserva = await prisma.reserva.create({
      data: { usuarioId: cliente.id, sessaoId: sessao.id, total: 30, expiraEm: daquiA(1) },
    });
    const assento = await prisma.sessaoAssento.findFirstOrThrow({ where: { sessaoId: sessao.id } });
    await prisma.sessaoAssento.update({
      where: { id: assento.id },
      data: { status: 'RESERVADO', reservaId: reserva.id, reservadoAte: daquiA(1) },
    });

    const resposta = await request(app).patch(`/sessoes/${sessao.id}/cancelar`).set(operador.auth);

    expect(resposta.status).toBe(200);
    expect(resposta.body.cancelada).toBe(true);
    expect((await prisma.reserva.findUniqueOrThrow({ where: { id: reserva.id } })).status).toBe('CANCELADA');
    expect(await prisma.sessaoAssento.findUniqueOrThrow({ where: { id: assento.id } })).toMatchObject({
      status: 'LIVRE',
      reservaId: null,
    });

    const deNovo = await request(app).patch(`/sessoes/${sessao.id}/cancelar`).set(operador.auth);
    expect(deNovo.status).toBe(409);
    expect(deNovo.body.erro.codigo).toBe('SESSAO_JA_CANCELADA');
  });
});

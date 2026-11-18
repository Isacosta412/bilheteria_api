import request from 'supertest';
import { Papel } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/config/prisma';
import { criarFilme, criarSala, criarSessao, criarUsuario, daquiA, limparBanco, type UsuarioTeste } from './helpers/banco';

let cliente: UsuarioTeste;

beforeEach(async () => {
  await limparBanco();
  cliente = await criarUsuario(Papel.CLIENTE);
});

async function prepararSessao(preco = '30.00', dataHora = daquiA(24)) {
  const filme = await criarFilme({ titulo: 'Filme da Reserva' });
  const sala = await criarSala(2, 5);
  const sessao = await criarSessao(filme.id, sala.id, dataHora, preco);
  const assentos = await prisma.assento.findMany({ where: { salaId: sala.id }, orderBy: [{ fila: 'asc' }, { numero: 'asc' }] });
  return { sessao, sala, assentoIds: assentos.map((a) => a.id) };
}

const reservar = (usuario: UsuarioTeste, corpo: object) => request(app).post('/reservas').set(usuario.auth).send(corpo);

describe('POST /reservas', () => {
  it('reserva 3 assentos: total e prazo calculados no servidor', async () => {
    const { sessao, assentoIds } = await prepararSessao('25.50');
    const antes = Date.now();

    const resposta = await reservar(cliente, { sessaoId: sessao.id, assentoIds: assentoIds.slice(0, 3) });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({
      status: 'PENDENTE',
      canal: 'APP',
      total: '76.50',
      sessao: { id: sessao.id, filmeTitulo: 'Filme da Reserva' },
    });
    expect(resposta.body.assentos.map((a: { fila: string; numero: number }) => `${a.fila}${a.numero}`)).toEqual(['A1', 'A2', 'A3']);
    const expiraEm = new Date(resposta.body.expiraEm).getTime();
    expect(expiraEm).toBeGreaterThanOrEqual(antes + env.RESERVA_MINUTOS * 60_000 - 1000);
    expect(expiraEm).toBeLessThanOrEqual(Date.now() + env.RESERVA_MINUTOS * 60_000 + 1000);

    expect(await prisma.sessaoAssento.count({ where: { sessaoId: sessao.id, status: 'RESERVADO' } })).toBe(3);
  });

  it('validação do body → 400 (0 ou 11 assentos, repetidos, campos do sistema)', async () => {
    const { sessao, assentoIds } = await prepararSessao();
    const casos = [
      { sessaoId: sessao.id, assentoIds: [] },
      { sessaoId: sessao.id, assentoIds: [...assentoIds, 9999] }, // 11
      { sessaoId: sessao.id, assentoIds: [assentoIds[0], assentoIds[0]] },
      { sessaoId: sessao.id, assentoIds: [assentoIds[0]], total: 1 },
      { sessaoId: sessao.id, assentoIds: [assentoIds[0]], status: 'PAGA' },
      { sessaoId: sessao.id, assentoIds: [assentoIds[0]], usuarioId: 1 },
    ];
    for (const corpo of casos) {
      const resposta = await reservar(cliente, corpo);
      expect(resposta.status, JSON.stringify(corpo)).toBe(400);
    }
    expect(await prisma.reserva.count()).toBe(0);
  });

  it('assento de outra sala → 422 ASSENTO_INVALIDO, sem gravar nada', async () => {
    const { sessao, assentoIds } = await prepararSessao();
    const outraSala = await criarSala(1, 3);
    const deOutraSala = await prisma.assento.findFirstOrThrow({ where: { salaId: outraSala.id } });

    const resposta = await reservar(cliente, { sessaoId: sessao.id, assentoIds: [assentoIds[0], deOutraSala.id] });

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro).toMatchObject({ codigo: 'ASSENTO_INVALIDO', detalhes: { assentoIds: [deOutraSala.id] } });
    expect(await prisma.reserva.count()).toBe(0);
    expect(await prisma.sessaoAssento.count({ where: { status: 'RESERVADO' } })).toBe(0);
  });

  it('sessão que já começou ou cancelada → 422; inexistente → 404', async () => {
    const passada = await prepararSessao('30.00', daquiA(-1));
    const cancelada = await prepararSessao();
    await prisma.sessao.update({ where: { id: cancelada.sessao.id }, data: { cancelada: true } });

    const r1 = await reservar(cliente, { sessaoId: passada.sessao.id, assentoIds: [passada.assentoIds[0]] });
    const r2 = await reservar(cliente, { sessaoId: cancelada.sessao.id, assentoIds: [cancelada.assentoIds[0]] });
    const r3 = await reservar(cliente, { sessaoId: 999, assentoIds: [1] });

    expect([r1.status, r1.body.erro.codigo]).toEqual([422, 'SESSAO_ENCERRADA']);
    expect([r2.status, r2.body.erro.codigo]).toEqual([422, 'SESSAO_CANCELADA']);
    expect(r3.status).toBe(404);
  });

  it('cliente com reserva pendente na sessão não faz outra (422); operador pode', async () => {
    const { sessao, assentoIds } = await prepararSessao();
    expect((await reservar(cliente, { sessaoId: sessao.id, assentoIds: [assentoIds[0]] })).status).toBe(201);

    const segunda = await reservar(cliente, { sessaoId: sessao.id, assentoIds: [assentoIds[1]] });
    expect(segunda.status).toBe(422);
    expect(segunda.body.erro.codigo).toBe('RESERVA_PENDENTE_EXISTENTE');
    expect(await prisma.sessaoAssento.count({ where: { sessaoId: sessao.id, status: 'RESERVADO' } })).toBe(1);

    const operador = await criarUsuario(Papel.OPERADOR);
    expect((await reservar(operador, { sessaoId: sessao.id, assentoIds: [assentoIds[1]] })).status).toBe(201);
    expect((await reservar(operador, { sessaoId: sessao.id, assentoIds: [assentoIds[2]] })).status).toBe(201);
  });

  it('sem login → 401', async () => {
    const resposta = await request(app).post('/reservas').send({ sessaoId: 1, assentoIds: [1] });
    expect(resposta.status).toBe(401);
  });
});

describe('GET /sessoes/:id/assentos (mapa)', () => {
  it('mostra status, resumo e minhaReserva só para o dono, sem expor reservaId', async () => {
    const { sessao, assentoIds } = await prepararSessao();
    const outro = await criarUsuario(Papel.CLIENTE);
    await reservar(cliente, { sessaoId: sessao.id, assentoIds: [assentoIds[0], assentoIds[1]] });

    const anonimo = await request(app).get(`/sessoes/${sessao.id}/assentos`);
    const dono = await request(app).get(`/sessoes/${sessao.id}/assentos`).set(cliente.auth);
    const deOutro = await request(app).get(`/sessoes/${sessao.id}/assentos`).set(outro.auth);

    expect(anonimo.status).toBe(200);
    expect(anonimo.body.resumo).toEqual({ livres: 8, reservados: 2, vendidos: 0 });
    expect(anonimo.body.sessao.id).toBe(sessao.id);
    expect(anonimo.body.filas.map((f: { fila: string }) => f.fila)).toEqual(['A', 'B']);
    expect(anonimo.body.filas[0].assentos[0]).toEqual({
      assentoId: assentoIds[0],
      numero: 1,
      tipo: 'PADRAO',
      status: 'RESERVADO',
      minhaReserva: false,
    });

    const meus = (r: typeof dono) => r.body.filas.flatMap((f: { assentos: { minhaReserva: boolean }[] }) => f.assentos).filter((a: { minhaReserva: boolean }) => a.minhaReserva).length;
    expect(meus(dono)).toBe(2);
    expect(meus(deOutro)).toBe(0);
    expect(meus(anonimo)).toBe(0);

    for (const resposta of [anonimo, dono, deOutro]) {
      const json = JSON.stringify(resposta.body);
      expect(json).not.toContain('reservaId');
      expect(json).not.toContain('reservadoAte');
      expect(json).not.toContain('usuario');
    }
  });

  it('token inválido → 401 (o login é opcional, mas se vier precisa ser válido)', async () => {
    const { sessao } = await prepararSessao();
    const resposta = await request(app).get(`/sessoes/${sessao.id}/assentos`).set('Authorization', 'Bearer invalido');
    expect(resposta.status).toBe(401);
  });
});

describe('GET /reservas/minhas e GET /reservas/:id', () => {
  it('lista as do usuário; outro cliente não vê (404); operador vê (200)', async () => {
    const { sessao, assentoIds } = await prepararSessao();
    const outro = await criarUsuario(Papel.CLIENTE);
    const operador = await criarUsuario(Papel.OPERADOR);
    const minha = await reservar(cliente, { sessaoId: sessao.id, assentoIds: [assentoIds[0]] });
    await reservar(outro, { sessaoId: sessao.id, assentoIds: [assentoIds[1]] });

    const minhas = await request(app).get('/reservas/minhas').set(cliente.auth);
    expect(minhas.status).toBe(200);
    expect(minhas.body.map((r: { reservaId: number }) => r.reservaId)).toEqual([minha.body.reservaId]);

    const id = minha.body.reservaId;
    expect((await request(app).get(`/reservas/${id}`).set(cliente.auth)).status).toBe(200);
    const alheia = await request(app).get(`/reservas/${id}`).set(outro.auth);
    expect(alheia.status).toBe(404);
    expect(alheia.body.erro.codigo).toBe('RESERVA_NAO_ENCONTRADA');
    expect((await request(app).get(`/reservas/${id}`).set(operador.auth)).status).toBe(200);
  });

  it('pendente vencida aparece como EXPIRADA', async () => {
    const { sessao, assentoIds } = await prepararSessao();
    const reserva = await reservar(cliente, { sessaoId: sessao.id, assentoIds: [assentoIds[0]] });
    await prisma.reserva.update({ where: { id: reserva.body.reservaId }, data: { expiraEm: daquiA(-1) } });

    const resposta = await request(app).get(`/reservas/${reserva.body.reservaId}`).set(cliente.auth);
    expect(resposta.body.status).toBe('EXPIRADA');
  });
});

describe('DELETE /reservas/:id', () => {
  it('cancela a pendente e libera os assentos; cancelar de novo → 422', async () => {
    const { sessao, assentoIds } = await prepararSessao();
    const reserva = await reservar(cliente, { sessaoId: sessao.id, assentoIds: [assentoIds[0], assentoIds[1]] });

    const cancelada = await request(app).delete(`/reservas/${reserva.body.reservaId}`).set(cliente.auth);
    expect(cancelada.status).toBe(200);
    expect(cancelada.body.status).toBe('CANCELADA');
    expect(cancelada.body.assentos).toHaveLength(2); // assentos que foram liberados
    expect(await prisma.sessaoAssento.count({ where: { sessaoId: sessao.id, status: 'RESERVADO' } })).toBe(0);

    const deNovo = await request(app).delete(`/reservas/${reserva.body.reservaId}`).set(cliente.auth);
    expect(deNovo.status).toBe(422);
    expect(deNovo.body.erro.codigo).toBe('RESERVA_NAO_PENDENTE');

    // Com a reserva cancelada, o cliente pode reservar de novo na mesma sessão
    expect((await reservar(cliente, { sessaoId: sessao.id, assentoIds: [assentoIds[0]] })).status).toBe(201);
  });

  it('outro cliente não cancela (404); operador cancela', async () => {
    const { sessao, assentoIds } = await prepararSessao();
    const outro = await criarUsuario(Papel.CLIENTE);
    const operador = await criarUsuario(Papel.OPERADOR);
    const reserva = await reservar(cliente, { sessaoId: sessao.id, assentoIds: [assentoIds[0]] });

    expect((await request(app).delete(`/reservas/${reserva.body.reservaId}`).set(outro.auth)).status).toBe(404);
    expect((await request(app).delete(`/reservas/${reserva.body.reservaId}`).set(operador.auth)).status).toBe(200);
  });
});

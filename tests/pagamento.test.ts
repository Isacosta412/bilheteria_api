import type { Server } from 'node:http';
import request from 'supertest';
import { Papel } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { criarFilme, criarSala, criarSessao, criarUsuario, daquiA, limparBanco, type UsuarioTeste } from './helpers/banco';

let servidor: Server;
let cliente: UsuarioTeste;

beforeAll(() => {
  servidor = app.listen(0);
});
afterAll(() => {
  servidor.close();
});
beforeEach(async () => {
  await limparBanco();
  cliente = await criarUsuario(Papel.CLIENTE);
});

const CODIGO_VALIDO = /^[A-HJ-NP-Z2-9]{10}$/; // sem 0, O, 1 e I

/** Sessão com 10 lugares e uma reserva PENDENTE do cliente com `qtd` assentos. */
async function reservaPendente(qtd = 2, preco = '30.00') {
  const filme = await criarFilme({ titulo: 'Filme do Pagamento' });
  const sala = await criarSala(2, 5);
  const sessao = await criarSessao(filme.id, sala.id, daquiA(24), preco);
  const assentos = await prisma.assento.findMany({ where: { salaId: sala.id }, orderBy: [{ fila: 'asc' }, { numero: 'asc' }] });
  const resposta = await request(servidor)
    .post('/reservas')
    .set(cliente.auth)
    .send({ sessaoId: sessao.id, assentoIds: assentos.slice(0, qtd).map((a) => a.id) });
  expect(resposta.status).toBe(201);
  return { sessao, reservaId: resposta.body.reservaId as number };
}

const pagar = (usuario: UsuarioTeste, reservaId: number, corpo: object = { metodo: 'PIX' }) =>
  request(servidor).post(`/reservas/${reservaId}/pagamento`).set(usuario.auth).send(corpo);

describe('POST /reservas/:id/pagamento', () => {
  it('pagamento feliz: PAGA, 1 pagamento = total, assentos VENDIDO e 1 ingresso por assento', async () => {
    const { sessao, reservaId } = await reservaPendente(2, '27.50');

    const resposta = await pagar(cliente, reservaId);

    expect(resposta.status).toBe(201);
    expect(resposta.body.reserva).toMatchObject({ reservaId, status: 'PAGA', total: '55.00' });
    expect(resposta.body.ingressos).toHaveLength(2);
    for (const ingresso of resposta.body.ingressos) {
      expect(ingresso.codigo).toMatch(CODIGO_VALIDO);
      expect(ingresso).toMatchObject({
        status: 'VALIDO',
        fila: 'A',
        filme: { titulo: 'Filme do Pagamento' },
        sessao: { id: sessao.id },
        utilizadoEm: null,
      });
      expect(ingresso).not.toHaveProperty('reservaId');
    }

    const pagamentos = await prisma.pagamento.findMany();
    expect(pagamentos).toHaveLength(1);
    expect(pagamentos[0]).toMatchObject({ reservaId, metodo: 'PIX' });
    expect(pagamentos[0]!.valor.toFixed(2)).toBe('55.00');
    expect(await prisma.sessaoAssento.count({ where: { reservaId, status: 'VENDIDO' } })).toBe(2);
    expect(await prisma.ingresso.count({ where: { reservaId } })).toBe(2);

    const mapa = await request(servidor).get(`/sessoes/${sessao.id}/assentos`);
    expect(mapa.body.resumo).toEqual({ livres: 8, reservados: 0, vendidos: 2 });
  });

  it('valor/total no body ou DINHEIRO pelo app → 400', async () => {
    const { reservaId } = await reservaPendente();

    for (const corpo of [{ metodo: 'PIX', valor: 1 }, { metodo: 'PIX', total: 1 }, { metodo: 'DINHEIRO' }, {}]) {
      const resposta = await pagar(cliente, reservaId, corpo);
      expect(resposta.status, JSON.stringify(corpo)).toBe(400);
    }
    expect(await prisma.pagamento.count()).toBe(0);
  });

  it('reserva vencida → 422 RESERVA_EXPIRADA, e a expiração FICA gravada (assentos livres)', async () => {
    const { reservaId } = await reservaPendente(2);
    const passado = new Date(Date.now() - 60_000);
    await prisma.reserva.update({ where: { id: reservaId }, data: { expiraEm: passado } });
    await prisma.sessaoAssento.updateMany({ where: { reservaId }, data: { reservadoAte: passado } });

    const resposta = await pagar(cliente, reservaId);

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro.codigo).toBe('RESERVA_EXPIRADA');
    expect((await prisma.reserva.findUniqueOrThrow({ where: { id: reservaId } })).status).toBe('EXPIRADA');
    expect(await prisma.sessaoAssento.count({ where: { reservaId } })).toBe(0);
    expect(await prisma.pagamento.count()).toBe(0);
    expect(await prisma.ingresso.count()).toBe(0);
  });

  it('10 pagamentos SIMULTÂNEOS da mesma reserva → exatamente 1 × 201 e 9 × 409', async () => {
    const { reservaId } = await reservaPendente(3);

    const respostas = await Promise.all(Array.from({ length: 10 }, () => pagar(cliente, reservaId)));

    const status = respostas.map((r) => r.status).sort();
    expect(status.filter((s) => s === 201)).toHaveLength(1);
    expect(status.filter((s) => s === 409)).toHaveLength(9);
    expect(respostas.filter((r) => r.status === 409).every((r) => r.body.erro.codigo === 'RESERVA_JA_PAGA')).toBe(true);

    expect(await prisma.pagamento.count()).toBe(1);
    expect(await prisma.ingresso.count()).toBe(3);
  });

  it('simularFalha: true → 500 FALHA_SIMULADA e NADA gravado (rollback)', async () => {
    const { reservaId } = await reservaPendente(2);

    const resposta = await pagar(cliente, reservaId, { metodo: 'CARTAO', simularFalha: true });

    expect(resposta.status).toBe(500);
    expect(resposta.body.erro.codigo).toBe('FALHA_SIMULADA');
    expect((await prisma.reserva.findUniqueOrThrow({ where: { id: reservaId } })).status).toBe('PENDENTE');
    expect(await prisma.pagamento.count()).toBe(0);
    expect(await prisma.ingresso.count()).toBe(0);
    expect(await prisma.sessaoAssento.count({ where: { reservaId, status: 'RESERVADO' } })).toBe(2);

    // Depois da falha, o pagamento normal funciona
    expect((await pagar(cliente, reservaId)).status).toBe(201);
  });

  it('outro cliente → 404; pagar de novo → 409; reserva cancelada → 409', async () => {
    const { reservaId } = await reservaPendente(1);
    const outro = await criarUsuario(Papel.CLIENTE);

    expect((await pagar(outro, reservaId)).status).toBe(404);
    expect((await pagar(cliente, reservaId)).status).toBe(201);
    const deNovo = await pagar(cliente, reservaId);
    expect([deNovo.status, deNovo.body.erro.codigo]).toEqual([409, 'RESERVA_JA_PAGA']);

    // Uma reserva paga não pode ser cancelada pelo DELETE
    expect((await request(servidor).delete(`/reservas/${reservaId}`).set(cliente.auth)).status).toBe(422);
  });

  it('reserva cancelada → 409 RESERVA_CANCELADA', async () => {
    const { reservaId } = await reservaPendente(1);
    await request(servidor).delete(`/reservas/${reservaId}`).set(cliente.auth);

    const resposta = await pagar(cliente, reservaId);
    expect([resposta.status, resposta.body.erro.codigo]).toEqual([409, 'RESERVA_CANCELADA']);
  });
});

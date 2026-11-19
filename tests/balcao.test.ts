import type { Server } from 'node:http';
import request from 'supertest';
import { Papel } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { criarFilme, criarSala, criarSessao, criarUsuario, daquiA, limparBanco, type UsuarioTeste } from './helpers/banco';

let servidor: Server;
let operador: UsuarioTeste;

beforeAll(() => {
  servidor = app.listen(0);
});
afterAll(() => {
  servidor.close();
});
beforeEach(async () => {
  await limparBanco();
  operador = await criarUsuario(Papel.OPERADOR);
});

async function prepararSessao() {
  const filme = await criarFilme({ titulo: 'Filme do Balcão' });
  const sala = await criarSala(2, 5);
  const sessao = await criarSessao(filme.id, sala.id, daquiA(24), '20.00');
  const assentoIds = (await prisma.assento.findMany({ where: { salaId: sala.id }, orderBy: [{ fila: 'asc' }, { numero: 'asc' }] })).map((a) => a.id);
  return { sessao, assentoIds };
}

const vender = (usuario: UsuarioTeste, corpo: object) => request(servidor).post('/balcao/vendas').set(usuario.auth).send(corpo);

describe('POST /balcao/vendas', () => {
  it('vende 3 assentos em DINHEIRO: reserva PAGA no canal BALCAO e 3 ingressos', async () => {
    const { sessao, assentoIds } = await prepararSessao();

    const resposta = await vender(operador, {
      sessaoId: sessao.id,
      assentoIds: assentoIds.slice(0, 3),
      metodo: 'DINHEIRO',
      nomeComprador: 'Ana Souza',
    });

    expect(resposta.status).toBe(201);
    expect(resposta.body.reserva).toMatchObject({ status: 'PAGA', canal: 'BALCAO', total: '60.00', nomeComprador: 'Ana Souza' });
    expect(resposta.body.ingressos).toHaveLength(3);
    const pagamento = await prisma.pagamento.findFirstOrThrow();
    expect(pagamento.metodo).toBe('DINHEIRO');
    expect(pagamento.valor.toFixed(2)).toBe('60.00');
    expect(await prisma.sessaoAssento.count({ where: { sessaoId: sessao.id, status: 'VENDIDO' } })).toBe(3);
  });

  it('10 vendas SIMULTÂNEAS do mesmo assento → 1 × 201 e 9 × 409, com 1 pagamento só', async () => {
    const { sessao, assentoIds } = await prepararSessao();

    const respostas = await Promise.all(
      Array.from({ length: 10 }, () => vender(operador, { sessaoId: sessao.id, assentoIds: [assentoIds[0]], metodo: 'PIX' })),
    );

    expect(respostas.filter((r) => r.status === 201)).toHaveLength(1);
    expect(respostas.filter((r) => r.status === 409 && r.body.erro.codigo === 'ASSENTO_INDISPONIVEL')).toHaveLength(9);
    expect(await prisma.pagamento.count()).toBe(1);
    expect(await prisma.ingresso.count()).toBe(1);
    expect(await prisma.reserva.count()).toBe(1); // as perdedoras não deixaram reserva nem pagamento
  });

  it('assento reservado por um cliente → 409, sem cobrar nada', async () => {
    const { sessao, assentoIds } = await prepararSessao();
    const cliente = await criarUsuario(Papel.CLIENTE);
    await request(servidor).post('/reservas').set(cliente.auth).send({ sessaoId: sessao.id, assentoIds: [assentoIds[1]] });

    const resposta = await vender(operador, { sessaoId: sessao.id, assentoIds: [assentoIds[0], assentoIds[1]], metodo: 'CARTAO' });

    expect([resposta.status, resposta.body.erro.codigo]).toEqual([409, 'ASSENTO_INDISPONIVEL']);
    expect(await prisma.pagamento.count()).toBe(0);
    expect(await prisma.sessaoAssento.findFirstOrThrow({ where: { sessaoId: sessao.id, assentoId: assentoIds[0] } })).toMatchObject({
      status: 'LIVRE',
    });
  });

  it('cliente → 403; método inválido ou campos do sistema → 400', async () => {
    const { sessao, assentoIds } = await prepararSessao();
    const cliente = await criarUsuario(Papel.CLIENTE);
    const corpo = { sessaoId: sessao.id, assentoIds: [assentoIds[0]], metodo: 'PIX' };

    expect((await vender(cliente, corpo)).status).toBe(403);
    expect((await vender(operador, { ...corpo, metodo: 'BOLETO' })).status).toBe(400);
    expect((await vender(operador, { ...corpo, total: 1 })).status).toBe(400);
  });
});

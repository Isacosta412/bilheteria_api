import type { Server } from 'node:http';
import request from 'supertest';
import { Papel } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { criarFilme, criarSala, criarSessao, criarUsuario, daquiA, limparBanco, type UsuarioTeste } from './helpers/banco';

let servidor: Server;
let cliente: UsuarioTeste;
let operador: UsuarioTeste;

beforeAll(() => {
  servidor = app.listen(0);
});
afterAll(() => {
  servidor.close();
});
beforeEach(async () => {
  await limparBanco();
  cliente = await criarUsuario(Papel.CLIENTE);
  operador = await criarUsuario(Papel.OPERADOR);
});

async function cenario(preco = '25.00') {
  const filme = await criarFilme({ titulo: 'Filme da Meia' });
  const sala = await criarSala(2, 5);
  const sessao = await criarSessao(filme.id, sala.id, daquiA(24), preco);
  const assentos = await prisma.assento.findMany({ where: { salaId: sala.id }, orderBy: [{ fila: 'asc' }, { numero: 'asc' }] });
  return { filme, sala, sessao, assentoIds: assentos.map((a) => a.id) };
}

describe('Meia-entrada', () => {
  it('reserva com meias: total = inteiras + meias pela metade, e o DTO traz os preços', async () => {
    const { sessao, assentoIds } = await cenario('25.00');
    const r = await request(servidor)
      .post('/reservas')
      .set(cliente.auth)
      .send({ sessaoId: sessao.id, assentoIds: assentoIds.slice(0, 3), meias: 1 });

    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ total: '62.50', meias: 1, precoInteira: '25.00', precoMeia: '12.50' });
  });

  it('sem "meias" continua tudo inteira (compatível com o app antigo)', async () => {
    const { sessao, assentoIds } = await cenario('25.00');
    const r = await request(servidor).post('/reservas').set(cliente.auth).send({ sessaoId: sessao.id, assentoIds: assentoIds.slice(0, 2) });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ total: '50.00', meias: 0 });
  });

  it('recusa mais meias do que assentos (400)', async () => {
    const { sessao, assentoIds } = await cenario();
    const r = await request(servidor)
      .post('/reservas')
      .set(cliente.auth)
      .send({ sessaoId: sessao.id, assentoIds: assentoIds.slice(0, 2), meias: 3 });
    expect(r.status).toBe(400);
  });

  it('PATCH /reservas/:id/meias recalcula o total; o pagamento emite ingressos meia e inteira com o valor certo', async () => {
    const { sessao, assentoIds } = await cenario('25.99');
    const criada = await request(servidor).post('/reservas').set(cliente.auth).send({ sessaoId: sessao.id, assentoIds: assentoIds.slice(0, 3) });
    const reservaId = criada.body.reservaId as number;

    const alterada = await request(servidor).patch(`/reservas/${reservaId}/meias`).set(cliente.auth).send({ meias: 2 });
    expect(alterada.status).toBe(200);
    // 25.99 + 2 × 13.00 (metade arredondada para cima no meio centavo)
    expect(alterada.body).toMatchObject({ meias: 2, total: '51.99', precoMeia: '13.00' });

    const demais = await request(servidor).patch(`/reservas/${reservaId}/meias`).set(cliente.auth).send({ meias: 4 });
    expect(demais.status).toBe(422);

    const outro = await criarUsuario(Papel.CLIENTE);
    const deOutro = await request(servidor).patch(`/reservas/${reservaId}/meias`).set(outro.auth).send({ meias: 1 });
    expect(deOutro.status).toBe(404);

    const paga = await request(servidor).post(`/reservas/${reservaId}/pagamento`).set(cliente.auth).send({ metodo: 'PIX' });
    expect(paga.status).toBe(201);
    const tipos = (paga.body.ingressos as { tipoIngresso: string; valor: string }[]).map((i) => `${i.tipoIngresso}:${i.valor}`).sort();
    expect(tipos).toEqual(['INTEIRA:25.99', 'MEIA:13.00', 'MEIA:13.00']);

    const pagamento = await prisma.pagamento.findUniqueOrThrow({ where: { reservaId } });
    expect(pagamento.valor.toFixed(2)).toBe('51.99');

    // Depois de paga não dá mais para trocar
    const depois = await request(servidor).patch(`/reservas/${reservaId}/meias`).set(cliente.auth).send({ meias: 0 });
    expect(depois.status).toBe(422);

    // A receita do relatório soma o valor de cada ingresso
    const [linha] = await prisma.$queryRaw<{ receita: { toFixed: (n: number) => string } }[]>`
      SELECT receita FROM vw_relatorio_sessoes WHERE sessao_id = ${sessao.id}`;
    expect(linha?.receita.toFixed(2)).toBe('51.99');
  });

  it('venda no balcão aceita meias', async () => {
    const { sessao, assentoIds } = await cenario('30.00');
    const r = await request(servidor)
      .post('/balcao/vendas')
      .set(operador.auth)
      .send({ sessaoId: sessao.id, assentoIds: assentoIds.slice(0, 2), meias: 1, metodo: 'DINHEIRO' });
    expect(r.status).toBe(201);
    expect(r.body.reserva).toMatchObject({ total: '45.00', meias: 1 });
  });
});

describe('Formato e idioma da sessão', () => {
  it('cria com padrão 2D dublado, aceita 3D legendado e o operador pode trocar depois', async () => {
    const filme = await criarFilme();
    const sala = await criarSala(1, 5);

    const padrao = await request(servidor)
      .post('/sessoes')
      .set(operador.auth)
      .send({ filmeId: filme.id, salaId: sala.id, dataHora: daquiA(24).toISOString(), preco: 20 });
    expect(padrao.status).toBe(201);
    expect(padrao.body).toMatchObject({ formato: 'DOIS_D', idioma: 'DUBLADO', precoMeia: '10.00' });

    const tresD = await request(servidor)
      .post('/sessoes')
      .set(operador.auth)
      .send({ filmeId: filme.id, salaId: sala.id, dataHora: daquiA(48).toISOString(), preco: 20, formato: 'TRES_D', idioma: 'LEGENDADO' });
    expect(tresD.status).toBe(201);
    expect(tresD.body).toMatchObject({ formato: 'TRES_D', idioma: 'LEGENDADO' });

    const trocada = await request(servidor).patch(`/sessoes/${padrao.body.id}`).set(operador.auth).send({ idioma: 'LEGENDADO' });
    expect(trocada.status).toBe(200);
    expect(trocada.body).toMatchObject({ formato: 'DOIS_D', idioma: 'LEGENDADO' });

    const invalida = await request(servidor).patch(`/sessoes/${padrao.body.id}`).set(operador.auth).send({ formato: '4D' });
    expect(invalida.status).toBe(400);

    const porCliente = await request(servidor).patch(`/sessoes/${padrao.body.id}`).set(cliente.auth).send({ formato: 'TRES_D' });
    expect(porCliente.status).toBe(403);

    const inexistente = await request(servidor).patch('/sessoes/999999').set(operador.auth).send({ formato: 'TRES_D' });
    expect(inexistente.status).toBe(404);
  });
});

/**
 * TESTE DE CONCORRÊNCIA – demonstrado na apresentação.
 *
 * Dispara várias reservas AO MESMO TEMPO (Promise.all) contra um servidor HTTP real e confere
 * que um assento nunca é reservado duas vezes, que as tentativas perdedoras não deixam nada
 * gravado (rollback) e que pedidos com conjuntos de assentos cruzados não causam deadlock.
 */
import type { Server } from 'node:http';
import request from 'supertest';
import { Papel } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { reservaService } from '../src/services/reserva.service';
import { criarFilme, criarSala, criarSessao, criarUsuario, daquiA, limparBanco, type UsuarioTeste } from './helpers/banco';

let servidor: Server;

beforeAll(() => {
  servidor = app.listen(0);
});
afterAll(() => {
  servidor.close();
});
beforeEach(limparBanco);

async function prepararSessao(qtdFilas = 2, porFila = 5) {
  const filme = await criarFilme();
  const sala = await criarSala(qtdFilas, porFila);
  const sessao = await criarSessao(filme.id, sala.id, daquiA(24), '30.00');
  const assentos = await prisma.assento.findMany({ where: { salaId: sala.id }, orderBy: [{ fila: 'asc' }, { numero: 'asc' }] });
  return { sessao, assentos };
}

function contarStatus(respostas: { status: number }[]): Record<number, number> {
  return respostas.reduce<Record<number, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
}

describe('concorrência na reserva', () => {
  it('20 reservas simultâneas do MESMO assento por 2 clientes → exatamente 1 × 201 e 19 × 409', async () => {
    const { sessao, assentos } = await prepararSessao();
    const alvo = assentos[0]!;
    const clientes = [await criarUsuario(Papel.CLIENTE), await criarUsuario(Papel.CLIENTE)];

    const respostas = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(servidor)
          .post('/reservas')
          .set(clientes[i % 2]!.auth)
          .send({ sessaoId: sessao.id, assentoIds: [String(alvo.id)] }),
      ),
    );

    expect(contarStatus(respostas)).toEqual({ 201: 1, 409: 19 });
    for (const perdedora of respostas.filter((r) => r.status === 409)) {
      expect(perdedora.body.erro.codigo).toBe('ASSENTO_INDISPONIVEL');
    }

    // No banco: exatamente 1 linha RESERVADO para o assento, apontando para a ÚNICA reserva gravada.
    const vencedora = respostas.find((r) => r.status === 201)!;
    const linhas = await prisma.sessaoAssento.findMany({ where: { sessaoId: sessao.id, assentoId: alvo.id } });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ status: 'RESERVADO', reservaId: vencedora.body.reservaId });
    expect(await prisma.sessaoAssento.count({ where: { sessaoId: sessao.id, status: 'RESERVADO' } })).toBe(1);

    // As 19 tentativas perdedoras fizeram rollback: nenhuma reserva órfã ficou gravada.
    expect(await prisma.reserva.count()).toBe(1);
  });

  it('pedidos simultâneos com conjuntos de assentos cruzados (em ordens diferentes) não causam deadlock', async () => {
    const { sessao, assentos } = await prepararSessao();
    const [a1, a2, a3] = [assentos[0]!.id, assentos[1]!.id, assentos[2]!.id];
    // Qualquer par entre 3 assentos cruza com qualquer outro par: só 1 pedido pode vencer.
    const pares = [[a1, a2], [a2, a1], [a2, a3], [a3, a2], [a1, a3], [a3, a1]];
    const clientes: UsuarioTeste[] = [];
    for (let i = 0; i < 20; i++) clientes.push(await criarUsuario(Papel.CLIENTE));

    const respostas = await Promise.all(
      clientes.map((cliente, i) =>
        request(servidor)
          .post('/reservas')
          .set(cliente.auth)
          .send({ sessaoId: sessao.id, assentoIds: pares[i % pares.length] }),
      ),
    );

    // Nenhum 500 e nenhum deadlock (que viraria CONFLITO_CONCORRENTE): só 1 vencedor e 409 ASSENTO_INDISPONIVEL.
    expect(contarStatus(respostas)).toEqual({ 201: 1, 409: 19 });
    expect(respostas.filter((r) => r.status === 409).every((r) => r.body.erro.codigo === 'ASSENTO_INDISPONIVEL')).toBe(true);

    const vencedora = respostas.find((r) => r.status === 201)!;
    expect(vencedora.body.assentos).toHaveLength(2);
    const reservados = await prisma.sessaoAssento.findMany({ where: { sessaoId: sessao.id, status: 'RESERVADO' } });
    expect(reservados).toHaveLength(2);
    expect(reservados.every((l) => l.reservaId === vencedora.body.reservaId)).toBe(true);
    expect(await prisma.reserva.count()).toBe(1);
  });
});

describe('expiração', () => {
  it('reserva vencida: mapa já mostra LIVRE, a procedure expira e outro cliente consegue reservar', async () => {
    const { sessao, assentos } = await prepararSessao();
    const alvo = assentos[0]!;
    const cliente1 = await criarUsuario(Papel.CLIENTE);
    const cliente2 = await criarUsuario(Papel.CLIENTE);

    const primeira = await request(servidor).post('/reservas').set(cliente1.auth).send({ sessaoId: sessao.id, assentoIds: [alvo.id] });
    expect(primeira.status).toBe(201);

    // Enquanto válida, o cliente 2 não consegue
    const bloqueada = await request(servidor).post('/reservas').set(cliente2.auth).send({ sessaoId: sessao.id, assentoIds: [alvo.id] });
    expect(bloqueada.status).toBe(409);

    // Força o vencimento (equivale a esperar RESERVA_MINUTOS)
    const passado = new Date(Date.now() - 60_000);
    await prisma.reserva.update({ where: { id: primeira.body.reservaId }, data: { expiraEm: passado } });
    await prisma.sessaoAssento.updateMany({ where: { reservaId: primeira.body.reservaId }, data: { reservadoAte: passado } });

    // O mapa já trata o assento como LIVRE, sem depender do job
    const mapa = await request(servidor).get(`/sessoes/${sessao.id}/assentos`);
    expect(mapa.body.filas[0].assentos[0]).toMatchObject({ assentoId: alvo.id, status: 'LIVRE' });

    // O job chama reservaService.expirarVencidas() → CALL sp_expirar_reservas()
    expect(await reservaService.expirarVencidas()).toBe(1);
    expect((await prisma.reserva.findUniqueOrThrow({ where: { id: primeira.body.reservaId } })).status).toBe('EXPIRADA');
    expect(await prisma.sessaoAssento.findFirstOrThrow({ where: { sessaoId: sessao.id, assentoId: alvo.id } })).toMatchObject({
      status: 'LIVRE',
      reservaId: null,
      reservadoAte: null,
    });

    // Agora o cliente 2 consegue
    const segunda = await request(servidor).post('/reservas').set(cliente2.auth).send({ sessaoId: sessao.id, assentoIds: [alvo.id] });
    expect(segunda.status).toBe(201);
  });

  it('assento vencido pode ser reservado por outro cliente mesmo ANTES de o job rodar', async () => {
    const { sessao, assentos } = await prepararSessao();
    const alvo = assentos[0]!;
    const cliente1 = await criarUsuario(Papel.CLIENTE);
    const cliente2 = await criarUsuario(Papel.CLIENTE);

    const primeira = await request(servidor).post('/reservas').set(cliente1.auth).send({ sessaoId: sessao.id, assentoIds: [alvo.id] });
    const passado = new Date(Date.now() - 60_000);
    await prisma.reserva.update({ where: { id: primeira.body.reservaId }, data: { expiraEm: passado } });
    await prisma.sessaoAssento.updateMany({ where: { reservaId: primeira.body.reservaId }, data: { reservadoAte: passado } });

    const segunda = await request(servidor).post('/reservas').set(cliente2.auth).send({ sessaoId: sessao.id, assentoIds: [alvo.id] });
    expect(segunda.status).toBe(201);

    // Quando o job roda depois, expira a reserva antiga SEM liberar o assento que agora é do cliente 2.
    expect(await reservaService.expirarVencidas()).toBe(1);
    expect(await prisma.sessaoAssento.findFirstOrThrow({ where: { sessaoId: sessao.id, assentoId: alvo.id } })).toMatchObject({
      status: 'RESERVADO',
      reservaId: segunda.body.reservaId,
    });
  });
});

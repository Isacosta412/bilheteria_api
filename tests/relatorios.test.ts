import request from 'supertest';
import { Papel, type Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { hojeEmBrasilia, somarDias } from '../src/utils/periodo';
import { criarFilme, criarSala, criarSessao, criarUsuario, daquiA, limparBanco, type UsuarioTeste } from './helpers/banco';

let operador: UsuarioTeste;
let sessao1: { id: number; filmeId: number };
let sessao2: { id: number; filmeId: number };

const TITULO_COM_SEPARADOR = 'Ação; Parte "2"';

/**
 * Seed controlado:
 *  - sessão 1: sala de 10 lugares, R$ 25,00 → cliente A compra 3 (PIX, app), cliente B reserva 2 (pendente)
 *  - sessão 2: outra sala de 10 lugares, R$ 25,00 → operador vende 2 no balcão (DINHEIRO)
 */
beforeEach(async () => {
  await limparBanco();
  operador = await criarUsuario(Papel.OPERADOR);
  const clienteA = await criarUsuario(Papel.CLIENTE);
  const clienteB = await criarUsuario(Papel.CLIENTE);

  const filme1 = await criarFilme({ titulo: 'Filme Um' });
  const filme2 = await criarFilme({ titulo: TITULO_COM_SEPARADOR });
  const sala1 = await criarSala(1, 10);
  const sala2 = await criarSala(1, 10);
  const s1 = await criarSessao(filme1.id, sala1.id, daquiA(24), '25.00');
  const s2 = await criarSessao(filme2.id, sala2.id, daquiA(48), '25.00');
  sessao1 = { id: s1.id, filmeId: filme1.id };
  sessao2 = { id: s2.id, filmeId: filme2.id };

  const assentos1 = (await prisma.assento.findMany({ where: { salaId: sala1.id }, orderBy: { numero: 'asc' } })).map((a) => a.id);
  const assentos2 = (await prisma.assento.findMany({ where: { salaId: sala2.id }, orderBy: { numero: 'asc' } })).map((a) => a.id);

  const compraA = await request(app).post('/reservas').set(clienteA.auth).send({ sessaoId: s1.id, assentoIds: assentos1.slice(0, 3) });
  expect((await request(app).post(`/reservas/${compraA.body.reservaId}/pagamento`).set(clienteA.auth).send({ metodo: 'PIX' })).status).toBe(201);
  expect((await request(app).post('/reservas').set(clienteB.auth).send({ sessaoId: s1.id, assentoIds: assentos1.slice(3, 5) })).status).toBe(201);
  expect(
    (await request(app).post('/balcao/vendas').set(operador.auth).send({ sessaoId: s2.id, assentoIds: assentos2.slice(0, 2), metodo: 'DINHEIRO' })).status,
  ).toBe(201);
});

const get = (url: string, usuario = operador) => request(app).get(url).set(usuario.auth);

describe('view vw_relatorio_sessoes (SQL direto)', () => {
  it('10 lugares, 3 vendidos e 2 reservados → taxa_ocupacao 30.00 e receita 75.00', async () => {
    const [linha] = await prisma.$queryRaw<
      { capacidade: number; vendidos: number; reservados: number; livres: number; taxa_ocupacao: Prisma.Decimal; receita: Prisma.Decimal }[]
    >`SELECT capacidade, vendidos, reservados, livres, taxa_ocupacao, receita FROM vw_relatorio_sessoes WHERE sessao_id = ${sessao1.id}`;

    expect(linha).toBeDefined();
    expect(linha!.capacidade).toBe(10);
    expect(linha!.vendidos).toBe(3);
    expect(linha!.reservados).toBe(2);
    expect(linha!.livres).toBe(5);
    expect(linha!.taxa_ocupacao.toFixed(2)).toBe('30.00');
    expect(linha!.receita.toFixed(2)).toBe('75.00');
  });
});

describe('GET /relatorios/sessoes', () => {
  it('linhas por sessão e totais com ocupação média PONDERADA', async () => {
    const resposta = await get('/relatorios/sessoes');

    expect(resposta.status).toBe(200);
    expect(resposta.body.sessoes).toHaveLength(2);
    expect(resposta.body.sessoes[0]).toMatchObject({
      sessaoId: sessao1.id,
      filmeTitulo: 'Filme Um',
      capacidade: 10,
      vendidos: 3,
      reservados: 2,
      livres: 5,
      taxaOcupacao: '30.00',
      receita: '75.00',
      preco: '25.00',
    });
    expect(resposta.body.sessoes[1]).toMatchObject({ sessaoId: sessao2.id, vendidos: 2, taxaOcupacao: '20.00', receita: '50.00' });
    expect(resposta.body.totais).toEqual({
      quantidadeSessoes: 2,
      capacidadeTotal: 20,
      ingressosVendidos: 5,
      assentosReservados: 2,
      receitaTotal: '125.00',
      ocupacaoMediaPonderada: '25.00', // (3 + 2) / 20
    });
    expect(resposta.body.periodo).toEqual({ inicio: somarDias(hojeEmBrasilia(), -30), fim: somarDias(hojeEmBrasilia(), 30) });
  });

  it('filtra por filme e por período', async () => {
    const porFilme = await get(`/relatorios/sessoes?filmeId=${sessao2.filmeId}`);
    expect(porFilme.body.sessoes.map((s: { sessaoId: number }) => s.sessaoId)).toEqual([sessao2.id]);

    const hoje = hojeEmBrasilia();
    const soAmanha = await get(`/relatorios/sessoes?inicio=${somarDias(hoje, 1)}&fim=${somarDias(hoje, 1)}`);
    expect(soAmanha.body.sessoes.map((s: { sessaoId: number }) => s.sessaoId)).toEqual([sessao1.id]);

    const passado = await get(`/relatorios/sessoes?inicio=${somarDias(hoje, -10)}&fim=${somarDias(hoje, -5)}`);
    expect(passado.body.sessoes).toEqual([]);
    expect(passado.body.totais).toMatchObject({ quantidadeSessoes: 0, receitaTotal: '0.00', ocupacaoMediaPonderada: '0.00' });
  });
});

describe('GET /relatorios/vendas', () => {
  it('agrupar=metodo separa PIX (app) e DINHEIRO (balcão)', async () => {
    const resposta = await get('/relatorios/vendas?agrupar=metodo');

    expect(resposta.status).toBe(200);
    expect(resposta.body.agrupamento).toBe('metodo');
    expect(resposta.body.grupos).toEqual([
      {
        chave: 'PIX',
        rotulo: 'PIX',
        vendas: 1,
        ingressos: 3,
        receita: '75.00',
        app: { ingressos: 3, receita: '75.00' },
        balcao: { ingressos: 0, receita: '0.00' },
      },
      {
        chave: 'DINHEIRO',
        rotulo: 'DINHEIRO',
        vendas: 1,
        ingressos: 2,
        receita: '50.00',
        app: { ingressos: 0, receita: '0.00' },
        balcao: { ingressos: 2, receita: '50.00' },
      },
    ]);
    expect(resposta.body.totais).toEqual({
      vendas: 2,
      ingressos: 5,
      receita: '125.00',
      app: { ingressos: 3, receita: '75.00' },
      balcao: { ingressos: 2, receita: '50.00' },
    });
  });

  it('agrupar=dia (padrão) e agrupar=filme', async () => {
    const porDia = await get('/relatorios/vendas');
    expect(porDia.body.agrupamento).toBe('dia');
    expect(porDia.body.grupos).toHaveLength(1);
    expect(porDia.body.grupos[0]).toMatchObject({ chave: hojeEmBrasilia(), ingressos: 5, receita: '125.00' });

    const porFilme = await get('/relatorios/vendas?agrupar=filme');
    expect(porFilme.body.grupos.map((g: { rotulo: string; receita: string }) => [g.rotulo, g.receita])).toEqual([
      ['Filme Um', '75.00'],
      [TITULO_COM_SEPARADOR, '50.00'],
    ]);
  });
});

describe('GET /relatorios/sessoes.csv', () => {
  it('CSV para Excel pt-BR: BOM, separador ";", decimal com vírgula, escape e linha TOTAL', async () => {
    const resposta = await get('/relatorios/sessoes.csv').buffer(true).parse((res, cb) => {
      let dados = '';
      res.setEncoding('utf8');
      res.on('data', (parte: string) => (dados += parte));
      res.on('end', () => cb(null, dados));
    });

    expect(resposta.status).toBe(200);
    expect(resposta.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(resposta.headers['content-disposition']).toMatch(/^attachment; filename="relatorio-sessoes-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv"$/);

    const csv = resposta.body as string;
    expect(csv.startsWith('﻿')).toBe(true);
    const linhas = csv.slice(1).split('\r\n');
    expect(linhas[0]).toBe('Data/hora;Filme;Sala;Preço (R$);Capacidade;Vendidos;Reservados;Livres;Ocupação (%);Receita (R$)');
    expect(linhas[1]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2};Filme Um;Sala \d+;25,00;10;3;2;5;30,00;75,00$/);
    // título com ; e aspas vai entre aspas, com as aspas duplicadas
    expect(linhas[2]).toContain(';"Ação; Parte ""2""";');
    expect(linhas[3]).toBe('');
    expect(linhas[4]).toBe('TOTAL;2 sessão(ões);;;20;5;2;;25,00;125,00');
  });
});

describe('validação e acesso', () => {
  it('período inválido → 422; formato errado ou agrupamento desconhecido → 400', async () => {
    const invertido = await get('/relatorios/sessoes?inicio=2026-12-10&fim=2026-12-01');
    expect([invertido.status, invertido.body.erro.codigo]).toEqual([422, 'PERIODO_INVALIDO']);

    const longo = await get('/relatorios/vendas?inicio=2025-01-01&fim=2026-06-30');
    expect([longo.status, longo.body.erro.codigo]).toEqual([422, 'PERIODO_MUITO_LONGO']);

    expect((await get('/relatorios/sessoes?inicio=24/11/2026')).status).toBe(400);
    expect((await get('/relatorios/vendas?agrupar=sala')).status).toBe(400);
  });

  it('cliente → 403; sem token → 401', async () => {
    const cliente = await criarUsuario(Papel.CLIENTE);
    for (const url of ['/relatorios/sessoes', '/relatorios/vendas', '/relatorios/sessoes.csv']) {
      expect((await get(url, cliente)).status, url).toBe(403);
      expect((await request(app).get(url)).status, url).toBe(401);
    }
  });
});

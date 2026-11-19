import type { Server } from 'node:http';
import request from 'supertest';
import { Papel } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { criarFilme, criarSala, criarSessao, criarUsuario, daquiA, limparBanco, venderUmAssento, type UsuarioTeste } from './helpers/banco';

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

/** Compra `qtd` ingressos pelo app (reserva + pagamento) numa sessão que começa em `horas`. */
async function comprar(horas: number, qtd = 1, titulo = 'Filme do Ingresso'): Promise<{ sessaoId: number; codigos: string[] }> {
  const filme = await criarFilme({ titulo, duracaoMinutos: 120 });
  const sala = await criarSala(1, 5);
  const sessao = await criarSessao(filme.id, sala.id, daquiA(horas));
  const assentos = await prisma.assento.findMany({ where: { salaId: sala.id }, orderBy: { numero: 'asc' } });
  const reserva = await request(servidor)
    .post('/reservas')
    .set(cliente.auth)
    .send({ sessaoId: sessao.id, assentoIds: assentos.slice(0, qtd).map((a) => a.id) });
  const pagamento = await request(servidor).post(`/reservas/${reserva.body.reservaId}/pagamento`).set(cliente.auth).send({ metodo: 'PIX' });
  expect(pagamento.status).toBe(201);
  return { sessaoId: sessao.id, codigos: pagamento.body.ingressos.map((i: { codigo: string }) => i.codigo) };
}

const validar = (codigo: string, usuario = operador) =>
  request(servidor).post('/ingressos/validar').set(usuario.auth).send({ codigo });

describe('POST /ingressos/validar', () => {
  it('valida uma vez (200) e na segunda responde 409 com o horário do uso', async () => {
    const { codigos } = await comprar(0.5); // começa em 30 min: dentro da janela de 60 min
    const codigo = codigos[0]!;

    const primeira = await validar(codigo);
    expect(primeira.status).toBe(200);
    expect(primeira.body).toMatchObject({ valido: true, ingresso: { codigo, status: 'UTILIZADO', filme: { titulo: 'Filme do Ingresso' } } });

    const segunda = await validar(codigo);
    expect(segunda.status).toBe(409);
    expect(segunda.body.erro.codigo).toBe('INGRESSO_JA_UTILIZADO');
    expect(segunda.body.erro.detalhes.utilizadoEm).toBe(primeira.body.ingresso.utilizadoEm);
    expect(segunda.body.erro.mensagem).toMatch(/^Ingresso já utilizado às \d{2}:\d{2}\.$/);

    const salvo = await prisma.ingresso.findUniqueOrThrow({ where: { codigo } });
    expect(salvo.validadoPorId).toBe(operador.id);
  });

  it('10 validações SIMULTÂNEAS do mesmo código → exatamente 1 × 200 e 9 × 409', async () => {
    const { codigos } = await comprar(0.5);
    const respostas = await Promise.all(Array.from({ length: 10 }, () => validar(codigos[0]!)));

    expect(respostas.filter((r) => r.status === 200)).toHaveLength(1);
    const conflitos = respostas.filter((r) => r.status === 409);
    expect(conflitos).toHaveLength(9);
    expect(conflitos.every((r) => r.body.erro.codigo === 'INGRESSO_JA_UTILIZADO' && r.body.erro.detalhes.utilizadoEm)).toBe(true);
  });

  it('aceita o código digitado em minúsculas, com espaços e hífen', async () => {
    const { codigos } = await comprar(0.5);
    const digitado = ` ${codigos[0]!.slice(0, 5).toLowerCase()}-${codigos[0]!.slice(5).toLowerCase()} `;

    expect((await validar(digitado)).status).toBe(200);
  });

  it('inexistente → 404 INGRESSO_INVALIDO; fora da janela → 422; cliente → 403', async () => {
    const { codigos } = await comprar(24); // amanhã: a entrada ainda não abriu

    const inexistente = await validar('ABCDEFGHJK');
    expect([inexistente.status, inexistente.body.erro.codigo]).toEqual([404, 'INGRESSO_INVALIDO']);

    const cedo = await validar(codigos[0]!);
    expect([cedo.status, cedo.body.erro.codigo]).toEqual([422, 'INGRESSO_FORA_DO_HORARIO']);
    expect(cedo.body.erro.detalhes).toHaveProperty('abre');
    // não foi marcado como usado
    expect((await prisma.ingresso.findUniqueOrThrow({ where: { codigo: codigos[0]! } })).utilizadoEm).toBeNull();

    expect((await validar(codigos[0]!, cliente)).status).toBe(403);
  });
});

describe('GET /ingressos/meus e GET /ingressos/:codigo', () => {
  it('agrupa por sessão com os status VALIDO, UTILIZADO e SESSAO_ENCERRADA', async () => {
    const amanha = await comprar(24, 2, 'Amanhã');
    const agora = await comprar(0.5, 1, 'Daqui a pouco');
    await validar(agora.codigos[0]!);
    // sessão que já terminou (2 h de filme, começou há 5 h), montada direto no banco
    const filmePassado = await criarFilme({ titulo: 'Ontem', duracaoMinutos: 120 });
    const salaPassada = await criarSala(1, 2);
    const passada = await criarSessao(filmePassado.id, salaPassada.id, daquiA(-5));
    await venderUmAssento(passada.id, cliente.id);

    const resposta = await request(servidor).get('/ingressos/meus').set(cliente.auth);

    expect(resposta.status).toBe(200);
    const grupos = resposta.body as { sessao: { id: number; filme: { titulo: string } }; ingressos: { status: string }[] }[];
    // próximas primeiro (a mais perto no topo), depois as passadas
    expect(grupos.map((g) => g.sessao.filme.titulo)).toEqual(['Daqui a pouco', 'Amanhã', 'Ontem']);
    expect(grupos[0]!.ingressos.map((i) => i.status)).toEqual(['UTILIZADO']);
    expect(grupos[1]!.ingressos.map((i) => i.status)).toEqual(['VALIDO', 'VALIDO']);
    expect(grupos[1]!.sessao.id).toBe(amanha.sessaoId);
    expect(grupos[2]!.ingressos.map((i) => i.status)).toEqual(['SESSAO_ENCERRADA']);
  });

  it('o dono e o operador veem o ingresso; outro cliente recebe 404', async () => {
    const { codigos } = await comprar(24);
    const outro = await criarUsuario(Papel.CLIENTE);

    expect((await request(servidor).get(`/ingressos/${codigos[0]}`).set(cliente.auth)).status).toBe(200);
    expect((await request(servidor).get(`/ingressos/${codigos[0]!.toLowerCase()}`).set(operador.auth)).status).toBe(200);
    expect((await request(servidor).get(`/ingressos/${codigos[0]}`).set(outro.auth)).status).toBe(404);
    expect((await request(servidor).get('/ingressos/meus').set(outro.auth)).body).toEqual([]);
  });
});

import request from 'supertest';
import { Papel } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { criarUsuario, limparBanco } from './helpers/banco';

beforeEach(limparBanco);

const novoCliente = { nome: 'Maria Silva', email: 'Maria@Exemplo.com ', senha: 'senha-forte-123' };

describe('POST /auth/registrar', () => {
  it('cria um CLIENTE, normaliza o e-mail e nunca devolve a senha', async () => {
    const resposta = await request(app).post('/auth/registrar').send(novoCliente);

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ nome: 'Maria Silva', email: 'maria@exemplo.com', papel: 'CLIENTE' });
    expect(resposta.body).not.toHaveProperty('senhaHash');
    expect(resposta.body).not.toHaveProperty('senha');

    const salvo = await prisma.usuario.findUniqueOrThrow({ where: { email: 'maria@exemplo.com' } });
    expect(salvo.senhaHash).not.toBe(novoCliente.senha);
    expect(salvo.senhaHash).toMatch(/^\$2[aby]\$/); // hash bcrypt
  });

  it('recusa "papel" no body (400) e não cria operador por essa via', async () => {
    const resposta = await request(app)
      .post('/auth/registrar')
      .send({ ...novoCliente, papel: 'OPERADOR' });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe('DADOS_INVALIDOS');
    expect(await prisma.usuario.count()).toBe(0);
  });

  it('exige senha com no mínimo 8 caracteres', async () => {
    const resposta = await request(app).post('/auth/registrar').send({ ...novoCliente, senha: '1234567' });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.detalhes).toEqual(
      expect.arrayContaining([expect.objectContaining({ campo: 'senha' })]),
    );
  });

  it('e-mail já cadastrado → 409 EMAIL_EM_USO', async () => {
    await request(app).post('/auth/registrar').send(novoCliente);
    const resposta = await request(app).post('/auth/registrar').send({ ...novoCliente, email: 'MARIA@exemplo.com' });

    expect(resposta.status).toBe(409);
    expect(resposta.body.erro.codigo).toBe('EMAIL_EM_USO');
  });
});

describe('POST /auth/login e GET /auth/me', () => {
  it('login correto devolve token e usuário; o token funciona no /auth/me', async () => {
    await request(app).post('/auth/registrar').send(novoCliente);

    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'maria@exemplo.com', senha: novoCliente.senha });

    expect(login.status).toBe(200);
    expect(login.body.token).toEqual(expect.any(String));
    expect(login.body.usuario).toMatchObject({ email: 'maria@exemplo.com', papel: 'CLIENTE' });
    expect(login.body.usuario).not.toHaveProperty('senhaHash');

    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body).toEqual(login.body.usuario);
  });

  it('senha errada e e-mail inexistente recebem a MESMA resposta genérica (401)', async () => {
    await request(app).post('/auth/registrar').send(novoCliente);

    const senhaErrada = await request(app).post('/auth/login').send({ email: 'maria@exemplo.com', senha: 'errada!!' });
    const emailInexistente = await request(app).post('/auth/login').send({ email: 'ninguem@exemplo.com', senha: 'qualquer' });

    for (const resposta of [senhaErrada, emailInexistente]) {
      expect(resposta.status).toBe(401);
      expect(resposta.body).toEqual({
        erro: { codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'E-mail ou senha inválidos.' },
      });
    }
  });

  it('/auth/me sem token ou com token inválido → 401', async () => {
    const semToken = await request(app).get('/auth/me');
    expect(semToken.status).toBe(401);
    expect(semToken.body.erro.codigo).toBe('NAO_AUTENTICADO');

    const tokenInvalido = await request(app).get('/auth/me').set('Authorization', 'Bearer abc.def.ghi');
    expect(tokenInvalido.status).toBe(401);
    expect(tokenInvalido.body.erro.codigo).toBe('TOKEN_INVALIDO');
  });
});

describe('POST /usuarios/operadores', () => {
  const novoOperador = { nome: 'João Bilheteria', email: 'joao@cinema.com', senha: 'senha-operador-1' };

  it('cliente → 403 SEM_PERMISSAO', async () => {
    const cliente = await criarUsuario(Papel.CLIENTE);
    const resposta = await request(app).post('/usuarios/operadores').set(cliente.auth).send(novoOperador);

    expect(resposta.status).toBe(403);
    expect(resposta.body.erro.codigo).toBe('SEM_PERMISSAO');
  });

  it('operador cria outro operador (201), que consegue fazer login', async () => {
    const operador = await criarUsuario(Papel.OPERADOR);
    const resposta = await request(app).post('/usuarios/operadores').set(operador.auth).send(novoOperador);

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ email: 'joao@cinema.com', papel: 'OPERADOR' });

    const login = await request(app).post('/auth/login').send({ email: novoOperador.email, senha: novoOperador.senha });
    expect(login.status).toBe(200);
    expect(login.body.usuario.papel).toBe('OPERADOR');
  });
});

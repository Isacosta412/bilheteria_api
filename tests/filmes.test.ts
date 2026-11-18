import request from 'supertest';
import { Papel } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { criarFilme, criarSala, criarSessao, criarUsuario, daquiA, limparBanco } from './helpers/banco';

beforeEach(limparBanco);

const filme = {
  titulo: 'O Auto da Compadecida',
  sinopse: 'As aventuras de João Grilo e Chicó.',
  duracaoMinutos: 104,
  classificacao: 'DOZE',
  genero: 'Comédia',
  posterUrl: 'https://placehold.co/300x450?text=Filme',
};

describe('permissões', () => {
  it('cliente tentando criar filme → 403', async () => {
    const cliente = await criarUsuario(Papel.CLIENTE);
    const resposta = await request(app).post('/filmes').set(cliente.auth).send(filme);

    expect(resposta.status).toBe(403);
    expect(resposta.body.erro.codigo).toBe('SEM_PERMISSAO');
  });

  it('sem token → 401', async () => {
    const resposta = await request(app).post('/filmes').send(filme);
    expect(resposta.status).toBe(401);
  });
});

describe('CRUD de filmes (operador)', () => {
  it('cria (201), edita (PUT) e desativa (PATCH)', async () => {
    const operador = await criarUsuario(Papel.OPERADOR);

    const criado = await request(app).post('/filmes').set(operador.auth).send(filme);
    expect(criado.status).toBe(201);
    expect(criado.body).toMatchObject({ ...filme, ativo: true });

    const editado = await request(app)
      .put(`/filmes/${criado.body.id}`)
      .set(operador.auth)
      .send({ ...filme, titulo: 'O Auto da Compadecida 2', posterUrl: null });
    expect(editado.status).toBe(200);
    expect(editado.body).toMatchObject({ titulo: 'O Auto da Compadecida 2', posterUrl: null });

    const desativado = await request(app)
      .patch(`/filmes/${criado.body.id}/ativo`)
      .set(operador.auth)
      .send({ ativo: false });
    expect(desativado.status).toBe(200);
    expect(desativado.body.ativo).toBe(false);
  });

  it('recusa campos controlados pelo sistema e dados inválidos (400)', async () => {
    const operador = await criarUsuario(Papel.OPERADOR);
    const comId = await request(app).post('/filmes').set(operador.auth).send({ ...filme, id: 99 });
    const duracaoZero = await request(app).post('/filmes').set(operador.auth).send({ ...filme, duracaoMinutos: 0 });

    expect(comId.status).toBe(400);
    expect(duracaoZero.status).toBe(400);
  });

  it('filme inexistente → 404', async () => {
    const resposta = await request(app).get('/filmes/999');
    expect(resposta.status).toBe(404);
    expect(resposta.body.erro.codigo).toBe('FILME_NAO_ENCONTRADO');
  });
});

describe('GET /filmes (público)', () => {
  it('filtra por ativo e por busca no título', async () => {
    await criarFilme({ titulo: 'Central do Brasil' });
    await criarFilme({ titulo: 'Cidade de Deus' });
    await criarFilme({ titulo: 'Bacurau', ativo: false });

    const ativos = await request(app).get('/filmes?ativo=true');
    expect(ativos.status).toBe(200);
    expect(ativos.body.map((f: { titulo: string }) => f.titulo)).toEqual(['Central do Brasil', 'Cidade de Deus']);

    const busca = await request(app).get('/filmes?busca=cidade');
    expect(busca.body).toHaveLength(1);
    expect(busca.body[0].titulo).toBe('Cidade de Deus');
  });
});

describe('DELETE /filmes/:id', () => {
  it('filme com sessões não é excluído (422); sem sessões, é (204)', async () => {
    const operador = await criarUsuario(Papel.OPERADOR);
    const comSessao = await criarFilme();
    const semSessao = await criarFilme();
    const sala = await criarSala();
    await criarSessao(comSessao.id, sala.id, daquiA(24));

    const bloqueado = await request(app).delete(`/filmes/${comSessao.id}`).set(operador.auth);
    expect(bloqueado.status).toBe(422);
    expect(bloqueado.body.erro.codigo).toBe('FILME_COM_SESSOES');

    const excluido = await request(app).delete(`/filmes/${semSessao.id}`).set(operador.auth);
    expect(excluido.status).toBe(204);
    expect((await request(app).get(`/filmes/${semSessao.id}`)).status).toBe(404);
  });
});

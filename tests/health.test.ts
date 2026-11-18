import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { healthRepository } from '../src/repositories/health.repository';

describe('GET /health', () => {
  it('responde 200 com status ok quando o banco responde ao SELECT 1', async () => {
    const resposta = await request(app).get('/health');

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ status: 'ok', banco: 'ok' });
  });

  it('responde 503 quando o banco está fora do ar', async () => {
    vi.spyOn(healthRepository, 'ping').mockRejectedValueOnce(new Error('conexão recusada'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const resposta = await request(app).get('/health');

    expect(resposta.status).toBe(503);
    expect(resposta.body).toEqual({ status: 'erro', banco: 'erro' });
  });

  it('inclui os cabeçalhos de segurança do helmet', async () => {
    const resposta = await request(app).get('/health');

    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
  });
});

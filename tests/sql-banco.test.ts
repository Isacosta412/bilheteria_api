/**
 * Testes de integração dos objetos SQL da migration sql_regras_banco:
 * triggers, procedure sp_expirar_reservas e view vw_relatorio_sessoes.
 *
 * Cada teste roda dentro de uma transação que SEMPRE é desfeita (rollback),
 * então nada fica gravado no banco de desenvolvimento.
 */
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';

type Tx = Prisma.TransactionClient;

class Rollback extends Error {}

async function emTransacaoDesfeita(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Rollback('desfazer dados do teste');
      },
      { timeout: 20_000 },
    );
  } catch (erro: unknown) {
    if (!(erro instanceof Rollback)) {
      throw erro;
    }
  }
}

interface Cenario {
  usuarioId: number;
  salaId: number;
  filmeId: number;
}

/** Cria usuário, filme e uma sala com filas A e B de 5 assentos (10 lugares). */
async function criarCenario(tx: Tx): Promise<Cenario> {
  const usuario = await tx.usuario.create({
    data: { nome: 'Cliente Teste', email: `teste-${Date.now()}@exemplo.com`, senhaHash: 'x' },
  });
  const filme = await tx.filme.create({
    data: {
      titulo: 'Filme Teste',
      sinopse: 'Sinopse',
      duracaoMinutos: 120,
      classificacao: 'LIVRE',
      genero: 'Drama',
    },
  });
  const sala = await tx.sala.create({ data: { nome: `Sala Teste ${Date.now()}` } });
  await tx.assento.createMany({
    data: ['A', 'B'].flatMap((fila) =>
      [1, 2, 3, 4, 5].map((numero) => ({ salaId: sala.id, fila, numero })),
    ),
  });
  return { usuarioId: usuario.id, salaId: sala.id, filmeId: filme.id };
}

async function criarSessao(tx: Tx, cenario: Cenario, preco = '30.00'): Promise<number> {
  const sessao = await tx.sessao.create({
    data: {
      filmeId: cenario.filmeId,
      salaId: cenario.salaId,
      dataHora: new Date(Date.now() + 24 * 60 * 60 * 1000),
      preco: new Prisma.Decimal(preco),
    },
  });
  return sessao.id;
}

/** Ids de sessao_assento de uma sessão, por "fila+numero" (ex.: "A1"). */
async function mapaAssentos(tx: Tx, sessaoId: number): Promise<Map<string, number>> {
  const linhas = await tx.sessaoAssento.findMany({
    where: { sessaoId },
    include: { assento: true },
  });
  return new Map(linhas.map((l) => [`${l.assento.fila}${l.assento.numero}`, l.id]));
}

function idsDe(mapa: Map<string, number>, rotulos: string[]): number[] {
  return rotulos.map((rotulo) => {
    const id = mapa.get(rotulo);
    if (id === undefined) throw new Error(`assento ${rotulo} não encontrado`);
    return id;
  });
}

describe('trigger trg_gerar_assentos_sessao', () => {
  it('cria um sessao_assento LIVRE para cada assento da sala ao inserir a sessão', async () => {
    await emTransacaoDesfeita(async (tx) => {
      const cenario = await criarCenario(tx);
      const sessaoId = await criarSessao(tx, cenario);

      const linhas = await tx.sessaoAssento.findMany({ where: { sessaoId } });
      expect(linhas).toHaveLength(10);
      expect(linhas.every((l) => l.status === 'LIVRE' && l.reservaId === null)).toBe(true);
    });
  });

  it('recusa sessão em sala sem assentos (SALA_SEM_ASSENTOS)', async () => {
    await emTransacaoDesfeita(async (tx) => {
      const cenario = await criarCenario(tx);
      const salaVazia = await tx.sala.create({ data: { nome: `Sala Vazia ${Date.now()}` } });

      // Último comando da transação: depois de um erro, o Postgres aborta a transação.
      await expect(
        criarSessao(tx, { ...cenario, salaId: salaVazia.id }),
      ).rejects.toThrow(/SALA_SEM_ASSENTOS/);
    });
  });
});

describe('trigger trg_atualizado_em', () => {
  it('atualiza atualizado_em em um UPDATE feito em SQL puro', async () => {
    await emTransacaoDesfeita(async (tx) => {
      const antigo = new Date('2020-01-01T00:00:00Z');
      const sala = await tx.sala.create({
        data: { nome: `Sala Antiga ${Date.now()}`, criadoEm: antigo, atualizadoEm: antigo },
      });

      await tx.$executeRaw`UPDATE sala SET ativa = false WHERE id = ${sala.id}`;

      const depois = await tx.sala.findUniqueOrThrow({ where: { id: sala.id } });
      expect(depois.atualizadoEm.getTime()).toBeGreaterThan(antigo.getTime());
      expect(depois.criadoEm.getTime()).toBe(antigo.getTime());
    });
  });
});

describe('procedure sp_expirar_reservas', () => {
  it('expira a reserva vencida, libera os assentos dela e não toca na reserva válida', async () => {
    await emTransacaoDesfeita(async (tx) => {
      const cenario = await criarCenario(tx);
      const sessaoId = await criarSessao(tx, cenario);
      const mapa = await mapaAssentos(tx, sessaoId);
      const umMinuto = 60 * 1000;

      const vencida = await tx.reserva.create({
        data: {
          usuarioId: cenario.usuarioId,
          sessaoId,
          total: new Prisma.Decimal('60.00'),
          expiraEm: new Date(Date.now() - umMinuto),
        },
      });
      const valida = await tx.reserva.create({
        data: {
          usuarioId: cenario.usuarioId,
          sessaoId,
          total: new Prisma.Decimal('30.00'),
          expiraEm: new Date(Date.now() + 9 * umMinuto),
        },
      });
      await tx.sessaoAssento.updateMany({
        where: { id: { in: idsDe(mapa, ['A1', 'A2']) } },
        data: { status: 'RESERVADO', reservaId: vencida.id, reservadoAte: vencida.expiraEm },
      });
      await tx.sessaoAssento.updateMany({
        where: { id: { in: idsDe(mapa, ['A3']) } },
        data: { status: 'RESERVADO', reservaId: valida.id, reservadoAte: valida.expiraEm },
      });

      const [resultado] = await tx.$queryRaw<{ qtd_expiradas: number }[]>`CALL sp_expirar_reservas(NULL)`;
      expect(resultado?.qtd_expiradas).toBeGreaterThanOrEqual(1);

      const reservaVencida = await tx.reserva.findUniqueOrThrow({ where: { id: vencida.id } });
      const reservaValida = await tx.reserva.findUniqueOrThrow({ where: { id: valida.id } });
      expect(reservaVencida.status).toBe('EXPIRADA');
      expect(reservaValida.status).toBe('PENDENTE');

      const liberados = await tx.sessaoAssento.findMany({ where: { id: { in: idsDe(mapa, ['A1', 'A2']) } } });
      expect(liberados.every((l) => l.status === 'LIVRE' && l.reservaId === null && l.reservadoAte === null)).toBe(true);

      const aindaReservado = await tx.sessaoAssento.findUniqueOrThrow({ where: { id: idsDe(mapa, ['A3'])[0] } });
      expect(aindaReservado.status).toBe('RESERVADO');
      expect(aindaReservado.reservaId).toBe(valida.id);
    });
  });
});

describe('view vw_relatorio_sessoes', () => {
  interface LinhaRelatorio {
    sessao_id: number;
    filme_titulo: string;
    capacidade: number;
    vendidos: number;
    reservados: number;
    livres: number;
    taxa_ocupacao: Prisma.Decimal;
    receita: Prisma.Decimal;
  }

  it('calcula capacidade, vendidos, reservados, livres, taxa de ocupação e receita', async () => {
    await emTransacaoDesfeita(async (tx) => {
      const cenario = await criarCenario(tx);
      const sessaoId = await criarSessao(tx, cenario, '30.00');
      const mapa = await mapaAssentos(tx, sessaoId);
      const umMinuto = 60 * 1000;

      // 2 vendidos (B1, B2) com ingresso
      const paga = await tx.reserva.create({
        data: {
          usuarioId: cenario.usuarioId,
          sessaoId,
          status: 'PAGA',
          total: new Prisma.Decimal('60.00'),
          expiraEm: new Date(Date.now() + 10 * umMinuto),
        },
      });
      const vendidos = idsDe(mapa, ['B1', 'B2']);
      await tx.sessaoAssento.updateMany({
        where: { id: { in: vendidos } },
        data: { status: 'VENDIDO', reservaId: paga.id },
      });
      await tx.ingresso.createMany({
        data: vendidos.map((id, i) => ({ codigo: `T${String(Date.now()).slice(-8)}${i}`, reservaId: paga.id, sessaoAssentoId: id })),
      });

      // 1 reservado válido (A3) e 1 reservado vencido (A1), que conta como livre
      const pendente = await tx.reserva.create({
        data: {
          usuarioId: cenario.usuarioId,
          sessaoId,
          total: new Prisma.Decimal('60.00'),
          expiraEm: new Date(Date.now() + 9 * umMinuto),
        },
      });
      await tx.sessaoAssento.update({
        where: { id: idsDe(mapa, ['A3'])[0] },
        data: { status: 'RESERVADO', reservaId: pendente.id, reservadoAte: new Date(Date.now() + 9 * umMinuto) },
      });
      await tx.sessaoAssento.update({
        where: { id: idsDe(mapa, ['A1'])[0] },
        data: { status: 'RESERVADO', reservaId: pendente.id, reservadoAte: new Date(Date.now() - umMinuto) },
      });

      const [linha] = await tx.$queryRaw<LinhaRelatorio[]>`
        SELECT * FROM vw_relatorio_sessoes WHERE sessao_id = ${sessaoId}`;

      expect(linha).toBeDefined();
      expect(linha?.filme_titulo).toBe('Filme Teste');
      expect(linha?.capacidade).toBe(10);
      expect(linha?.vendidos).toBe(2);
      expect(linha?.reservados).toBe(1);
      expect(linha?.livres).toBe(7);
      expect(linha?.taxa_ocupacao.toFixed(2)).toBe('20.00');
      expect(linha?.receita.toFixed(2)).toBe('60.00');
    });
  });
});

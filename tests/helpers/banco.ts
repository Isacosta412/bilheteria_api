/**
 * Fábricas e limpeza para os testes. Inserem direto pelo Prisma só para MONTAR o cenário;
 * o comportamento que está sendo testado passa sempre pela API (supertest).
 */
import bcrypt from 'bcryptjs';
import { Classificacao, Papel, Prisma, TipoAssento } from '@prisma/client';
import { prisma } from '../../src/config/prisma';
import { tokenService } from '../../src/services/token.service';

export async function limparBanco(): Promise<void> {
  // Trava de segurança: nunca limpar um banco que não seja o de teste.
  const [{ banco } = { banco: '' }] = await prisma.$queryRaw<{ banco: string }[]>`SELECT current_database() AS banco`;
  if (!/test/i.test(banco)) {
    throw new Error(`limparBanco() recusado: o banco atual ("${banco}") não é um banco de teste.`);
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE ingresso, pagamento, sessao_assento, reserva, sessao, assento, sala, filme, usuario RESTART IDENTITY CASCADE',
  );
}

let sequencia = 0;
const proximo = (): number => ++sequencia;

export interface UsuarioTeste {
  id: number;
  email: string;
  senha: string;
  token: string;
  auth: { Authorization: string };
}

export async function criarUsuario(papel: Papel = Papel.CLIENTE): Promise<UsuarioTeste> {
  const n = proximo();
  const senha = `senha-teste-${n}`;
  const usuario = await prisma.usuario.create({
    data: {
      nome: `${papel === Papel.OPERADOR ? 'Operador' : 'Cliente'} ${n}`,
      email: `usuario${n}@teste.local`,
      // custo baixo só nos testes, para não deixar a suíte lenta
      senhaHash: await bcrypt.hash(senha, 4),
      papel,
    },
  });
  const token = tokenService.gerar({ id: usuario.id, papel });
  return { id: usuario.id, email: usuario.email, senha, token, auth: { Authorization: `Bearer ${token}` } };
}

export async function criarFilme(dados: Partial<{ titulo: string; duracaoMinutos: number; ativo: boolean }> = {}) {
  return prisma.filme.create({
    data: {
      titulo: dados.titulo ?? `Filme ${proximo()}`,
      sinopse: 'Sinopse de teste',
      duracaoMinutos: dados.duracaoMinutos ?? 120,
      classificacao: Classificacao.LIVRE,
      genero: 'Drama',
      ativo: dados.ativo ?? true,
    },
  });
}

/** Sala com filas A, B, ... e `porFila` assentos em cada. */
export async function criarSala(qtdFilas = 2, porFila = 5, ativa = true) {
  const sala = await prisma.sala.create({ data: { nome: `Sala ${proximo()}`, ativa } });
  if (qtdFilas > 0) {
    await prisma.assento.createMany({
      data: Array.from({ length: qtdFilas }, (_, i) => String.fromCharCode(65 + i)).flatMap((fila) =>
        Array.from({ length: porFila }, (_, j) => ({ salaId: sala.id, fila, numero: j + 1, tipo: TipoAssento.PADRAO })),
      ),
    });
  }
  return sala;
}

/** Insere a sessão direto (a trigger gera os sessao_assento). Aceita datas no passado, para montar cenários. */
export async function criarSessao(filmeId: number, salaId: number, dataHora: Date, preco = '30.00') {
  return prisma.sessao.create({ data: { filmeId, salaId, dataHora, preco: new Prisma.Decimal(preco) } });
}

/** Data a `horas` horas de agora, com os segundos zerados. */
export function daquiA(horas: number): Date {
  const data = new Date(Date.now() + horas * 60 * 60 * 1000);
  data.setUTCSeconds(0, 0);
  return data;
}

/** Vende o primeiro assento da sessão (reserva PAGA + ingresso), para cenários de "já tem venda". */
export async function venderUmAssento(sessaoId: number, usuarioId: number): Promise<void> {
  const assento = await prisma.sessaoAssento.findFirstOrThrow({ where: { sessaoId }, orderBy: { id: 'asc' } });
  const reserva = await prisma.reserva.create({
    data: {
      usuarioId,
      sessaoId,
      status: 'PAGA',
      total: new Prisma.Decimal('30.00'),
      expiraEm: daquiA(1),
    },
  });
  await prisma.sessaoAssento.update({ where: { id: assento.id }, data: { status: 'VENDIDO', reservaId: reserva.id } });
  await prisma.ingresso.create({
    data: { codigo: `TST${String(proximo()).padStart(6, '0')}`, reservaId: reserva.id, sessaoAssentoId: assento.id },
  });
}

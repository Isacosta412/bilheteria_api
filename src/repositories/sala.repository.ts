import type { Prisma, Sala, TipoAssento } from '@prisma/client';
import { clientePadrao, type ClienteBanco } from './transacao';

export interface NovoAssento {
  fila: string;
  numero: number;
  tipo: TipoAssento;
}

const comAssentos = {
  assentos: { select: { id: true, fila: true, numero: true, tipo: true }, orderBy: [{ fila: 'asc' }, { numero: 'asc' }] },
} satisfies Prisma.SalaInclude;

export type SalaComAssentos = Prisma.SalaGetPayload<{ include: typeof comAssentos }>;

export const salaRepository = {
  listar(cliente: ClienteBanco = clientePadrao): Promise<SalaComAssentos[]> {
    return cliente.sala.findMany({ include: comAssentos, orderBy: { nome: 'asc' } });
  },

  buscarPorId(id: number, cliente: ClienteBanco = clientePadrao): Promise<SalaComAssentos | null> {
    return cliente.sala.findUnique({ where: { id }, include: comAssentos });
  },

  /** Só os dados da sala, sem os assentos. */
  buscarResumo(id: number, cliente: ClienteBanco = clientePadrao): Promise<Sala | null> {
    return cliente.sala.findUnique({ where: { id } });
  },

  buscarPorNome(nome: string, cliente: ClienteBanco = clientePadrao): Promise<Sala | null> {
    return cliente.sala.findFirst({ where: { nome: { equals: nome, mode: 'insensitive' } } });
  },

  criar(nome: string, cliente: ClienteBanco = clientePadrao): Promise<Sala> {
    return cliente.sala.create({ data: { nome } });
  },

  atualizar(id: number, dados: { nome: string; ativa: boolean }, cliente: ClienteBanco = clientePadrao): Promise<Sala> {
    return cliente.sala.update({ where: { id }, data: dados });
  },

  async criarAssentos(salaId: number, assentos: NovoAssento[], cliente: ClienteBanco = clientePadrao): Promise<number> {
    const { count } = await cliente.assento.createMany({ data: assentos.map((a) => ({ ...a, salaId })) });
    return count;
  },

  async excluirAssentos(salaId: number, cliente: ClienteBanco = clientePadrao): Promise<void> {
    await cliente.assento.deleteMany({ where: { salaId } });
  },

  contarAssentos(salaId: number, cliente: ClienteBanco = clientePadrao): Promise<number> {
    return cliente.assento.count({ where: { salaId } });
  },

  contarSessoesFuturas(salaId: number, agora: Date, cliente: ClienteBanco = clientePadrao): Promise<number> {
    return cliente.sessao.count({ where: { salaId, cancelada: false, dataHora: { gte: agora } } });
  },

  contarSessoes(salaId: number, cliente: ClienteBanco = clientePadrao): Promise<number> {
    return cliente.sessao.count({ where: { salaId } });
  },

  /**
   * Trava a linha da sala até o fim da transação (SELECT ... FOR UPDATE).
   * Serializa operações que dependem da agenda/estrutura da sala: criar sessão e mudar o layout.
   * Devolve false se a sala não existe.
   */
  async travar(salaId: number, cliente: ClienteBanco): Promise<boolean> {
    const linhas = await cliente.$queryRaw<{ id: number }[]>`SELECT id FROM sala WHERE id = ${salaId} FOR UPDATE`;
    return linhas.length > 0;
  },
};

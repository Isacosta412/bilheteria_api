import { CanalReserva, Prisma, StatusReserva } from '@prisma/client';
import { clientePadrao, type ClienteBanco } from './transacao';

const comDetalhes = {
  sessao: {
    select: {
      id: true,
      dataHora: true,
      preco: true,
      formato: true,
      idioma: true,
      filme: { select: { titulo: true } },
      sala: { select: { nome: true } },
    },
  },
  assentos: {
    select: { assento: { select: { id: true, fila: true, numero: true, tipo: true } } },
    orderBy: { assentoId: 'asc' },
  },
} satisfies Prisma.ReservaInclude;

export type ReservaComDetalhes = Prisma.ReservaGetPayload<{ include: typeof comDetalhes }>;

/** Sessão lida (e travada) no início da reserva. */
export interface SessaoParaReserva {
  id: number;
  dataHora: Date;
  preco: Prisma.Decimal;
  cancelada: boolean;
}

export interface NovaReserva {
  usuarioId: number;
  sessaoId: number;
  total: Prisma.Decimal;
  qtdMeia: number;
  expiraEm: Date;
  canal: CanalReserva;
  nomeComprador: string | null;
}

export interface ReservaParaPagamento {
  id: number;
  usuarioId: number;
  status: StatusReserva;
  expiraEm: Date;
  total: Prisma.Decimal;
  qtdMeia: number;
  precoSessao: Prisma.Decimal;
  dataHoraSessao: Date;
}

export interface ReservaTravada {
  id: number;
  usuarioId: number;
  status: StatusReserva;
  expiraEm: Date;
}

export const reservaRepository = {
  /**
   * Passo 1 da reserva: lê a sessão com FOR SHARE. Várias reservas na mesma sessão continuam em
   * paralelo (FOR SHARE não conflita com FOR SHARE), mas o cancelamento da sessão (FOR UPDATE)
   * espera elas terminarem, e vice-versa.
   */
  async travarSessaoCompartilhada(sessaoId: number, cliente: ClienteBanco): Promise<SessaoParaReserva | null> {
    const linhas = await cliente.$queryRaw<
      { id: number; data_hora: Date; preco: Prisma.Decimal; cancelada: boolean }[]
    >(Prisma.sql`SELECT id, data_hora, preco, cancelada FROM sessao WHERE id = ${sessaoId} FOR SHARE`);
    const linha = linhas[0];
    return linha ? { id: linha.id, dataHora: linha.data_hora, preco: linha.preco, cancelada: linha.cancelada } : null;
  },

  /**
   * Lock consultivo (advisory) do par cliente+sessão até o fim da transação: requisições do MESMO
   * cliente para a MESMA sessão passam uma de cada vez; as de outros clientes não esperam.
   * ($executeRaw porque pg_advisory_xact_lock devolve void.)
   */
  async travarClienteNaSessao(usuarioId: number, sessaoId: number, cliente: ClienteBanco): Promise<void> {
    await cliente.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${usuarioId}::int, ${sessaoId}::int)`);
  },

  criar(dados: NovaReserva, cliente: ClienteBanco): Promise<{ id: number }> {
    return cliente.reserva.create({ data: dados, select: { id: true } });
  },

  contarOutrasPendentesValidas(
    usuarioId: number,
    sessaoId: number,
    excetoId: number,
    agora: Date,
    cliente: ClienteBanco,
  ): Promise<number> {
    return cliente.reserva.count({
      where: {
        usuarioId,
        sessaoId,
        status: StatusReserva.PENDENTE,
        expiraEm: { gte: agora },
        id: { not: excetoId },
      },
    });
  },

  buscarPorId(id: number, cliente: ClienteBanco = clientePadrao): Promise<ReservaComDetalhes | null> {
    return cliente.reserva.findUnique({ where: { id }, include: comDetalhes });
  },

  listarDoUsuario(usuarioId: number, cliente: ClienteBanco = clientePadrao): Promise<ReservaComDetalhes[]> {
    return cliente.reserva.findMany({ where: { usuarioId }, include: comDetalhes, orderBy: { criadoEm: 'desc' } });
  },

  /** Trava a reserva (SELECT ... FOR UPDATE) até o fim da transação. */
  async travar(id: number, cliente: ClienteBanco): Promise<ReservaTravada | null> {
    const linhas = await cliente.$queryRaw<
      { id: number; usuario_id: number; status: StatusReserva; expira_em: Date }[]
    >(Prisma.sql`SELECT id, usuario_id, status, expira_em FROM reserva WHERE id = ${id} FOR UPDATE`);
    const linha = linhas[0];
    return linha ? { id: linha.id, usuarioId: linha.usuario_id, status: linha.status, expiraEm: linha.expira_em } : null;
  },

  async marcarCancelada(id: number, cliente: ClienteBanco): Promise<void> {
    await cliente.reserva.update({ where: { id }, data: { status: StatusReserva.CANCELADA } });
  },

  /**
   * Trava a reserva para o pagamento (SELECT ... FOR UPDATE OF r) e traz o preço e o horário da
   * sessão. Um segundo pagamento (ou cancelamento) simultâneo da mesma reserva espera este lock.
   */
  async travarParaPagamento(id: number, cliente: ClienteBanco): Promise<ReservaParaPagamento | null> {
    const linhas = await cliente.$queryRaw<
      {
        id: number;
        usuario_id: number;
        status: StatusReserva;
        expira_em: Date;
        total: Prisma.Decimal;
        qtd_meia: number;
        preco: Prisma.Decimal;
        data_hora: Date;
      }[]
    >(Prisma.sql`
      SELECT r.id, r.usuario_id, r.status, r.expira_em, r.total, r.qtd_meia, s.preco, s.data_hora
        FROM reserva r
        JOIN sessao s ON s.id = r.sessao_id
       WHERE r.id = ${id}
         FOR UPDATE OF r`);
    const l = linhas[0];
    return l
      ? {
          id: l.id,
          usuarioId: l.usuario_id,
          status: l.status,
          expiraEm: l.expira_em,
          total: l.total,
          qtdMeia: l.qtd_meia,
          precoSessao: l.preco,
          dataHoraSessao: l.data_hora,
        }
      : null;
  },

  async alterarMeias(id: number, qtdMeia: number, total: Prisma.Decimal, cliente: ClienteBanco): Promise<void> {
    await cliente.reserva.update({ where: { id }, data: { qtdMeia, total } });
  },

  async marcarPaga(id: number, cliente: ClienteBanco): Promise<void> {
    await cliente.reserva.update({ where: { id }, data: { status: StatusReserva.PAGA } });
  },

  async marcarExpirada(id: number, cliente: ClienteBanco): Promise<void> {
    await cliente.reserva.update({ where: { id }, data: { status: StatusReserva.EXPIRADA } });
  },

  /** Chama a stored procedure do banco (migration sql_regras_banco). Devolve quantas reservas expiraram. */
  async expirarVencidas(cliente: ClienteBanco = clientePadrao): Promise<number> {
    const [resultado] = await cliente.$queryRaw<{ qtd_expiradas: number }[]>(
      Prisma.sql`CALL sp_expirar_reservas(NULL)`,
    );
    return resultado?.qtd_expiradas ?? 0;
  },
};

import { TipoAssento } from '@prisma/client';
import { Conflito, NaoEncontrado, RegraNegocio } from '../errors';
import { salaRepository, type NovoAssento, type SalaComAssentos } from '../repositories/sala.repository';
import { emTransacao } from '../repositories/transacao';
import type { AtualizarSalaEntrada, CriarSalaEntrada, EstruturaSala, PosicaoAssento } from '../schemas/sala.schema';
import type { FilaLayoutDTO, SalaDetalheDTO, SalaDTO } from '../types/sala';

/** Ordem natural das filas: A, B, ..., Z, AA, AB... */
function compararFilas(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

/** A, B, ..., Z para qtdFilas (o schema limita a 26). */
function nomesDeFilas(qtd: number): string[] {
  return Array.from({ length: qtd }, (_, i) => String.fromCharCode(65 + i));
}

const chave = (p: PosicaoAssento): string => `${p.fila}-${p.numero}`;

/** Regra 8: o SERVICE gera os assentos a partir da estrutura informada. */
function gerarAssentos(estrutura: EstruturaSala): NovoAssento[] {
  const filas = estrutura.filas ?? nomesDeFilas(estrutura.qtdFilas ?? 0);
  const existentes = new Set<string>();
  const assentos: NovoAssento[] = [];
  for (const fila of filas) {
    for (let numero = 1; numero <= estrutura.assentosPorFila; numero++) {
      existentes.add(chave({ fila, numero }));
      assentos.push({ fila, numero, tipo: TipoAssento.PADRAO });
    }
  }

  const pcd = new Set((estrutura.assentosPcd ?? []).map(chave));
  const vip = new Set((estrutura.assentosVip ?? []).map(chave));

  const fora = [...pcd, ...vip].filter((c) => !existentes.has(c));
  if (fora.length > 0) {
    throw new RegraNegocio(
      'ASSENTO_FORA_DO_LAYOUT',
      'Há assentos PCD/VIP que não existem no layout informado.',
      { assentos: [...new Set(fora)] },
    );
  }
  const ambos = [...pcd].filter((c) => vip.has(c));
  if (ambos.length > 0) {
    throw new RegraNegocio('ASSENTO_TIPO_CONFLITANTE', 'Um assento não pode ser PCD e VIP ao mesmo tempo.', {
      assentos: ambos,
    });
  }

  return assentos.map((a) => {
    const c = chave(a);
    if (pcd.has(c)) return { ...a, tipo: TipoAssento.PCD };
    if (vip.has(c)) return { ...a, tipo: TipoAssento.VIP };
    return a;
  });
}

function montarLayout(sala: SalaComAssentos): FilaLayoutDTO[] {
  const porFila = new Map<string, FilaLayoutDTO>();
  for (const assento of sala.assentos) {
    const linha = porFila.get(assento.fila) ?? { fila: assento.fila, assentos: [] };
    linha.assentos.push({ id: assento.id, numero: assento.numero, tipo: assento.tipo });
    porFila.set(assento.fila, linha);
  }
  return [...porFila.values()]
    .sort((a, b) => compararFilas(a.fila, b.fila))
    .map((linha) => ({ ...linha, assentos: linha.assentos.sort((a, b) => a.numero - b.numero) }));
}

function paraSalaDTO(sala: SalaComAssentos): SalaDTO {
  return {
    id: sala.id,
    nome: sala.nome,
    ativa: sala.ativa,
    capacidade: sala.assentos.length,
    qtdFilas: new Set(sala.assentos.map((a) => a.fila)).size,
    criadoEm: sala.criadoEm.toISOString(),
    atualizadoEm: sala.atualizadoEm.toISOString(),
  };
}

function paraSalaDetalheDTO(sala: SalaComAssentos): SalaDetalheDTO {
  return { ...paraSalaDTO(sala), layout: montarLayout(sala) };
}

async function garantirNomeLivre(nome: string, idAtual?: number): Promise<void> {
  const existente = await salaRepository.buscarPorNome(nome);
  if (existente && existente.id !== idAtual) {
    throw new Conflito('SALA_NOME_EM_USO', `Já existe uma sala chamada "${existente.nome}".`);
  }
}

async function buscarDetalheOuFalhar(id: number): Promise<SalaDetalheDTO> {
  const sala = await salaRepository.buscarPorId(id);
  if (!sala) {
    throw new NaoEncontrado('Sala não encontrada.', 'SALA_NAO_ENCONTRADA');
  }
  return paraSalaDetalheDTO(sala);
}

export const salaService = {
  async listar(): Promise<SalaDTO[]> {
    const salas = await salaRepository.listar();
    return salas.map(paraSalaDTO);
  },

  buscarPorId(id: number): Promise<SalaDetalheDTO> {
    return buscarDetalheOuFalhar(id);
  },

  /** Cria a sala e todos os assentos em uma única transação: ou tudo, ou nada. */
  async criar(entrada: CriarSalaEntrada): Promise<SalaDetalheDTO> {
    const { nome, ...estrutura } = entrada;
    const assentos = gerarAssentos(estrutura);
    await garantirNomeLivre(nome);

    const salaId = await emTransacao(async (tx) => {
      const sala = await salaRepository.criar(nome, tx);
      await salaRepository.criarAssentos(sala.id, assentos, tx);
      return sala.id;
    });
    return buscarDetalheOuFalhar(salaId);
  },

  /**
   * Atualiza nome/ativa e, se `estrutura` vier, troca o layout de assentos.
   * Regra 8: a estrutura não muda se houver sessões futuras. Sessões passadas também impedem
   * a troca, porque os assentos antigos estão nas vendas registradas (FK RESTRICT).
   */
  async atualizar(id: number, entrada: AtualizarSalaEntrada): Promise<SalaDetalheDTO> {
    const novosAssentos = entrada.estrutura ? gerarAssentos(entrada.estrutura) : undefined;
    await garantirNomeLivre(entrada.nome, id);

    await emTransacao(async (tx) => {
      // Trava a sala: nenhuma sessão nova é criada nela enquanto a estrutura muda.
      if (!(await salaRepository.travar(id, tx))) {
        throw new NaoEncontrado('Sala não encontrada.', 'SALA_NAO_ENCONTRADA');
      }

      if (novosAssentos) {
        const futuras = await salaRepository.contarSessoesFuturas(id, new Date(), tx);
        if (futuras > 0) {
          throw new RegraNegocio(
            'SALA_COM_SESSOES_FUTURAS',
            `A estrutura da sala não pode ser alterada: há ${futuras} sessão(ões) futura(s) agendada(s).`,
          );
        }
        if ((await salaRepository.contarSessoes(id, tx)) > 0) {
          throw new RegraNegocio(
            'SALA_COM_HISTORICO',
            'A sala já teve sessões e os assentos fazem parte do histórico de vendas. Crie uma nova sala com o novo layout.',
          );
        }
        await salaRepository.excluirAssentos(id, tx);
        await salaRepository.criarAssentos(id, novosAssentos, tx);
      }

      await salaRepository.atualizar(id, { nome: entrada.nome, ativa: entrada.ativa }, tx);
    });

    return buscarDetalheOuFalhar(id);
  },
};

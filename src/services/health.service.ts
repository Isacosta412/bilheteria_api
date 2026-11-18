import { healthRepository } from '../repositories/health.repository';
import type { StatusSaude } from '../types/health';

export const healthService = {
  /** Testa a conexão com o banco; nunca lança, devolve o status para o controller. */
  async verificar(): Promise<StatusSaude> {
    try {
      await healthRepository.ping();
      return { status: 'ok', banco: 'ok' };
    } catch (erro: unknown) {
      console.error('[health] falha ao consultar o banco:', erro instanceof Error ? erro.message : erro);
      return { status: 'erro', banco: 'erro' };
    }
  },
};

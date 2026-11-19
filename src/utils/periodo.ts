import { FUSO_HORARIO } from '../config/constantes';

const DIA_MS = 24 * 60 * 60 * 1000;

export interface Periodo {
  /** Primeiro dia (inclusive), AAAA-MM-DD no horário de Brasília. */
  inicio: string;
  /** Último dia (inclusive), AAAA-MM-DD no horário de Brasília. */
  fim: string;
  /** Instante inicial (inclusive): inicio 00:00 em Brasília. */
  de: Date;
  /** Instante final (exclusivo): dia seguinte ao fim, 00:00 em Brasília. */
  ate: Date;
  /** Quantidade de dias do período (fim − inicio + 1). */
  dias: number;
}

/** Dia de hoje em Brasília, AAAA-MM-DD. */
export function hojeEmBrasilia(agora = new Date()): string {
  // en-CA formata como AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

/** Soma dias a uma data AAAA-MM-DD (aritmética de calendário, sem fuso). */
export function somarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

/**
 * Converte dias de calendário (Brasília) no intervalo [de, ate) usado nas consultas.
 * Sem datas, usa de 30 dias atrás até 30 dias à frente (vendas recentes + sessões agendadas).
 * Não valida regra de negócio: quem decide se o período é aceitável é o service.
 */
export function resolverPeriodo(inicio?: string, fim?: string, agora = new Date()): Periodo {
  const hoje = hojeEmBrasilia(agora);
  const i = inicio ?? somarDias(hoje, -30);
  const f = fim ?? somarDias(hoje, 30);
  return {
    inicio: i,
    fim: f,
    de: new Date(`${i}T00:00:00${FUSO_HORARIO}`),
    ate: new Date(`${somarDias(f, 1)}T00:00:00${FUSO_HORARIO}`),
    dias: Math.round((Date.parse(`${f}T00:00:00Z`) - Date.parse(`${i}T00:00:00Z`)) / DIA_MS) + 1,
  };
}

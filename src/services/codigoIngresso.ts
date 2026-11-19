import { randomInt } from 'node:crypto';

/**
 * Alfabeto sem caracteres ambíguos: sem 0/O e sem 1/I (fáceis de confundir ao digitar na entrada).
 * 32 símbolos × 10 posições ≈ 1,1 × 10^15 códigos possíveis, não sequenciais e imprevisíveis.
 */
export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const TAMANHO_CODIGO = 10;

/** Gera um código de ingresso com gerador criptográfico (crypto.randomInt é uniforme, sem viés de módulo). */
export function gerarCodigoIngresso(): string {
  let codigo = '';
  for (let i = 0; i < TAMANHO_CODIGO; i++) {
    codigo += ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)];
  }
  return codigo;
}

/** Normaliza o que o operador digitou: tira espaços e hífens e passa para maiúsculas. */
export function normalizarCodigo(codigo: string): string {
  return codigo.replace(/[\s-]/g, '').toUpperCase();
}

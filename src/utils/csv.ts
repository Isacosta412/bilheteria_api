/**
 * CSV no formato que o Excel em português abre direto (duplo clique):
 * BOM UTF-8 (acentos corretos), separador ";" e quebra de linha CRLF.
 */
export const SEPARADOR_CSV = ';';
const BOM = '﻿';

export type CampoCsv = string | number | null | undefined;

/** Campo com ; " ou quebra de linha vai entre aspas, com as aspas internas duplicadas (RFC 4180). */
export function escaparCampo(valor: CampoCsv): string {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function gerarCsv(cabecalho: string[], linhas: CampoCsv[][]): string {
  const todas = [cabecalho, ...linhas].map((linha) => linha.map(escaparCampo).join(SEPARADOR_CSV));
  return BOM + todas.join('\r\n') + '\r\n';
}

/** "1234.5" → "1234,50" (decimal com vírgula, como o Excel pt-BR espera). */
export function decimalPtBr(valor: string): string {
  return Number(valor).toFixed(2).replace('.', ',');
}

/** ISO → "24/11/2026 19:30" no horário de Brasília. */
export function dataHoraPtBr(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(',', '');
}

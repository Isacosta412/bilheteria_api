/** Ordem natural das filas: A, B, ..., Z, AA, AB... (ordem alfabética pura poria "AA" antes de "B"). */
export function compararFilas(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

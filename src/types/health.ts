/** DTO de saída do GET /health. */
export interface StatusSaude {
  status: 'ok' | 'erro';
  banco: 'ok' | 'erro';
}

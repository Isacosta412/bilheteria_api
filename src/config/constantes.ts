/** Constantes de negócio que não variam por ambiente. */

/** Intervalo de limpeza da sala entre o fim de uma sessão e o início da próxima. */
export const LIMPEZA_MINUTOS = 15;

/** Duração máxima aceita para um filme/evento (também limita a janela da checagem de sobreposição). */
export const DURACAO_MAXIMA_MINUTOS = 600;

/** Fuso usado para interpretar filtros por dia (ex.: ?data=2026-11-24). O Brasil não tem horário de verão desde 2019. */
export const FUSO_HORARIO = '-03:00';

/** Custo do bcrypt para o hash das senhas. */
export const BCRYPT_CUSTO = 10;

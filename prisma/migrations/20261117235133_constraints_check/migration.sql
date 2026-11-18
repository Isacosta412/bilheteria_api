-- Migration manual: CHECK constraints que o Prisma não consegue expressar no schema.prisma.
-- O service valida essas regras antes (e devolve erros de negócio claros); os CHECKs são a
-- defesa em profundidade no banco: nenhum INSERT/UPDATE, nem em SQL puro, grava um estado impossível.

-- ─── Pedidos no B02 ─────────────────────────────────────────────────────────

-- Preço do ingresso da sessão precisa ser positivo.
ALTER TABLE "sessao"
  ADD CONSTRAINT "ck_sessao_preco_positivo" CHECK ("preco" > 0);

-- Número do assento começa em 1.
ALTER TABLE "assento"
  ADD CONSTRAINT "ck_assento_numero_positivo" CHECK ("numero" > 0);

-- Duração do filme/evento precisa ser positiva (usada no cálculo de sobreposição de sessões).
ALTER TABLE "filme"
  ADD CONSTRAINT "ck_filme_duracao_positiva" CHECK ("duracao_minutos" > 0);

-- Assento RESERVADO precisa ter prazo de expiração (reservado_ate), senão nunca seria liberado.
ALTER TABLE "sessao_assento"
  ADD CONSTRAINT "ck_sessao_assento_reservado_ate"
  CHECK ("status" <> 'RESERVADO' OR "reservado_ate" IS NOT NULL);

-- ─── Extras ─────────────────────────────────────────────────────────────────

-- Total da reserva é calculado no servidor (quantidade × preço) e nunca é zero ou negativo.
ALTER TABLE "reserva"
  ADD CONSTRAINT "ck_reserva_total_positivo" CHECK ("total" > 0);

-- Valor pago precisa ser positivo.
ALTER TABLE "pagamento"
  ADD CONSTRAINT "ck_pagamento_valor_positivo" CHECK ("valor" > 0);

-- Fila do assento: 1 ou 2 letras maiúsculas (A, B, ..., Z, AA, AB...).
ALTER TABLE "assento"
  ADD CONSTRAINT "ck_assento_fila_formato" CHECK ("fila" ~ '^[A-Z]{1,2}$');

-- Coerência entre status e reserva:
--   LIVRE              → não pertence a nenhuma reserva e não tem prazo;
--   RESERVADO/VENDIDO  → sempre aponta para a reserva que o prendeu/comprou.
ALTER TABLE "sessao_assento"
  ADD CONSTRAINT "ck_sessao_assento_coerencia_reserva"
  CHECK (
    ("status" = 'LIVRE' AND "reserva_id" IS NULL AND "reservado_ate" IS NULL)
    OR ("status" <> 'LIVRE' AND "reserva_id" IS NOT NULL)
  );

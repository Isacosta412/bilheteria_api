-- Formato (2D/3D) e idioma (dublado/legendado) da sessão; meia-entrada na reserva e no ingresso.
-- Migration escrita à mão: tudo aditivo, com DEFAULT para as linhas que já existem.

-- 1. Enums
CREATE TYPE "formato_sessao" AS ENUM ('DOIS_D', 'TRES_D');
CREATE TYPE "idioma_sessao" AS ENUM ('DUBLADO', 'LEGENDADO');
CREATE TYPE "tipo_ingresso" AS ENUM ('INTEIRA', 'MEIA');

-- 2. Sessão: as sessões existentes ficam 2D dubladas
ALTER TABLE "sessao"
  ADD COLUMN "formato" "formato_sessao" NOT NULL DEFAULT 'DOIS_D',
  ADD COLUMN "idioma"  "idioma_sessao"  NOT NULL DEFAULT 'DUBLADO';

-- 3. Reserva: quantos ingressos são meia
ALTER TABLE "reserva"
  ADD COLUMN "qtd_meia" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "ck_reserva_qtd_meia" CHECK ("qtd_meia" >= 0);

-- 4. Ingresso: tipo e valor pago. Os já emitidos eram todos inteira, pelo preço da sessão.
ALTER TABLE "ingresso"
  ADD COLUMN "tipo"  "tipo_ingresso" NOT NULL DEFAULT 'INTEIRA',
  ADD COLUMN "valor" DECIMAL(10, 2);

UPDATE "ingresso" i
   SET "valor" = se."preco"
  FROM "sessao_assento" sa
  JOIN "sessao" se ON se."id" = sa."sessao_id"
 WHERE sa."id" = i."sessao_assento_id";

ALTER TABLE "ingresso"
  ALTER COLUMN "valor" SET NOT NULL,
  ADD CONSTRAINT "ck_ingresso_valor_positivo" CHECK ("valor" > 0);

-- 5. View de relatório: a receita passa a somar o valor de cada ingresso (meia conta metade).
--    Mesmas colunas, na mesma ordem (CREATE OR REPLACE VIEW exige isso).
CREATE OR REPLACE VIEW vw_relatorio_sessoes AS
SELECT
  se.id                                                         AS sessao_id,
  f.id                                                          AS filme_id,
  f.titulo                                                      AS filme_titulo,
  sa_sala.id                                                    AS sala_id,
  sa_sala.nome                                                  AS sala_nome,
  se.data_hora                                                  AS data_hora,
  se.preco                                                      AS preco,
  se.cancelada                                                  AS cancelada,
  COUNT(sa.id)::INTEGER                                         AS capacidade,
  (COUNT(*) FILTER (WHERE sa.status = 'VENDIDO'))::INTEGER      AS vendidos,
  (COUNT(*) FILTER (
     WHERE sa.status = 'RESERVADO' AND sa.reservado_ate >= now()
  ))::INTEGER                                                   AS reservados,
  (COUNT(*) FILTER (
     WHERE sa.status = 'LIVRE'
        OR (sa.status = 'RESERVADO' AND sa.reservado_ate < now())
  ))::INTEGER                                                   AS livres,
  COALESCE(
    ROUND(
      (COUNT(*) FILTER (WHERE sa.status = 'VENDIDO')) * 100.0
        / NULLIF(COUNT(sa.id), 0),
      2),
    0)::NUMERIC(5, 2)                                           AS taxa_ocupacao,
  COALESCE(SUM(i.valor), 0)::NUMERIC(12, 2)                     AS receita
FROM sessao se
JOIN filme f            ON f.id = se.filme_id
JOIN sala sa_sala       ON sa_sala.id = se.sala_id
LEFT JOIN sessao_assento sa ON sa.sessao_id = se.id
LEFT JOIN ingresso i        ON i.sessao_assento_id = sa.id
GROUP BY se.id, f.id, f.titulo, sa_sala.id, sa_sala.nome;

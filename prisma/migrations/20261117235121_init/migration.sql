-- CreateEnum
CREATE TYPE "papel" AS ENUM ('CLIENTE', 'OPERADOR');

-- CreateEnum
CREATE TYPE "classificacao" AS ENUM ('LIVRE', 'DEZ', 'DOZE', 'CATORZE', 'DEZESSEIS', 'DEZOITO');

-- CreateEnum
CREATE TYPE "tipo_assento" AS ENUM ('PADRAO', 'PCD', 'VIP');

-- CreateEnum
CREATE TYPE "status_assento" AS ENUM ('LIVRE', 'RESERVADO', 'VENDIDO');

-- CreateEnum
CREATE TYPE "status_reserva" AS ENUM ('PENDENTE', 'PAGA', 'EXPIRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "canal_reserva" AS ENUM ('APP', 'BALCAO');

-- CreateEnum
CREATE TYPE "metodo_pagamento" AS ENUM ('PIX', 'CARTAO', 'DINHEIRO');

-- CreateTable
CREATE TABLE "usuario" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "senha_hash" VARCHAR(255) NOT NULL,
    "papel" "papel" NOT NULL DEFAULT 'CLIENTE',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filme" (
    "id" SERIAL NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "sinopse" TEXT NOT NULL,
    "duracao_minutos" INTEGER NOT NULL,
    "classificacao" "classificacao" NOT NULL,
    "genero" VARCHAR(60) NOT NULL,
    "poster_url" VARCHAR(500),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "filme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sala" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sala_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assento" (
    "id" SERIAL NOT NULL,
    "sala_id" INTEGER NOT NULL,
    "fila" VARCHAR(2) NOT NULL,
    "numero" INTEGER NOT NULL,
    "tipo" "tipo_assento" NOT NULL DEFAULT 'PADRAO',

    CONSTRAINT "assento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessao" (
    "id" SERIAL NOT NULL,
    "filme_id" INTEGER NOT NULL,
    "sala_id" INTEGER NOT NULL,
    "data_hora" TIMESTAMPTZ(3) NOT NULL,
    "preco" DECIMAL(10,2) NOT NULL,
    "cancelada" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessao_assento" (
    "id" SERIAL NOT NULL,
    "sessao_id" INTEGER NOT NULL,
    "assento_id" INTEGER NOT NULL,
    "status" "status_assento" NOT NULL DEFAULT 'LIVRE',
    "reserva_id" INTEGER,
    "reservado_ate" TIMESTAMPTZ(3),

    CONSTRAINT "sessao_assento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserva" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "sessao_id" INTEGER NOT NULL,
    "status" "status_reserva" NOT NULL DEFAULT 'PENDENTE',
    "canal" "canal_reserva" NOT NULL DEFAULT 'APP',
    "total" DECIMAL(10,2) NOT NULL,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamento" (
    "id" SERIAL NOT NULL,
    "reserva_id" INTEGER NOT NULL,
    "metodo" "metodo_pagamento" NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "pago_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingresso" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(16) NOT NULL,
    "reserva_id" INTEGER NOT NULL,
    "sessao_assento_id" INTEGER NOT NULL,
    "utilizado_em" TIMESTAMPTZ(3),
    "validado_por_id" INTEGER,
    "emitido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingresso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sala_nome_key" ON "sala"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "assento_sala_id_fila_numero_key" ON "assento"("sala_id", "fila", "numero");

-- CreateIndex
CREATE INDEX "sessao_sala_id_data_hora_idx" ON "sessao"("sala_id", "data_hora");

-- CreateIndex
CREATE INDEX "sessao_filme_id_idx" ON "sessao"("filme_id");

-- CreateIndex
CREATE INDEX "sessao_assento_sessao_id_status_idx" ON "sessao_assento"("sessao_id", "status");

-- CreateIndex
CREATE INDEX "sessao_assento_reserva_id_idx" ON "sessao_assento"("reserva_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessao_assento_sessao_id_assento_id_key" ON "sessao_assento"("sessao_id", "assento_id");

-- CreateIndex
CREATE INDEX "reserva_status_expira_em_idx" ON "reserva"("status", "expira_em");

-- CreateIndex
CREATE INDEX "reserva_usuario_id_idx" ON "reserva"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagamento_reserva_id_key" ON "pagamento"("reserva_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingresso_codigo_key" ON "ingresso"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ingresso_sessao_assento_id_key" ON "ingresso"("sessao_assento_id");

-- CreateIndex
CREATE INDEX "ingresso_reserva_id_idx" ON "ingresso"("reserva_id");

-- AddForeignKey
ALTER TABLE "assento" ADD CONSTRAINT "assento_sala_id_fkey" FOREIGN KEY ("sala_id") REFERENCES "sala"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_filme_id_fkey" FOREIGN KEY ("filme_id") REFERENCES "filme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_sala_id_fkey" FOREIGN KEY ("sala_id") REFERENCES "sala"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_assento" ADD CONSTRAINT "sessao_assento_sessao_id_fkey" FOREIGN KEY ("sessao_id") REFERENCES "sessao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_assento" ADD CONSTRAINT "sessao_assento_assento_id_fkey" FOREIGN KEY ("assento_id") REFERENCES "assento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_assento" ADD CONSTRAINT "sessao_assento_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reserva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_sessao_id_fkey" FOREIGN KEY ("sessao_id") REFERENCES "sessao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamento" ADD CONSTRAINT "pagamento_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reserva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresso" ADD CONSTRAINT "ingresso_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reserva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresso" ADD CONSTRAINT "ingresso_sessao_assento_id_fkey" FOREIGN KEY ("sessao_assento_id") REFERENCES "sessao_assento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresso" ADD CONSTRAINT "ingresso_validado_por_id_fkey" FOREIGN KEY ("validado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

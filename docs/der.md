# DER – bilheteria-api

Diagrama gerado a partir de `prisma/schema.prisma` e das migrations `init`, `constraints_check` e `formato_idioma_meia`.

Versão em imagem: [diagrama-entidade-relacionamento.png](diagrama-entidade-relacionamento.png). Nela, os tipos enumerados aparecem com o nome do Prisma (`MetodoPagamento`, `StatusReserva`...); no PostgreSQL eles se chamam `metodo_pagamento`, `status_reserva`... (`@@map`).
Nomes reais do banco (snake_case). Para exportar como imagem: cole o bloco em https://mermaid.live.

```mermaid
erDiagram
    usuario {
        int id PK
        varchar nome
        varchar email UK
        varchar senha_hash
        papel papel "CLIENTE | OPERADOR"
        timestamptz criado_em
        timestamptz atualizado_em
    }

    filme {
        int id PK
        varchar titulo
        text sinopse
        int duracao_minutos "CHECK > 0"
        classificacao classificacao "LIVRE..DEZOITO"
        varchar genero
        varchar poster_url "nulo"
        boolean ativo
        timestamptz criado_em
        timestamptz atualizado_em
    }

    sala {
        int id PK
        varchar nome UK
        boolean ativa
        timestamptz criado_em
        timestamptz atualizado_em
    }

    assento {
        int id PK
        int sala_id FK "UK(sala_id, fila, numero)"
        varchar fila "CHECK ^[A-Z]{1,2}$"
        int numero "CHECK > 0"
        tipo_assento tipo "PADRAO | PCD | VIP"
    }

    sessao {
        int id PK
        int filme_id FK
        int sala_id FK
        timestamptz data_hora
        decimal preco "CHECK > 0"
        formato_sessao formato "DOIS_D | TRES_D"
        idioma_sessao idioma "DUBLADO | LEGENDADO"
        boolean cancelada
        timestamptz criado_em
        timestamptz atualizado_em
    }

    sessao_assento {
        int id PK
        int sessao_id FK "UK(sessao_id, assento_id)"
        int assento_id FK
        status_assento status "LIVRE | RESERVADO | VENDIDO"
        int reserva_id FK "nulo"
        timestamptz reservado_ate "nulo"
    }

    reserva {
        int id PK
        int usuario_id FK
        int sessao_id FK
        status_reserva status "PENDENTE | PAGA | EXPIRADA | CANCELADA"
        canal_reserva canal "APP | BALCAO"
        decimal total "CHECK > 0"
        int qtd_meia "CHECK >= 0"
        timestamptz expira_em
        timestamptz criado_em
        timestamptz atualizado_em
    }

    pagamento {
        int id PK
        int reserva_id FK,UK
        metodo_pagamento metodo "PIX | CARTAO | DINHEIRO"
        decimal valor "CHECK > 0"
        timestamptz pago_em
    }

    ingresso {
        int id PK
        varchar codigo UK
        int reserva_id FK
        int sessao_assento_id FK,UK
        tipo_ingresso tipo "INTEIRA | MEIA"
        decimal valor "CHECK > 0"
        timestamptz utilizado_em "nulo"
        int validado_por_id FK "nulo"
        timestamptz emitido_em
    }

    sala    ||--o{ assento        : "possui"
    sala    ||--o{ sessao         : "recebe"
    filme   ||--o{ sessao         : "exibido em"
    sessao  ||--|{ sessao_assento : "tem um por assento"
    assento ||--o{ sessao_assento : "aparece em"
    usuario ||--o{ reserva        : "faz"
    sessao  ||--o{ reserva        : "recebe"
    reserva |o--o{ sessao_assento : "prende"
    reserva ||--o| pagamento      : "é paga por"
    reserva ||--o{ ingresso       : "emite"
    sessao_assento ||--o| ingresso : "vira no máximo um"
    usuario |o--o{ ingresso       : "valida na entrada"
```

## Restrições de integridade

**Unicidade**
- `usuario.email`, `sala.nome`, `ingresso.codigo`
- `assento (sala_id, fila, numero)`: a mesma poltrona não existe duas vezes na sala.
- `sessao_assento (sessao_id, assento_id)`: **um assento tem exatamente uma linha de status por sessão**.
- `ingresso.sessao_assento_id`: **um assento de uma sessão gera no máximo um ingresso**.
- `pagamento.reserva_id`: uma reserva tem no máximo um pagamento.

**CHECK** (migration `constraints_check`)
- `ck_sessao_preco_positivo`, `ck_assento_numero_positivo`, `ck_filme_duracao_positiva`, `ck_reserva_total_positivo`, `ck_pagamento_valor_positivo`
- `ck_assento_fila_formato`: fila com 1 ou 2 letras maiúsculas.
- `ck_sessao_assento_reservado_ate`: `RESERVADO` exige `reservado_ate`.
- `ck_sessao_assento_coerencia_reserva`: `LIVRE` ⇒ sem reserva e sem prazo; `RESERVADO`/`VENDIDO` ⇒ com `reserva_id`.
- Migration `formato_idioma_meia`: `ck_reserva_qtd_meia` (`qtd_meia >= 0`) e `ck_ingresso_valor_positivo` (`valor > 0`).

**Formato, idioma e meia-entrada** (migration `formato_idioma_meia`)
- `sessao.formato` (2D/3D) e `sessao.idioma` (dublado/legendado), com padrão `DOIS_D` e `DUBLADO` para as sessões que já existiam.
- `reserva.qtd_meia`: quantos assentos da reserva são meia-entrada. O total é calculado no servidor: inteiras × preço + meias × metade do preço (arredondada para centavos).
- `ingresso.tipo` e `ingresso.valor`: cada ingresso guarda se é inteira ou meia e quanto foi pago por ele. Os ingressos emitidos antes da migration receberam `INTEIRA` e o preço da sessão.

**Chaves estrangeiras (ON DELETE)**
| FK | Regra |
|---|---|
| assento.sala_id → sala | CASCADE |
| sessao.filme_id → filme, sessao.sala_id → sala | RESTRICT |
| sessao_assento.sessao_id → sessao | CASCADE |
| sessao_assento.assento_id → assento, sessao_assento.reserva_id → reserva | RESTRICT |
| reserva.sessao_id → sessao | CASCADE (bloqueado por pagamento/ingresso se houver venda) |
| reserva.usuario_id → usuario | RESTRICT |
| pagamento.reserva_id → reserva | RESTRICT |
| ingresso.reserva_id, ingresso.sessao_assento_id, ingresso.validado_por_id | RESTRICT |

**Índices**: `sessao(sala_id, data_hora)`, `sessao(filme_id)`, `sessao_assento(sessao_id, status)`, `sessao_assento(reserva_id)`, `reserva(status, expira_em)`, `reserva(usuario_id)`, `ingresso(reserva_id)`, além dos índices únicos acima.

# B06 – Pagamento simulado, emissão de ingresso, venda no balcão e validação

```
Use o Plan Mode. Siga o CLAUDE.md (regras 4, 6 e 9).

1. POST /reservas/:id/pagamento { metodo: "PIX" | "CARTAO" } (dono da reserva)
   Service, em UMA transação:
   - trava a reserva com SELECT ... FOR UPDATE (método do repository com $queryRaw parametrizado);
   - valida: status PENDENTE (senão Conflito), expiraEm > now (senão: marca EXPIRADA, libera os assentos e lança RegraNegocio('RESERVA_EXPIRADA')), dono = usuário logado;
   - cria o Pagamento com valor = reserva.total (nunca vindo do body);
   - UPDATE sessao_assento SET status = 'VENDIDO' WHERE reserva_id = :id AND status = 'RESERVADO' → a contagem deve bater com a quantidade da reserva;
   - cria 1 Ingresso por assento com codigo único (gerador em src/services/codigoIngresso.ts, sem caracteres ambíguos como 0/O e 1/I, com 10 caracteres);
   - reserva → PAGA.
   Simulação: aceite um campo opcional "simularFalha": true SOMENTE quando NODE_ENV != production, para demonstrar o rollback.
   Resposta: { reserva, ingressos: [ { codigo, fila, numero, sessao, filme, sala, dataHora } ] }

2. GET /ingressos/meus → ingressos do cliente, agrupados por sessão, com status (VALIDO, UTILIZADO, SESSAO_ENCERRADA).
   GET /ingressos/:codigo (dono ou OPERADOR).

3. POST /balcao/vendas (OPERADOR) { sessaoId, assentoIds, metodo: "DINHEIRO" | "CARTAO" | "PIX", nomeComprador? }
   Reutiliza o MESMO service de reserva + pagamento em uma única transação (canal BALCAO), sem duplicar a lógica de concorrência. Retorna os ingressos.

4. POST /ingressos/validar { codigo } (OPERADOR)
   Service:
   - normaliza o código (trim, maiúsculas);
   - UPDATE condicional: SET utilizado_em = now(), validado_por_id = :op WHERE codigo = :c AND utilizado_em IS NULL;
   - se a contagem for 0: busca o ingresso; se não existir → 404 INGRESSO_INVALIDO; se já foi usado → 409 INGRESSO_JA_UTILIZADO (com utilizadoEm);
   - regra extra: só valida de 60 min antes do início até o fim da sessão (RegraNegocio caso contrário). Deixe a janela configurável por env para facilitar a demonstração.
   Resposta: { valido: true, ingresso: { codigo, filme, sala, fila, numero, dataHora } }

Testes: pagamento feliz; pagamento de reserva expirada → 422 e assentos livres; pagamento duplo simultâneo da mesma reserva → só 1 sucesso; validação dupla simultânea do mesmo código → 1 sucesso e 1 409; simularFalha → nada gravado (rollback).
Rode build e testes.
```

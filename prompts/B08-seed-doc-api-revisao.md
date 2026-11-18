# B08 – Seed de demonstração, documentação da API e revisão final

```
Três tarefas. Use o Plan Mode.

1. SEED (prisma/seed.ts, idempotente com upsert):
   - 1 operador (do env), 3 clientes de teste com senhas fortes vindas do env (nunca hardcoded no repositório);
   - 4 filmes com sinopse e posterUrl (use URLs de placeholder, como https://placehold.co/300x450?text=Titulo; nada de pôster de filme real);
   - 3 salas: "Sala 1" (8 filas × 12), "Sala 2" (6 × 10, com 2 PCD), "Sala VIP" (4 × 8, tipo VIP);
   - sessões para os próximos 7 dias, a partir da data atual (2 a 3 por dia, sem sobreposição);
   - algumas vendas e reservas já feitas, para o relatório e o mapa de assentos não aparecerem vazios na apresentação.

2. DOCUMENTAÇÃO DA API (o enunciado exige a "definição da API do back end"):
   - Gere docs/openapi.yaml (OpenAPI 3.1) com TODAS as rotas, schemas de request/response, códigos de erro e segurança bearerAuth. Gere os schemas a partir dos zod (zod-to-openapi) OU escreva à mão, mas mantenha-os iguais aos do código.
   - Sirva o Swagger UI em GET /docs (swagger-ui-express), habilitado também em produção.
   - Gere docs/api.md com uma tabela: Método | Rota | Perfil | Descrição | Body | Respostas.
   - Gere bilheteria.http (REST Client do VS Code) ou uma coleção do Insomnia/Postman com o fluxo completo.

3. REVISÃO DE ARQUITETURA E SEGURANÇA. Faça uma auditoria e me mostre um relatório antes de corrigir:
   - algum controller importa prisma ou tem regra de negócio? Algum repository tem regra de negócio?
   - existe algum `any`? Rode `npx tsc --noEmit` com strict.
   - alguma rota devolve senhaHash, reservaId de terceiros ou um stack trace?
   - algum endpoint aceita do body: total, status, codigo, usuarioId ou papel?
   - todos os $queryRaw/$executeRaw são parametrizados?
   - CORS restrito à origem do app; helmet ativo; rate limit no login.
   Depois corrija o que encontrar e rode todos os testes.
```

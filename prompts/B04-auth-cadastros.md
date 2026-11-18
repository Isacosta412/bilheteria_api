# B04 – Autenticação e cadastros da gerência

```
Use o Plan Mode. Siga as camadas do CLAUDE.md (route → controller → service → repository) para cada recurso.

PARTE A – Autenticação
- POST /auth/registrar  { nome, email, senha } → cria sempre um CLIENTE (o papel NUNCA vem do body). A senha deve ter no mínimo 8 caracteres e o hash é feito com bcrypt.
- POST /auth/login      { email, senha } → { token, usuario: { id, nome, email, papel } }. A mensagem de erro é genérica ("E-mail ou senha inválidos").
- GET  /auth/me         → usuário logado (sem senhaHash).
- Middlewares: autenticar (JWT Bearer) e autorizar(...papeis).
- O primeiro OPERADOR é criado pelo seed (prisma/seed.ts) com credenciais vindas do env (SEED_OPERADOR_EMAIL / SEED_OPERADOR_SENHA).
- POST /usuarios/operadores (somente OPERADOR) → cria outro operador.

PARTE B – Cadastros (somente OPERADOR para escrita; GET de filmes e sessões é público ou de CLIENTE)
- Filmes: GET /filmes (filtro ?ativo, ?busca), GET /filmes/:id, POST, PUT /filmes/:id, PATCH /filmes/:id/ativo. Não excluir fisicamente um filme com sessões; apenas desativar.
- Salas: POST /salas { nome, filas: ["A".."J"] ou { qtdFilas, assentosPorFila }, assentosPcd?: [{fila, numero}] } → o SERVICE gera os assentos em uma transação. GET /salas, GET /salas/:id (com o layout de assentos). PUT de estrutura bloqueado se a sala tiver sessões futuras (RegraNegocio).
- Sessões: POST /sessoes { filmeId, salaId, dataHora, preco }; GET /sessoes (filtros ?filmeId, ?data, ?salaId; só as futuras e não canceladas por padrão); GET /sessoes/:id; PATCH /sessoes/:id/cancelar (só se não houver ingressos vendidos; caso contrário, RegraNegocio).
  Regras no SERVICE: dataHora no futuro; sala ativa e filme ativo; sem sobreposição na mesma sala, considerando duracaoMinutos + 15 min de limpeza (consulta no repository, decisão no service).

Para cada rota: schema zod de entrada, DTO de saída tipado, status HTTP corretos.
Testes (vitest + supertest com um banco de teste): registro e login, cliente tentando criar filme → 403, sobreposição de sessão → 422, criação de sessão gera N sessao_assento (prova da trigger).
Rode build e testes no final.
```

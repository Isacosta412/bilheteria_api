/**
 * Demonstração AO VIVO do controle de concorrência contra a API (local ou em produção).
 *
 *   npm run demo:concorrencia -- --url https://minha-api.exemplo.com
 *
 * Opções:
 *   --url <url>          API alvo (padrão: http://localhost:3333)
 *   --requisicoes <n>    quantos POST /reservas simultâneos (padrão: 20)
 *   --sessao <id>        usa esta sessão (senão reaproveita/cria a sessão "Demo Concorrência")
 *   --email / --senha    operador (padrão: DEMO_OPERADOR_EMAIL/SENHA ou SEED_OPERADOR_* do .env)
 *
 * Clientes: com DEMO_CLIENTE_SENHA no ambiente, reaproveita demo-concorrencia-1/2@demo.local
 * (menos chamadas em /auth, que tem rate limit); sem ela, cria 2 clientes descartáveis por execução.
 *
 * O que acontece: N reservas do MESMO assento disparadas ao mesmo tempo por 2 clientes.
 * O esperado é exatamente 1 × 201 e (N − 1) × 409. No fim, a reserva vencedora é cancelada
 * para a demonstração poder ser repetida.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

// ─── Cores (desligadas fora de um terminal ou com NO_COLOR) ──────────────────
const usarCor = process.stdout.isTTY && !process.env.NO_COLOR;
const pintar = (codigo: number) => (texto: string | number) => (usarCor ? `\x1b[${codigo}m${texto}\x1b[0m` : String(texto));
const verde = pintar(32);
const vermelho = pintar(31);
const amarelo = pintar(33);
const ciano = pintar(36);
const cinza = pintar(90);
const negrito = pintar(1);

// ─── Argumentos ──────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3333' },
    requisicoes: { type: 'string', default: '20' },
    sessao: { type: 'string' },
    email: { type: 'string' },
    senha: { type: 'string' },
    ajuda: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.ajuda) {
  console.log('Uso: npm run demo:concorrencia -- --url <url da API> [--requisicoes 20] [--sessao <id>] [--email <op>] [--senha <senha>]');
  process.exit(0);
}

const BASE = args.url.replace(/\/+$/, '');
const N = Number(args.requisicoes);
if (!Number.isInteger(N) || N < 2 || N > 200) {
  console.error('--requisicoes deve ser um inteiro entre 2 e 200.');
  process.exit(1);
}

// ─── Cliente HTTP mínimo ─────────────────────────────────────────────────────
interface RespostaApi<T> {
  status: number;
  corpo: T;
  ms: number;
}
interface ErroApi {
  erro?: { codigo: string; mensagem: string };
}

async function api<T>(metodo: string, caminho: string, opcoes: { corpo?: unknown; token?: string } = {}): Promise<RespostaApi<T>> {
  const inicio = performance.now();
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(opcoes.token ? { Authorization: `Bearer ${opcoes.token}` } : {}),
    },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  });
  const texto = await resposta.text();
  const corpo = (texto ? JSON.parse(texto) : {}) as T;
  return { status: resposta.status, corpo, ms: Math.round(performance.now() - inicio) };
}

function falhar(etapa: string, resposta: RespostaApi<unknown>): never {
  const erro = (resposta.corpo as ErroApi).erro;
  console.error(vermelho(`\n✖ Falha em "${etapa}": HTTP ${resposta.status}${erro ? ` – ${erro.codigo}: ${erro.mensagem}` : ''}`));
  process.exit(1);
}

// ─── Tipos das respostas usadas ──────────────────────────────────────────────
interface Login { token: string; usuario: { id: number; nome: string } }
interface Sala { id: number; nome: string }
interface Filme { id: number; titulo: string }
interface Sessao { id: number; dataHora: string; assentosLivres: number; filme: { titulo: string }; sala: { nome: string } }
interface AssentoMapa { assentoId: number; numero: number; status: string; minhaReserva: boolean }
interface Mapa { sessao: Sessao; filas: { fila: string; assentos: AssentoMapa[] }[] }
interface Reserva { reservaId: number }

const NOME_DEMO = 'Demo Concorrência';

async function loginOperador(): Promise<string> {
  const email = args.email ?? process.env.DEMO_OPERADOR_EMAIL ?? process.env.SEED_OPERADOR_EMAIL;
  const senha = args.senha ?? process.env.DEMO_OPERADOR_SENHA ?? process.env.SEED_OPERADOR_SENHA;
  if (!email || !senha) {
    console.error(vermelho('Informe o operador com --email/--senha (ou DEMO_OPERADOR_EMAIL/DEMO_OPERADOR_SENHA no ambiente).'));
    process.exit(1);
  }
  const resposta = await api<Login & ErroApi>('POST', '/auth/login', { corpo: { email, senha } });
  if (resposta.status !== 200) falhar('login do operador', resposta);
  return resposta.corpo.token;
}

/** Reaproveita uma sessão futura da demo com assento livre; se não houver, cria sala, filme e sessão. */
async function obterSessao(tokenOperador: string): Promise<number> {
  const salas = await api<Sala[]>('GET', '/salas', { token: tokenOperador });
  if (salas.status !== 200) falhar('listar salas', salas);
  let sala = salas.corpo.find((s) => s.nome === NOME_DEMO);
  if (!sala) {
    const nova = await api<Sala>('POST', '/salas', { token: tokenOperador, corpo: { nome: NOME_DEMO, qtdFilas: 1, assentosPorFila: 10 } });
    if (nova.status !== 201) falhar('criar sala de demonstração', nova);
    sala = nova.corpo;
  }

  const filmes = await api<Filme[]>('GET', `/filmes?busca=${encodeURIComponent(NOME_DEMO)}`);
  let filme = filmes.corpo.find((f) => f.titulo === NOME_DEMO);
  if (!filme) {
    const novo = await api<Filme>('POST', '/filmes', {
      token: tokenOperador,
      corpo: { titulo: NOME_DEMO, sinopse: 'Sessão usada na demonstração de concorrência.', duracaoMinutos: 60, classificacao: 'LIVRE', genero: 'Demonstração' },
    });
    if (novo.status !== 201) falhar('criar filme de demonstração', novo);
    filme = novo.corpo;
  }

  const existentes = await api<Sessao[]>('GET', `/sessoes?filmeId=${filme.id}&salaId=${sala.id}`);
  const reaproveitavel = existentes.corpo.find((s) => s.assentosLivres > 0);
  if (reaproveitavel) return reaproveitavel.id;

  const base = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  base.setUTCMinutes(0, 0, 0);
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const dataHora = new Date(base.getTime() + tentativa * 3 * 60 * 60 * 1000).toISOString();
    const criada = await api<Sessao & ErroApi>('POST', '/sessoes', {
      token: tokenOperador,
      corpo: { filmeId: filme.id, salaId: sala.id, dataHora, preco: 10 },
    });
    if (criada.status === 201) return criada.corpo.id;
    if (criada.corpo.erro?.codigo !== 'SESSAO_SOBREPOSTA') falhar('criar sessão de demonstração', criada);
  }
  console.error(vermelho('Não encontrei horário livre para a sessão de demonstração.'));
  process.exit(1);
}

/** Login de 2 clientes de demonstração (reaproveitados se DEMO_CLIENTE_SENHA estiver definida). */
async function obterClientes(): Promise<{ nome: string; token: string }[]> {
  const senhaFixa = process.env.DEMO_CLIENTE_SENHA;
  const sufixo = Date.now();
  const clientes: { nome: string; token: string }[] = [];

  for (const n of [1, 2]) {
    const email = senhaFixa ? `demo-concorrencia-${n}@demo.local` : `demo-${sufixo}-${n}@demo.local`;
    const senha = senhaFixa ?? randomBytes(12).toString('base64url');
    const nome = `Cliente ${n}`;

    let login = senhaFixa ? await api<Login & ErroApi>('POST', '/auth/login', { corpo: { email, senha } }) : undefined;
    if (!login || login.status !== 200) {
      const cadastro = await api<ErroApi>('POST', '/auth/registrar', { corpo: { nome: `Demo ${nome}`, email, senha } });
      if (cadastro.status !== 201) falhar(`cadastro do ${nome}`, cadastro);
      login = await api<Login & ErroApi>('POST', '/auth/login', { corpo: { email, senha } });
    }
    if (login.status !== 200) falhar(`login do ${nome}`, login);
    clientes.push({ nome, token: login.corpo.token });
  }
  return clientes;
}

function primeiroLivre(mapa: Mapa): { assentoId: number; rotulo: string } | null {
  for (const fila of mapa.filas) {
    const assento = fila.assentos.find((a) => a.status === 'LIVRE');
    if (assento) return { assentoId: assento.assentoId, rotulo: `${fila.fila}${assento.numero}` };
  }
  return null;
}

function assentoNoMapa(mapa: Mapa, assentoId: number): AssentoMapa | undefined {
  return mapa.filas.flatMap((f) => f.assentos).find((a) => a.assentoId === assentoId);
}

async function main(): Promise<void> {
  console.log(negrito(ciano('\n══════════════════════════════════════════════════════════════')));
  console.log(negrito(ciano('   DEMONSTRAÇÃO DE CONCORRÊNCIA – bilheteria-api')));
  console.log(negrito(ciano('══════════════════════════════════════════════════════════════')));

  const saude = await api<{ status: string; banco: string }>('GET', '/health').catch(() => null);
  if (!saude || saude.status !== 200) {
    console.error(vermelho(`\n✖ API indisponível em ${BASE} (GET /health).`));
    process.exit(1);
  }

  const tokenOperador = await loginOperador();
  const sessaoId = args.sessao ? Number(args.sessao) : await obterSessao(tokenOperador);
  const clientes = await obterClientes();

  const mapaAntes = await api<Mapa>('GET', `/sessoes/${sessaoId}/assentos`);
  if (mapaAntes.status !== 200) falhar('ler o mapa de assentos', mapaAntes);
  const alvo = primeiroLivre(mapaAntes.corpo);
  if (!alvo) {
    console.error(vermelho('\n✖ A sessão não tem assento livre.'));
    process.exit(1);
  }

  const s = mapaAntes.corpo.sessao;
  console.log(`  API ........... ${negrito(BASE)}`);
  console.log(`  Sessão ........ #${s.id} – ${s.filme.titulo} – ${s.sala.nome} – ${new Date(s.dataHora).toLocaleString('pt-BR')}`);
  console.log(`  Assento ....... ${negrito(alvo.rotulo)} (id ${alvo.assentoId})`);
  console.log(`  Disparando .... ${negrito(N)} POST /reservas SIMULTÂNEOS, alternando ${clientes.map((c) => c.nome).join(' e ')}\n`);

  // Prepara todas as promessas e dispara de uma vez
  const inicio = performance.now();
  const resultados = await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const cliente = clientes[i % clientes.length]!;
      const resposta = await api<Reserva & ErroApi>('POST', '/reservas', {
        token: cliente.token,
        corpo: { sessaoId, assentoIds: [alvo.assentoId] },
      });
      return { i: i + 1, cliente, resposta };
    }),
  );
  const totalMs = Math.round(performance.now() - inicio);

  for (const { i, cliente, resposta } of resultados) {
    const n = String(i).padStart(2, '0');
    if (resposta.status === 201) {
      console.log(`  ${verde('✔')} #${n}  ${verde('201 Created ')}  ${cliente.nome}  ${cinza(`${resposta.ms} ms`)}  ${verde(`reserva #${resposta.corpo.reservaId}`)}`);
    } else if (resposta.status === 409) {
      console.log(`  ${amarelo('✖')} #${n}  ${amarelo('409 Conflict')}  ${cliente.nome}  ${cinza(`${resposta.ms} ms`)}  ${cinza(resposta.corpo.erro?.codigo ?? '')}`);
    } else {
      console.log(`  ${vermelho('!')} #${n}  ${vermelho(`${resposta.status}         `)}  ${cliente.nome}  ${cinza(`${resposta.ms} ms`)}  ${vermelho(resposta.corpo.erro?.codigo ?? '')}`);
    }
  }

  const criados = resultados.filter((r) => r.resposta.status === 201);
  const conflitos = resultados.filter((r) => r.resposta.status === 409).length;
  const outros = N - criados.length - conflitos;

  console.log(`\n  Resumo: ${verde(`201: ${criados.length}`)} | ${amarelo(`409: ${conflitos}`)} | ${outros > 0 ? vermelho(`outros: ${outros}`) : `outros: ${outros}`}   ${cinza(`(${totalMs} ms no total)`)}`);

  // Conferência no mapa: o assento está RESERVADO e só o vencedor o vê como "minhaReserva"
  let mapaOk = false;
  const vencedor = criados[0];
  if (vencedor) {
    const perdedor = clientes.find((c) => c !== vencedor.cliente)!;
    const visaoVencedor = await api<Mapa>('GET', `/sessoes/${sessaoId}/assentos`, { token: vencedor.cliente.token });
    const visaoPerdedor = await api<Mapa>('GET', `/sessoes/${sessaoId}/assentos`, { token: perdedor.token });
    const aV = assentoNoMapa(visaoVencedor.corpo, alvo.assentoId);
    const aP = assentoNoMapa(visaoPerdedor.corpo, alvo.assentoId);
    mapaOk = aV?.status === 'RESERVADO' && aV.minhaReserva === true && aP?.minhaReserva === false;
    console.log(`  Mapa: assento ${alvo.rotulo} → ${aV?.status ?? '?'}; minhaReserva para ${vencedor.cliente.nome}: ${aV?.minhaReserva}, para ${perdedor.nome}: ${aP?.minhaReserva}  ${mapaOk ? verde('✔') : vermelho('✖')}`);

    // Limpeza: cancela a reserva vencedora para a demonstração poder ser repetida
    const cancelamento = await api<ErroApi>('DELETE', `/reservas/${vencedor.resposta.corpo.reservaId}`, { token: vencedor.cliente.token });
    console.log(cinza(`  Limpeza: reserva #${vencedor.resposta.corpo.reservaId} cancelada (HTTP ${cancelamento.status}); o assento voltou a ficar livre.`));
  }

  const ok = criados.length === 1 && conflitos === N - 1 && mapaOk;
  console.log(
    ok
      ? negrito(verde(`\n  ✔ CONCORRÊNCIA OK: exatamente 1 reserva confirmada e ${N - 1} recusadas com 409.\n`))
      : negrito(vermelho(`\n  ✖ FALHOU: esperado 1 × 201 e ${N - 1} × 409.\n`)),
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((erro: unknown) => {
  console.error(vermelho(`\n✖ Erro inesperado: ${erro instanceof Error ? erro.message : String(erro)}`));
  process.exitCode = 1;
});

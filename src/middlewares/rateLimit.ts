import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import type { RespostaErro } from '../types/erro';

const respostaMuitasTentativas: RespostaErro = {
  erro: {
    codigo: 'MUITAS_TENTATIVAS',
    mensagem: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.',
  },
};

/** Limite para as rotas de autenticação (login/cadastro): 20 requisições a cada 15 minutos por IP. */
export const limiteAutenticacao = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: respostaMuitasTentativas,
  // Nos testes automatizados o limite atrapalharia (muitos logins em sequência).
  skip: () => env.NODE_ENV === 'test',
});

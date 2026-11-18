import { AppError } from './AppError';

export { AppError };

/** 400 – dados de entrada inválidos. */
export class DadosInvalidos extends AppError {
  constructor(mensagem = 'Dados inválidos.', codigo = 'DADOS_INVALIDOS', detalhes?: unknown) {
    super(codigo, mensagem, 400, detalhes);
  }
}

/** 401 – sem token, token inválido ou credenciais erradas. */
export class NaoAutenticado extends AppError {
  constructor(mensagem = 'Autenticação necessária.', codigo = 'NAO_AUTENTICADO') {
    super(codigo, mensagem, 401);
  }
}

/** 403 – autenticado, mas sem o papel/permissão necessária. */
export class SemPermissao extends AppError {
  constructor(mensagem = 'Você não tem permissão para esta operação.', codigo = 'SEM_PERMISSAO') {
    super(codigo, mensagem, 403);
  }
}

/** 404 – recurso não encontrado. */
export class NaoEncontrado extends AppError {
  constructor(mensagem = 'Recurso não encontrado.', codigo = 'NAO_ENCONTRADO') {
    super(codigo, mensagem, 404);
  }
}

/** 409 – conflito com o estado atual (ex.: ASSENTO_INDISPONIVEL, EMAIL_EM_USO). */
export class Conflito extends AppError {
  constructor(codigo: string, mensagem: string, detalhes?: unknown) {
    super(codigo, mensagem, 409, detalhes);
  }
}

/** 422 – a requisição é válida, mas viola uma regra de negócio (ex.: SESSAO_NO_PASSADO). */
export class RegraNegocio extends AppError {
  constructor(codigo: string, mensagem: string, detalhes?: unknown) {
    super(codigo, mensagem, 422, detalhes);
  }
}

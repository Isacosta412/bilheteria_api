/** Formato padrão das respostas de erro da API. */
export interface RespostaErro {
  erro: {
    codigo: string;
    mensagem: string;
    detalhes?: unknown;
  };
}

# Histórico de versões

## Boletim Interno
- 1.0.1 — lingueta e destaques do painel com a cor da área e a sigla do script (azul, BI), para identificar cada script na lateral.
- 1.0.0 — primeira versão DevDu: painel padrão com abas na lateral, marca e atualização automática.
  Captura o relatório "Afastamentos a Serviço" no SCDP e gera o Boletim de Concessão de Diárias no SEI
  (documento público, CPF mascarado, conferência do documento salvo).

## Cadastro de Diárias
- 1.0.1 — lingueta e destaques do painel com a cor da área e a sigla do script (azul, CD), para identificar cada script na lateral.
- 1.0.0 — primeira versão DevDu (antes "SEI → SCDP | Cadastro de diárias", até a 0.21.2): painel padrão com abas na
  lateral no SEI e no SCDP, aviso de andamento ao lado da lingueta, marca e atualização automática.

## Consulta Viagens SCDP
- 1.0.4 — lingueta e destaques do painel com a cor da área e a sigla do script (azul, CV), para identificar cada script na lateral.
- 1.0.3 — órgãos fora do primeiro nível da árvore do SCDP (caminho com ">" na tabela de equivalência).
- 1.0.2 — período não vai mais para a coluna da unidade; reconhece "1º a 3 OUT 26".
- 1.0.1 — leitura dos documentos do SEI corrigida (não repete mais o primeiro viajante nos documentos seguintes nem
  dá "Nenhum viajante encontrado" por ler o quadro errado).
- 1.0.0 — primeira versão DevDu (antes "SEI → SCDP | Solicitações de diárias", até a 0.10.1): painel padrão com abas na
  lateral no SEI e no SCDP, marca e atualização automática.

## Empenho Suprimento
- 1.1.0 — na emissão, o crédito (célula orçamentária) respeita o plano interno do pedido: pedido sem PI usa só célula sem PI;
  com PI (tabela "PLANO INTERNO | ..." ou texto "Plano Interno: ..."), só a célula daquele PI. PI editável no painel.
- 1.0.1 — lingueta e destaques do painel com a cor da área e a sigla do script (verde-azulado, ES), para identificar cada script na lateral.
- 1.0.0 — primeira versão DevDu (antes "Empenhos de Suprimento de Fundos", até a 1.7.0): painel padrão com abas
  na lateral, marca e atualização automática. Emissão, reforço e anulação de empenhos no Contratos.gov.br, despacho
  de retorno e bloco de assinatura.

## Concessão Suprimento
- 1.1.0 — reforço: cada concessão tem a escolha Concessão/Reforço (o script sugere) e, no reforço, os campos do nº do SF e da UG do SF, para digitar quando o despacho de devolução não for encontrado; o reforço não pede mais o período.
- 1.0.2 — quando o empenho foi emitido em favor da UG, o credor dos Dados Básicos do SF passa a ser a UG (antes ia o CPF).
- 1.0.1 — lingueta e destaques do painel com a cor da área e a sigla do script (verde-azulado escuro, CS), para identificar cada script na lateral.
- 1.0.0 — primeira versão DevDu (antes "SIAFI – Concessão de Suprimento de Fundos", até a 0.5.1): painel padrão com
  abas na lateral, marca e atualização automática. Emissão e reforço de SF no SIAFI e despacho de devolução no SEI.

## Reinf Envio em Lote
- 1.0.1 — lingueta e destaques do painel com a cor da área e a sigla do script (âmbar, RE), para identificar cada script na lateral.
- 1.0.0 — primeira versão DevDu (antes "Reinf Web — Envio em lote", até a 2.8.1): painel padrão com abas na lateral,
  marca e atualização automática. O CNPJ do contribuinte passa a ser capturado na página inicial do e-CAC (perfil em
  uso) ou informado no painel, e planilhas com estabelecimento de outro CNPJ ficam bloqueadas com alerta.

## Instrumento de Cobrança (Planilha)
- 1.1.0 — aceita também a planilha de entrada extraída do outro sistema: converte para o formato arquivosecom
  (uma linha por nota e empenho, tema e valor do processo) e oferece "Baixar no formato arquivosecom", para usar
  também na Liquidação Contratos SECOM. Contrato que o Excel transformou em data volta a ser mês/ano.
- 1.0.1 — lingueta e destaques do painel com a cor da área e a sigla do script (violeta, IP), para identificar cada script na lateral.
- 1.0.0 — primeira versão DevDu (antes "Contratos.gov.br – Instrumento de Cobrança em lote", até a 0.10): painel
  padrão com abas na lateral, marca e atualização automática.

## Instrumento de Cobrança (Gercont)
- 1.0.1 — lingueta e destaques do painel com a cor da área e a sigla do script (violeta, IG), para identificar cada script na lateral.
- 1.0.0 — primeira versão DevDu (antes "Gercont → Contratos.gov.br – Instrumento de Cobrança", até a 2.2): painel
  padrão com abas na lateral no Contratos e no Gercont, marca e atualização automática.

## Liquidação Contratos SECOM
- 1.1.5 — a caixinha do script na lista de instrumentos de cobrança mostra a sigla LS na cor do script (antes "DevDu"
  em verde, igual à da Liquidação Geral), para não confundir com a caixinha do outro script.
- 1.1.4 — primeira publicação: instalação pelo link e atualização automática. Lingueta violeta (LS).
  Apropria no Contratos.gov.br as notas marcadas na lista de instrumentos de cobrança, conferindo com a planilha xlsx
  da liquidação, e gera no SEI o documento de pagamento com a NP. Sem tributos e sem dados de pagamento.

## Liquidação Geral
- 1.4.0 — saldo a liquidar por subitem do empenho (Execução financeira → Empenhos → detalhado): no painel, abaixo de
  cada empenho; na apropriação, o subitem de cada item (o indicado pelo gestor na nota, ou o do empenho trocado) é
  conferido com o saldo do subitem antes de gravar — insuficiente ou empenho sem o subitem → erro, não envia.
- 1.3.8 — alerta quando o processo SEI do grupo é de ano anterior ao corrente (provavelmente o processo da
  contratação): aviso no painel, abaixo do campo do processo, e na confirmação do lote. Não impede a apropriação.
- 1.3.7 — a caixinha do script na lista de instrumentos de cobrança mostra a sigla LG na cor do script (antes "DevDu"
  em verde, igual à da Liquidação Contratos SECOM), para não confundir com a caixinha do outro script.
- 1.3.6 — documento "DIROF - Documento de Pagamento": o script passa a reconhecer a tabela do próprio tipo (sem
  cabeçalho) e preenche a linha "VALOR BRUTO:" com o valor e a NP, o nome da empresa e o processo no topo; demais linhas
  como estão. Opcional: documento modelo (nº SEI) na Config. do SEI; "↻ gerar de novo" para documento com erro ou a
  conferir.
- 1.3.5 — documento no SEI sem texto padrão: o documento nasce com o modelo do próprio tipo (que já traz a tabela NP ×
  valor) e o script preenche a tabela. Texto padrão na Config. passa a ser opcional. Tipo de documento padrão:
  "DIROF - Documento de Pagamento".
- 1.3.4 — "↻ Atualizar saldos": consulta de novo os saldos a liquidar dos empenhos (botão para todos os contratos marcados
  e link em cada grupo, com a hora da última consulta).
- 1.3.3 — botão "Limpar escolhas" no painel: desmarca as notas de todas as páginas e desfaz grupos, parâmetros
  editados e trocas de empenho (o histórico dos contratos e as notas apropriadas não mudam).
- 1.3.2 — primeira publicação: instalação pelo link e atualização automática. Lingueta violeta (LG).
  Notas de contratos diferentes, uma NP por grupo de notas do mesmo contrato, sugestões pelo histórico de cada
  contrato, troca de empenho e 2ª situação; no SEI, documento com a NP e o valor em cada processo. Sem tributos e sem
  dados de pagamento.

## Prazo pelo Termo de Recebimento
- 1.0.0 — primeira versão DevDu (antes "Prazo pelo Termo de Recebimento - SEI/PR", até a 1.7): painel padrão,
  instalação pelo link e atualização automática. Lingueta violeta (PT). Coluna **Prazo** na lista do Controle de
  Processos (opção "Mostrar o prazo", dispensa a SEI Pro): data do marcador e há quantos dias, até 15 dias verde,
  16 a 30 amarelo, mais de 30 vermelho; clique no título para ordenar. Prazo pela data de assinatura do Termo de
  Recebimento, com empresa e valor (linha TOTAL) no marcador; CSV e relatório da página.

## lib/devdu-ui.js
- 1.1.0 — identidade por script: cor da família da área (suprimento: verde-azulado; diárias e viagens: azul;
  contratos e liquidação: violeta; tributos: âmbar) e sigla de 2 letras na lingueta; a cor vale também para a aba
  selecionada, o ponto do título e os botões. Script sem identidade continua verde DevDu.
- 1.0.0 — painel lateral padrão com abas na lateral, log, avisos e marca DevDu; opção `css` para o CSS de cada script.

# Histórico de versões

## Boletim Interno
- 1.0.1 — lingueta e destaques do painel com a cor da área e a sigla do script (azul, BI), para identificar cada script na lateral.
- 1.0.0 — primeira versão DevDu: painel padrão com abas na lateral, marca e atualização automática.
  Captura o relatório "Afastamentos a Serviço" no SCDP e gera o Boletim de Concessão de Diárias no SEI
  (documento público, CPF mascarado, conferência do documento salvo).

## Cadastro de Diárias
- 1.2.0 — aba Auxílio na janela do SEI: lista de servidores com auxílio-alimentação diferenciado (colada do Excel, com
  nome e órgão) e espaço para o valor mensal de cada um. Quem está na lista sem valor fica em Revisar; com o valor, ele
  entra no desconto da alteração e no cadastro do zero.
- 1.1.0 — botão "Editar período" na janela do SEI: altera as datas de ida e volta de um viajante (ou corrige um
  período não reconhecido) antes de consultar e enviar ao SCDP.
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

## Faturamento SCDP
- 1.1.2 — o botão Parar interrompe a coleta (antes a etapa em andamento desfazia a parada e a coleta seguia);
  Continuar retoma de onde parou.
- 1.1.1 — primeira versão publicada. Lingueta azul (FS). Para uma lista de órgãos (árvore do topo do SCDP) e UGRs num
  período, abre o Relatório de Conferência da Fatura, escolhe a primeira Unidade Responsável com o código da UGR e
  pesquisa cada empenho com cada agência de viagem (todas, ou as escolhidas em Config.). No fim baixa o Excel: aba
  Faturamento (um bilhete por linha, com órgão solicitante, PCDP, proposto e valores) e aba Resumo (cada pesquisa,
  com os totais da fatura e a conferência da soma).

## Empenho Suprimento
- 1.2.0 — emissão que já tem nota de empenho registrada pode ser emitida de novo (ex.: NE cancelada direto no
  Contratos): caixa "emitir de novo" na linha, com alerta da NE já registrada antes de executar; gera um despacho novo.
- 1.1.0 — na emissão, o crédito (célula orçamentária) respeita o plano interno do pedido: pedido sem PI usa só célula sem PI;
  com PI (tabela "PLANO INTERNO | ..." ou texto "Plano Interno: ..."), só a célula daquele PI. PI editável no painel.
- 1.0.1 — lingueta e destaques do painel com a cor da área e a sigla do script (verde-azulado, ES), para identificar cada script na lateral.
- 1.0.0 — primeira versão DevDu (antes "Empenhos de Suprimento de Fundos", até a 1.7.0): painel padrão com abas
  na lateral, marca e atualização automática. Emissão, reforço e anulação de empenhos no Contratos.gov.br, despacho
  de retorno e bloco de assinatura.

## Concessão Suprimento
- 1.2.0 — solicitação com várias linhas da mesma natureza (ex.: 339039 hotéis + restaurantes): os valores são somados; período de aplicação escrito por extenso ("de 26 de setembro a 25 de outubro de 2026") é reconhecido; crédito e saque de cada natureza podem ser corrigidos no cartão, e crédito + saque diferente do total da solicitação é apontado como erro.
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
- 1.8.0 — saldo por subitem do empenho pela mesma consulta da tela de cadastro do instrumento de cobrança (saldo
  atualizado; só consulta, não cadastra nada), na janela e na conferência antes de apropriar.
- 1.7.0 — opção "não utilizar" na caixa de cada empenho indicado nas notas: o empenho não vai para o Contratos
  (sai da aba PCO) e a janela pede o valor de cada empenho que fica (é esse valor que vai para o PCO); funciona junto com
  "mais um empenho". Aviso do Gercont mais claro quando a pesquisa da nota não acha o link "Enviar para pagamento".
- 1.6.3 — Gercont: cada nota é pesquisada pelo número (a lista do Gercont vem em páginas de 10; as notas fora da
  1ª página ficavam sem a data).
- 1.6.2 — Gercont: quem decide se a nota precisa da data é o próprio Gercont (o script não pula mais a nota por
  registro próprio); data apagada no Gercont é lançada de novo.
- 1.6.1 — "mais um empenho" com campo para a conta VPD (A) do empenho novo (o passivo é o do grupo); caixinha em cada
  grupo e botão "✕ Tirar do lote os grupos marcados" (os outros grupos ficam como estão); painel reorganizado: marcar ou
  desmarcar todas as notas da página da lista do Contratos e "Limpar tudo" juntos, numa linha própria.
- 1.6.0 — data de envio para pagamento no Gercont: antes de apropriar (ou só pelo botão "📅 Data no Gercont", sem
  apropriar), o script lança a data de hoje em cada nota fiscal das notas marcadas no Gercont. Precisa estar logada no
  Gercont no navegador; dá para desligar a etapa automática na Config.
- 1.5.4 — centro de custo como na tela: depois de mexer no PCO (troca, mais um empenho, 2ª situação), ou se os centros
  de custo gerados não fecham com o PCO, o script exclui os gerados e inclui um só pelo "+", já com todos os empenhos.
- 1.5.3 — o "mais um empenho" registra cada passo e o alerta do fim do lote mostra a mensagem de cada erro; o saldo
  por subitem trava só quando confere com o saldo do empenho (diz o valor máximo no subitem), senão só avisa.
- 1.5.1 — mais um empenho por grupo: além de trocar o empenho indicado pelo gestor, dá para incluir mais uma nota de
  empenho da lista do contrato (com o saldo) e informar quanto vai em cada empenho; o script confere se a soma dos
  empenhos é igual ao total das notas (com glosa, total − glosa), cria o item no PCO como o botão "+" da tela, com as
  mesmas contas, e confere o saldo do empenho novo e do subitem antes.
  2ª situação por subitem: num empenho com mais de um subitem indicado, escolhe-se o subitem que vai para a 2ª situação;
  com o valor vazio, o item inteiro (empenho + subitem) sai da 1ª situação e vai para a 2ª.
  Glosa: a aba PCO passa a ficar com o total das notas menos a glosa (tirada do empenho da glosa).
  Saldo por subitem: a coluna do saldo é conferida com o saldo do empenho (restos a pagar mostravam zero e travavam a
  apropriação); quando não bate, o script só avisa.
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

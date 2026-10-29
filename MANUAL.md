<!-- Este manual é gerado a partir de publico/MANUAL.md do repositório de trabalho: edições feitas direto aqui são apagadas na próxima publicação. -->
# Manual dos scripts DevDu

Guia rápido de cada script: **para que serve**, **o que deixar aberto antes de começar**, **o passo a passo** e os
**cuidados**. Para instalar, veja o [README](README.md).

## Antes de começar (vale para todos)

- **Onde fica o script:** ao abrir o sistema, aparece uma **lingueta colorida** no canto direito da tela, com o ícone
  DevDu e a **sigla** do script. Clique nela para abrir o painel. As abas ficam na lateral do painel.
- **Mesmo navegador:** quando o script passa de um sistema para outro (SEI → SIAFI, por exemplo), os sistemas precisam
  estar **logados no mesmo navegador**, cada um na sua aba. Os scripts conversam entre as abas sozinhos.
- **Janela principal:** no SEI, o painel aparece na janela principal (a tela com a lista de processos ou com a árvore do
  processo), não nas janelas que abrem por cima.
- **Teste primeiro:** os scripts que gravam alguma coisa começam em **modo teste/simulação**. Faça a primeira rodada
  assim, confira e só depois desligue.
- **Nada em dobro:** os scripts que registram (empenho, SF, NP, documento no SEI) guardam o que já fizeram. Se algo
  parar no meio, rode de novo: eles continuam de onde pararam. Quando o sistema não responde a um registro, o script
  **não repete sozinho**: confira no sistema e informe no painel se registrou ou não.
- **Dúvidas e problemas:** fale com a Dulce informando o nome do script e a versão (no rodapé do painel). Muitos
  scripts têm o botão **Copiar diagnóstico** ou **Copiar log**: mande junto.

## Resumo: onde cada script começa

| Script | Sigla | Comece em | Deixe também aberto |
|---|---|---|---|
| [Boletim Interno](#boletim-interno) | BI | SCDP, no relatório "Afastamentos a Serviço" em HTML | SEI, no processo do boletim |
| [Cadastro de Diárias](#cadastro-de-diárias) | CD | SEI, no processo das Solicitações de Diárias | SCDP |
| [Consulta Viagens SCDP](#consulta-viagens-scdp) | CV | SEI, no processo das Solicitações de Diárias | SCDP |
| [Faturamento SCDP](#faturamento-scdp) | FS | SCDP, qualquer tela | — |
| [Prestação de Contas SCDP](#prestação-de-contas-scdp) | PC | SCDP, qualquer tela | — |
| [Comparador de Faturas](#comparador-de-faturas) | CF | SCDP, qualquer tela | — (arquivos no computador) |
| [Conferência de Hospedagem](#conferência-de-hospedagem) | CH | SEI | — |
| [Empenho Suprimento](#empenho-suprimento) | ES | SEI | Contratos.gov.br |
| [Concessão Suprimento](#concessão-suprimento) | CS | SEI | SIAFI |
| [Prestação de Contas Suprimento](#prestação-de-contas-suprimento) | PC | SEI | SIAFI e Contratos.gov.br |
| [Instrumento de Cobrança (Planilha)](#instrumento-de-cobrança-planilha) | IP | Contratos.gov.br, no contrato aberto | — |
| [Instrumento de Cobrança (Gercont)](#instrumento-de-cobrança-gercont) | IG | Gercont, nas notas do contrato | Contratos.gov.br, no contrato aberto |
| [Liquidação Contratos SECOM](#liquidação-contratos-secom) | LS | Contratos.gov.br, na lista de instrumentos de cobrança | SEI |
| [Liquidação Geral](#liquidação-geral) | LG | Contratos.gov.br, na lista de instrumentos de cobrança | SEI e Gercont |
| [Prazo pelo Termo de Recebimento](#prazo-pelo-termo-de-recebimento) | PT | SEI, no Controle de Processos | — |
| [Conferência GEROP](#conferência-gerop) | CG | SIAFI, na transação GEROP | Consulta Optantes (Receita) e SEI |
| [NPs Pendentes](#nps-pendentes) | NP | SIAFI, na transação CONDH | — |
| [Apropria Folha de Pagamento](#apropria-folha-de-pagamento) | FP | SIAFI | — |
| [Reinf Envio em Lote](#reinf-envio-em-lote) | RE | e-CAC (página inicial) e depois o Reinf Web | Assinador SERPRO |

As duas "PC" não se confundem: a da Prestação de Contas SCDP só aparece no SCDP, e a da Prestação de Contas
Suprimento, no SEI e no SIAFI.

---

## Diárias e viagens

### Boletim Interno

**Para que serve:** pega o relatório de afastamentos do SCDP e gera no SEI o "Boletim de Concessão de Diárias", em
texto pesquisável e com o CPF mascarado.

**Abra antes:** no SCDP, o relatório **Afastamentos a Serviço** gerado em **HTML** (a lingueta só aparece nessa
página). Depois, no SEI, o **processo do boletim**.

**Passo a passo:**
1. No SCDP, gere o relatório em HTML. Na página do relatório, lingueta **BI** → **Capturar relatório**.
2. No SEI, abra o processo do boletim.
3. Lingueta **BI** → aba **Boletim**: confira o resumo, informe o **nº do boletim** (o script sugere o seguinte ao
   último) e clique em **Gerar boletim neste processo**.
4. Confira o documento criado. A aba **PCDPs** mostra a lista por unidade, para conferência.

**Cuidados:**
- O boletim é sempre **público** e com o **CPF mascarado**, com o relatório inteiro do período.
- O nº do boletim no SEI é diferente do nº do relatório no SCDP.
- Se o documento já tiver PCDPs desse relatório, o script recusa gravar de novo.
- Na aba **Outras**: carregar o arquivo HTML, gravar num documento já existente ou copiar para colar no editor.

### Cadastro de Diárias

**Para que serve:** lê as Solicitações de Diárias no SEI, consulta as PCDPs no SCDP e, para cada viajante, **altera a
prestação de contas** ou **cadastra a viagem**, anexando o ofício. Também exporta o Relatório > Viagem do SCDP para o
Excel.

**Abra antes:** o **SEI** com o processo das Solicitações de Diárias aberto e o **SCDP** logado em outra aba.

**Passo a passo:**
1. Na primeira vez, aba **Unidades SEI → SCDP**: preencha a equivalência entre a sigla da unidade no SEI e o órgão no
   SCDP (o botão **Copiar órgãos do SCDP**, no SCDP, ajuda) e salve.
2. No SEI, lingueta **CD** → aba **Extrair**: informe os números SEI das Solicitações de Diárias e clique em
   **Extrair dados**.
3. Confira a triagem de cada viajante (**Cadastrar**, **Alterar**, **Manual**, **Revisar**). Corrija o que for preciso
   com **Editar CPF** e **Editar período**.
4. No SCDP, lingueta **CD** → aba **Triagem**: **Consultar PCDPs** e depois **Alterar marcadas** ou **Cadastrar
   marcadas**.
5. Alguns cliques ficam com você, de propósito: **Pesquisar** do proposto, **Salvar** da aba Proposto e
   **Encaminhar**. Depois de encaminhar, clique em **Já encaminhei: próximo**.
6. Para o Excel: no SCDP, abra **Relatório > Viagem** e use a caixa do canto inferior esquerdo (**Coletar este
   relatório** → **Baixar Excel**).

**Cuidados:**
- PCDP que já tem diárias ou reembolso no SCDP vem desmarcada, com alerta vermelho.
- CPF repetido no documento é só alerta: marque a linha certa.
- Abas **Propostos** e **Auxílio**: dados por CPF para as exceções (função que não indica o posto, auxílio-alimentação
  diferenciado).
- Se uma etapa travar, use **Copiar diagnóstico** e mande para a Dulce.

### Consulta Viagens SCDP

**Para que serve:** confere no SCDP se cada viajante das Solicitações de Diárias tem PCDP e traz o nº, as diárias, as
passagens e o total, numa tabela para o Excel. Só consulta, não altera nada.

**Abra antes:** o **SEI** com o processo aberto e o **SCDP** logado em outra aba.

**Passo a passo:**
1. Na primeira vez, aba **Unidades SEI → SCDP**: cole a tabela de equivalência (sigla do SEI ; órgão do SCDP) e salve.
2. No SEI, lingueta **CV** → aba **Extrair**: informe os números SEI das Solicitações de Diárias e clique em
   **Extrair dados**.
3. No SCDP, lingueta **CV** → aba **Consulta** → **Consultar PCDPs**. O SCDP recarrega várias vezes: deixe a aba
   trabalhar.
4. Volte ao SEI: a tabela mostra o resultado de cada viajante. **Copiar tabela** e cole no Excel.

**Cuidados:**
- Só vão para o SCDP os viajantes com CPF, período e órgão do SCDP definidos.
- Resultado: **encontrada**, **divergente** (período diferente), **não cadastrada** ou **erro** (erro não quer dizer que
  a PCDP não existe).

### Faturamento SCDP

**Para que serve:** para uma lista de órgãos e UGRs num período, pesquisa o Relatório de Conferência da Fatura em cada
empenho e agência e junta tudo num Excel, um bilhete por linha.

**Abra antes:** o **SCDP**, em qualquer tela (o script abre o relatório sozinho).

**Passo a passo:**
1. Lingueta **FS** → aba **Faturamento**: informe a lista (por exemplo, `Órgão; 110001, 110002`, ou o órgão numa linha e
   as UGRs nas seguintes; `>` para órgão dentro de outro) e o período.
2. Clique em **Iniciar**. **Parar** interrompe e **Continuar** retoma.
3. No fim, o Excel é baixado (abas **Faturamento** e **Resumo**). **Baixar Excel** gera de novo.

**Cuidados:**
- Na **Config.**, informe as agências de viagem usadas (vazio = todas). Isso reduz bastante as pesquisas.
- O Resumo avisa quando a soma dos bilhetes não bate com o total da fatura.
- O Excel gerado serve de planilha para o **Comparador de Faturas**.

### Prestação de Contas SCDP

**Para que serve:** percorre uma lista de órgãos e **encaminha** as prestações de contas cujo **"Solicitado por"**
está na lista de nomes informada.

**Abra antes:** o **SCDP**, em qualquer tela.

**Passo a passo:**
1. Lingueta **PC** → aba **Prestação**: informe os órgãos (um por linha; vazio = o órgão do topo) e os nomes do
   **Solicitado por** (um por linha, obrigatório).
2. Clique em **Iniciar**. **Parar** interrompe e **Continuar** retoma.
3. Confira a lista de resultados: encaminhada, outro solicitante ou erro.

**Cuidados:**
- O script só escolhe e encaminha: não marca viagem realizada nem mexe em valores ou empenho.
- Se o SCDP pedir, ele preenche a **data prevista de publicação** vazia (31/12 do ano) e as justificativas (como a de
  prestação fora do prazo) com o texto da **Config.** (padrão "FINALIZADA NESTA DATA").
- **Config. → "Eu clico em Encaminhar"**: o script abre, confere e preenche, e você mesmo clica em Encaminhar.
- Órgão em que o seu perfil não tem acesso é pulado, com aviso.

### Comparador de Faturas

**Para que serve:** compara as faturas em PDF da agência de viagens com a planilha de faturamento do SCDP e mostra as
divergências, o quadro de tributação e o agrupamento por nota de empenho (SIORG e centro de custo) para o SIAFI.

**Abra antes:** o **SCDP**, em qualquer tela. Tenha no computador o **.zip da agência** (ou os PDFs soltos) e a
**planilha de faturamento do SCDP** (.xlsx, por exemplo a gerada pelo Faturamento SCDP).

**Passo a passo:**
1. Lingueta **CF** (ou **Ctrl+Shift+F**) → aba **Comparar**.
2. Arraste o .zip e a planilha para a área tracejada (ou clique nela para escolher os arquivos).
3. Clique em **Comparar** e confira o relatório. Se precisar, ajuste a nota de empenho de algum item.
4. Baixe o relatório em **Excel** ou **HTML**, ou copie o quadro de tributação para colar no Excel.

**Cuidados:**
- Os arquivos **não saem do computador**: tudo é feito no navegador.
- O leitor foi feito para o layout de fatura da agência atual. Se a agência mudar o PDF, avise.
- **Config.**: tabela de NE × SIORG e exceções de centro de custo por viajante. **Exportar/Importar** passa a mesma
  configuração para os colegas.

### Conferência de Hospedagem

**Para que serve:** confere as faturas de hotel com o extrato de hóspedes e os documentos do SEI e monta as listas
(com e sem nomes) para colar nos processos.

**Abra antes:** o **SEI** (os processos de qualquer unidade são abertos pela pesquisa rápida).

**Passo a passo:**
1. Lingueta **CH** → aba **Faturas**: informe o processo das faturas e o dos extratos. Inclua uma linha por fatura
   (**+ Fatura**: nº, hotel, valor e nº SEI do extrato). **Listar documentos** ajuda a achar os extratos.
2. **Ler o extrato**: o script faz uma leitura inicial (com OCR, se for digitalizado) e abre a **tabela** com o extrato
   ao lado. Complete e corrija na tabela (Enter desce; dá para colar do Excel).
3. Aba **Conferência**: os hóspedes aparecem em ordem alfabética. Abra no SEI o documento onde a pessoa aparece e
   **clique no campo nº SEI** do hóspede: o script pega o número e o processo do documento aberto. Marque a situação.
4. **Copiar lista com nomes** / **Copiar lista sem nomes** e cole no editor do SEI.

**Cuidados:**
- O OCR é só a leitura inicial: confira sempre a tabela com o extrato.
- **Config. → Exportar a conferência** guarda tudo num arquivo para retomar depois (**Importar conferência…**). O
  arquivo tem nomes de pessoas: guarde em local interno.
- Confira o **ano** na Config. (as datas do extrato costumam vir sem ano).

---

## Suprimento de fundos

A ordem é: **Empenho Suprimento** → **Concessão Suprimento** → **Prestação de Contas Suprimento**. Cada um lê os
despachos que o anterior deixou no processo.

### Empenho Suprimento

**Para que serve:** lê os despachos de pedido no SEI, faz **emissão, reforço ou anulação** dos empenhos de suprimento
no Contratos.gov.br e devolve ao processo o despacho com as NEs.

**Abra antes:** o **SEI** (janela principal) e o **Contratos.gov.br** logado em outra aba. Na primeira vez, o
Tampermonkey pede permissão para o script acessar o Contratos: permita.

**Passo a passo:**
1. Lingueta **ES** → aba **Execução**: informe os números SEI dos despachos de pedido e clique em **Ler documentos**.
2. Confira a tabela: operação, UG, CPF, naturezas, valores, UGR, PTRES, fonte, amparo legal e plano interno.
3. Clique em **Executar** e acompanhe o log.
4. O despacho de retorno é criado em cada processo (sem assinatura) e, se houver bloco na **Config.**, incluído nele.

**Cuidados:**
- Executar de novo só refaz o que faltou: o registro evita empenho e despacho em duplicidade.
- NE cancelada direto no Contratos: marque **emitir de novo** na linha.
- **Config.**: listas de UGR e PTRES, padrões por processo e bloco de assinatura.
- A caixa de números só esvazia pelo botão **Limpar**.

### Concessão Suprimento

**Para que serve:** lê as solicitações de concessão no SEI, **emite ou reforça os SF** no SIAFI e gera o despacho de
devolução no processo.

**Abra antes:** o **SEI** e o **SIAFI** logado em outra aba.

**Passo a passo:**
1. No SEI, lingueta **CS** → aba **Concessões**: informe o nº SEI de cada solicitação, um por linha (opcional: o 2º nº
   da linha é o despacho de retorno do empenho), e clique em **Ler documentos**.
2. Confira cada cartão: tipo, período, destino, câmbio, **Concessão** ou **Reforço**. Desmarque **enviar** no que não
   for agora.
3. **Enviar fila para o SIAFI**.
4. No SIAFI, lingueta **CS** → aba **Fila de SF**: confira e clique em **Emitir SFs**. Em **modo teste** (padrão), o
   script preenche e para antes do Registrar.
5. Com a aba do SEI aberta, o **despacho de devolução** é gerado sozinho quando os SF são registrados (ou pelo botão
   **Gerar despachos prontos**) e incluído no bloco de assinatura.

**Cuidados:**
- O SIAFI não tem ambiente de teste: faça a primeira rodada em modo teste.
- Moeda **numerário** ainda não é tratada: o script para e avisa.
- SF já registrado é pulado. Registro sem resposta: confira no SIAFI e use **Já está registrado: informar o nº e
  seguir** ou **Não foi registrado: registrar de novo**.

### Prestação de Contas Suprimento

**Para que serve:** a partir do relatório "Despesas do Servidor por Item" (PDF) e do processo no SEI, faz no SIAFI o
detalhamento e a anulação do saldo do SF (com o Detacustos), anula o saldo das NEs no Contratos.gov.br e gera o
despacho final no SEI.

**Abra antes:** o **SEI**, o **SIAFI** e o **Contratos.gov.br**, logados no mesmo navegador. O PDF do relatório
incluído no processo do SEI.

**Passo a passo:**
1. No SEI, lingueta **PC** → aba **Prestação de contas**: informe o nº SEI do PDF, um por linha (opcional: o 2º nº é o
   despacho de devolução), e clique em **Ler do SEI**. Também dá para carregar o PDF do computador.
2. Confira cada cartão: SF e UG (editáveis), centro de custo, devolução por NE e a VPD de natureza nova, se pedir.
3. **Enviar para o SIAFI**.
4. No SIAFI, lingueta **PC** → **Lançar no SIAFI**. Em **modo teste** (padrão), o script para antes de registrar.
5. De volta ao SEI: **Consultar saldo das NEs no Contratos** e depois **Anular NEs no Contratos**.
6. **Gerar despachos no SEI**: o despacho final vai para o bloco de assinatura da Config.

**Cuidados:**
- A NE só é anulada se o saldo no Contratos for igual ao valor a anular.
- A tabela de VPD aprende com os lançamentos: a natureza nova digitada no cartão entra na tabela quando o SIAFI aceita.
- Registro sem resposta: confira no SIAFI antes de tentar de novo.

---

## Contratos e liquidação

### Instrumento de Cobrança (Planilha)

**Para que serve:** cadastra no Contratos.gov.br os instrumentos de cobrança (notas fiscais) de uma planilha, sem
cliques.

**Abra antes:** o **Contratos.gov.br**, com o **contrato aberto** na tela de instrumentos de cobrança.

**Passo a passo:**
1. Lingueta **IP** → aba **Cadastrar**: **Baixar planilha modelo** (na primeira vez) e preencha.
2. Escolha o arquivo da planilha e confira o contrato no seletor.
3. Rode com **Simular** marcado, confira o log, desmarque e clique em **Cadastrar notas**.

**Cuidados:**
- Use este **ou** o Instrumento de Cobrança (Gercont), não os dois ativos ao mesmo tempo.
- Aceita também a planilha de entrada do outro sistema e a converte (**Baixar no formato arquivosecom**, que serve para
  a Liquidação Contratos SECOM).
- Nota já cadastrada no contrato é pulada. A soma dos empenhos tem de bater com o valor líquido.

### Instrumento de Cobrança (Gercont)

**Para que serve:** você marca as notas no Gercont e o script cadastra os instrumentos de cobrança no Contratos.gov.br
(também aceita planilha).

**Abra antes:** o **Gercont**, na lista de notas do contrato, e o **Contratos.gov.br** com o mesmo contrato aberto na
tela de instrumentos de cobrança.

**Passo a passo:**
1. No Gercont, marque as notas na coluna **Lançar** (acrescentada pelo script) e envie pela aba **Enviar** do painel
   **IG**.
2. No Contratos.gov.br, lingueta **IG** → aba **Cadastrar**: as notas recebidas já aparecem.
3. Rode em **modo simulação**, confira, desligue a simulação e cadastre.

**Cuidados:**
- Use este **ou** o da planilha, não os dois ativos ao mesmo tempo.
- Nota com crédito no Gercont é pulada (lançar à mão). A soma dos vínculos tem de bater com a liquidação.

### Liquidação Contratos SECOM

**Para que serve:** apropria (liquida) no Contratos.gov.br as notas marcadas na lista, conferindo com a planilha xlsx
da liquidação, e gera no SEI o documento de pagamento com a NP. Sem tributos e sem dados de pagamento (ficam no SIAFI).

**Abra antes:** o **Contratos.gov.br** na **lista de instrumentos de cobrança** e o **SEI** logado em outra aba, na
**unidade** em que os processos estão abertos.

**Passo a passo:**
1. Lingueta **LS** → aba **Liquidação**: carregue a planilha da liquidação.
2. Cada nota da lista ganha uma etiqueta (**confere**, **divergente**, **fora da planilha**, **apropriada**). Marque o lote
   na **caixinha LS do script**, não na do Contratos.
3. Clique em **▶ Apropriar marcadas** e confirme. Uma nota com erro não para as outras.
4. No fim, **Baixar planilha** traz a NP/NS de cada nota.
5. Com a aba do SEI aberta, os documentos de pagamento são gerados sozinhos (ou pelo botão **Gerar documentos
   pendentes**).

**Cuidados:**
- Na primeira vez, configure o **tipo de documento** na **Config.** do painel do SEI. Sem isso, o script não gera e
  avisa.
- A confirmação do lote mostra em que unidade do SEI os documentos serão criados: confira.
- Com a Liquidação Geral também instalada, cada linha tem duas caixinhas: LS é esta.

### Liquidação Geral

**Para que serve:** apropria no Contratos.gov.br notas de contratos diferentes, **uma NP por grupo de notas do mesmo
contrato**, com situação, contas e centro de custo sugeridos pelo histórico de cada contrato. Lança a data de envio
para pagamento no Gercont e inclui no SEI o documento com a NP. Sem tributos e sem dados de pagamento (ficam no SIAFI).

**Abra antes:** o **Contratos.gov.br** na **lista de instrumentos de cobrança**, o **SEI** logado em outra aba e o
**Gercont** logado (para a data de pagamento).

**Passo a passo:**
1. Marque as notas na **caixinha LG** do script (pode misturar contratos; as marcações valem entre páginas).
2. Lingueta **LG** → aba **Liquidação**: confira os grupos. Para cada um, veja processo SEI, contas, centro de custo e a
   **tabela da aba PCO** (empenho, situação, subitem, VPD e valor). Separe ou junte notas se precisar.
3. Clique em **▶ Apropriar** e confirme. Antes de apropriar, o script lança a data no Gercont (ou use só o botão
   **📅 Data no Gercont**).
4. No SEI, lingueta **LG** → aba **Documentos SEI** → **▶ Incluir documentos pendentes** (ou automático, se ligado na
   Config.).

**Cuidados:**
- Processo de ano anterior ao corrente gera alerta amarelo: costuma ser o processo da contratação, posto por engano.
- **↻ Atualizar saldos** relê o saldo dos empenhos e dos subitens.
- Grupo que não dá para liquidar agora: marque a caixinha do grupo e use **✕ Tirar do lote os grupos marcados**.
- Dedução, dados de pagamento e detalhamento de centro de custo continuam no SIAFI.

### Prazo pelo Termo de Recebimento

**Para que serve:** mostra a coluna **Prazo** no Controle de Processos do SEI (dispensa a extensão SEI Pro) e define o
prazo dos processos pela data de assinatura do Termo de Recebimento, com empresa e valor no marcador.

**Abra antes:** o **SEI**, no **Controle de Processos**.

**Passo a passo:**
1. Lingueta **PT** → aba **Prazos**: marque **Mostrar o prazo** para ver a coluna (verde até 15 dias, amarelo de 16 a 30,
   vermelho acima de 30). Clique no título da coluna para ordenar.
2. Para gravar os prazos: rode **Inspecionar o 1º** para conferir a leitura de um processo.
3. Com o **modo simulação** ligado, clique em **Processar a página** e confira. Depois desligue a simulação e processe
   de novo.

**Cuidados:**
- O prazo fica no **primeiro marcador** do processo (linha "Ate dd/mm/aaaa"). Sem marcador, o script usa o padrão da
  Config.
- O valor vem da **linha TOTAL** das tabelas do termo.
- Processo com muitos documentos (árvore em pastas) pode não ter o termo achado: defina o prazo à mão.

---

## SIAFI e tributos

### Conferência GEROP

**Para que serve:** confere as OPs pendentes de assinatura da UG logada na GEROP, com os dados da NP e o Simples
Nacional do credor, aponta alertas e gera no SEI o Termo de Conformidade de cada processo.

**Abra antes:** o **SIAFI** na transação **GEROP**. Depois, a página **Consulta Optantes** do Simples Nacional (Receita)
e o **SEI**, cada um na sua aba.

**Passo a passo:**
1. Na GEROP, lingueta **CG** → aba **OPs pendentes** → **Consultar** (leva uns 7 segundos por OP nova).
2. **Não clique mais na tela da GEROP depois da coleta** (o SIAFI derruba a sessão). Para conferir, use o painel na
   página da Receita ou no SEI.
3. Na Consulta Optantes, aba **Simples** → **Consultar pendentes**. Você resolve o captcha e o script segue.
4. Confira cada OP: marque os tiques de documentos e deduções, escreva os apontamentos e marque **Conferido**,
   **Conferência manual** ou **Com pendência**.
5. No SEI, aba **Termos SEI** → **▶ Gerar termos pendentes**: um termo por processo, com as OPs Conferidas, incluído no
   seu bloco de assinatura.

**Cuidados:**
- Na **Config.**, informe o seu bloco de assinatura, nome e cargo (cada operador tem os seus).
- Equipe: quem coleta usa **Exportar extração**. Os demais usam **Importar extração** e conferem as OPs atribuídas a
  eles.
- OPs em Conferência manual ou Com pendência ficam no painel mesmo depois de saírem da GEROP.

### NPs Pendentes

**Para que serve:** percorre no CONDH as NPs pendentes de realização da UG (o ano atual e os 5 anteriores) e gera o
relatório das que têm **pagamento pendente**: favorecido não pago por inteiro ou NP sem favorecido.

**Abra antes:** o **SIAFI** na transação **CONDH**.

**Passo a passo:**
1. Lingueta **NP** → aba **Pendências** → **Consultar**. **Parar** interrompe e **Continuar** faz só o que faltou.
2. No fim, **Baixar relatório** (HTML, com ordenação por coluna) ou **Baixar planilha (CSV)**.

**Cuidados:**
- Trabalhe no SIAFI com o **relatório baixado**, em outra aba: mexer na tela usada pela consulta derruba a sessão.
- Nas rodadas seguintes, só as NPs alteradas são relidas. **Ler tudo de novo** ignora essa memória.

### Apropria Folha de Pagamento

**Para que serve:** a partir dos relatórios DDP da folha (PDF) e da consulta de saldos de empenho, calcula a PCO e a
Despesa a Anular pela tabela de correlações e lança o documento FL no SIAFI.

**Abra antes:** o **SIAFI**. Tenha no computador os **5 PDFs DDP** (nível A, nível E, EST16, EST35 e Todos) e a
**consulta de saldos de empenho** do Tesouro Gerencial, para colar.

**Passo a passo:**
1. Lingueta **FP** → aba **Folha de pagamento**: carregue os 5 PDFs e cole a consulta de empenhos.
2. **Calcular** e confira os totais com o relatório Todos. Ajuste na tabela o que for preciso (NE, VPD, valor, ✂ para
   dividir uma linha).
3. Preencha os Dados Básicos (processo, datas) e clique em **Lançar no SIAFI**. Em **modo teste** (padrão), o script
   para antes do 1º registro.
4. O lançamento vai em registros sucessivos: primeiro toda a PCO (até 40 linhas por registro), depois a Despesa a
   Anular, cada um com o Detacustos.
5. Nas pausas, corrija no SIAFI o que o painel pedir e clique em **Continuar**.

**Cuidados:**
- Linhas sem NE ou acima do saldo bloqueiam o lançamento: resolva na tabela antes.
- Na **Config.**: tabela de correlações, compensações e **centro de custo**. Sem centro de custo, o script pausa no
  Detacustos.
- Mesma competência lançada de novo pede confirmação. **Continuar o FL…** retoma o próximo registro.

### Reinf Envio em Lote

**Para que serve:** envia em lote, a partir de planilhas, os eventos R-4010, R-4020 e R-2010 da EFD-Reinf, e confere o
que já está no Reinf.

**Abra antes:** a **página inicial do e-CAC**, no perfil do órgão (o script lê o CNPJ ali). Depois, o **Reinf Web**.
Deixe o **Assinador SERPRO** aberto, com o token conectado.

**Passo a passo:**
1. Lingueta **RE**: confira no topo o CNPJ em uso. Se não aparecer, informe e clique em **Usar este CNPJ**.
2. Na aba do evento (**R-4010**, **R-4020** ou **R-2010**), **Baixar planilha modelo** (na primeira vez) e carregue a
   sua planilha.
3. **Validar** e confira os itens (inválidos e alertas ficam fora do envio).
4. **Enviar ao Reinf** e confirme a assinatura no Assinador (uma confirmação por bloco de eventos).
5. **Baixar planilha com recibos**: as linhas enviadas ficam marcadas e são puladas na próxima carga.
6. Aba **Conferência**: contagem por período ou conciliação planilha × Reinf.

**Cuidados:**
- O script **só inclui** eventos: exclusão e retificação são feitas à mão.
- Recarregar a página perde o andamento: a planilha com recibos é o registro.
- A consulta do Reinf traz no máximo 500 eventos por vez: acima disso, o painel avisa.

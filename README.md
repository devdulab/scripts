<!-- Este README é gerado a partir de publico/README.md do repositório de trabalho: edições feitas direto aqui são apagadas na próxima publicação. -->
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/devdu-logo-dark.png">
    <img src="assets/devdu-logo-light.png" alt="DevDu" width="320">
  </picture>
</p>

<p align="center">Scripts para automatizar rotinas de execução orçamentária e financeira no SEI, SIAFI, SCDP, Contratos.gov.br e outros sistemas do governo federal. São ferramentas de trabalho para simplificar a vida dos executores. Algumas necessitam de configuração para funcionar no seu ambiente.</p>

<p align="center">Se o seu órgão tiver interesse, podemos adaptar os scripts ou criar novos para os sistemas e rotinas de vocês. <a href="#customização-e-contato">Fale com a gente</a>. :))</p>

---

## Como instalar

1. Instale a extensão **Tampermonkey** no Chrome ([Chrome Web Store](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)).
2. Libere os scripts no Chrome (só na primeira vez): abra `chrome://extensions`, clique em **Detalhes** no Tampermonkey
   e ative **Permitir scripts de usuário**. Se essa opção não aparecer (Chrome mais antigo), ative o
   **Modo do desenvolvedor**, no canto superior direito da mesma página.
3. Clique no link **Instalar** do script que você quer, na tabela abaixo.
4. Na tela do Tampermonkey que abrir, clique em **Instalar**.

Pronto. As atualizações chegam sozinhas (o Tampermonkey verifica uma vez por dia).
Ao abrir o sistema, o script aparece como uma lingueta no canto direito da tela, com o ícone DevDu, a cor da área e a sigla do script.

> O link **Instalar** funciona no computador com o Tampermonkey. Sem ele (no celular, por exemplo), aparece só o
> texto do script.

## Scripts

| Script | O que faz | Sistema | Versão | Instalar |
|---|---|---|---|---|
| Boletim Interno | Captura o relatório de afastamentos do SCDP e gera o Boletim de Concessão de Diárias no SEI, com CPF mascarado | SCDP → SEI | 1.0.1 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/boletim-interno.user.js) |
| Cadastro de Diárias | Lê as Solicitações de Diárias no SEI, consulta as PCDPs no SCDP e altera a prestação de contas ou cadastra a viagem, com o ofício anexado; exporta o Relatório > Viagem para Excel | SEI → SCDP | 1.2.0 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/cadastro-diarias.user.js) |
| Consulta Viagens SCDP | Lê os viajantes das Solicitações de Diárias no SEI e confere no SCDP se cada um tem PCDP, com diárias, passagens e total; a tabela vai para o Excel | SEI → SCDP | 1.0.4 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/consulta-viagens-scdp.user.js) |
| Faturamento SCDP | Para uma lista de órgãos e UGRs num período, pesquisa o Relatório de Conferência da Fatura do SCDP em cada empenho e agência de viagem e junta tudo num Excel: um bilhete por linha (órgão solicitante, PCDP, proposto, valores) e um resumo com os totais de cada fatura | SCDP | 1.1.2 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/faturamento-scdp.user.js) |
| Prestação de Contas SCDP | Percorre uma lista de órgãos, abre cada prestação de contas pendente e encaminha só as solicitadas pelas pessoas da lista informada, preenchendo a data prevista de publicação e a justificativa de prestação fora do prazo quando o SCDP pedir; opção de parar em cada uma para você clicar em Encaminhar | SCDP | 2.1.3 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/prestacao-contas-scdp.user.js) |
| Comparador de Faturas | Compara as faturas em PDF da agência de viagens (o .zip recebido) com a planilha de faturamento do SCDP e mostra as divergências, o quadro de tributação para o SIAFI e o agrupamento por nota de empenho, com SIORG e centro de custo; os arquivos não saem do computador | SCDP | 2.0.0 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/comparador-faturas.user.js) |
| Conferência de Hospedagem | Confere as faturas de hotel: lê a tabela de hóspedes do extrato em PDF no SEI (o digitalizado é lido com OCR e completado à mão, com o extrato ao lado), lista os hóspedes em ordem alfabética e, com o documento aberto no SEI, inclui num clique o nº do documento e o processo onde a pessoa aparece; marca a situação de cada um e gera as listas com e sem nomes para colar nos processos | SEI | 1.1.0 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/conferencia-hospedagem.user.js) |
| Empenho Suprimento | Lê os pedidos no SEI, emite, reforça ou anula os empenhos de suprimento de fundos no Contratos.gov.br e devolve o despacho com as NEs | SEI → Contratos.gov.br | 1.2.1 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/empenho-suprimento.user.js) |
| Concessão Suprimento | Lê as solicitações de concessão no SEI, emite ou reforça os SF no SIAFI e gera o despacho de devolução | SEI → SIAFI | 1.3.0 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/concessao-suprimento.user.js) |
| Prestação de Contas Suprimento | Lê no SEI o relatório de despesas do suprimento (PDF) e lança no SF o detalhamento e a anulação do saldo no SIAFI, com o Detacustos; anula o saldo das NEs no Contratos.gov.br e gera o despacho final no SEI, no bloco de assinatura | SEI → SIAFI → Contratos.gov.br | 1.0.0 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/prestacao-contas-suprimento.user.js) |
| Reinf Envio em Lote | Envia em lote, a partir de planilhas, os eventos R-4010 (diárias), R-4020 (pagamentos a PJ) e R-2010 (retenção previdenciária) da EFD-Reinf, assinando pelo Assinador SERPRO, e confere o que já está no Reinf. Pega o CNPJ do perfil na página inicial do e-CAC (abra o e-CAC antes do Reinf) ou aceita o CNPJ digitado | Reinf Web (e-CAC) | 1.0.1 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/reinf-envio-lote.user.js) |
| Instrumento de Cobrança (Planilha) | Cadastra os instrumentos de cobrança (notas fiscais) de uma planilha no Contratos.gov.br, sem cliques | Contratos.gov.br | 1.1.0 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/instrumento-cobranca-planilha.user.js) |
| Instrumento de Cobrança (Gercont) | Marca as notas no Gercont e cadastra os instrumentos de cobrança no Contratos.gov.br (também aceita planilha). Use este **ou** o da planilha | Gercont → Contratos.gov.br | 1.0.1 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/instrumento-cobranca-gercont.user.js) |
| Liquidação Contratos SECOM | Apropria (liquida) no Contratos.gov.br as notas marcadas na lista de instrumentos de cobrança, conferindo com a planilha xlsx da liquidação, e gera no SEI o documento de pagamento com a NP. Sem tributos e sem dados de pagamento (ficam no SIAFI) | Contratos.gov.br → SEI | 1.1.5 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/liquidacao-contratos-secom.user.js) |
| Liquidação Geral | Apropria no Contratos.gov.br notas de contratos diferentes, uma NP por contrato, com situação, contas e centro de custo sugeridos pelo histórico de cada contrato, e inclui no SEI o documento com a NP e o valor em cada processo. Sem tributos e sem dados de pagamento (ficam no SIAFI) | Contratos.gov.br → SEI | 2.0.0 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/liquidacao-geral.user.js) |
| Conferência GEROP | Confere as OPs pendentes de assinatura na GEROP do SIAFI com os dados da NP (dados básicos, PCO, despesa a anular, deduções e pagamento), consulta o Simples Nacional dos credores na Receita, aponta alertas (soma dos documentos, processos, Simples × retenção IN 1234, bem patrimonial) e gera no SEI o Termo de Conformidade de cada processo, com o extrato do SIAFI e os documentos de pagamento, no seu bloco de assinatura | SIAFI → Receita → SEI | 1.4.0 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/conferencia-gerop.user.js) |
| Prazo pelo Termo de Recebimento | Mostra a coluna Prazo na lista do Controle de Processos (sem a extensão SEI Pro), com cores pelos dias desde a assinatura do Termo de Recebimento, e define o prazo dos processos por essa data, com empresa e valor no marcador | SEI | 1.0.1 | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/prazo-termo-recebimento.user.js) |

## Dúvidas e problemas

Fale com a Dulce informando o nome do script e a versão (aparece no rodapé do painel).

## Customização e contato

Quer adaptar um script para o seu órgão ou automatizar outra rotina? Escreva para
[dulceoga@gmail.com](mailto:dulceoga@gmail.com).

## Histórico

Veja as mudanças de cada script no [CHANGELOG](CHANGELOG.md).

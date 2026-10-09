<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/devdu-logo-dark.png">
    <img src="assets/devdu-logo-light.png" alt="DevDu" width="320">
  </picture>
</p>

<p align="center">Scripts para automatizar rotinas de execução orçamentária e financeira no SEI, SIAFI, SCDP, Contratos.gov.br e outros sistemas do governo federal.</p>

---

## Como instalar

1. Instale a extensão **Tampermonkey** no Chrome ([Chrome Web Store](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)).
2. Clique no link **Instalar** do script que você quer, na tabela abaixo.
3. Na tela que abrir, clique em **Instalar**.

Pronto. As atualizações chegam sozinhas (o Tampermonkey verifica uma vez por dia).
Ao abrir o sistema, o script aparece como uma lingueta verde com o ícone DevDu no canto direito da tela.

## Scripts

| Script | O que faz | Sistema | Instalar |
|---|---|---|---|
| Boletim Interno | Captura o relatório de afastamentos do SCDP e gera o Boletim de Concessão de Diárias no SEI, com CPF mascarado | SCDP → SEI | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/boletim-interno.user.js) |
| Empenho Suprimento | Lê os pedidos no SEI, emite, reforça ou anula os empenhos de suprimento de fundos no Contratos.gov.br e devolve o despacho com as NEs | SEI → Contratos.gov.br | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/empenho-suprimento.user.js) |
| Concessão Suprimento | Lê as solicitações de concessão no SEI, emite ou reforça os SF no SIAFI e gera o despacho de devolução | SEI → SIAFI | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/concessao-suprimento.user.js) |
| Instrumento de Cobrança (Planilha) | Cadastra os instrumentos de cobrança (notas fiscais) de uma planilha no Contratos.gov.br, sem cliques | Contratos.gov.br | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/instrumento-cobranca-planilha.user.js) |
| Instrumento de Cobrança (Gercont) | Marca as notas no Gercont e cadastra os instrumentos de cobrança no Contratos.gov.br (também aceita planilha). Use este **ou** o da planilha | Gercont → Contratos.gov.br | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/instrumento-cobranca-gercont.user.js) |

## Dúvidas e problemas

Fale com a Dulce informando o nome do script e a versão (aparece no rodapé do painel).

## Histórico

Veja as mudanças de cada script no [CHANGELOG](CHANGELOG.md).

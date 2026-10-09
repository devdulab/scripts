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
Ao abrir o sistema, o script aparece como uma lingueta verde com o ícone DevDu no canto direito da tela.

> O link **Instalar** funciona no computador com o Tampermonkey. Sem ele (no celular, por exemplo), aparece só o
> texto do script.

## Scripts

| Script | O que faz | Sistema | Instalar |
|---|---|---|---|
| Boletim Interno | Captura o relatório de afastamentos do SCDP e gera o Boletim de Concessão de Diárias no SEI, com CPF mascarado | SCDP → SEI | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/boletim-interno.user.js) |
| Empenho Suprimento | Lê os pedidos no SEI, emite, reforça ou anula os empenhos de suprimento de fundos no Contratos.gov.br e devolve o despacho com as NEs | SEI → Contratos.gov.br | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/empenho-suprimento.user.js) |
| Concessão Suprimento | Lê as solicitações de concessão no SEI, emite ou reforça os SF no SIAFI e gera o despacho de devolução | SEI → SIAFI | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/concessao-suprimento.user.js) |
| Reinf Envio em Lote | Envia em lote, a partir de planilhas, os eventos R-4010 (diárias), R-4020 (pagamentos a PJ) e R-2010 (retenção previdenciária) da EFD-Reinf, assinando pelo Assinador SERPRO, e confere o que já está no Reinf. Pega o CNPJ do perfil na página inicial do e-CAC (abra o e-CAC antes do Reinf) ou aceita o CNPJ digitado | Reinf Web (e-CAC) | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/reinf-envio-lote.user.js) |
| Instrumento de Cobrança (Planilha) | Cadastra os instrumentos de cobrança (notas fiscais) de uma planilha no Contratos.gov.br, sem cliques | Contratos.gov.br | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/instrumento-cobranca-planilha.user.js) |
| Instrumento de Cobrança (Gercont) | Marca as notas no Gercont e cadastra os instrumentos de cobrança no Contratos.gov.br (também aceita planilha). Use este **ou** o da planilha | Gercont → Contratos.gov.br | [Instalar](https://raw.githubusercontent.com/devdulab/scripts/main/scripts/instrumento-cobranca-gercont.user.js) |

## Dúvidas e problemas

Fale com a Dulce informando o nome do script e a versão (aparece no rodapé do painel).

## Customização e contato

Quer adaptar um script para o seu órgão ou automatizar outra rotina? Escreva para
[dulceoga@gmail.com](mailto:dulceoga@gmail.com).

## Histórico

Veja as mudanças de cada script no [CHANGELOG](CHANGELOG.md).

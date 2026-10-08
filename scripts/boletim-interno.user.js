// ==UserScript==
// @name         DevDu - Boletim Interno
// @namespace    https://github.com/devdulab
// @version      1.0.0
// @description  Captura o relatório de afastamentos do SCDP (HTML) e gera o Boletim de Concessão de Diárias no SEI
// @author       DevDu
// @icon         https://raw.githubusercontent.com/devdulab/scripts/main/assets/devdu-icon-64.png
// @match        https://protocolo.presidencia.gov.br/*
// @match        https://www2.scdp.gov.br/novoscdp/*
// @match        https://scdp.gov.br/novoscdp/*
// @require      https://raw.githubusercontent.com/devdulab/scripts/main/lib/devdu-ui.js?v=1.0.0
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @updateURL    https://raw.githubusercontent.com/devdulab/scripts/main/scripts/boletim-interno.user.js
// @downloadURL  https://raw.githubusercontent.com/devdulab/scripts/main/scripts/boletim-interno.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const VERSAO = '1.0.0'; // manter igual ao @version do cabeçalho

  // ---------------------------------------------------------------------------
  // Funções puras (testáveis no Node com jsdom)
  // ---------------------------------------------------------------------------
  const P = {};

  P.norm = (s) => String(s == null ? '' : s).replace(/ /g, ' ').replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim();
  P.chave = (s) => P.norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ');
  P.digitos = (s) => String(s || '').replace(/\D/g, '');
  P.esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  P.parseBRL = (s) => {
    const t = P.norm(s).replace(/R\$\s*/i, '').replace(/\s/g, '');
    return /\d/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : NaN;
  };
  P.fmtBRL = (n) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Conteúdo do editor do SEI: não-ASCII como entidade (o formulário vai em ISO-8859-1)
  P.entidades = (html) => String(html).replace(/[^\x00-\x7F]/g, (ch) => '&#' + ch.codePointAt(0) + ';');
  P.encLatin1 = (s) => {
    let out = '';
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (/[A-Za-z0-9\-_.*]/.test(ch)) out += ch;
      else if (ch === ' ') out += '+';
      else if (c < 256) out += '%' + c.toString(16).toUpperCase().padStart(2, '0');
      else out += encodeURIComponent('&#' + c + ';');
    }
    return out;
  };
  P.formLatin1 = (pares) => pares.map(([k, v]) => P.encLatin1(k) + '=' + P.encLatin1(v == null ? '' : v)).join('&');

  // Codificação do arquivo do SCDP: a do <meta charset>; sem ela, UTF-8 se for válido, senão windows-1252
  P.charsetHTML = (bytes) => {
    const ini = Array.from(bytes.slice(0, 4096), (b) => String.fromCharCode(b)).join('');
    const m = ini.match(/charset\s*=\s*["']?([\w-]+)/i);
    if (m) return m[1].toLowerCase();
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'utf-8'; } catch (e) { return 'windows-1252'; }
  };

  // CPF no boletim: 'mascarado' (***.123.456-**, padrão LGPD), 'completo' ou 'omitir'
  P.cpfExibicao = (cpf, modo) => {
    const d = P.digitos(cpf);
    if (modo === 'omitir' || d.length !== 11) return modo === 'omitir' ? '' : P.norm(cpf);
    if (modo === 'completo') return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  };

  // Rótulos do relatório "Afastamentos a Serviço" do SCDP (chave sem acento → campo)
  const ROTULOS = {
    'NUMERO:': 'numero', 'ORGAO SOLICITANTE:': 'orgao', 'DATA DE GERACAO:': 'dataGeracao',
    'NOME DO PROPOSTO:': 'nome', 'CPF DO PROPOSTO:': 'cpf', 'CARGO OU FUNCAO:': 'cargo',
    'MOTIVO DA VIAGEM:': 'motivo', 'DESCRICAO MOTIVO:': 'descricao', 'VALOR DAS DIARIAS:': 'valorTexto',
  };
  const CAMPOS_CABECALHO = ['numero', 'orgao', 'dataGeracao'];
  const ehRotulo = (t) => P.chave(t) in ROTULOS || (/:$/.test(t) && t.length <= 40 && !/\n/.test(t));
  const ehRodape = (t) => /^Sistema de Concess[ãa]o de Di[áa]rias e Passagens$/i.test(t) || /^P[áa]gina \d+ de( \d+)?$/i.test(t);
  const RE_LOCAL = /^(.*\S)\s*\((\d{2}\/\d{2}\/\d{4})\)$/;

  // Textos do relatório na ordem do documento. O HTML do SCDP é um export do JasperReports: cada campo é um <span>
  // dentro de uma célula; <br> separa parágrafos. As páginas A4 (table.jrPage) são só visuais: uma concessão pode
  // começar numa página e terminar na outra, por isso a leitura ignora as páginas e segue os rótulos.
  P.tokens = (doc) => {
    const out = [];
    for (const sp of doc.querySelectorAll('span')) {
      if (sp.querySelector('span')) continue;
      const tmp = doc.createElement('div');
      tmp.innerHTML = sp.innerHTML.replace(/<br\s*\/?>/gi, '\n');
      const t = P.norm(tmp.textContent);
      if (t) out.push(t);
    }
    return out;
  };

  // Relatório SCDP → { titulo, numero, orgao, dataGeracao, concessoes: [...], avisos: [...] }
  // Concessão: { id (ordem no relatório), unidade, pcdp (ex. 000567/25 ou 000753/25-1C), nome, cpf, cargo, motivo, descricao, trechos: [{ origem, dataSaida, destino, dataChegada }],
  //              valorTexto, valor, extras: { rótulo desconhecido: valor } }
  P.relatorioSCDP = (doc) => {
    const tk = P.tokens(doc).filter((t, i, a) => !ehRodape(t) && !(i > 0 && /^P[áa]gina \d+ de$/i.test(a[i - 1]) && /^\d+$/.test(t)));
    const rel = { titulo: '', numero: '', orgao: '', dataGeracao: '', concessoes: [], avisos: [] };
    let unidade = '';
    let atual = null;
    let campo = ''; // último rótulo lido na concessão atual
    let locais = [];
    const fechar = () => {
      if (!atual) return;
      if (locais.length % 2) rel.avisos.push(`PCDP ${atual.pcdp}: roteiro com número ímpar de locais (${locais.length})`);
      for (let k = 0; k + 1 < locais.length; k += 2) {
        atual.trechos.push({ origem: locais[k].local, dataSaida: locais[k].data, destino: locais[k + 1].local, dataChegada: locais[k + 1].data });
      }
      if (locais.length % 2) atual.trechos.push({ origem: locais[locais.length - 1].local, dataSaida: locais[locais.length - 1].data, destino: '', dataChegada: '' });
      atual.valor = P.parseBRL(atual.valorTexto);
      if (!atual.nome) rel.avisos.push(`PCDP ${atual.pcdp}: sem nome do proposto`);
      if (!atual.valorTexto) rel.avisos.push(`PCDP ${atual.pcdp}: sem valor das diárias`);
      else if (isNaN(atual.valor)) rel.avisos.push(`PCDP ${atual.pcdp}: valor das diárias ilegível ("${atual.valorTexto}")`);
      if (!atual.trechos.length) rel.avisos.push(`PCDP ${atual.pcdp}: sem roteiro`);
      rel.concessoes.push(atual);
      atual = null; campo = ''; locais = [];
    };
    for (let i = 0; i < tk.length; i++) {
      const t = tk[i];
      const prox = tk[i + 1];
      const valorDoRotulo = () => (prox != null && !ehRotulo(prox) && prox !== 'PCDP' ? (i++, prox) : '');
      if (t === 'PCDP') {
        fechar();
        atual = { id: rel.concessoes.length, unidade, pcdp: '', nome: '', cpf: '', cargo: '', motivo: '', descricao: '', trechos: [], valorTexto: '', valor: NaN, extras: {} };
        if (prox && /^\d+\/\d+(-\w+)?$/.test(prox)) { atual.pcdp = prox; i++; } else rel.avisos.push(`PCDP sem número depois de "${unidade}"`);
        continue;
      }
      if (ehRotulo(t)) {
        const nome = ROTULOS[P.chave(t)];
        const v = valorDoRotulo();
        if (nome && CAMPOS_CABECALHO.includes(nome)) { if (!rel[nome]) rel[nome] = v; continue; }
        if (!atual) { rel.avisos.push(`Rótulo "${t}" fora de uma concessão`); continue; }
        campo = nome || t;
        if (nome) atual[nome] = v; else atual.extras[t.replace(/:$/, '')] = v;
        if (nome === 'valorTexto') fechar();
        continue;
      }
      const loc = t.match(RE_LOCAL);
      if (atual && loc && (campo === 'descricao' || campo === 'motivo' || locais.length)) {
        locais.push({ local: loc[1], data: loc[2] });
        continue;
      }
      if (atual && campo === 'descricao' && !locais.length) {
        // descrição cortada na quebra de página: o resto vem no início da página seguinte
        atual.descricao += (/[.;:!?]$/.test(atual.descricao) ? '\n' : ' ') + t;
        continue;
      }
      if (atual) { rel.avisos.push(`PCDP ${atual.pcdp}: texto não reconhecido "${t.slice(0, 80)}"`); continue; }
      if (i === 0) { rel.titulo = t; continue; }
      unidade = t; // cabeçalho do grupo (unidade do proposto), vale até o próximo
    }
    fechar();
    return rel;
  };

  // Concessões agrupadas por unidade, na ordem do relatório
  P.agrupar = (concessoes) => {
    const grupos = [];
    for (const c of concessoes) {
      let g = grupos[grupos.length - 1];
      if (!g || g.unidade !== c.unidade) grupos.push((g = { unidade: c.unidade, concessoes: [] }));
      g.concessoes.push(c);
    }
    return grupos;
  };

  // HTML para o editor do SEI (estilos padrão do SEI: Texto_*, Tabela_Texto_*)
  // opcoes: { cpf: 'mascarado'|'completo'|'omitir', cabecalho: bool, numero: nº do boletim no SEI }
  P.htmlBoletim = (rel, concessoes, opcoes = {}) => {
    const o = Object.assign({ cpf: 'mascarado', cabecalho: true }, opcoes);
    const p = (cls, html) => `<p class="${cls}">${html}</p>`;
    const linha = (rot, html) => `<tr><td style="width:24%; vertical-align:top">${p('Tabela_Texto_Alinhado_Esquerda', '<strong>' + P.esc(rot) + '</strong>')}</td>` +
      `<td style="vertical-align:top">${html}</td></tr>`;
    const texto = (s) => p('Tabela_Texto_Alinhado_Esquerda', P.esc(s) || '&nbsp;');
    const partes = [];
    if (o.cabecalho) {
      // Nº do título = nº do boletim informado no SEI (o nº do relatório no SCDP não é usado – decisão da usuária)
      partes.push(p('Texto_Centralizado_Maiusculas_Negrito', P.esc(rel.titulo || 'Afastamentos a Serviço') + (o.numero ? ' N&ordm; ' + P.esc(o.numero) : '')));
      const info = [rel.orgao && 'Órgão solicitante: ' + rel.orgao, rel.dataGeracao && 'Data de geração: ' + rel.dataGeracao].filter(Boolean).join(' – ');
      if (info) partes.push(p('Texto_Centralizado', P.esc(info)));
    }
    for (const g of P.agrupar(concessoes)) {
      if (g.unidade) partes.push(p('Texto_Fundo_Cinza_Negrito', P.esc(g.unidade)));
      for (const c of g.concessoes) {
        const linhas = [
          linha('PCDP', p('Tabela_Texto_Alinhado_Esquerda', '<strong>' + P.esc(c.pcdp) + '</strong>')),
          linha('Nome do Proposto', texto(c.nome)),
        ];
        if (o.cpf !== 'omitir') linhas.push(linha('CPF do Proposto', texto(P.cpfExibicao(c.cpf, o.cpf))));
        linhas.push(linha('Cargo ou Função', texto(c.cargo)), linha('Motivo da Viagem', texto(c.motivo)));
        const paras = String(c.descricao || '').split(/\n+/).filter(Boolean);
        linhas.push(linha('Descrição Motivo', paras.length ? paras.map((x) => p('Tabela_Texto_Justificado', P.esc(x))).join('') : texto('')));
        for (const [rot, v] of Object.entries(c.extras || {})) linhas.push(linha(rot, texto(v)));
        const rot = c.trechos.map((t) => P.esc(`${t.origem} (${t.dataSaida})`) + (t.destino ? ' &rarr; ' + P.esc(`${t.destino} (${t.dataChegada})`) : ''));
        linhas.push(linha('Roteiro', rot.length ? rot.map((x) => p('Tabela_Texto_Alinhado_Esquerda', x)).join('') : texto('')));
        linhas.push(linha('Valor das Diárias', texto(c.valorTexto ? 'R$ ' + c.valorTexto : '')));
        partes.push('<table border="1" cellpadding="3" cellspacing="0" style="border-collapse:collapse; width:100%"><tbody>' + linhas.join('') + '</tbody></table>');
        partes.push(p('Texto_Alinhado_Esquerda', '&nbsp;'));
      }
    }
    return partes.join('\n');
  };

  // Árvore do processo (procedimento_visualizar): "Nos[i] = new infraArvoreNo(tipo, id, pai, link, alvo, rótulo, dica, ...,
  // protocolo)". Os argumentos são lidos um a um; o último texto é o nº do protocolo. Links trazem infra_hash: colher, não montar.
  P.arvore = (html) => {
    const nos = {};
    const ini = /Nos\[(\d+)\]\s*=\s*new infraArvoreNo\(/g;
    const desesc = (t) => t.replace(/\\u([0-9a-fA-F]{4})/g, (x, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, '$1');
    let m;
    while ((m = ini.exec(html))) {
      const tok = /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(null|true|false|-?\d+(?:\.\d+)?))\s*([,)])/y;
      tok.lastIndex = ini.lastIndex;
      const args = [];
      let t;
      while ((t = tok.exec(html))) {
        args.push(t[1] != null ? desesc(t[1]) : t[2] != null ? desesc(t[2]) : (t[3] === 'null' ? null : t[3]));
        if (t[4] === ')') break;
      }
      if (args.length < 6) continue;
      let protocolo = '';
      for (const a of args) if (typeof a === 'string' && a && !/^(true|false)$/.test(a)) protocolo = a;
      nos[m[1]] = { tipo: args[0], id: args[1], link: args[3] || '', rotulo: String(args[5] || '').trim(), protocolo: protocolo.trim() };
    }
    const reSrc = /Nos\[(\d+)\]\.src\s*=\s*'([^']*)'/g; // link documento_visualizar (conteúdo do documento)
    while ((m = reSrc.exec(html))) if (nos[m[1]]) nos[m[1]].src = m[2];
    const inc = html.match(/controlador\.php\?acao=documento_escolher_tipo[^"'\s]*/);
    const r = { processo: '', documentos: [], linkEscolherTipo: inc ? inc[0].replace(/&amp;/g, '&') : '' };
    for (const k of Object.keys(nos).map(Number).sort((a, b) => a - b)) {
      if (nos[k].tipo === 'PROCESSO' && !r.processo) r.processo = nos[k].protocolo || nos[k].rotulo;
      if (nos[k].tipo === 'DOCUMENTO') r.documentos.push(nos[k]);
    }
    return r;
  };
  P.documentoNaArvore = (docs, numero) => {
    for (const d of docs) if (d.protocolo === numero) return d;
    for (const d of docs) if (new RegExp('(^|\\D)' + numero + '(\\D|$)').test(d.rotulo)) return d;
    return null;
  };

  // Formulário → pares [nome, valor], como o navegador envia
  P.serializarForm = (form) => {
    const pares = [];
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      const t = (el.type || '').toLowerCase();
      if (t === 'button' || t === 'submit' || t === 'file' || t === 'image') continue;
      if ((t === 'radio' || t === 'checkbox') && !el.checked) continue;
      if (el.tagName === 'SELECT') {
        if (el.multiple) { for (const o of el.options) if (o.selected) pares.push([el.name, o.value]); continue; }
        const o = el.options[el.selectedIndex] || el.options[0];
        if (o) pares.push([el.name, o.value]);
        continue;
      }
      pares.push([el.name, el.value]);
    }
    return pares;
  };

  // Nº do boletim seguinte ao último gerado, no mesmo formato ("07/2026" → "08/2026"; "7" → "8").
  // Ano diferente do atual recomeça em 01/ano. Sem último número → ''.
  P.proximoNumero = (ultimo, ano) => {
    const m = P.norm(ultimo).match(/^(\d+)(?:\s*\/\s*(\d{4}))?$/);
    if (!m) return '';
    const larg = m[1].length;
    if (m[2] && ano && String(ano) !== m[2]) return '1'.padStart(larg, '0') + '/' + ano;
    return String(Number(m[1]) + 1).padStart(larg, '0') + (m[2] ? '/' + m[2] : '');
  };

  // Identifica o relatório (para avisar se o boletim dele já foi gerado)
  P.chaveRelatorio = (rel) => [rel.numero, rel.orgao, rel.dataGeracao, rel.concessoes.length].join('|');

  // Mensagem de erro do SEI numa página de resposta. As telas do SEI trazem dezenas de alert() de validação no
  // próprio JavaScript (ex. "Nome do anexo possui caracteres especiais."): com a tela original em htmlBase, só conta
  // alert que não estava nela (a mensagem que o servidor acrescentou). Também lê div de mensagem/exceção do infra.
  P.erroSEI = (html, htmlBase) => {
    const limpar = (t) => P.norm(t.replace(/\\n/g, ' ').replace(/\\u([0-9a-fA-F]{4})/g, (x, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\(.)/g, '$1').replace(/<[^>]+>/g, ' '));
    const alertas = (h) => [...String(h || '').matchAll(/alert\(\s*(['"])((?:(?!\1)[^\\]|\\.)+)\1\s*\)/g)].map((m) => m[2]);
    const base = new Set(alertas(htmlBase));
    const novo = alertas(html).find((a) => !base.has(a));
    if (novo) return limpar(novo);
    const div = String(html).match(/id="div(?:InfraMsg\d*|InfraExcecao|InfraAviso)"[^>]*>([\s\S]*?)<\/div>/);
    return div && P.norm(div[1].replace(/<[^>]+>/g, ' ')) ? limpar(div[1]) : '';
  };

  // Onde entra o conteúdo no documento do boletim (seções = HTML de cada txaEditor_*):
  //  1. parágrafo com a marca [CONCESSOES] (ou {CONCESSOES}) → substituído pelo conteúdo;
  //  2. sem marca: no lugar da última seção vazia (corpo do modelo);
//  3. senão, no fim da maior seção que não seja cabeçalho/rodapé.
// editaveis (opcional): false nas seções somente leitura do modelo, que nunca recebem o conteúdo.
  // Recusa se o documento já tiver alguma PCDP deste relatório (evita gravar duas vezes).
  // Retorna { secoes: [html...], indice, modo: 'marca'|'vazia'|'fim' } ou lança erro.
 // Texto visível de uma seção do editor (sem tags, entidades de espaço e espaços)
  P.textoSecao = (h) => P.norm(String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;|&#xa0;/gi, ' '));
  P.RE_MARCA = /[[{]\s*CONCESS(?:OES|&Otilde;ES|ÕES|&#213;ES)\s*[\]}]/i;
  P.inserirNoDocumento = (doc, secoes, conteudo, pcdps, editaveis) => {
    const pode = (i) => !editaveis || editaveis[i] !== false;
    const ja = pcdps.find((n) => secoes.some((h) => h.includes(n)));
    if (ja) throw new Error(`O documento já tem a PCDP ${ja}: as concessões parecem já ter sido gravadas (apague-as no editor para gravar de novo)`);
    const novas = secoes.slice();
    let indice = novas.findIndex((h, i) => pode(i) && P.RE_MARCA.test(h));
    if (indice >= 0) {
      const d = doc.implementation.createHTMLDocument('');
      const raiz = d.createElement('div');
      raiz.innerHTML = novas[indice];
      const alvo = [...raiz.querySelectorAll('p, div, td')].reverse().find((el) => P.RE_MARCA.test(el.innerHTML) && !el.querySelector('p, div, table'));
      if (alvo && alvo.tagName === 'P' && P.norm(alvo.textContent).replace(P.RE_MARCA, '').trim() === '') {
        alvo.insertAdjacentHTML('beforebegin', conteudo);
        alvo.remove();
        novas[indice] = raiz.innerHTML;
      } else {
        novas[indice] = novas[indice].replace(P.RE_MARCA, conteudo);
      }
      return { secoes: novas, indice, modo: 'marca' };
    }
    const ehCabecalhoRodape = (h) => /<img/i.test(h) && P.textoSecao(h).length < 300;
    // Seção vazia (só parágrafos em branco) = corpo do modelo: o conteúdo entra no lugar dela. Caso real (08/10/2026):
    // o modelo do "Boletim de Concessão de Diárias" tem o título "Boletim ... Nº x" numa seção e o corpo vazio em outra;
    // a v0.2.4 escolhia a maior (a do título) e o SEI não guardou o conteúdo.
    const vazias = [];
    novas.forEach((h, i) => { if (pode(i) && !/<(img|table)/i.test(h) && P.textoSecao(h) === '') vazias.push(i); });
    if (vazias.length) {
      indice = vazias[vazias.length - 1];
      novas[indice] = conteudo;
      return { secoes: novas, indice, modo: 'vazia' };
    }
    let maior = -1;
    novas.forEach((h, i) => { if (pode(i) && !ehCabecalhoRodape(h) && h.length > maior) { maior = h.length; indice = i; } });
    if (indice < 0) throw new Error('Não encontrei a seção de texto do documento');
    novas[indice] = novas[indice] + '\n' + conteudo;
    return { secoes: novas, indice, modo: 'fim' };
  };

  // Seções somente leitura na página do editor (editor_montar): atributo readonly/disabled na textarea ou
  // "readOnly: true" na configuração do CKEditor dela. Retorna um boolean por textarea (true = editável).
  P.secoesEditaveis = (html, textareas) => textareas.map((ta) => {
    if (ta.hasAttribute('readonly') || ta.hasAttribute('disabled')) return false;
    const re = new RegExp(ta.name + '[\'"][^;]{0,600}?readOnly\\s*:\\s*true', 'i');
    return !re.test(html);
  });

  if (typeof module === 'object' && module.exports) { module.exports = { P, VERSAO }; return; }

  // ---------------------------------------------------------------------------
  // Navegador
  // ---------------------------------------------------------------------------
  const NO_SCDP = /(^|\.)scdp\.gov\.br$/.test(location.hostname);
  if (NO_SCDP) {
    // só na página do relatório (export HTML do JasperReports)
    if (!document.querySelector('table.jrPage, table[id^="JR_PAGE_ANCHOR"]')) return;
  } else if (window.top !== window.self || !/controlador\.php/.test(location.href)) return;
  // painel padrão DevDu (lib/devdu-ui.js, via @require). O host do painel ganha o id "bi-painel" da versão antiga
  // (antes da DevDu): se as duas estiverem instaladas, a que rodar depois vê o painel e não duplica.
  if (document.getElementById('bi-painel')) { console.warn('Boletim: outra cópia do script já está ativa nesta página'); return; }

  const parseHTML = (s) => new DOMParser().parseFromString(s, 'text/html');
  // Padrão do boletim interno (decisão da usuária, 08/10/2026): CPF mascarado e documento público – fixos, sem opção.
  const CFG_PADRAO = { cabecalho: true, tipoDocumento: 'Boletim de Concessão de Diárias' };
  const cfg = () => Object.assign({}, CFG_PADRAO, GM_getValue('bi_opcoes', {}), { cpf: 'mascarado', nivelAcesso: '0' });
  const gravarCfg = (dif) => GM_setValue('bi_opcoes', Object.assign(cfg(), dif));

  const PASSOS = `<ol class="passos">
    <li${NO_SCDP ? ' class="agora"' : ''}>No <b>SCDP</b>, gere o relatório em <b>HTML</b>. Na página do relatório, abra esta janelinha e clique em <b>Capturar relatório</b>.</li>
    <li${NO_SCDP ? '' : ' class="agora"'}>No <b>SEI</b>, abra o processo onde o boletim vai ser publicado, informe o <b>nº do boletim</b> e clique em <b>Gerar boletim neste processo</b>. O script cria o documento e grava as concessões.</li>
    <li>Na primeira vez, confira em <b>Configurações</b> o tipo de documento do SEI (padrão: Boletim de Concessão de Diárias).</li>
  </ol>`;

  // CSS do script dentro do painel (o painel DevDu fica num shadow DOM, isolado do CSS do SEI/SCDP)
  const CSS = `
    ol.passos{margin:0 0 10px;padding-left:20px;color:var(--suave)}
    ol.passos li{margin:3px 0}
    ol.passos li.agora{color:var(--texto);background:#FFF6D6}
    .linha{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
    .linha .dd-campo{flex:1;margin:0}
    .dica{color:var(--suave);font-size:12px}
    .dd-campo span.dica{display:inline;margin-left:6px}
    #bi-resumo{background:var(--fundo2);border:1px solid var(--borda);border-radius:6px;padding:8px;margin-bottom:10px}
    #bi-avisos{color:var(--aviso);white-space:pre-wrap;margin-bottom:10px}
    #bi-avisos:empty{display:none}
    #bi-lista details{border-bottom:1px solid var(--borda)}
    #bi-lista summary{padding:5px 6px;background:var(--fundo2);cursor:pointer;font-weight:600}
    #bi-lista .pcdp{display:flex;gap:6px;padding:3px 6px 3px 16px}
    #bi-lista .pcdp .v{margin-left:auto;color:var(--suave);white-space:nowrap}
    #bi-log{white-space:pre-wrap;margin-top:10px}
    #bi-log:empty{display:none}
    .diag{display:block;margin-top:6px;color:var(--teal-esc)}
    label.check{display:flex;gap:6px;align-items:center;margin-bottom:10px}
    h3{font-size:13px;color:var(--navy);margin:14px 0 6px}`;

  const SOBRE = `<p>Captura no <b>SCDP</b> o relatório "Afastamentos a Serviço" e gera no <b>SEI</b> o
    <b>Boletim de Concessão de Diárias</b> com todas as concessões, como texto pesquisável.</p>
    <p>Padrão do boletim interno: documento <b>público</b> e CPF <b>mascarado</b> (***.123.456-**).</p>
    <h3>Como usar</h3>${PASSOS}
    <p class="dica">Problemas: fale com a Dulce informando o nome do script e a versão (no rodapé do painel).</p>`;

  const painel = DevDu.painel({
    id: 'boletim-interno', nome: 'Boletim Interno', versao: VERSAO, largura: 520, css: CSS,
    abas: NO_SCDP
      ? [{ id: 'capturar', titulo: 'Capturar', icone: '📥' }, { id: 'sobre', titulo: 'Sobre', icone: 'ℹ️' }]
      : [{ id: 'boletim', titulo: 'Boletim', icone: '📄' }, { id: 'pcdps', titulo: 'PCDPs', icone: '📋' },
        { id: 'outras', titulo: 'Outras', icone: '🧰' }, { id: 'config', titulo: 'Config.', icone: '⚙️' },
        { id: 'sobre', titulo: 'Sobre', icone: 'ℹ️' }],
  });
  painel.elemento.id = 'bi-painel';
  painel.elemento.dataset.versao = VERSAO;
  const campo = (id) => painel.raiz.querySelector('#' + id);
  painel.secao('sobre').innerHTML = SOBRE;

  function log(msg) {
    const l = campo('bi-log');
    l.textContent += `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}\n`;
    l.scrollTop = l.scrollHeight;
  }

  const textoResumo = (r) => `<b>${P.esc(r.titulo || 'Relatório')}</b> – ${P.esc(r.orgao)}` +
    `${r.dataGeracao ? ' – gerado em ' + P.esc(r.dataGeracao) : ''}`;
  const somaDiarias = (lista) => lista.reduce((s, c) => s + (isNaN(c.valor) ? 0 : c.valor), 0);

  // ---------------------------------------------------------------------------
  // SCDP: captura do relatório (fica no armazenamento do Tampermonkey, que o SEI lê)
  // ---------------------------------------------------------------------------
  if (NO_SCDP) {
    painel.secao('capturar').innerHTML = `${PASSOS}
      <div class="linha"><button id="bi-capturar" class="dd-btn">Capturar relatório</button></div>
      <div id="bi-resumo">Relatório ainda não capturado.</div>
      <div id="bi-avisos"></div><div id="bi-log" class="dd-log"></div>`;
    const mostrar = () => {
      const cap = GM_getValue('bi_relatorio', null);
      if (!cap) return;
      const r = cap.rel;
      campo('bi-resumo').innerHTML = `${textoResumo(r)}<br>${r.concessoes.length} PCDP(s) · diárias R$ ${P.fmtBRL(somaDiarias(r.concessoes))}` +
        `<br>Capturado em ${new Date(cap.em).toLocaleString('pt-BR')}${cap.url === location.href ? ' (desta página)' : ' (de outra página)'}`;
      campo('bi-avisos').textContent = r.avisos.length ? 'Avisos:\n' + r.avisos.join('\n') : '';
    };
    campo('bi-capturar').onclick = () => {
      try {
        const r = P.relatorioSCDP(document);
        if (!r.concessoes.length) throw new Error('Nenhuma PCDP encontrada nesta página');
        GM_setValue('bi_relatorio', { rel: r, em: new Date().toISOString(), url: location.href });
        log(`✔ ${r.concessoes.length} PCDP(s) capturadas. Agora vá ao SEI e abra o processo do boletim (a janelinha do SEI recebe o relatório sozinha).`);
        mostrar();
      } catch (e) { log('ERRO: ' + e.message); }
    };
    mostrar();
    return;
  }

  // ---------------------------------------------------------------------------
  // SEI
  // ---------------------------------------------------------------------------
  async function seiReq(url, pares) {
    const opt = { credentials: 'include' };
    if (pares) {
      opt.method = 'POST';
      opt.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      opt.body = P.formLatin1(pares);
    }
    const r = await fetch(new URL(url.replace(/&amp;/g, '&'), location.href).href, opt);
    const html = new TextDecoder('windows-1252').decode(await r.arrayBuffer());
    if (!r.ok) throw new Error(`SEI respondeu ${r.status}`);
    if (/acao=(infra_)?login|sip\/login/i.test(r.url)) throw new Error('Sessão do SEI expirada');
    return { url: r.url, html };
  }

  function acaoPesquisaRapida() {
    const f = document.querySelector('#frmProtocoloPesquisaRapida') || (document.querySelector('input[name="txtPesquisaRapida"]') || {}).form;
    if (!f) throw new Error('Pesquisa rápida do SEI não encontrada nesta tela (abra o Controle de Processos)');
    return f.getAttribute('action');
  }

  // Processo aberto na tela (árvore à esquerda)
  async function processoAberto() {
    const ifr = document.getElementById('ifrArvore');
    const src = ifr && ifr.getAttribute('src');
    if (!src || !/procedimento_visualizar/.test(src)) throw new Error('Abra no SEI o processo onde o boletim vai ser publicado');
    const arv = P.arvore((await seiReq(src)).html);
    if (!arv.processo) throw new Error('Não consegui ler a árvore do processo aberto');
    arv.url = src;
    return arv;
  }

  // Novo documento do tipo configurado, sem texto inicial (o modelo do tipo traz o cabeçalho)
  async function criarDocumento(arv, c, numeroBoletim) {
    if (!arv.linkEscolherTipo) throw new Error(`Não há "Incluir Documento" no processo ${arv.processo} (ele está aberto na sua unidade?)`);
    const pEsc = await seiReq(arv.linkEscolherTipo);
    const dEsc = parseHTML(pEsc.html);
    const fEsc = dEsc.querySelector('#frmDocumentoEscolherTipo');
    const serie = [...dEsc.querySelectorAll('input[title]')].find((i) => P.chave(i.title) === P.chave(c.tipoDocumento));
    if (!fEsc || !serie) throw new Error(`Tipo de documento "${c.tipoDocumento}" não encontrado no SEI (confira em Configurações)`);
    const paresEsc = P.serializarForm(fEsc).filter(([k]) => !/^chkInfraItem/.test(k)).map(([k, v]) => [k, k === 'hdnIdSerie' ? serie.value : v]);
    const pGer = await seiReq(fEsc.getAttribute('action'), paresEsc);
    const fGer = parseHTML(pGer.html).querySelector('#frmDocumentoCadastro');
    if (!fGer) throw new Error('A tela de geração de documento não abriu' + (P.erroSEI(pGer.html, pEsc.html) ? ': ' + P.erroSEI(pGer.html, pEsc.html) : ''));
    const campos = [
      'hdnInfraTipoPagina', 'txtDataElaboracao', 'rdoTextoInicial', 'txtProtocoloDocumentoTextoBase', 'txtTextoPadrao', 'hdnIdTextoPadrao',
      'hdnIdDocumentoTextoBase', 'txtDescricao', 'txtNumero', 'txtNomeArvore', 'txtDinValor', 'txtRemetente', 'hdnIdRemetente',
      'txtInteressado', 'hdnIdInteressado', 'txtDestinatario', 'hdnIdDestinatario', 'txtAssunto', 'hdnIdAssunto', 'txaObservacoes',
      'selGrauSigilo', 'rdoNivelAcesso', 'selHipoteseLegal', 'hdnFlagDocumentoCadastro', 'hdnAssuntos', 'hdnInteressados', 'hdnDestinatarios',
      'hdnIdSerie', 'hdnIdUnidadeGeradoraProtocolo', 'hdnStaDocumento', 'hdnIdTipoConferencia', 'hdnSinArquivamento', 'hdnStaNivelAcessoLocal',
      'hdnIdHipoteseLegal', 'hdnStaGrauSigilo', 'hdnIdDocumento', 'hdnIdProcedimento', 'hdnAnexos', 'hdnIdHipoteseLegalSugestao',
      'hdnIdTipoProcedimento', 'hdnUnidadesReabertura', 'hdnSinBloqueado', 'hdnContatoObject', 'hdnContatoIdentificador', 'hdnAssuntoIdentificador'];
    const atuais = Object.fromEntries(P.serializarForm(fGer));
    const pub = fGer.querySelector('#optPublico');
    if (pub && pub.disabled) throw new Error(`O SEI não permite nível de acesso público para "${c.tipoDocumento}"`);
    // Público: além do rádio, o campo oculto hdnStaNivelAcessoLocal (a tela o preenche com o nível sugerido do tipo –
    // na v0.2.3 foi como restrito e o SEI pediu hipótese legal) e sem hipótese/grau de sigilo.
    const forcar = { rdoTextoInicial: 'N', txtTextoPadrao: '', hdnIdTextoPadrao: '', txtProtocoloDocumentoTextoBase: '', hdnIdDocumentoTextoBase: '',
      rdoNivelAcesso: '0', hdnStaNivelAcessoLocal: '0', selHipoteseLegal: 'null', hdnIdHipoteseLegal: '', selGrauSigilo: 'null', hdnStaGrauSigilo: '',
      hdnFlagDocumentoCadastro: '2', txtNumero: numeroBoletim };
    const sel = (n) => { const x = fGer.querySelector(`select[name="${n}"]`); return x && x.options.length ? (x.options[x.selectedIndex] || x.options[0]).value : 'null'; };
    const pares = campos.map((n) => [n, n in forcar ? forcar[n] : (n in atuais ? atuais[n] : (/^sel/.test(n) ? sel(n) : ''))]);
    const pNovo = await seiReq(fGer.getAttribute('action'), pares);
    const id = (pNovo.url.match(/id_documento=(\d+)/) || [])[1];
    if (!id) {
      try { diagnostico(pNovo, pares); } catch (e) { /* o diagnóstico não pode esconder o erro */ }
      const msg = P.erroSEI(pNovo.html, pGer.html);
      throw new Error('O SEI não criou o documento: ' + (msg || 'a resposta não trouxe mensagem de erro') +
        '. Confira na árvore se algum documento foi criado e mande o arquivo "resposta do SEI" abaixo para análise.');
    }
    const numero = (pNovo.html.match(/<span>[^<]*?(\d{6,})<\/span>/) || [])[1] || '';
    const linkEditor = (pNovo.html.match(/linkEditarConteudo\s*=\s*'([^']+)'/) || [])[1] || '';
    return { id, numero, linkEditor };
  }

  // Resposta do SEI numa falha, para baixar e mandar para análise (com os campos enviados, sem o conteúdo do boletim)
  function diagnostico(resp, pares, nota) {
    const enviado = pares.filter(([k]) => !/^txaEditor_/.test(k)).map(([k, v]) => `${k} = ${v}`).join('\n');
    const info = `Boletim ${VERSAO} – ${new Date().toISOString()}\nURL: ${resp.url}\n${nota ? nota + '\n' : ''}Campos enviados:\n${enviado}`;
    const blob = new Blob([`<!-- ${info.replace(/--/g, '- -')}\n-->\n${resp.html}`], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `resposta-sei-${Date.now()}.html`;
    a.textContent = '⬇ baixar a resposta do SEI (para análise)';
    a.className = 'diag';
    campo('bi-log').after(a);
  }

  // Grava o conteúdo pelo editor (editor_montar → editor_salvar), como o script do empenho faz com o despacho
  async function gravarNoEditor(linkEditor, conteudo, pcdps) {
    if (!linkEditor) throw new Error('Link de edição do documento não encontrado (já assinado ou não é documento interno?)');
    const pEd = await seiReq(linkEditor);
    const dEd = parseHTML(pEd.html);
    const urlSalvar = (pEd.html.match(/editor\/editor_processar\.php\?acao=editor_salvar[^"'\s]*/) || [])[0];
    if (!urlSalvar) throw new Error('Endereço de salvamento do editor não encontrado');
    const tas = [...dEd.querySelectorAll('textarea[name^="txaEditor_"]')];
    if (!tas.length) throw new Error('Seções do editor não encontradas');
    const res = P.inserirNoDocumento(document, tas.map((t) => t.value), conteudo, pcdps, P.secoesEditaveis(pEd.html, tas));
    const pares = tas.map((t, i) => [t.name, P.entidades(res.secoes[i])]);
    for (const n of ['hdnVersao', 'hdnIgnorarNovaVersao', 'hdnSiglaUnidade', 'hdnInfraPrefixoCookie']) {
      const e = dEd.querySelector(`[name="${n}"]`);
      pares.push([n, e ? e.value : (n === 'hdnIgnorarNovaVersao' ? 'N' : '')]);
    }
    const salvo = await seiReq(urlSalvar, pares);
    if (!/^\s*OK/.test(salvo.html)) throw new Error('O editor não confirmou o salvamento: ' + P.norm(parseHTML(salvo.html).body.textContent).slice(0, 200));
    const editaveis = P.secoesEditaveis(pEd.html, tas);
    const resumo = tas.map((t, i) => `${t.name}${editaveis[i] ? '' : ' (somente leitura)'}: ${P.textoSecao(t.value).slice(0, 50) || (/<img/i.test(t.value) ? '(imagem)' : '(vazia)')}`).join(' | ');
    return { modo: res.modo, secao: tas[res.indice].name, secoes: tas.length, resumo, pEd };
  }

  // Confere no documento salvo (documento_visualizar) se as PCDPs apareceram; senão, oferece a página do editor
  async function conferir(urlArvore, idDoc, pcdp, g) {
    const no = P.arvore((await seiReq(urlArvore)).html).documentos.find((d) => d.id === idDoc);
    if (!no || !no.src) { log('  (não consegui abrir o documento para conferir: confira na árvore)'); return true; }
    const html = (await seiReq(no.src)).html;
    if (html.includes(pcdp)) return true;
    log(`  ⚠ o SEI salvou, mas as concessões NÃO aparecem no documento. Seções: ${g.resumo}`);
    try { diagnostico(g.pEd, [], `Seção escolhida: ${g.secao} (${g.modo}). Seções: ${g.resumo}`); } catch (e) { /* só diagnóstico */ }
    return false;
  }

  let rel = null;
  let origem = '';          // 'captura' | nome do arquivo
  const escolhidas = () => rel.concessoes; // o boletim publica sempre o relatório todo
  const conteudo = () => P.htmlBoletim(rel, escolhidas(), Object.assign(cfg(), { numero: P.norm(campo('bi-numbol').value) }));

  painel.secao('boletim').innerHTML = `${PASSOS}
    <div id="bi-resumo">Nenhum relatório capturado ainda (passo 1). Se já capturou no SCDP, aguarde alguns segundos ou recarregue esta página (F5).</div>
    <div id="bi-avisos"></div>
    <label class="dd-campo"><span>Nº do boletim (o SEI pede) <span id="bi-numbol-dica" class="dica"></span></span>
      <input id="bi-numbol" placeholder="ex.: 08/2026"></label>
    <div class="linha"><button id="bi-gerar" class="dd-btn" disabled>Gerar boletim neste processo</button>
      <button id="bi-previa" class="dd-btn sec" disabled>Prévia</button></div>
    <div id="bi-log" class="dd-log"></div>`;
  painel.secao('pcdps').innerHTML = `<p class="dica">Concessões do relatório, por unidade, na ordem do SCDP (só para conferência: o boletim publica o relatório todo).</p>
    <div id="bi-lista"><p>Nenhum relatório capturado ainda.</p></div>`;
  painel.secao('outras').innerHTML = `
    <h3>Carregar o arquivo HTML do SCDP em vez de capturar</h3>
    <div class="linha"><input type="file" id="bi-arquivo" accept=".html,.htm,text/html"></div>
    <h3>Gravar num documento que já existe</h3>
    <div class="linha"><label class="dd-campo"><span>Nº SEI do documento</span><input id="bi-numero"></label>
      <button id="bi-gravar" class="dd-btn" disabled>Gravar</button></div>
    <p class="dica">No documento, o conteúdo entra no lugar do parágrafo <b>[CONCESSOES]</b>, se houver; senão, no corpo do texto. Feche o editor do documento antes.</p>
    <h3>Copiar</h3>
    <div class="linha"><button id="bi-copiar" class="dd-btn sec" disabled title="Copia o conteúdo para colar (Ctrl+V) no editor do SEI">Copiar para colar no editor</button></div>`;
  painel.secao('config').innerHTML = `
    <label class="dd-campo"><span>Tipo de documento do SEI</span><input id="bi-tipo"></label>
    <label class="check"><input type="checkbox" id="bi-cabecalho"> título, órgão e data do relatório no início</label>
    <p class="dica">Documento <b>público</b>, com CPF <b>mascarado</b> (***.123.456-**) – padrão do boletim interno, sem opção.</p>`;

  const c0 = cfg();
  campo('bi-tipo').value = c0.tipoDocumento;
  campo('bi-cabecalho').checked = !!c0.cabecalho;
  campo('bi-tipo').oninput = () => gravarCfg({ tipoDocumento: campo('bi-tipo').value.trim() });
  campo('bi-cabecalho').onchange = () => gravarCfg({ cabecalho: campo('bi-cabecalho').checked });
  const ultimoNum = GM_getValue('bi_ultimo_numero', '');
  campo('bi-numbol').value = GM_getValue('bi_numbol', '') || P.proximoNumero(ultimoNum, new Date().getFullYear());
  campo('bi-numbol-dica').textContent = ultimoNum ? `último gerado: ${ultimoNum}` : '';
  campo('bi-numbol').oninput = () => GM_setValue('bi_numbol', campo('bi-numbol').value.trim());
  campo('bi-numero').value = GM_getValue('bi_numero', '');
  campo('bi-numero').oninput = () => GM_setValue('bi_numero', campo('bi-numero').value.trim());
  campo('bi-arquivo').onchange = (e) => { const f = e.target.files[0]; if (f) carregarArquivo(f).catch((er) => log('ERRO: ' + er.message)); };
  campo('bi-previa').onclick = previa;
  campo('bi-copiar').onclick = () => copiar().catch((er) => log('ERRO: ' + er.message));
  const comBotoes = (fn) => () => {
    ['bi-gerar', 'bi-gravar'].forEach((id) => { campo(id).disabled = true; });
    fn().catch((er) => log('ERRO: ' + er.message)).finally(() => desenharLista());
  };
  campo('bi-gerar').onclick = comBotoes(gerarNoProcesso);
  campo('bi-gravar').onclick = comBotoes(gravarEmExistente);

  function usarRelatorio(r, de) {
    rel = r;
    origem = de;
    campo('bi-avisos').textContent = rel.avisos.length ? 'Avisos:\n' + rel.avisos.join('\n') : '';
    desenharLista();
  }

  async function carregarArquivo(arquivo) {
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const r = P.relatorioSCDP(parseHTML(new TextDecoder(P.charsetHTML(bytes)).decode(bytes)));
    if (!r.concessoes.length) throw new Error('Nenhuma PCDP encontrada no arquivo (é o HTML do relatório "Afastamentos a Serviço" do SCDP?)');
    usarRelatorio(r, arquivo.name);
    log(`${arquivo.name}: ${r.concessoes.length} PCDP(s) lidas${r.avisos.length ? `, ${r.avisos.length} aviso(s)` : ''}`);
  }

  function desenharLista() {
    if (!rel) return;
    const lista = campo('bi-lista');
    const sel = escolhidas();
    const cap = GM_getValue('bi_relatorio', null);
    const de = origem === 'captura' && cap ? `capturado do SCDP em ${new Date(cap.em).toLocaleString('pt-BR')}` : `arquivo ${origem}`;
    const gerado = GM_getValue('bi_gerados', {})[P.chaveRelatorio(rel)];
    campo('bi-resumo').innerHTML = `${textoResumo(rel)}<br><span style="color:#555">${P.esc(de)}</span><br>` +
      `${sel.length} PCDP(s) · diárias R$ ${P.fmtBRL(somaDiarias(sel))}` +
      (gerado ? `<br><b style="color:#9a5b00">Boletim deste relatório já gerado: documento ${P.esc(gerado.numero)} no processo ${P.esc(gerado.processo)}</b>` : '');
    const abertos = new Set([...lista.querySelectorAll('details[open]')].map((d) => d.dataset.u));
    lista.innerHTML = P.agrupar(rel.concessoes).map((g, gi) => {
      return `<details data-u="${gi}"${abertos.has(String(gi)) ? ' open' : ''}><summary>${P.esc(g.unidade || '(sem unidade)')} – ${g.concessoes.length}</summary>` +
        g.concessoes.map((c) => `<div class="pcdp">` +
          `PCDP ${P.esc(c.pcdp)} – ${P.esc(c.nome)}<span class="v">${c.trechos.length ? P.esc(c.trechos[0].dataSaida) : ''} · R$ ${P.esc(c.valorTexto)}</span></div>`).join('') +
        '</details>';
    }).join('');
    ['bi-gerar', 'bi-previa', 'bi-copiar', 'bi-gravar'].forEach((id) => { campo(id).disabled = !sel.length; });
  }

  async function gerarNoProcesso() {
    const c = cfg();
    if (!c.tipoDocumento) throw new Error('Defina o tipo de documento do SEI em Configurações');
    const numBol = P.norm(campo('bi-numbol').value);
    if (!numBol) { campo('bi-numbol').focus(); throw new Error('Informe o nº do boletim (o SEI pede esse número ao gerar o documento)'); }
    const sel = escolhidas();
    const arv = await processoAberto();
    const chave = P.chaveRelatorio(rel);
    const gerados = GM_getValue('bi_gerados', {});
    const ja = gerados[chave];
    const mesmoNum = Object.values(gerados).find((x) => x.numeroBoletim && P.chave(x.numeroBoletim) === P.chave(numBol));
    const aviso = (ja ? `\n\nATENÇÃO: o boletim deste relatório já foi gerado (documento ${ja.numero}, processo ${ja.processo}).` : '') +
      (mesmoNum ? `\n\nATENÇÃO: o nº ${numBol} já foi usado no documento ${mesmoNum.numero}.` : '');
    if (!confirm(`Criar "${c.tipoDocumento}" Nº ${numBol} no processo ${arv.processo} com ${sel.length} PCDP(s)?${aviso}`)) return;
    log(`Criando "${c.tipoDocumento}" Nº ${numBol} no processo ${arv.processo}…`);
    const doc = await criarDocumento(arv, c, numBol);
    log(`  documento ${doc.numero || doc.id} criado; gravando ${sel.length} PCDP(s)…`);
    const g = await gravarNoEditor(doc.linkEditor, conteudo(), sel.map((x) => x.pcdp));
    GM_setValue('bi_gerados', Object.assign(GM_getValue('bi_gerados', {}), { [chave]: { numero: doc.numero || doc.id, numeroBoletim: numBol, processo: arv.processo, em: new Date().toISOString() } }));
    GM_setValue('bi_ultimo_numero', numBol);
    GM_setValue('bi_numbol', '');
    campo('bi-numbol').value = P.proximoNumero(numBol, new Date().getFullYear());
    campo('bi-numbol-dica').textContent = `último gerado: ${numBol}`;
    const MODO = { marca: 'no lugar da marca [CONCESSOES]', vazia: 'no corpo do documento', fim: 'no fim do texto' };
    if (await conferir(arv.url, doc.id, sel[0].pcdp, g)) {
      log(`✔ boletim Nº ${numBol} (SEI ${doc.numero || doc.id}) gravado ${MODO[g.modo]} (seção ${g.secao} de ${g.secoes}). Confira antes de assinar.`);
    }
    const ifr = document.getElementById('ifrArvore');
    try { ifr.contentWindow.location.reload(); } catch (e) { /* atualizar a árvore é só conveniência */ }
  }

  async function gravarEmExistente() {
    const numero = P.digitos(campo('bi-numero').value);
    if (!numero) throw new Error('Informe o nº SEI do documento');
    const sel = escolhidas();
    if (!confirm(`Gravar ${sel.length} PCDP(s) no documento SEI ${numero}?`)) return;
    log(`Gravando ${sel.length} PCDP(s) no documento ${numero}…`);
    const r = await seiReq(acaoPesquisaRapida(), [['txtPesquisaRapida', numero]]);
    const urlArvore = (r.html.match(/id="ifrArvore"[^>]*src="([^"]+)"/) || r.html.match(/src="([^"]*acao=procedimento_visualizar[^"]*)"/) || [])[1];
    if (!urlArvore) throw new Error(`Documento ${numero} não encontrado (a pesquisa não abriu um processo)`);
    const arv = P.arvore((await seiReq(urlArvore)).html);
    const no = P.documentoNaArvore(arv.documentos, numero);
    if (!no || !no.link) throw new Error(`Documento ${numero} não está na árvore do processo ${arv.processo}`);
    const linkEditor = ((await seiReq(no.link)).html.match(/linkEditarConteudo\s*=\s*'([^']+)'/) || [])[1];
    const g = await gravarNoEditor(linkEditor, conteudo(), sel.map((x) => x.pcdp));
    if (await conferir(urlArvore, no.id, sel[0].pcdp, g)) {
      log(`✔ gravado no documento ${numero} (processo ${arv.processo}), seção ${g.secao} de ${g.secoes}. Confira antes de assinar.`);
    }
  }

  function previa() {
    const w = window.open('', '_blank');
    if (!w) { log('O navegador bloqueou a janela da prévia (libere pop-ups para o SEI)'); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Prévia do boletim</title><style>
      body{font:12pt Calibri,Arial,sans-serif;max-width:800px;margin:20px auto}p{margin:2px 0}td{border:1px solid #999}
      .Texto_Fundo_Cinza_Negrito{background:#ddd;font-weight:bold;padding:2px 4px;margin-top:8px}
      .Texto_Centralizado_Maiusculas_Negrito{text-align:center;text-transform:uppercase;font-weight:bold}.Texto_Centralizado{text-align:center}
      .Tabela_Texto_Justificado{text-align:justify}</style>${conteudo()}`);
    w.document.close();
  }

  async function copiar() {
    const html = conteudo();
    if (navigator.clipboard && window.ClipboardItem) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([tmp.innerText], { type: 'text/plain' }),
      })]);
    } else {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.style.cssText = 'position:fixed;left:-9999px;top:0';
      div.innerHTML = html;
      document.body.appendChild(div);
      const r = document.createRange();
      r.selectNodeContents(div);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      document.execCommand('copy');
      s.removeAllRanges();
      div.remove();
    }
    log(`${escolhidas().length} PCDP(s) copiadas: cole com Ctrl+V no editor do documento`);
  }

  // Captura feita no SCDP com a aba do SEI já aberta: o painel recebe na hora (listener do Tampermonkey) e, por
  // garantia, confere de novo ao voltar para a aba ou abrir a janelinha. Até a v0.2.1 só lia ao carregar a página.
  let capturaEm = '';
  function lerCaptura(inicio) {
    const cap = GM_getValue('bi_relatorio', null);
    if (!cap || !cap.rel || !cap.rel.concessoes || !cap.rel.concessoes.length || cap.em === capturaEm) return;
    capturaEm = cap.em;
    usarRelatorio(cap.rel, 'captura');
    if (inicio !== true) log(`Relatório capturado no SCDP: ${cap.rel.concessoes.length} PCDP(s)`);
  }
  lerCaptura(true);
  if (typeof GM_addValueChangeListener === 'function') GM_addValueChangeListener('bi_relatorio', () => lerCaptura());
  window.addEventListener('focus', () => lerCaptura());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lerCaptura(); });
  painel.raiz.querySelector('.lingueta').addEventListener('click', () => lerCaptura());
})();

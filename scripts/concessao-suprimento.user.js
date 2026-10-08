// ==UserScript==
// @name         DevDu - Concessão Suprimento
// @namespace    https://github.com/devdulab
// @version      1.0.0
// @description  No SEI, lê as solicitações de concessão e os despachos de retorno do empenho e monta a fila; no SIAFI, emite os SF no INCDH.
// @author       DevDu
// @icon         https://raw.githubusercontent.com/devdulab/scripts/main/assets/devdu-icon-64.png
// @match        https://siafi.tesouro.gov.br/siafi*/*
// @match        https://protocolo.presidencia.gov.br/*
// @require      https://raw.githubusercontent.com/devdulab/scripts/main/lib/devdu-ui.js?v=1.0.0
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @updateURL    https://raw.githubusercontent.com/devdulab/scripts/main/scripts/concessao-suprimento.user.js
// @downloadURL  https://raw.githubusercontent.com/devdulab/scripts/main/scripts/concessao-suprimento.user.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  const VERSAO = '1.0.0'; // manter igual ao @version do cabeçalho

  /* ======================================================================
   * Leitura dos documentos SEI – funções puras (recebem Document; testadas em test/parsers.js)
   * Atenção: no SIAFI a Prototype.js altera métodos de Array (ver armadilha 8 do CLAUDE.md);
   * estas funções só usam laços for, map e filter.
   * ==================================================================== */
  const P = {};
  // texto visível normalizado: sem NBSP, espaços colapsados
  P.texto = n => String((n && n.textContent) || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  // maiúsculas sem acento, para comparar rótulos
  P.chave = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  // "R$ 1.234,56", "US$ 10,00", "$ 2.000,00", "€ 5,00", "-" ou vazio → { valor, moeda }
  P.valorMoeda = s => {
    const t = String(s || '').replace(/ /g, ' ').trim();
    const num = t.replace(/[^\d,]/g, '');
    const valor = num ? Math.round(Number(num.replace(/\./g, '').replace(',', '.')) * 100) / 100 || 0 : 0;
    let moeda = '';
    if (/R\$/i.test(t)) moeda = 'BRL';
    else if (/€|EUR/i.test(t)) moeda = 'EUR';
    else if (/\$|USD|US/i.test(t)) moeda = 'USD';
    return { valor, moeda };
  };
  P.numeroProcesso = s => (String(s || '').match(/\d{5}\.\d{6}\/\d{4}-\d{2}/) || [])[0] || '';
  P.cpf = s => {
    const m = String(s || '').match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
    return m ? m[0].replace(/\D/g, '') : '';
  };
  // processo e número SEI do próprio documento (título "SEI/PR - 7915163 - ..." e rodapé "Referência")
  P.identificacao = doc => {
    const corpo = P.texto(doc.body);
    const ref = corpo.match(/Refer[eê]ncia:\s*Processo n[ºo°]\s*(\d{5}\.\d{6}\/\d{4}-\d{2})/i);
    return {
      processo: ref ? ref[1] : P.numeroProcesso(corpo),
      sei: ((doc.title || '').match(/SEI\/\w+ - (\d+)/) || corpo.match(/SEI n[ºo°]\s*(\d+)/) || [])[1] || '',
    };
  };
  const tabelaCom = (doc, rotulo) => {
    const tabs = doc.querySelectorAll('table');
    for (let i = 0; i < tabs.length; i++) if (P.chave(P.texto(tabs[i])).includes(rotulo)) return tabs[i];
    return null;
  };

  // Solicitação de concessão ("Suprimento de Fundos - Concessão")
  P.solicitacao = doc => {
    const r = Object.assign(P.identificacao(doc), { cpf: '', nome: '', marcado: {}, naturezas: [], totais: null, finalidade: '', periodo: null });
    const supr = tabelaCom(doc, 'DADOS DO AGENTE SUPRIDO');
    if (supr) {
      // a tabela achada pode conter também o item 1 (solicitante), com os mesmos rótulos: ler só depois do título
      const t2 = P.texto(supr).replace(/^[\s\S]*?AGENTE SUPRIDO/i, '');
      r.cpf = P.cpf((t2.match(/CPF:\s*([\d.\-]*)/i) || [])[1]);
      // "NOME: Fulana de Tal" (parágrafo próprio, antes de "UNIDADE:")
      const m = t2.match(/NOME:\s*(.*?)\s*(UNIDADE:|CPF:|SIAPE:|$)/i);
      r.nome = m ? m[1].replace(/[:\s]+$/, '').trim() : '';
    }

    // item 3: "[x] NUMERÁRIO", "[ ] DÓLAR", "[ ] EURO", "[ ] REAL", "[x ] CARTÃO DE PAGAMENTO..."
    const tipo = tabelaCom(doc, 'TIPO DE CONCESSAO');
    const t3 = P.chave(P.texto(tipo));
    const opcoes = { numerario: 'NUMERARIO', dolar: 'DOLAR', euro: 'EURO', real: 'REAL', cartao: 'CARTAO' };
    for (const k in opcoes) {
      const m = t3.match(new RegExp('\\[([^\\]]*)\\]\\s*' + opcoes[k]));
      r.marcado[k] = !!m && /X/.test(m[1]);
    }

    // item 4: linhas por natureza (CRÉDITO | SAQUE | TOTAL) e item 5 (totais)
    const val = tabelaCom(doc, 'VALOR SOLICITADO POR NATUREZA');
    const linhas = val ? val.querySelectorAll('tr') : [];
    for (let i = 0; i < linhas.length; i++) {
      const cel = linhas[i].querySelectorAll('td');
      if (cel.length < 4) continue;
      const rot = P.chave(P.texto(cel[0]));
      const [credito, saque, total] = [1, 2, 3].map(j => P.valorMoeda(P.texto(cel[j])));
      if (/VALOR SOLICITADO$/.test(rot) || /^5\.? ?VALOR SOLICITADO/.test(rot)) { r.totais = { credito, saque, total }; continue; }
      const nd = (rot.match(/\b(3\d{5})\b/) || [])[1] || '';
      if (!(credito.valor || saque.valor)) continue; // cabeçalho e naturezas do modelo sem valor
      r.naturezas.push({ nd, rotulo: P.texto(cel[0]).replace(/\(.*$/, '').trim(), credito, saque, total });
    }

    const corpo = P.texto(doc.body);
    const fin = corpo.match(/6\.\s*DESCRI[CÇ][AÃ]O DA FINALIDADE[^:]*:\s*(.*?)\s*7\.\s*JUSTIFICATIVA/i);
    r.finalidade = fin ? fin[1].trim() : '';
    const per = corpo.match(/PER[IÍ]ODO DE APLICA[CÇ][AÃ]O\s*de\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (per) r.periodo = { inicio: per[1], fim: per[2] };
    return r;
  };

  // Despacho de retorno do empenho (gerado pelo script do empenho): "Informo emissão de empenho na UG X,
  // em favor do CPF Y, conforme abaixo:" + tabela NATUREZA | NOTA DE EMPENHO | VALOR (R$)
  P.retornoEmpenho = doc => {
    const r = Object.assign(P.identificacao(doc), { operacao: '', ug: '', cpf: '', linhas: [] });
    const corpo = P.texto(doc.body);
    const inf = corpo.match(/Informo\s+(emiss[aã]o|refor[cç]o|anula[cç][aã]o)[^:]*?na UG\s*([\d.]{6,7})([^:]*):/i);
    if (inf) {
      r.operacao = { EMISSAO: 'emissao', REFORCO: 'reforco', ANULACAO: 'anulacao' }[P.chave(inf[1])];
      r.ug = inf[2].replace(/\D/g, '');
      r.cpf = P.cpf((inf[3].match(/CPF\s*([\d.\-]+)/i) || [])[1]);
    }
    const tab = tabelaCom(doc, 'NOTA DE EMPENHO');
    const trs = tab ? tab.querySelectorAll('tr') : [];
    for (let i = 0; i < trs.length; i++) {
      const c = trs[i].querySelectorAll('td');
      if (c.length < 3) continue;
      let nd = P.texto(c[0]), ne = P.chave(P.texto(c[1]));
      const ok = /^\d{4}NE\d{6}$/.test(ne);
      if (!/^\d{6}$/.test(nd)) { if (!ok) continue; nd = ''; } // cabeçalho; no reforço a natureza pode vir vazia
      r.linhas.push({ nd, ne: ok ? ne : '', valor: P.valorMoeda(P.texto(c[2])).valor, naoRealizado: !ok });
    }
    return r;
  };

  // Despacho de devolução já emitido (gerado por este script ou à mão): nº dos SF na tabela MODALIDADE
  // (linha CRÉDITO = SF SPF003; linha SAQUE - OBK = SF SPF002) e a UG ("unidade gestora 110322:")
  P.devolucaoLida = doc => {
    const r = Object.assign(P.identificacao(doc), { sf003: '', sf002: '', ug: '' });
    const corpo = P.texto(doc.body);
    r.ug = ((corpo.match(/unidade gestora\s*([\d.]{6,7})\s*:/i) || [])[1] || '').replace(/\D/g, '');
    const tab = tabelaCom(doc, 'MODALIDADE');
    const trs = tab ? tab.querySelectorAll('tr') : [];
    const sf = td => ((P.texto(td).match(/\d{4}SF\d{6}/i) || [])[0] || '').toUpperCase();
    for (let i = 0; i < trs.length; i++) {
      const tds = trs[i].querySelectorAll('td');
      if (tds.length < 3) continue;
      const rot = P.chave(P.texto(tds[0]));
      if (/^CREDITO$/.test(rot)) r.sf003 = sf(tds[2]);
      else if (/^SAQUE ?- ?OBK$/.test(rot)) r.sf002 = sf(tds[2]);
    }
    return r;
  };

  // Árvore do processo (iframe ifrArvore): "Nos[i] = new infraArvoreNo(tipo, id, pai, link, alvo, rótulo, dica, ...,
  // protocolo)" e "Nos[i].src = '...'" (link do documento). Os argumentos são lidos um a um (aspas e \uXXXX escapados
  // no rótulo não quebram a leitura). O último texto é o nº do protocolo (SEI do documento ou nº do processo).
  // Os links trazem infra_hash: colher daqui, nunca montar.
  P.arvore = html => {
    const nos = {};
    const ini = /Nos\[(\d+)\]\s*=\s*new infraArvoreNo\(/g;
    const desesc = t => t.replace(/\\u([0-9a-fA-F]{4})/g, (x, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, '$1');
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
      nos[m[1]] = { tipo: args[0], id: args[1], rotulo: String(args[5] || '').trim(), protocolo: protocolo.trim(), src: '' };
    }
    const reSrc = /Nos\[(\d+)\]\.src\s*=\s*'([^']*)'/g;
    while ((m = reSrc.exec(html))) if (nos[m[1]]) nos[m[1]].src = m[2];
    const esc = html.match(/controlador\.php\?acao=documento_escolher_tipo[^"'\s]*/);
    const r = { processo: '', documentos: [], linkEscolherTipo: esc ? esc[0].replace(/&amp;/g, '&') : '' };
    const ordem = Object.keys(nos).map(Number).sort((a, b) => a - b);
    for (const k of ordem) {
      if (nos[k].tipo === 'PROCESSO' && !r.processo) r.processo = nos[k].protocolo || nos[k].rotulo;
      if (nos[k].tipo === 'DOCUMENTO') r.documentos.push(nos[k]);
    }
    return r;
  };
  // documento da árvore com o nº SEI: pelo protocolo; senão, pelo número no rótulo
  P.documentoNaArvore = (docs, numero) => {
    for (const d of docs) if (d.protocolo === numero) return d;
    for (const d of docs) if (new RegExp('(^|\\D)' + numero + '(\\D|$)').test(d.rotulo)) return d;
    return null;
  };

  // Destino da viagem a partir da finalidade (texto livre) – só sugestão; a usuária confirma na janela.
  P.destino = finalidade => {
    const t = String(finalidade || '');
    const m = t.match(/destino\s*:?\s*([^,.;\n]+)/i) ||
      t.match(/viage[mn]s?\s+(?:oficial\s+)?(?:a|à|ao|aos|às|para|até)\s+([^,.;\n]+)/i) ||
      t.match(/miss[aã]o\s+(?:oficial\s+)?(?:a|à|ao|em|para)\s+([^,.;\n]+)/i);
    return m ? m[1].replace(/\s+(no|na|nos|nas|do|da|de|dos|das)\s+per[ií]odo.*$/i, '').trim() : '';
  };

  const r2 = n => Math.round(n * 100) / 100;
  const brl = n => r2(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  P.fmtCPF = c => (c && c.length === 11 ? c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : c);

  // Monta os SFs de uma concessão (solicitação + despacho de retorno do empenho).
  // Regras (confirmadas com a usuária):
  //  - Sem dólar/euro/numerário marcado (cartão e/ou real): um SPF003 com crédito + saque de cada natureza
  //    (o saque em R$ serve só para o despacho de devolução); deve bater com o valor da NE.
  //  - Dólar, euro ou numerário marcado: SPF003 só com o crédito e UM SPF002 com o saque de todas as naturezas
  //    (em R$: numerário direto; dólar/euro convertido pela taxa de câmbio ou valor digitado por natureza).
  //    Crédito + saque em R$ não pode passar do valor da NE (avisa se sobrar).
  //  - SF com valor zero não é emitido. O "tipo" (AJO, ECONOMATO...) vem da janela (lista configurável).
  // op: { tipo, periodo, destino, cambio, saqueBRL: { nd: valor } }
  // Reforço (ret.operacao 'reforco'): mesma montagem, mas cada SF é a ALTERAÇÃO de um SF já emitido na concessão
  // (nº lido do despacho de devolução: dev = P.devolucaoLida) – SPF003 reforça o SF do crédito, SPF002 o do saque OBK.
  // Não pede tipo nem CPF (o SF já existe). A UG do SF (despacho de devolução) e a das NEs (retorno) têm de ser iguais.
  P.montarConcessao = (sol, ret, op = {}, dev = null) => {
    const erros = [], avisos = [];
    const reforco = ret.operacao === 'reforco';
    const m = sol.marcado || {};
    const estrangeira = !!(m.dolar || m.euro);
    if (m.dolar && m.euro) erros.push('Dólar e euro marcados ao mesmo tempo na solicitação');
    const saqueNoSPF002 = estrangeira || !!m.numerario;
    if (!ret.ug) erros.push('UG não encontrada no despacho de retorno do empenho');
    if (ret.operacao && ret.operacao !== 'emissao' && !reforco) erros.push(`Despacho de retorno é de ${ret.operacao}, não de emissão nem de reforço`);
    if (reforco && !(dev && (dev.sf003 || dev.sf002))) erros.push('Reforço: despacho de devolução da concessão (com o nº do SF) não encontrado no processo');
    // a UG do SF e a das NEs do reforço têm de ser a mesma (usuária, 07/10/2026): divergência = erro, não lança
    if (reforco && dev && dev.ug && ret.ug && dev.ug !== ret.ug) {
      erros.push(`Reforço: UG do SF (${dev.ug}, despacho de devolução) diferente da UG das NEs do reforço (${ret.ug}) – não pode ser lançado`);
    }
    if (sol.cpf && ret.cpf && sol.cpf !== ret.cpf) erros.push(`CPF da solicitação (${P.fmtCPF(sol.cpf)}) diferente do despacho de retorno (${P.fmtCPF(ret.cpf)})`);
    const cpf = ret.cpf || sol.cpf;
    if (!cpf && !reforco) erros.push('CPF do suprido não encontrado (nem na solicitação, nem no despacho de retorno)');
    if (!(sol.naturezas || []).length) erros.push('Nenhuma natureza com valor no item 4 da solicitação');
    if (!op.tipo && !reforco) erros.push('Escolha o tipo de suprimento');
    const periodo = op.periodo != null ? op.periodo : (sol.periodo ? `${sol.periodo.inicio} A ${sol.periodo.fim}` : '');
    if (!periodo) erros.push('Período de aplicação não encontrado (item 8)');

    const itens003 = [], itens002 = [], naturezas = [];
    let faltaCambio = false;
    for (const nat of sol.naturezas || []) {
      let linha = (ret.linhas || []).filter(l => l.nd === nat.nd)[0];
      // reforço com a natureza em branco no retorno: uma natureza e uma NE só podem ser a mesma
      if (!linha && (sol.naturezas || []).length === 1 && (ret.linhas || []).length === 1 && !ret.linhas[0].nd) linha = ret.linhas[0];
      if (!linha) { erros.push(`Natureza ${nat.nd}: sem NE no despacho de retorno`); continue; }
      if (linha.naoRealizado) { erros.push(`Natureza ${nat.nd}: empenho não realizado`); continue; }
      const credito = nat.credito.valor, saque = nat.saque.valor;
      let saqueBRL = saque;
      if (estrangeira && saque) {
        const dig = op.saqueBRL && op.saqueBRL[nat.nd];
        if (dig != null && dig !== '') saqueBRL = r2(Number(dig));
        else if (op.cambio > 0) saqueBRL = r2(saque * op.cambio);
        else { saqueBRL = null; faltaCambio = true; }
      }
      const v003 = r2(credito + (saqueNoSPF002 ? 0 : saque));
      const v002 = saqueNoSPF002 ? saqueBRL : 0;
      if (v003 > 0) itens003.push({ ne: linha.ne, valor: v003, nd: nat.nd });
      if (v002 > 0) itens002.push({ ne: linha.ne, valor: v002, nd: nat.nd });
      if (saqueBRL != null) {
        const usado = r2(credito + saqueBRL);
        if (!estrangeira && usado !== linha.valor) avisos.push(`Natureza ${nat.nd}: crédito + saque (R$ ${brl(usado)}) diferente da NE ${linha.ne} (R$ ${brl(linha.valor)})`);
        if (estrangeira && usado > linha.valor) erros.push(`Natureza ${nat.nd}: crédito + saque convertido (R$ ${brl(usado)}) maior que a NE ${linha.ne} (R$ ${brl(linha.valor)})`);
        if (estrangeira && usado < linha.valor) avisos.push(`Natureza ${nat.nd}: sobra R$ ${brl(linha.valor - usado)} na NE ${linha.ne}`);
      }
      naturezas.push({ nd: nat.nd, ne: linha.ne, valorNE: linha.valor, credito, saque, moedaSaque: estrangeira ? (m.dolar ? 'USD' : 'EUR') : 'BRL', saqueBRL });
    }
    if (faltaCambio) erros.push('Informe a taxa de câmbio ou o valor do saque em R$ de cada natureza');

    const base = {
      ug: ret.ug, processo: sol.processo || ret.processo, cpf: P.fmtCPF(cpf), nomeSuprido: sol.nome || '',
      tipo: op.tipo || '', periodo, destino: op.destino || '',
      origem: { solicitacao: sol.sei, retorno: ret.sei },
    };
    if (reforco) {
      base.operacao = 'reforco';
      base.ugEmpenho = ret.ug;
      base.ug = (dev && dev.ug) || ret.ug;
      base.origem.devolucao = dev ? dev.sei : '';
    }
    const sfs = [];
    const limpa = l => l.map(i => ({ ne: i.ne, valor: i.valor, nd: i.nd }));
    if (itens003.length) sfs.push(Object.assign({ id: `${sol.sei}-SPF003`, situacao: 'SPF003', itens: limpa(itens003) }, base));
    if (itens002.length) sfs.push(Object.assign({ id: `${sol.sei}-SPF002`, situacao: 'SPF002', itens: limpa(itens002) }, base));
    if (!sfs.length && !erros.length) erros.push('Nenhum SF com valor');
    if (reforco && dev) {
      for (const sf of sfs) {
        sf.sfNumero = sf.situacao === 'SPF003' ? dev.sf003 : dev.sf002;
        if (!sf.sfNumero) erros.push(`Reforço ${sf.situacao}: a concessão não tem SF ${sf.situacao} no despacho de devolução ${dev.sei}`);
      }
    }
    return { erros, avisos, sfs, naturezas, reforco, estrangeira, numerario: !!m.numerario, moeda: m.dolar ? 'USD' : m.euro ? 'EUR' : '' };
  };

  // Janela "Resultado do Registrar" do INCDH (modal form_manterDocumentoHabil:modalResultadoRegistrar, dentro da página):
  // legenda "Número do Documento Hábil Registrado: 2026SF000068", "Data de Lançamento", documentos contábeis gerados
  // (ex.: "110001/2026NS020069") e botão Retornar. Enquanto ela está aberta, numeroDocumentoHabil_outputText fica "-".
  P.resultadoRegistro = doc => {
    const leg = doc.querySelector('#modalRegistrarCodigoDocumentoHabil legend');
    const caixa = leg ? leg.parentNode : doc.getElementById('form_manterDocumentoHabil:painelResultado');
    const t = P.texto(caixa);
    const m = t.match(/(?:Registrado|Atualizado):?\s*(\d{4}[A-Z]{2}\d{6})/i); // INCDH / alteração pelo CONDH
    if (!m) return null;
    const documentos = [];
    const cel = doc.querySelectorAll('[id$=":colCodigoDocumento"]');
    for (let i = 0; i < cel.length; i++) {
      const d = P.texto(cel[i]).match(/\d{6}\/\d{4}[A-Z]{2}\d{6}/);
      if (d) documentos.push(d[0]);
    }
    return { numero: m[1], data: (t.match(/Data de Lan[cç]amento:\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1] || '', documentos };
  };

  /* ---------------- SEI: formulários, bloco de assinatura (como no script do empenho) ---------------- */
  // POST para o SEI em ISO-8859-1 (caracteres fora do Latin-1 viram &#NNN;)
  P.encLatin1 = s => {
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
  P.formLatin1 = pares => pares.map(([k, v]) => P.encLatin1(k) + '=' + P.encLatin1(v == null ? '' : v)).join('&');
  // conteúdo do editor do SEI: tudo que não é ASCII vira entidade numérica
  P.entidades = html => String(html).replace(/[^\x00-\x7F]/g, ch => '&#' + ch.codePointAt(0) + ';');
  // formulário → lista de pares, como o navegador enviaria
  P.serializarForm = form => {
    const pares = [];
    const els = form.elements;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el.name || el.disabled) continue;
      const t = (el.type || '').toLowerCase();
      if (t === 'button' || t === 'submit' || t === 'file') continue;
      if ((t === 'radio' || t === 'checkbox') && !el.checked) continue;
      if (el.tagName === 'SELECT') {
        if (el.multiple) { for (let j = 0; j < el.options.length; j++) if (el.options[j].selected) pares.push([el.name, el.options[j].value]); continue; }
        const o = el.options[el.selectedIndex] || el.options[0];
        if (o) pares.push([el.name, o.value]);
        continue;
      }
      pares.push([el.name, el.value]);
    }
    return pares;
  };
  P.opcoesSelect = (doc, seletor) => {
    const s = doc.querySelector(seletor);
    const r = [];
    if (s) for (let i = 0; i < s.options.length; i++) r.push({ valor: s.options[i].value, texto: P.texto(s.options[i]) });
    return r;
  };
  // link "Incluir em Bloco de Assinatura" de um documento (árvore do processo)
  P.linkBloco = (html, idDocumento) => {
    const re = /controlador\.php\?acao=bloco_escolher[^"'\s]*/g;
    let m;
    while ((m = re.exec(html))) {
      const u = m[0].replace(/&amp;/g, '&');
      if (new RegExp(`[?&]id_documento=${idDocumento}(&|$)`).test(u)) return u;
    }
    return '';
  };
  // tela bloco_escolher: bloco em que o documento já está ('' se nenhum; null se o documento não aparece)
  P.blocoDoDocumento = (doc, idDocumento) => {
    const chks = doc.querySelectorAll('input[name^="chkDocumentosItem"]');
    for (let i = 0; i < chks.length; i++) {
      if (chks[i].value !== String(idDocumento)) continue;
      const a = chks[i].closest('tr').querySelector('a[href*="id_bloco="]');
      return a ? (a.getAttribute('href').match(/id_bloco=(\d+)/) || [])[1] || '' : '';
    }
    return null;
  };

  /* ---------------- Despacho de devolução ao suprido (texto padrão 3802) ---------------- */
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  // mês de referência = mês do início do período ("26/10/2026 A 26/11/2026" → "outubro/2026")
  P.mesAno = periodo => {
    const m = String(periodo || '').match(/\d{2}\/(\d{2})\/(\d{4})/);
    return m ? `${MESES[Number(m[1]) - 1]}/${m[2]}` : '';
  };
  // Dados do despacho a partir da concessão montada (P.montarConcessao) e do registro de SF registrados.
  //  CRÉDITO: nº do SPF003 + soma do crédito; SAQUE: soma do saque em R$ (só quando o saque foi no SPF003, ou seja,
  //  sem dólar/euro/numerário); SAQUE - OBK: nº do SPF002 + valor dele. OB e câmbio ficam para preenchimento manual.
  P.dadosDevolucao = (m, ug, op, registrados) => {
    const sf = sit => (m.sfs || []).filter(x => x.situacao === sit)[0];
    const s3 = sf('SPF003'), s2 = sf('SPF002');
    const reg = x => (x && registrados[x.id] && registrados[x.id].numero) || '';
    const num = x => (x && reg(x) ? x.sfNumero || reg(x) : ''); // reforço: o nº é o do SF alterado
    let credito = 0, saque = 0;
    for (const n of m.naturezas || []) { credito += n.credito; saque += n.saque; }
    const saqueNoSPF003 = !m.estrangeira && !m.numerario;
    let v2 = 0;
    if (s2) for (const i of s2.itens) v2 += i.valor;
    return {
      ug, destino: (op && op.destino) || '', mesAno: P.mesAno(op && op.periodo),
      sf003: num(s3), credito: s3 ? r2(credito) : null, saque: s3 && saqueNoSPF003 && saque ? r2(saque) : null,
      sf002: num(s2), valorObk: s2 ? r2(v2) : null,
      pendentes: [s3, s2].filter(x => x && !num(x)).map(x => x.id), reforco: !!m.reforco,
    };
  };
  // Preenche, dentro do HTML de uma seção do editor (raiz), o parágrafo "Restituo ... do mês de .../aaaa", a UG
  // ("unidade gestora X:") e a tabela MODALIDADE | DOCUMENTO | Nº | VALOR. Devolve quantos itens preencheu.
  P.preencherDevolucao = (doc, raiz, d) => {
    let n = 0;
    const ps = raiz.querySelectorAll('p');
    const sp = '(?:\\s|&nbsp;|\u00a0)';
    // reforço: "Dados do Reforço da Concessão" e "de reforço de concessão" nos parágrafos 1 e 2
    const termoReforco = p => {
      if (!d.reforco || /refor[cç]o/i.test(P.texto(p))) return;
      const antes = p.innerHTML;
      p.innerHTML = antes.replace(/Dados(\s|&nbsp;|\u00a0)+da(\s|&nbsp;|\u00a0)+Concess(ã|&atilde;|&#227;)o/i, 'Dados do Reforço da Concessão')
        .replace(new RegExp(`(processo${sp}*de${sp}+|documentos${sp}+de${sp}+)(concess(?:ã|&atilde;|&#227;)o)`, 'i'), '$1reforço de $2');
      if (p.innerHTML !== antes) n++;
    };
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], t = P.texto(p);
      if (/Dados da Concess|Restituo|Seguem/i.test(t)) termoReforco(p);
      if (/Restituo/i.test(t) && /(m[eê]s de|viagem)/i.test(t)) {
        const novo = d.destino ? `da viagem a ${d.destino}` : `do mês de ${d.mesAno}`;
        const re = new RegExp(`(?:do${sp}+m(?:ê|&ecirc;|&#234;)s${sp}+de${sp}*[^,<]*?\\/${sp}*\\d{4}|da${sp}+viagem${sp}+a${sp}+[^,<]*)`, 'i');
        if (re.test(p.innerHTML)) { p.innerHTML = p.innerHTML.replace(re, novo); n++; }
      }
      if (/unidade gestora/i.test(t) && d.ug) {
        p.innerHTML = p.innerHTML.replace(new RegExp(`(unidade${sp}+gestora)${sp}*[\\d.]*${sp}*:`, 'i'), `$1 ${d.ug}:`);
        n++;
      }
    }
    const tabs = raiz.querySelectorAll('table');
    let tab = null;
    for (let i = 0; i < tabs.length; i++) if (/MODALIDADE/.test(P.chave(P.texto(tabs[i])))) tab = tabs[i];
    if (!tab) return n;
    const brlTxt = v => (v == null ? 'R$' : 'R$ ' + brl(v));
    const escrever = (td, txt) => {
      const pp = td.querySelector('p');
      const cls = pp && pp.className ? pp.className : 'Tabela_Texto_Centralizado';
      td.innerHTML = '';
      const np = doc.createElement('p');
      np.className = cls;
      np.textContent = txt;
      td.appendChild(np);
      n++;
    };
    const trs = tab.querySelectorAll('tr');
    for (let i = 0; i < trs.length; i++) {
      const tds = trs[i].querySelectorAll('td');
      if (!tds.length) continue;
      const rot = P.chave(P.texto(tds[0]));
      if (/^CREDITO$/.test(rot) && tds.length >= 4) {
        if (d.sf003) escrever(tds[2], d.sf003);
        if (d.credito != null) escrever(tds[3], brlTxt(d.credito));
      } else if (/^SAQUE$/.test(rot) && tds.length >= 2) {
        escrever(tds[tds.length - 1], brlTxt(d.saque));
      } else if (/^SAQUE ?- ?OBK$/.test(rot) && tds.length >= 4) {
        if (d.sf002) escrever(tds[2], d.sf002);
        if (d.valorObk != null) escrever(tds[3], brlTxt(d.valorObk));
      }
    }
    return n;
  };

  /* ---------------- Planilha de saída (uma linha por NE de cada SF) ---------------- */
  P.COLUNAS_PLANILHA = ['Processo', 'Suprido', 'UG', 'Situação', 'Nº do SF', 'Data do registro', 'Nota de empenho',
    'Natureza', 'Valor (R$)', 'Tipo', 'Período', 'Destino', 'Solicitação SEI', 'Situação do registro', 'Operação'];
  // sfs: SF da fila (prepararFila / montarConcessao); registrados: GM 'sf_registrados' (id do SF → { numero, em, ... })
  P.linhasPlanilha = (sfs, registrados) => {
    const linhas = [];
    for (const sf of sfs) {
      const r = (registrados || {})[sf.id] || null;
      const data = r ? (r.data || (r.em ? r.em.slice(8, 10) + '/' + r.em.slice(5, 7) + '/' + r.em.slice(0, 4) : '')) : '';
      for (const it of sf.itens || []) {
        const reforco = sf.operacao === 'reforco';
        linhas.push([sf.processo, sf.nomeSuprido || (r && r.nomeCredor) || '', sf.ug, sf.situacao, reforco ? sf.sfNumero || '' : r ? r.numero || '' : '', data,
          it.ne, it.nd || '', brl(it.valor), sf.tipo || '', sf.periodo || '', sf.destino || '',
          (sf.origem && sf.origem.solicitacao) || '', r ? (reforco ? 'alterado' : 'registrado') : (reforco ? 'não alterado' : 'não registrado'),
          reforco ? 'reforço' : 'concessão']);
      }
    }
    return linhas;
  };
  // CSV para o Excel em português: separador ";", BOM UTF-8, campos entre aspas quando preciso
  P.csv = linhas => '\ufeff' + linhas.map(l => l.map(v => {
    const t = String(v == null ? '' : v);
    return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }).join(';')).join('\r\n') + '\r\n';

  if (typeof module === 'object' && module.exports) { module.exports = { P, VERSAO }; return; }

  // O SIAFI tem um iframe oculto (/siafi/blank.html) que também casa com o @match.
  // Sem esta trava, uma segunda cópia do script rodava dentro dele e disputava o estado.
  if (window.top !== window.self) return;

  /* ======================================================================
   * Configuração
   * ==================================================================== */
  const CONFIG_PADRAO = {
    modeloObs: 'CONCESSÃO SUPRIMENTO DE FUNDOS - PERIODO {periodo} - PROCESSO {processo} - TIPO {tipo}{destino}',
    subelemento: '96',
    // reforço (CONDH): "Motivo/Observação" da janela de confirmação da alteração (máx. 468, sem ¬<&>"';=%#)
    modeloMotivo: 'REFORÇO DE CONCESSÃO DE SUPRIMENTO DE FUNDOS - PROCESSO {processo}',
    timeoutAjax: 30000,
    timeoutMainframe: 120000,
  };
  const config = () => Object.assign({}, CONFIG_PADRAO, GM_getValue('sf_config', {}));

  const F = 'form_manterDocumentoHabil:';
  const el = id => document.getElementById(F + id);
  const esperar = ms => new Promise(r => setTimeout(r, ms));

  /* ======================================================================
   * Estado persistente (sobrevive às recargas de página)
   * ==================================================================== */
  const estado = {
    ler: () => GM_getValue('sf_estado', null),
    salvar: e => GM_setValue('sf_estado', e),
    limpar: () => GM_deleteValue('sf_estado'),
  };
  function atualizar(parcial) {
    const e = Object.assign(estado.ler() || {}, parcial);
    estado.salvar(e);
    return e;
  }
  function registrarLog(msg, tipo = 'info') {
    const e = estado.ler() || {};
    e.log = (e.log || []).concat({ t: new Date().toLocaleTimeString('pt-BR'), msg, tipo }).slice(-200);
    estado.salvar(e);
    renderizarLog();
  }

  /* ======================================================================
   * Utilidades de formato
   * ==================================================================== */
  const hoje = () => new Date().toLocaleDateString('pt-BR');
  // O SIAFI carrega a Prototype.js 1.6 (RichFaces 3.3.3), que SUBSTITUI métodos nativos de Array:
  // reduce (numa lista de 1 item devolve o próprio item, não a soma), entries (vira uma cópia da lista)
  // e às vezes toJSON (JSON.stringify de lista vira texto). Não usar esses métodos neste script;
  // usar soma(), laços for e jsonTexto(). (Erro "valor total do SF: null" das v0.1.5 a v0.1.9.)
  const soma = lista => { let s = 0; for (const x of lista) s += x; return s; };
  function jsonTexto(v, espaco) {
    const toJSON = Array.prototype.toJSON;
    if (toJSON) delete Array.prototype.toJSON;
    try { return JSON.stringify(v, null, espaco); } finally { if (toJSON) Array.prototype.toJSON = toJSON; }
  }
  const metodoNativo = f => typeof f === 'function' && /\[native code\]/.test(Function.prototype.toString.call(f));

  function fmtBR(n, rotulo = 'valor') {
    const v = typeof n === 'string' ? parseBR(n) : n;
    if (typeof v !== 'number' || !isFinite(v)) throw new Error(`Valor inválido em "${rotulo}": ${typeof n === 'object' ? jsonTexto(n) : String(n)}`);
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const parseBR = s => Number(String(s).replace(/[^\d,-]/g, '').replace(',', '.')) || 0;
  const centavos = n => Math.round(n * 100) / 100;
  const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

  function montarObservacao(modelo, dados) {
    let txt = modelo.replace(/\{(\w+)\}/g, (m, k) => (dados[k] ?? m));
    const sobrou = txt.match(/\{\w+\}/g);
    if (sobrou) throw new Error('Marcador sem valor na observação: ' + sobrou.join(', '));
    txt = txt.replace(/[¬<&>"';=%#]/g, '').replace(/\s+/g, ' ').trim();
    if (txt.length > 468) throw new Error(`Observação com ${txt.length} caracteres (máximo 468)`);
    return txt;
  }

  /* ======================================================================
   * Espera de AJAX e leitura de mensagens do SIAFI
   * ==================================================================== */
  function visivel(idContainer) {
    const c = document.getElementById(idContainer);
    return !!c && c.style.display !== 'none';
  }

  async function aguardarModal(idContainer, timeout, tempoParaAbrir = 1500) {
    const inicio = Date.now();
    while (!visivel(idContainer) && Date.now() - inicio < tempoParaAbrir) await esperar(100);
    while (visivel(idContainer)) {
      if (Date.now() - inicio > timeout) throw new Error('TIMEOUT:' + idContainer);
      await esperar(200);
    }
    await esperar(150); // deixa o RichFaces terminar de redesenhar
  }
  const aguardarAjax = () => aguardarModal('mpStatusContainer', config().timeoutAjax);
  const aguardarMainframe = () =>
    aguardarModal('ajaxCarregandoMainframeSubview:carregandoMainframeContainer', config().timeoutMainframe, 10000);

  function lerMensagensSiafi() {
    const msgs = [];
    document.querySelectorAll('dl.rich-messages').forEach(dl => {
      if (dl.style.display === 'none') return;
      const t = P.texto(dl);
      if (t) msgs.push(t);
    });
    const ol = document.querySelector('#divMsgErro ol');
    if (ol && ol.style.display !== 'none' && P.texto(ol)) msgs.push(P.texto(ol));
    ['modal_erro_DH', 'modal_alerta_DH'].forEach(m => {
      if (visivel(m + 'Container')) msgs.push(P.texto(document.getElementById(m + '_mensagem')) || m);
    });
    return [...new Set(msgs)].join(' | ');
  }

  async function clicarEAguardar(id) {
    const b = el(id);
    if (!b) throw new Error('Botão não encontrado: ' + id);
    if (b.disabled) throw new Error('Botão desabilitado: ' + id);
    b.click();
    await aguardarAjax();
  }

  async function preencherComBlur(id, valor) {
    const c = el(id);
    if (!c) throw new Error('Campo não encontrado: ' + id);
    c.value = valor;
    c.dispatchEvent(new Event('blur'));
    await aguardarAjax();
  }

  function preencher(id, valor) {
    const c = el(id);
    if (!c) throw new Error('Campo não encontrado: ' + id);
    c.value = valor;
  }

  // Digita como o Selenium (send_keys): foco, apaga o conteúdo (o Selenium dá duplo clique para
  // selecionar o que já estava no campo) e envia keydown/keypress/input/keyup por caractere.
  // Campos com máscara tratam o keypress e escrevem o valor eles mesmos (cancelando o evento);
  // se nenhum tratador cancelar, o caractere é inserido aqui.
  function eventoTecla(tipo, ch) {
    const ev = new KeyboardEvent(tipo, { key: ch, bubbles: true, cancelable: true });
    const cod = tipo === 'keypress' ? ch.charCodeAt(0) : ch.toUpperCase().charCodeAt(0);
    // scripts antigos leem keyCode/which/charCode, que o construtor não deixa definir
    Object.defineProperty(ev, 'keyCode', { get: () => cod });
    Object.defineProperty(ev, 'which', { get: () => cod });
    Object.defineProperty(ev, 'charCode', { get: () => (tipo === 'keypress' ? cod : 0) });
    return ev;
  }

  function digitar(c, texto) {
    c.focus();
    c.value = '';
    for (const ch of String(texto)) {
      c.dispatchEvent(eventoTecla('keydown', ch));
      if (c.dispatchEvent(eventoTecla('keypress', ch))) {
        c.value += ch;
        c.dispatchEvent(new Event('input', { bubbles: true }));
      }
      c.dispatchEvent(eventoTecla('keyup', ch));
    }
    c.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Digita e confere o que ficou no campo. Se a máscara deixou algo diferente do esperado,
  // grava o valor esperado direto (comportamento das versões anteriores) e avisa no log.
  // `comBlur`: dispara o blur (gatilho AJAX de vários campos do SIAFI) e espera o AJAX.
  async function digitarConferindo(campo, texto, esperado = texto, { comBlur = false, rotulo } = {}) {
    const c = typeof campo === 'string' ? el(campo) : campo;
    if (!c) throw new Error('Campo não encontrado: ' + (rotulo || campo));
    digitar(c, texto);
    if (c.value !== esperado) {
      registrarLog(`Campo ${rotulo || c.id}: digitado ficou "${c.value}", gravando "${esperado}"`, 'aviso');
      c.value = esperado;
      c.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (comBlur) {
      c.dispatchEvent(new Event('blur'));
      await aguardarAjax();
    }
  }

  // Equivalente ao espera_aparecer do Selenium, com limite de tempo.
  async function aguardarElemento(seletor, timeout = config().timeoutAjax) {
    const inicio = Date.now();
    for (;;) {
      const e = document.querySelector(seletor);
      if (e) return e;
      if (Date.now() - inicio > timeout) return null;
      await esperar(250);
    }
  }

  // Valor no formato do SIAFI digitado só com algarismos (como o Selenium: 10,00 → "1000");
  // a máscara do campo coloca a vírgula e os pontos.
  const digitosValor = (n, rotulo) => fmtBR(n, rotulo).replace(/\D/g, '');

  /* ======================================================================
   * Navegação (acesso rápido e troca de UG) — recarregam a página
   * ==================================================================== */
  const ugAtual = () => document.querySelector('.textUG span')?.textContent.trim();
  // No JSF a URL do navegador fica "um passo atrás" (o POST renderiza a tela nova no endereço antigo).
  // Por isso a tela é identificada pelo conteúdo, nunca pela URL.
  const naTelaTrocaUG = () => !!document.getElementById('formTrocaDeUg');
  const naTelaINCDH = () => !!document.getElementById('form_manterDocumentoHabil') &&
    /INCDH/.test(document.getElementById('title')?.textContent || '');

  function acessoRapido(mnemonico) {
    const campo = document.getElementById('frmMenu:acessoRapido');
    const botao = document.getElementById('frmMenu:botaoAcessoRapidoVerificaTipoTransacao');
    if (!campo || !botao) throw new Error('Acesso rápido não encontrado nesta página');
    campo.value = mnemonico;
    botao.click();
  }

  function abrirTrocaUG() {
    // O item "Configurar Acesso" só abre o submenu; a ação está no link filho "Trocar UG".
    // O ID desse link muda entre telas (j_id44, j_id45, j_id46...), por isso a busca é pelo texto.
    const link = [...document.querySelectorAll('#horizontalMenu a')]
      .find(a => a.textContent.trim() === 'Trocar UG');
    if (!link) throw new Error('Link "Trocar UG" não encontrado no menu Configurar Acesso');
    // abre o submenu como se o mouse passasse por cima (para o caso de o SIAFI exigir o menu visível)
    const pai = link.closest('ul')?.closest('li');
    if (pai) pai.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    link.click();
  }

  async function trocarUG(ugDestino) {
    const sel = document.getElementById('formTrocaDeUg:selectCodUG');
    if (!sel) throw new Error('Tela de troca de UG não encontrada');
    const permitidas = [...new Set([...sel.options].map(o => o.value))];
    if (!permitidas.includes(ugDestino)) throw new Error(`Usuário sem acesso à UG ${ugDestino}`);

    // espera a tela terminar as rotinas de carregamento do próprio SIAFI
    if (document.readyState !== 'complete') await new Promise(r => window.addEventListener('load', r, { once: true }));
    await esperar(800);

    sel.focus();
    // marca só a primeira option com a UG pedida (a lista traz 110001 duplicada, ambas com selected)
    let marcou = false;
    [...sel.options].forEach(o => {
      const alvo = !marcou && o.value === ugDestino;
      if (alvo) marcou = true;
      o.selected = alvo;
      if (alvo) o.setAttribute('selected', 'selected'); else o.removeAttribute('selected');
    });
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (sel.value !== ugDestino) throw new Error(`Não foi possível selecionar a UG ${ugDestino} na lista`);
    registrarLog(`UG ${ugDestino} selecionada; confirmando a troca`);

    document.getElementById('formTrocaDeUg:btnConfirmarAlteracao').click();

    // Se a troca for aceita, a página recarrega e este código nunca chega aqui.
    await esperar(8000);
    const msgTela = P.texto(document.querySelector('#container ol'));
    throw new Error('O SIAFI não enviou a troca de UG (a página não recarregou). ' +
      (msgTela || lerMensagensSiafi() || 'Nenhuma mensagem na tela.'));
  }

  /* ======================================================================
   * Emissão de um SF (tudo por AJAX, dentro da mesma página)
   * ==================================================================== */
  async function etapaTipoDocumento() {
    preencher('codigoTipoDocHabil_input', 'SF');
    el('codigoTipoDocHabil_input').dispatchEvent(new Event('blur'));
    await aguardarAjax();
    const titulo = el('tituloTipoDocHabil')?.textContent.trim();
    if (titulo !== 'SUPRIMENTO DE FUNDOS') throw new Error('Tipo SF não reconhecido: ' + titulo);
    await clicarEAguardar('btnConfirmarTipoDoc');
    if (!el('pagadoraRecebedora_input')) throw new Error('Dados Básicos não abriram. ' + lerMensagensSiafi());
  }

  async function etapaDadosBasicos(job) {
    const d = hoje();
    if (el('pagadoraRecebedora_input').value !== job.ug) await preencherComBlur('pagadoraRecebedora_input', job.ug);
    preencher('dataEmissao_calendarInputDate', d);
    preencher('dataVencimento_calendarInputDate', d);
    preencher('dataAteste_calendarInputDate', d);
    preencher('processo_input', job.processo);
    await digitarConferindo('valorPrincipalDocumento_input', digitosValor(job.valorTotal, 'valor total do SF'),
      fmtBR(job.valorTotal, 'valor total do SF'), { rotulo: 'valor do documento' });

    await preencherComBlur('credorDevedor_input', job.cpf.replace(/\D/g, ''));
    const nome = el('nomeCredorDevedor')?.textContent.trim();
    if (!nome) throw new Error('CPF do suprido não reconhecido pelo SIAFI: ' + job.cpf);
    if (job.nomeSuprido && !normalizar(nome).includes(normalizar(job.nomeSuprido).split(' ')[0])) {
      throw new Error(`Nome do credor no SIAFI (${nome}) não confere com o suprido (${job.nomeSuprido})`);
    }
    job.nomeCredor = nome;
    registrarLog('Credor: ' + nome);

    el('observacao').value = job.observacao;
    registrarLog('Observação: ' + job.observacao);
    await clicarEAguardar('btnConfirmarDadosBasicos');

    if (!el('campo_situacao_input')) {
      // fallback: abre a aba PCO manualmente
      if (el('abaPrincipalComOrcamentoId') && !el('abaPrincipalComOrcamentoId').disabled) {
        await clicarEAguardar('abaPrincipalComOrcamentoId');
      }
      if (!el('campo_situacao_input')) throw new Error('Dados Básicos não confirmados. ' + lerMensagensSiafi());
    }
  }

  async function incluirItensPCO(itens, { sempreIncluir = false } = {}) {
    const SEL_NE = '[id$=":PCO_item_num_empenho_input"]';
    const SEL_GRAVADO = '[id$=":PCO_item_num_empenho_header"]';
    for (let n = 0; n < itens.length; n++) {
      const it = itens[n];
      const antes = document.querySelectorAll(SEL_GRAVADO).length;
      // A linha 0 abre sozinha depois de confirmar a situação (o Selenium espera ~2 s por ela);
      // as seguintes só depois de clicar em Incluir (no CONDH, todas).
      let campoNE = await aguardarElemento(SEL_NE, n === 0 && !sempreIncluir ? 3000 : 0);
      if (!campoNE) {
        await clicarEAguardar('lista_PCO_painel_incluir');
        campoNE = await aguardarElemento(SEL_NE);
        if (!campoNE) throw new Error('O botão Incluir não abriu a linha do item. ' + lerMensagensSiafi());
      }
      const prefixo = campoNE.id.replace('PCO_item_num_empenho_input', '');
      const valor = fmtBR(it.valor, 'valor da NE ' + it.ne);
      // mesma ordem do Selenium: NE, subitem, valor
      await digitarConferindo(campoNE, it.ne.toUpperCase(), it.ne.toUpperCase(), { comBlur: true, rotulo: 'NE' });
      await digitarConferindo(document.getElementById(prefixo + 'PCO_item_num_subitem_input'),
        config().subelemento, config().subelemento, { rotulo: 'subitem' });
      await digitarConferindo(document.getElementById(prefixo + 'PCO_item_valor_item_input'),
        digitosValor(it.valor, 'valor da NE ' + it.ne), valor, { rotulo: 'valor da NE ' + it.ne });

      await clicarEAguardar('lista_PCO_painel_confirmar');
      const gravados = [...document.querySelectorAll(SEL_GRAVADO)].map(e => e.textContent.trim());
      if (!gravados.includes(it.ne.toUpperCase()) || gravados.length !== antes + 1) {
        throw new Error(`SIAFI não aceitou a NE ${it.ne}. ` + lerMensagensSiafi());
      }
      registrarLog(`Item incluído: ${it.ne} – R$ ${fmtBR(it.valor, 'valor da NE ' + it.ne)}`);
    }
  }

  async function etapaPCO(job) {
    await digitarConferindo('campo_situacao_input', job.situacao.toUpperCase(), job.situacao.toUpperCase(),
      { rotulo: 'situação' });
    await clicarEAguardar('botao_ConfirmarSituacao');
    await aguardarElemento('[id="' + F + 'codigoSituacao"]', 5000);
    const sit = el('codigoSituacao')?.textContent.trim();
    if (sit !== job.situacao.toUpperCase()) throw new Error(`Situação ${job.situacao} não aceita. ` + lerMensagensSiafi());
    registrarLog(`Situação ${sit} – ${el('PCO_nome_situacao')?.textContent.trim()}`);

    const campoUG = el('codigoUGEmpenho_input');
    if (campoUG && campoUG.value !== job.ug) await preencherComBlur('codigoUGEmpenho_input', job.ug);
    if (!el('nomeUGEmpenho')?.textContent.trim()) throw new Error('UG do empenho inválida: ' + job.ug);

    await incluirItensPCO(job.itens);

    const total = el('collapseTotaisPCO_valor_total')?.textContent.trim();
    if (total !== fmtBR(job.valorTotal, 'valor total do SF')) {
      throw new Error(`Total da PCO (${total}) diferente do valor do documento (${fmtBR(job.valorTotal)})`);
    }
  }

  // Registro: depois do clique em Registrar, qualquer falha é INDETERMINADA (o SF pode ter sido registrado) – nunca
  // repetir sozinho. O estado guarda 'registrando' antes do clique: se a página recarregar no meio, executar() também
  // marca como indeterminado. Só é erro "normal" (pode tentar de novo) a recusa da validação, antes de o pedido ir ao
  // mainframe (a barra "Processando..." não chegou a aparecer).
  async function etapaRegistrar(job, botao = 'btnRegistrar') {
    const b = el(botao);
    if (!b) throw new Error('Botão de registro não encontrado: ' + botao);
    const msgAntes = lerMensagensSiafi();
    const MAINFRAME = 'ajaxCarregandoMainframeSubview:carregandoMainframeContainer';
    atualizar({ registrando: { jobId: job.id, em: new Date().toISOString() } });
    b.click();
    let viuMainframe = false, res = null, msg = '';
    const limite = Date.now() + config().timeoutMainframe + 20000;
    while (Date.now() < limite) {
      await esperar(300);
      if (visivel(MAINFRAME)) viuMainframe = true;
      if (visivel(F + 'modalResultadoRegistrarContainer') || document.getElementById('modalRegistrarCodigoDocumentoHabil')) {
        res = P.resultadoRegistro(document);
        if (res) break;
      }
      const m = lerMensagensSiafi();
      if (m && m !== msgAntes && !visivel('mpStatusContainer') && !visivel(MAINFRAME)) { msg = m; break; }
    }
    if (!res) {
      if (msg && !viuMainframe) {
        atualizar({ registrando: null });
        throw new Error('O SIAFI recusou o registro (nada foi registrado): ' + msg);
      }
      registrarLog(`Registro sem confirmação${msg ? ': ' + msg : ' (a janela de resultado não apareceu)'}`, 'erro');
      throw new Error('INDETERMINADO');
    }
    gravarRegistroSF(job, res.numero, { documentos: res.documentos, data: res.data });
    atualizar({ registrando: null });
    registrarLog(`SIAFI registrou ${res.numero}${res.documentos.length ? ' (' + res.documentos.join(', ') + ')' : ''}`, 'ok');
    // fecha a janela de resultado (botão Retornar)
    const ret = el('btnRetornarResultadoRegistrar');
    if (ret) { ret.click(); await aguardarAjax(); }
    return {
      numero: res.numero, data: res.data, documentos: res.documentos,
      ugEmitente: el('ugEmitente_output')?.textContent.trim() || job.ug,
    };
  }

  async function emitirSF(job, modoTeste) {
    if (ugAtual() !== job.ug) throw new Error(`UG do login (${ugAtual()}) diferente da UG do SF (${job.ug})`);
    registrarLog(`Iniciando SF ${job.id} – ${job.situacao} – R$ ${fmtBR(job.valorTotal, 'valor total do SF')}`);
    const etapas = [
      ['tipo de documento', () => etapaTipoDocumento()],
      ['dados básicos', () => etapaDadosBasicos(job)],
      ['PCO', () => etapaPCO(job)],
    ];
    if (!modoTeste) etapas.push(['registro', () => etapaRegistrar(job)]);
    let r = { teste: true };
    for (const [nome, fn] of etapas) {
      registrarLog('Etapa: ' + nome);
      try { r = (await fn()) || r; }
      catch (err) {
        if (err.message === 'INDETERMINADO') throw err;
        throw new Error(`[${nome}] ${err.message}`);
      }
    }
    return r;
  }

  /* ======================================================================
   * Reforço: alteração do SF pelo CONDH (capturas de 07/10/2026, SF 2026SF000073)
   * CONDH (formConsultarDH: UG emitente, ano, tipo, número → Pesquisar, recarrega) → "CONDH: Detalhar" →
   * "Alterar Documento Hábil" (AJAX) → aba PCO (situação e UG do empenho fixas) → Incluir uma linha por NE →
   * "Registrar Alterações" → janela com data de emissão e Motivo/Observação → Confirmar (mainframe) →
   * "Resultado do Registrar": "Número do Documento Hábil Atualizado: 2026SF000073" → Retornar.
   * ==================================================================== */
  const naTelaCONDH = () => !!document.getElementById('formConsultarDH');
  const naTelaDetalheDH = () => !!document.getElementById('form_manterDocumentoHabil') &&
    /CONDH/.test(document.getElementById('title')?.textContent || '');
  const etapaDoSF = job => (job && job.operacao === 'reforco' ? 'irCONDH' : 'irINCDH');
  async function aguardarVisivel(idContainer, timeout) {
    const fim = Date.now() + timeout;
    while (Date.now() < fim) { if (visivel(idContainer)) return true; await esperar(200); }
    return false;
  }

  // Tela de consulta do CONDH: preenche e pesquisa (o botão é submit: a página recarrega no detalhe do SF)
  async function pesquisarCONDH(job) {
    const c = id => document.getElementById('formConsultarDH:' + id);
    const ano = job.sfNumero.slice(0, 4), num = job.sfNumero.slice(6);
    if (c('ugEmitente_input') && c('ugEmitente_input').value !== job.ug) {
      c('ugEmitente_input').value = job.ug;
      c('ugEmitente_input').dispatchEvent(new Event('blur'));
      await aguardarAjax();
    }
    await digitarConferindo(c('anoDH_input'), ano, ano, { rotulo: 'ano do documento' });
    await digitarConferindo(c('tipoDH_input'), 'SF', 'SF', { rotulo: 'tipo do documento' });
    await digitarConferindo(c('numeroDH_input'), num, num, { rotulo: 'número do documento' });
    atualizar({ etapa: 'noDetalheDH' });
    registrarLog(`CONDH: pesquisando ${job.sfNumero} na UG ${job.ug}`);
    c('btnConsultar').click();
  }

  // Detalhe do SF aberto pelo CONDH: altera só a aba PCO, incluindo as NEs do reforço
  async function reforcarSF(job, modoTeste) {
    const num = (el('numeroDocumentoHabil_outputText')?.textContent || '').trim();
    if (Number(num) !== Number(job.sfNumero.slice(6)) || !/SUPRIMENTO/i.test(el('tituloTipoDocHabil')?.textContent || '')) {
      throw new Error(`O CONDH abriu o documento "${num}" (${el('tituloTipoDocHabil')?.textContent.trim() || '?'}), esperado ${job.sfNumero}`);
    }
    const ugEm = el('ugEmitente_output')?.textContent.trim();
    if (ugEm && ugEm !== job.ug) throw new Error(`O ${job.sfNumero} aberto é da UG ${ugEm}, esperado ${job.ug}`);
    registrarLog(`CONDH: ${job.sfNumero} aberto (${el('otStatus')?.textContent.trim() || 'situação ?'}) – reforço ${job.situacao} de R$ ${fmtBR(job.valorTotal, 'valor do reforço')}`);
    await clicarEAguardar('btnAlterarDocumentoHabil');
    if (!await aguardarElemento('[id="' + F + 'btnRegistrarAlteracaoDocumentoHabil"]', 15000)) {
      throw new Error('O SIAFI não entrou no modo de alteração. ' + lerMensagensSiafi());
    }
    await clicarEAguardar('abaPrincipalComOrcamentoId');
    if (!await aguardarElemento('[id="' + F + 'lista_PCO_painel_incluir"]', 15000)) throw new Error('A aba PCO não abriu. ' + lerMensagensSiafi());
    const sit = (el('codigoSituacao')?.textContent || '').trim();
    if (sit !== job.situacao) throw new Error(`O ${job.sfNumero} é da situação ${sit || '?'}; o reforço pedido é ${job.situacao}`);
    const ugNE = (el('codigoUGEmpenho_output')?.textContent || '').trim();
    if (job.ugEmpenho && ugNE && ugNE !== job.ugEmpenho) {
      throw new Error(`A UG do empenho do ${job.sfNumero} é ${ugNE}, mas as NEs do reforço são da UG ${job.ugEmpenho} – o reforço não pode ser lançado`);
    }
    const totalAntes = parseBR(el('collapseTotaisPCO_valor_total')?.textContent);
    await incluirItensPCO(job.itens, { sempreIncluir: true });
    const total = parseBR(el('collapseTotaisPCO_valor_total')?.textContent);
    if (centavos(total) !== centavos(totalAntes + job.valorTotal)) {
      throw new Error(`Total da PCO (${fmtBR(total)}) diferente de ${fmtBR(totalAntes)} + reforço ${fmtBR(job.valorTotal)}`);
    }
    registrarLog(`PCO: R$ ${fmtBR(totalAntes)} + reforço R$ ${fmtBR(job.valorTotal)} = R$ ${fmtBR(total)}`);
    if (modoTeste) return { teste: true };
    await clicarEAguardar('btnRegistrarAlteracaoDocumentoHabil');
    if (!await aguardarVisivel(F + 'modalAlterarDocHabilContainer', 15000)) {
      throw new Error('A janela de confirmação da alteração não abriu. ' + lerMensagensSiafi());
    }
    const motivo = montarObservacao(config().modeloMotivo, { processo: job.processo, sf: job.sfNumero });
    const caixa = el('txtModalAlteracaoMotivo');
    if (!caixa) throw new Error('Campo Motivo/Observação não encontrado');
    caixa.value = motivo;
    ['input', 'keyup', 'change'].forEach(t => caixa.dispatchEvent(new Event(t, { bubbles: true })));
    registrarLog('Motivo: ' + motivo);
    return etapaRegistrar(job, 'btnModalAlteracaoConfirmar');
  }

  /* ======================================================================
   * Máquina de estados: executa um passo a cada carregamento de página
   * ==================================================================== */
  // Registro permanente dos SF já registrados (separado da fila, que pode ser reiniciada ou ficar desatualizada):
  // chave = id do SF na fila (ex.: "7915163-SPF003"). Antes de começar qualquer SF, o script confere este registro e
  // pula o que já foi registrado – nunca registra o mesmo SF duas vezes (v0.2.4, depois de um SPF003 repetido).
  const registroSF = () => GM_getValue('sf_registrados', {});
  function gravarRegistroSF(job, numero, extra = {}) {
    const reg = registroSF();
    // guarda também os dados da planilha (o SF pode sair da fila depois)
    reg[job.id] = Object.assign({ numero, situacao: job.situacao, processo: job.processo, ug: job.ug,
      valor: job.valorTotal, itens: job.itens, nomeSuprido: job.nomeSuprido || '', nomeCredor: job.nomeCredor || '',
      tipo: job.tipo || '', periodo: job.periodo || '', destino: job.destino || '', origem: job.origem || null,
      em: new Date().toISOString() }, extra);
    GM_setValue('sf_registrados', reg);
  }

  function proximaEtapa(e) {
    const job = e.fila[e.idx];
    if (!job) {
      const n = (e.resultados || []).filter(r => r.status === 'registrado').length;
      registrarLog(`Fila concluída: ${e.fila.length} SF na fila${e.modoTeste ? '' : `, ${n} registrado(s)`}.`, 'ok');
      return 'concluido';
    }
    return ugAtual() === job.ug ? etapaDoSF(job) : 'irTrocaUG';
  }

  async function executar() {
    let e = estado.ler();
    if (!e || !e.fila || ['ocioso', 'pausado', 'concluido'].includes(e.etapa)) return;
    let job = e.fila[e.idx];

    try {
      // A página recarregou (ou o script reiniciou) no meio de um registro: pode ter registrado – não repetir.
      // (se o número já foi lido e guardado no registro permanente, não há dúvida: o SF é pulado logo abaixo)
      if (e.registrando && !(job && registroSF()[job.id])) {
        registrarLog('A página recarregou durante o registro deste SF', 'erro');
        throw new Error('INDETERMINADO');
      }
      // Revalida o SF salvo (total, observação etc.) em vez de confiar na fila guardada: uma fila de versão
      // anterior retomada com "Tentar este SF de novo" chegava com valorTotal nulo (erro da v0.1.5/v0.1.6).
      if (job) job = prepararFila([job])[0];
      // SF já registrado (registro permanente): pula, nunca registra de novo
      const ja = job && !e.modoTeste && registroSF()[job.id];
      if (ja) {
        registrarLog(`SF ${job.id} já foi registrado como ${ja.numero || '(nº não informado)'} – pulando`, 'aviso');
        const x = estado.ler();
        if (!(x.resultados || []).some(r => r.jobId === job.id && r.status === 'registrado')) {
          x.resultados = (x.resultados || []).concat({ numero: ja.numero, jobId: job.id, situacao: job.situacao, itens: job.itens,
            status: 'registrado', jaRegistrado: true, processo: job.processo, ug: job.ug, origem: job.origem || null });
        }
        x.idx += 1;
        x.registrando = null;
        estado.salvar(x);
        atualizar({ etapa: proximaEtapa(estado.ler()) });
        renderizarPainel();
        return executar();
      }
      switch (e.etapa) {
        case 'irTrocaUG':
          atualizar({ etapa: 'naTrocaUG' });
          registrarLog(`Trocando para a UG ${job.ug}`);
          return abrirTrocaUG();

        case 'naTrocaUG':
          if (!naTelaTrocaUG()) throw new Error('Esperava a tela de troca de UG (formulário não encontrado)');
          atualizar({ etapa: 'conferirUG' });
          await trocarUG(job.ug);
          return;

        case 'conferirUG':
          if (ugAtual() !== job.ug) throw new Error(`Troca de UG falhou: login em ${ugAtual()}, esperado ${job.ug}`);
          registrarLog(`UG ${job.ug} ativa`);
          atualizar({ etapa: etapaDoSF(job) });
          return executar();

        case 'irINCDH':
          atualizar({ etapa: 'noINCDH' });
          return acessoRapido('INCDH');

        case 'noINCDH': {
          if (!naTelaINCDH()) throw new Error('Esperava a tela INCDH (formulário não encontrado)');
          // Espera a tela terminar de carregar antes de preencher o tipo de documento.
          registrarLog(`v${VERSAO}: tela INCDH aberta, aguardando carregar`);
          if (document.readyState !== 'complete') await new Promise(r => window.addEventListener('load', r, { once: true }));
          if (!await aguardarElemento('[id="' + F + 'codigoTipoDocHabil_input"]', 15000)) {
            throw new Error('Campo do tipo de documento não apareceu na tela INCDH');
          }
          await esperar(1000);
          return concluirSF(job, await emitirSF(job, e.modoTeste));
        }

        case 'irCONDH':
          atualizar({ etapa: 'noCONDH' });
          return acessoRapido('CONDH');

        case 'noCONDH': {
          if (!naTelaCONDH()) throw new Error('Esperava a tela de consulta do CONDH (formulário não encontrado)');
          if (document.readyState !== 'complete') await new Promise(r => window.addEventListener('load', r, { once: true }));
          if (!await aguardarElemento('[id="formConsultarDH:numeroDH_input"]', 15000)) throw new Error('Campo do número do documento não apareceu no CONDH');
          await esperar(500);
          return pesquisarCONDH(job);
        }

        case 'noDetalheDH': {
          if (document.readyState !== 'complete') await new Promise(r => window.addEventListener('load', r, { once: true }));
          if (!naTelaDetalheDH() || !await aguardarElemento('[id="' + F + 'btnAlterarDocumentoHabil"]', 15000)) {
            throw new Error(`O CONDH não abriu o ${job.sfNumero}. ${lerMensagensSiafi()}`);
          }
          await esperar(1000);
          let r;
          try { r = await reforcarSF(job, e.modoTeste); } catch (err) {
            if (err.message === 'INDETERMINADO') throw err;
            throw new Error('[reforço] ' + err.message);
          }
          return concluirSF(job, r);
        }
      }
      if (e.etapa === 'concluido') { abrirPainel(); return; }
    } catch (err) {
      tratarErro(err, job);
    }
  }

  // fim de um SF (emissão ou reforço): modo teste pausa; registrado → resultado e próximo SF
  function concluirSF(job, r) {
    const e = estado.ler();
    const reforco = job.operacao === 'reforco';
    if (r.teste) {
      registrarLog(reforco ? `Modo teste: reforço do ${job.sfNumero} preenchido e NÃO registrado. Confira a tela e clique em "Cancelar Alterações".`
        : `Modo teste: SF ${job.id} preenchido e NÃO registrado. Confira a tela.`, 'aviso');
      atualizar({ etapa: 'pausado', motivo: 'teste' });
      return renderizarPainel();
    }
    registrarLog(reforco ? `Reforço registrado: ${r.numero} atualizado` : `SF registrado: ${r.numero} (UG ${r.ugEmitente})`, 'ok');
    e.resultados = (e.resultados || []).concat({ ...r, jobId: job.id, situacao: job.situacao,
      valor: job.valorTotal, itens: job.itens, status: 'registrado',
      processo: job.processo, ug: job.ug, origem: job.origem || null });
    e.idx += 1;
    estado.salvar(e);
    atualizar({ etapa: proximaEtapa(estado.ler()) });
    renderizarPainel();
    return executar();
  }

  function tratarErro(err, job) {
    const indeterminado = err.message === 'INDETERMINADO';
    const msg = indeterminado
      ? `SF ${job.id}: o SIAFI não confirmou o registro a tempo. Situação indeterminada – confira no SIAFI antes de repetir.`
      : `Erro no SF ${job?.id}: ${err.message}`;
    registrarLog(msg, 'erro');
    const e = estado.ler();
    if (indeterminado) {
      e.resultados = (e.resultados || []).concat({ jobId: job.id, situacao: job.situacao, status: 'indeterminado',
        processo: job.processo, ug: job.ug, origem: job.origem || null });
    }
    e.registrando = null;
    e.etapa = 'pausado';
    e.motivo = indeterminado ? 'indeterminado' : 'erro';
    estado.salvar(e);
    renderizarPainel();
    abrirPainel();
  }

  /* ======================================================================
   * Entrada de dados (v0.1: JSON) e validação da fila
   * ==================================================================== */
  const EXEMPLO = [{
    id: 'teste-1', ug: '110809', situacao: 'SPF003', processo: '00150.000752/2026-02',
    cpf: '000.000.000-00', nomeSuprido: '', tipo: 'CPGF', periodo: '26/09/2026 A 26/10/2026', destino: '',
    itens: [{ ne: '2026NE000365', valor: 10.0 }],
  }];

  function prepararFila(lista) {
    const cfg = config();
    return lista.map((j, i) => {
      const obrig = j.operacao === 'reforco' ? ['ug', 'situacao', 'processo', 'sfNumero', 'itens'] : ['ug', 'situacao', 'processo', 'cpf', 'itens'];
      const faltando = obrig.filter(k => !j[k] || (Array.isArray(j[k]) && !j[k].length));
      if (j.operacao === 'reforco' && !/^\d{4}SF\d{6}$/.test(String(j.sfNumero || ''))) faltando.push('sfNumero no formato 2026SF000000');
      if (faltando.length) throw new Error(`Item ${i + 1}: faltam ${faltando.join(', ')}`);
      const itens = j.itens.map(it => ({ ne: String(it.ne).toUpperCase(), valor: centavos(Number(it.valor)) }));
      if (itens.some(it => !(it.valor > 0))) throw new Error(`Item ${i + 1}: NE com valor zero ou inválido`);
      if (itens.length > 50) throw new Error(`Item ${i + 1}: ${itens.length} NEs; o SIAFI aceita no máximo 50 itens na PCO`);
      const valorTotal = centavos(soma(itens.map(it => it.valor)));
      const observacao = montarObservacao(cfg.modeloObs, {
        periodo: j.periodo || '', processo: j.processo, tipo: j.tipo || '',
        destino: j.destino ? ' - DESTINO ' + j.destino : '',
      });
      return { ...j, id: j.id || `sf-${i + 1}`, ug: String(j.ug), itens, valorTotal, observacao };
    });
  }

  /* ======================================================================
   * Painel
   * ==================================================================== */
  // CSS do script dentro do painel DevDu (shadow DOM, isolado do CSS do SEI/SIAFI); .sf = seções das abas
  const CSS = `
    .secao.sf:not([hidden]){display:flex;flex-direction:column;gap:8px}
    .sf #sfLog:empty{display:none}
    .sf textarea{width:100%;box-sizing:border-box;font:12px Consolas,monospace;min-height:160px;white-space:pre;overflow:auto;resize:vertical}
    .sf button{background:var(--teal);color:#fff;border:0;border-radius:3px;padding:6px 10px;cursor:pointer;font-size:12px}
    .sf button.sec{background:#e6ecf1;color:var(--navy)}
    .sf button:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
    .sf .linha{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .sf .status{background:#f3f6f8;border-left:4px solid var(--teal);padding:6px 8px}
    .sf #sfLog{max-height:200px;overflow:auto;border:1px solid #d6dde3;padding:4px;font-size:12px}
    .sf #sfLog div{padding:1px 0}
    .sf #sfLog .erro{color:#a1260d} .sf #sfLog .ok{color:#1d6b2f} .sf #sfLog .aviso{color:#8a5a00}
    .sf .card{overflow-x:auto}
    .sf .card{border:1px solid #d6dde3;border-radius:3px;padding:6px 8px;display:flex;flex-direction:column;gap:4px}
    .sf .card.comErro{border-left:4px solid #a1260d} .sf .card.ok{border-left:4px solid #1d6b2f}
    .sf .card input,.sf .card select{font-size:12px;padding:2px 4px}
    .sf .card table{border-collapse:collapse;font-size:12px} .sf .card td,.sf .card th{border:1px solid #d6dde3;padding:1px 4px;text-align:right}
    .sf .card td:first-child,.sf .card th:first-child,.sf .card td:nth-child(2){text-align:left}
    .sf .msgErro{color:#a1260d} .sf .msgAviso{color:#8a5a00} .sf .peq{font-size:11px;color:#55636e}
    .sf .sf-titulo{font-size:14px;color:var(--navy);border-bottom:2px solid var(--teal);padding-bottom:3px}
    .sf .barra{display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:#f3f6f8;padding:6px;border-radius:3px}
    .sf .barra .dir{margin-left:auto;display:flex;gap:6px}
    .sf .status.ok{border-left-color:#1d6b2f} .sf .status.pausa{border-left-color:#a1260d}
    .sf details>summary{cursor:pointer;color:var(--navy);font-weight:bold;padding:2px 0}
    .sf .grupoUG{border:1px solid #d6dde3;border-radius:4px;overflow:hidden}
    .sf .tituloUG{display:flex;justify-content:space-between;gap:8px;background:#e6ecf1;color:var(--navy);padding:4px 8px}
    .sf .tituloUG span{font-size:12px}
    .sf table.sf{border-collapse:collapse;width:100%;font-size:12px}
    .sf table.sf th{text-align:left;background:#f3f6f8;color:#55636e;font-weight:normal;padding:3px 6px;border-bottom:1px solid #d6dde3}
    .sf table.sf td{padding:4px 6px;border-bottom:1px solid #eef1f4;vertical-align:top}
    .sf table.sf .num{text-align:right;white-space:nowrap}
    .sf table.sf .ne{display:flex;justify-content:space-between;gap:10px;white-space:nowrap}
    .sf table.sf td.st{white-space:nowrap;font-weight:bold;color:#55636e}
    .sf table.sf tr.ok td.st{color:#1d6b2f} .sf table.sf tr.erro td.st{color:#a1260d}
    .sf table.sf tr.aviso td.st{color:#8a5a00}
    .sf table.sf tr.andamento{background:#fff8dc} .sf table.sf tr.andamento td.st{color:var(--navy)}
    .sf .ferramentas{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px}
    .sf .card .cab{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .sf .card .cab .ic{font-weight:bold;width:14px}
    .sf .card.ok .cab .ic{color:#1d6b2f} .sf .card.comErro .cab .ic{color:#a1260d}
    .sf .card.pendente{border-left:4px solid var(--teal)} .sf .card.pendente .cab .ic{color:#b08a00}
    .sf .card .cab .proc{font-weight:bold;color:var(--navy)}
    .sf .selo{background:var(--teal);color:var(--navy);font-size:10px;font-weight:bold;padding:1px 5px;border-radius:3px}
    .sf .card .cab .resumo{margin-left:auto;font-size:12px;white-space:nowrap}
    .sf .card .det{display:none;flex-direction:column;gap:4px;border-top:1px dashed #d6dde3;padding-top:4px}
    .sf .card.aberto .det{display:flex}
    .sf .card .abrir{background:none;color:var(--navy);padding:0 4px;font-size:12px;text-decoration:underline}
  `;

  // Painel padrão DevDu (lib/devdu-ui.js, via @require): abas na lateral, lingueta verde à direita.
  // O host ganha id "sfPainel" + data-versao: a versão antiga do script (antes da DevDu), se ainda estiver instalada,
  // vê o painel e não roda (evita duas cópias processando a mesma fila no SIAFI).
  const noSEI = () => location.hostname === 'protocolo.presidencia.gov.br';
  let painel = null;
  const campo = id => (painel ? painel.raiz.querySelector('#' + id) : null);
  const SOBRE = `<p>Concessão de suprimento de fundos: no <b>SEI</b>, lê as solicitações de concessão e os despachos de
    retorno do empenho e monta a fila; no <b>SIAFI</b>, emite os SF (INCDH) ou reforça (CONDH); de volta ao SEI, gera os
    despachos de devolução.</p>
    <ol><li>No SEI, aba <b>Concessões</b>: informe os números SEI das solicitações e clique em <b>Ler documentos</b>; confira
    tipo, período e destino e clique em <b>Enviar fila para o SIAFI</b>.</li>
    <li>No SIAFI, aba <b>Fila de SF</b>: confira a fila e clique em <b>Emitir SFs</b> (comece em modo teste).</li>
    <li>Com a aba do SEI aberta, os despachos de devolução são gerados quando o SIAFI registra.</li></ol>
    <p class="peq">Problemas: fale com a Dulce informando o nome do script e a versão (no rodapé do painel).</p>`;
  function criarPainel() {
    if (painel) return;
    painel = DevDu.painel({
      id: 'concessao-suprimento', nome: 'Concessão Suprimento', versao: VERSAO, largura: noSEI() ? 720 : 680, css: CSS,
      abas: noSEI()
        ? [{ id: 'principal', titulo: 'Concessões', icone: '📄' }, { id: 'config', titulo: 'Config.', icone: '⚙️' },
          { id: 'sobre', titulo: 'Sobre', icone: 'ℹ️' }]
        : [{ id: 'principal', titulo: 'Fila de SF', icone: '▶️' }, { id: 'sobre', titulo: 'Sobre', icone: 'ℹ️' }],
    });
    painel.elemento.id = 'sfPainel';
    painel.elemento.dataset.versao = VERSAO;
    for (const sec of painel.raiz.querySelectorAll('.secao')) sec.classList.add('sf');
    painel.secao('sobre').innerHTML = SOBRE;
    if (noSEI()) montarConfigSEI();
  }
  function abrirPainel() { if (painel) painel.abrir(); }

  function renderizarLog() {
    const box = campo('sfLog');
    if (!box) return;
    const log = (estado.ler() || {}).log || [];
    box.innerHTML = log.map(l => `<div class="${l.tipo}">${l.t} ${l.msg.replace(/</g, '&lt;')}</div>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  // Fila mostrada no painel do SIAFI: a da execução em andamento, ou a da caixa (sf_json, vinda do SEI)
  function filaDaCaixa() {
    const txt = GM_getValue('sf_json', null) ?? jsonTexto(EXEMPLO, 2);
    try { return { fila: prepararFila(JSON.parse(txt)) }; } catch (err) { return { fila: [], erro: err.message }; }
  }
  // situação de um SF da fila: registrado (com o número), em andamento, pausado, a conferir ou aguardando
  function situacaoNaFila(job, e) {
    const reg = registroSF()[job.id];
    if (reg) return { cls: 'ok', txt: '✔ ' + (reg.numero || 'registrado') };
    if (e && e.fila) {
      const atual = e.fila[e.idx];
      if (!['ocioso', 'concluido'].includes(e.etapa) && atual && atual.id === job.id) {
        if (e.etapa !== 'pausado') return { cls: 'andamento', txt: '▶ em andamento' };
        if (e.motivo === 'indeterminado') return { cls: 'erro', txt: '⚠ conferir no SIAFI' };
        if (e.motivo === 'teste') return { cls: 'aviso', txt: '✎ preenchido (teste)' };
        return { cls: 'erro', txt: '✖ erro – pausado' };
      }
      const res = (e.resultados || []).filter(r => r.jobId === job.id);
      if (res.length && res[res.length - 1].status === 'indeterminado') return { cls: 'erro', txt: '⚠ conferir no SIAFI' };
    }
    return { cls: '', txt: 'aguardando' };
  }
  // tabela da fila agrupada por UG (uma troca de UG por grupo), com o nº de cada SF assim que é registrado
  function tabelaFila(fila, e) {
    if (!fila.length) return '<div class="peq">Fila vazia: leia as concessões no SEI e clique em "Enviar fila para o SIAFI".</div>';
    const ugs = [];
    for (const j of fila) if (ugs.indexOf(j.ug) < 0) ugs.push(j.ug);
    return ugs.map(ug => {
      const da = fila.filter(j => j.ug === ug);
      const nReg = da.filter(j => registroSF()[j.id]).length;
      const linhas = da.map(j => {
        const s = situacaoNaFila(j, e);
        const extra = [j.tipo, j.periodo, j.destino].filter(Boolean).join(' · ');
        return `<tr class="${s.cls}"><td><b>${esc(j.processo)}</b><div class="peq">${esc(j.nomeSuprido || j.cpf)}</div>${extra ? `<div class="peq">${esc(extra)}</div>` : ''}</td>
          <td>${esc(j.situacao)}${j.operacao === 'reforco' ? `<div class="selo">REFORÇO</div><div class="peq">${esc(j.sfNumero)}</div>` : ''}</td>
          <td>${j.itens.map(it => `<div class="ne"><span>${esc(it.ne)}${it.nd ? ` <span class="peq">${esc(it.nd)}</span>` : ''}</span><span>${brl(it.valor)}</span></div>`).join('')}</td>
          <td class="num"><b>${brl(j.valorTotal)}</b></td><td class="st">${s.txt}</td></tr>`;
      }).join('');
      return `<div class="grupoUG"><div class="tituloUG"><b>UG ${esc(ug)}</b>
          <span>${da.length} SF · R$ ${brl(soma(da.map(j => j.valorTotal)))} · ${nReg} registrado(s)</span></div>
        <table class="sf"><thead><tr><th>Processo · suprido</th><th>Sit.</th><th>Notas de empenho</th><th class="num">Total</th><th>Nº do SF</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>`;
    }).join('');
  }

  // Planilha (CSV para o Excel) com uma linha por NE: processo, suprido, SF, NE, valor, tipo, período, destino
  function baixarPlanilha(sfs, nome) {
    const linhas = [P.COLUNAS_PLANILHA].concat(P.linhasPlanilha(sfs, registroSF()));
    const blob = new Blob([P.csv(linhas)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const d = new Date(), z = n => String(n).padStart(2, '0');
    a.href = URL.createObjectURL(blob);
    a.download = `${nome || 'concessoes-SF'}-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  // todos os SF do registro permanente (inclusive de filas antigas) como lista de SF para a planilha
  function sfsDoRegistro() {
    const r = registroSF();
    return Object.keys(r).map(id => Object.assign({}, r[id], { id,
      itens: r[id].itens && r[id].itens.length ? r[id].itens : [{ ne: '', valor: r[id].valor || 0 }] }));
  }

  function renderizarPainel() {
    criarPainel();
    const corpo = painel.secao('principal');
    const ugLinha = `<div class="peq">UG do login: ${esc(ugAtual() || '—')}</div>`;
    const e = estado.ler();
    const emExecucao = e && e.fila && !['ocioso', 'concluido'].includes(e.etapa);
    const nReg = Object.keys(registroSF()).length;
    const rodape = `<div class="peq">${nReg} SF registrado(s) guardado(s) – a fila pula os que já estão aqui.
      <a href="#" id="sfVerReg">ver</a> · <a href="#" id="sfPlanReg">planilha de todos</a> · <a href="#" id="sfLimparReg">limpar</a></div>`;

    if (!emExecucao) {
      const { fila, erro } = filaDaCaixa();
      const origem = GM_getValue('sf_json_origem', '');
      const total = soma(fila.map(j => j.valorTotal));
      corpo.innerHTML = `${ugLinha}
        <div class="sf-titulo"><b>Fila de SF</b>${origem ? ` <span class="peq">– veio do ${esc(origem)}</span>` : ''}
          ${fila.length ? `<span class="peq"> · ${fila.length} SF · R$ ${brl(total)}</span>` : ''}</div>
        ${erro ? `<div class="msgErro">Fila inválida: ${esc(erro)}</div>` : ''}
        <div id="sfTabela">${tabelaFila(fila, e)}</div>
        <div class="barra">
          <button id="sfIniciar"${fila.length ? '' : ' disabled'}>Emitir SFs</button>
          <label><input type="checkbox" id="sfTeste" checked> Modo teste (preenche e para antes de registrar)</label>
          <span class="dir"><button class="sec" id="sfPlanilha"${fila.length ? '' : ' disabled'}>Baixar planilha</button>
          <button class="sec" id="sfLimpar" title="Apaga o log e os resultados da última execução (não apaga a lista de SF registrados)">Limpar histórico</button></span>
        </div>
        ${e && e.etapa === 'concluido' ? `<div class="status ok">Fila concluída: ${(e.resultados || []).filter(r => r.status === 'registrado').length} SF registrado(s). Baixe a planilha.</div>` : ''}
        <details${erro ? ' open' : ''}><summary>Editar a fila (JSON)</summary>
          <textarea id="sfJSON"></textarea>
          <div class="linha"><button class="sec" id="sfExemplo">Restaurar exemplo</button>
            ${e && e.resultados && e.resultados.length ? '<button class="sec" id="sfCopiar">Copiar resultados (JSON)</button>' : ''}</div>
        </details>
        ${rodape}
        <div id="sfLog"></div>`;
      corpo.querySelector('#sfIniciar').onclick = iniciar;
      corpo.querySelector('#sfPlanilha').onclick = () => baixarPlanilha(filaDaCaixa().fila);
      corpo.querySelector('#sfLimpar').onclick = () => { estado.limpar(); renderizarPainel(); };
      // O JSON digitado fica guardado (o painel é redesenhado a cada recarga e ao limpar o histórico).
      const caixa = corpo.querySelector('#sfJSON');
      caixa.value = GM_getValue('sf_json', null) ?? jsonTexto(EXEMPLO, 2);
      caixa.oninput = () => { GM_setValue('sf_json', caixa.value); GM_deleteValue('sf_json_origem'); };
      caixa.onchange = () => {
        const f = filaDaCaixa();
        corpo.querySelector('#sfTabela').innerHTML = f.erro ? `<div class="msgErro">Fila inválida: ${esc(f.erro)}</div>` : tabelaFila(f.fila, e);
      };
      corpo.querySelector('#sfExemplo').onclick = () => {
        GM_deleteValue('sf_json'); GM_deleteValue('sf_json_origem'); renderizarPainel();
      };
      const cp = corpo.querySelector('#sfCopiar');
      if (cp) cp.onclick = () => navigator.clipboard.writeText(jsonTexto(e.resultados, 2));
    } else {
      const job = e.fila[e.idx];
      const pausado = e.etapa === 'pausado';
      const nFeitos = e.fila.filter(j => registroSF()[j.id]).length;
      corpo.innerHTML = `${ugLinha}
        <div class="status${pausado ? ' pausa' : ''}"><b>SF ${Math.min(e.idx + 1, e.fila.length)} de ${e.fila.length}</b>${job ? ` – ${esc(job.processo)}, ${job.situacao}, UG ${job.ug}` : ''}
          · ${nFeitos} registrado(s)<br>
          ${pausado ? 'Pausado' : 'Em execução: ' + e.etapa}${e.modoTeste ? ' (modo teste)' : ''}</div>
        <div class="barra">
          ${pausado && e.motivo === 'indeterminado' ? `<span class="msgErro">Este SF pode já ter sido registrado: confira no SIAFI.</span>
            <button id="sfJaRegistrado">Já está registrado: informar o nº e seguir</button>
            <button class="sec" id="sfRetomar">Não foi registrado: registrar de novo</button>` : ''}
          ${pausado && e.motivo !== 'indeterminado' ? `<button id="sfRetomar">Tentar este SF de novo</button><button class="sec" id="sfPular">Pular para o próximo</button>` : ''}
          <button class="sec" id="sfParar">Encerrar execução</button>
          <span class="dir"><button class="sec" id="sfPlanilha">Baixar planilha</button></span>
        </div>
        <div id="sfTabela">${tabelaFila(e.fila, e)}</div>
        ${rodape}
        <div id="sfLog"></div>`;
      corpo.querySelector('#sfPlanilha').onclick = () => baixarPlanilha(estado.ler().fila);
      const on = (id, fn) => { const b = corpo.querySelector(id); if (b) b.onclick = fn; };
      on('#sfRetomar', () => {
        if (e.motivo === 'indeterminado' && !confirm('Confirma que este SF NÃO foi registrado no SIAFI? Ele será registrado de novo.')) return;
        atualizar({ etapa: etapaDoSF(estado.ler().fila[estado.ler().idx]), motivo: null }); renderizarPainel(); executar();
      });
      // segue para o próximo SF; se este já estiver registrado, guarda o número informado (para o despacho)
      const seguir = numero => {
        const x = estado.ler(), j = x.fila[x.idx];
        if (numero) {
          x.resultados = (x.resultados || []).filter(r => !(r.jobId === j.id && r.status === 'indeterminado')).concat({
            numero, jobId: j.id, situacao: j.situacao, itens: j.itens, status: 'registrado', informadoPelaUsuaria: true,
            processo: j.processo, ug: j.ug, origem: j.origem || null,
          });
          gravarRegistroSF(prepararFila([j])[0], numero, { informadoPelaUsuaria: true });
          registrarLog(`SF ${j.id}: registrado como ${numero} (informado)`, 'ok');
        }
        x.idx += 1; estado.salvar(x);
        atualizar({ etapa: proximaEtapa(estado.ler()), motivo: null }); renderizarPainel(); executar();
      };
      const pedirNumero = obrigatorio => {
        for (;;) {
          const n = prompt(obrigatorio ? 'Número do SF registrado no SIAFI (ex.: 2026SF000068):'
            : 'Se este SF foi registrado no SIAFI, digite o número (ex.: 2026SF000068).\nSe não foi, deixe em branco.');
          if (n === null) return null;
          const v = n.trim().toUpperCase();
          if (!v && !obrigatorio) return '';
          if (/^\d{4}SF\d{6}$/.test(v)) return v;
          alert('Número inválido. Formato: 2026SF000068');
        }
      };
      on('#sfJaRegistrado', () => { const n = pedirNumero(true); if (n) seguir(n); });
      on('#sfPular', () => { const n = pedirNumero(false); if (n !== null) seguir(n); });
      on('#sfParar', () => { atualizar({ etapa: 'ocioso' }); registrarLog('Execução encerrada pelo usuário', 'aviso'); renderizarPainel(); });
    }
    corpo.querySelector('#sfVerReg').onclick = ev => {
      ev.preventDefault();
      const r = registroSF();
      alert(Object.keys(r).length ? Object.keys(r).map(k => `${k}: ${r[k].numero} (${r[k].em.slice(0, 10)})`).join('\n') : 'Nenhum SF registrado guardado.');
    };
    corpo.querySelector('#sfPlanReg').onclick = ev => { ev.preventDefault(); baixarPlanilha(sfsDoRegistro(), 'SF-registrados'); };
    corpo.querySelector('#sfLimparReg').onclick = ev => {
      ev.preventDefault();
      if (confirm('Apagar a lista de SF já registrados? Sem ela, uma fila com os mesmos SF poderá registrá-los de novo.')) {
        GM_deleteValue('sf_registrados'); renderizarPainel();
      }
    };
    renderizarLog();
  }

  function iniciar() {
    try {
      const fila = prepararFila(JSON.parse(campo('sfJSON').value));
      const modoTeste = campo('sfTeste').checked;
      const jaReg = modoTeste ? [] : fila.filter(j => registroSF()[j.id]);
      if (!modoTeste && !confirm(`Registrar ${fila.length - jaReg.length} SF(s) no SIAFI? Esta ação gera documentos reais.` +
        (jaReg.length ? `\n\nJá registrados (serão pulados): ${jaReg.map(j => j.id + ' = ' + registroSF()[j.id].numero).join(', ')}` : ''))) return;
      estado.salvar({ fila, idx: 0, modoTeste, resultados: [], log: [], etapa: 'ocioso' });
      atualizar({ etapa: proximaEtapa(estado.ler()) });
      registrarLog(`v${VERSAO} – fila com ${fila.length} SF(s)${modoTeste ? ' – modo teste' : ''}`);
      if (!metodoNativo(Array.prototype.reduce)) registrarLog('Página com métodos de Array alterados (Prototype.js) – tratado');
      renderizarPainel();
      executar();
    } catch (err) {
      alert('Não foi possível iniciar: ' + err.message);
    }
  }

  /* ======================================================================
   * SEI: leitura das concessões e montagem da fila para o SIAFI
   * (o Tampermonkey compartilha GM_getValue/GM_setValue entre o SEI e o SIAFI: a fila vai em 'sf_json')
   * ==================================================================== */
  const TIPOS_PADRAO = ['AJO', 'ECONOMATO', 'EX-PR', 'DILOG', 'ALVORADA'];
  const tiposSF = () => GM_getValue('sf_tipos', TIPOS_PADRAO);
  const parseHTML = html => new DOMParser().parseFromString(html, 'text/html');
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const numBR = v => { const n = Number(String(v == null ? '' : v).trim().replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : NaN; };

  // SEI: mesma origem, páginas em ISO-8859-1
  async function seiReq(url, pares) {
    const opt = { credentials: 'include' };
    if (pares) {
      opt.method = 'POST';
      opt.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      opt.body = P.formLatin1(pares); // o SEI recebe formulários em ISO-8859-1
    }
    const r = await fetch(new URL(url.replace(/&amp;/g, '&'), location.href).href, opt);
    const html = new TextDecoder('windows-1252').decode(await r.arrayBuffer());
    if (!r.ok) throw new Error(`SEI respondeu ${r.status}`);
    if (/acao=(infra_)?login|sip\/login/i.test(r.url)) throw new Error('Sessão do SEI expirada');
    return { url: r.url, html };
  }

  function acaoPesquisaRapida() {
    const f = document.querySelector('#frmProtocoloPesquisaRapida') ||
      (document.querySelector('input[name="txtPesquisaRapida"]') || {}).form;
    if (!f) throw new Error('Pesquisa rápida do SEI não encontrada nesta tela (abra o Controle de Processos)');
    return f.getAttribute('action');
  }

  // Linha da caixa: nº SEI da solicitação; opcionalmente, um 2º número = despacho de retorno (senão, o script procura).
  // pesquisa rápida pelo nº SEI de um documento → árvore do processo dele
  async function abrirArvore(numero) {
    const r = await seiReq(acaoPesquisaRapida(), [['txtPesquisaRapida', numero]]);
    const urlArvore = (r.html.match(/id="ifrArvore"[^>]*src="([^"]+)"/) || r.html.match(/src="([^"]*acao=procedimento_visualizar[^"]*)"/) || [])[1];
    if (!urlArvore) throw new Error(`Documento ${numero} não encontrado (a pesquisa não abriu um processo)`);
    const html = (await seiReq(urlArvore)).html;
    return { urlArvore, html, arv: P.arvore(html) };
  }

  async function lerConcessaoSEI(linha) {
    const [numero, numRetorno, numDevolucao] = linha.match(/\d{6,}/g) || [];
    const { arv } = await abrirArvore(numero);
    const docs = arv.documentos;
    const lista = () => docs.length ? docs.map(d => `${d.rotulo || '?'} [${d.protocolo}]`).join('; ') : 'nenhum documento lido na árvore';
    const docSol = P.documentoNaArvore(docs, numero);
    if (!docSol) throw new Error(`Documento ${numero} não encontrado na árvore do processo ${arv.processo}. Documentos vistos: ${lista()}`);
    if (!docSol.src) throw new Error(`Documento ${numero} (${docSol.rotulo}) está na árvore, mas sem link para abrir`);
    const sol = P.solicitacao(parseHTML((await seiReq(docSol.src)).html));
    if (!sol.naturezas.length && !/CONCESS/.test(P.chave(docSol.rotulo))) {
      throw new Error(`Documento ${numero} (${docSol.rotulo}) não parece uma solicitação de concessão`);
    }
    // despacho de retorno: o indicado na linha; senão o primeiro depois da solicitação com tabela de NEs de emissão ou
    // de reforço; senão (árvore fora de ordem) o mais recente de emissão. Reforço: 3º número na linha = devolução.
    const despachos = docs.filter(d => d !== docSol && /DESPACHO/.test(P.chave(d.rotulo)));
    const iSol = docs.indexOf(docSol);
    let candidatos;
    if (numRetorno) {
      const dr = P.documentoNaArvore(docs, numRetorno);
      if (!dr) throw new Error(`Despacho ${numRetorno} não encontrado na árvore do processo ${arv.processo}. Documentos vistos: ${lista()}`);
      candidatos = [dr];
    } else {
      candidatos = despachos.filter(d => docs.indexOf(d) > iSol).concat(despachos.filter(d => docs.indexOf(d) < iSol).reverse());
    }
    const lidos = {};
    const lerDoc = async d => lidos[d.protocolo] || (lidos[d.protocolo] = parseHTML((await seiReq(d.src)).html));
    let ret = null, rotuloRetorno = '', docRet = null;
    for (const d of candidatos) {
      if (!d.src) continue;
      const r = P.retornoEmpenho(await lerDoc(d));
      const depois = docs.indexOf(d) > iSol;
      if (r.linhas.length && (numRetorno || r.operacao === 'emissao' || (r.operacao === 'reforco' && depois))) { ret = r; rotuloRetorno = d.rotulo; docRet = d; break; }
    }
    if (!ret) throw new Error(`Processo ${arv.processo}: despacho de retorno do empenho (emissão ou reforço, com tabela de NEs) não encontrado`);
    if (ret.operacao !== 'reforco') {
      // retorno de emissão ANTES da solicitação com um despacho de devolução no meio: a concessão já foi feita e esta
      // solicitação é de reforço, cujo retorno ainda não veio – não emitir outro SF
      const iRet = docs.indexOf(docRet);
      if (!numRetorno && iRet < iSol) {
        for (const d of despachos.filter(x => docs.indexOf(x) > iRet && docs.indexOf(x) < iSol)) {
          const x = d.src ? P.devolucaoLida(await lerDoc(d)) : {};
          if (x.sf003 || x.sf002) throw new Error(`Processo ${arv.processo}: a concessão já tem despacho de devolução (${d.rotulo}, SF ${x.sf003 || x.sf002}); se esta solicitação é de reforço, falta o despacho de retorno do reforço do empenho`);
        }
      }
      return { sol, ret, rotuloRetorno };
    }

    // Reforço: nº do SF no despacho de devolução da concessão (o mais recente antes da solicitação de reforço)
    let dev = null;
    const devCands = numDevolucao ? [P.documentoNaArvore(docs, numDevolucao)].filter(Boolean)
      : despachos.filter(d => docs.indexOf(d) < iSol).reverse();
    if (numDevolucao && !devCands.length) throw new Error(`Despacho de devolução ${numDevolucao} não encontrado na árvore do processo ${arv.processo}`);
    for (const d of devCands) {
      if (!d.src) continue;
      const x = P.devolucaoLida(await lerDoc(d));
      if (x.sf003 || x.sf002) { dev = Object.assign(x, { rotulo: d.rotulo }); break; }
    }
    // retorno de reforço sem natureza: busca a natureza de cada NE nos retornos de emissão do processo
    if (ret.linhas.some(l => !l.nd)) {
      for (const d of despachos) {
        if (!d.src || !ret.linhas.some(l => !l.nd)) continue;
        const e = P.retornoEmpenho(await lerDoc(d));
        if (e.operacao !== 'emissao') continue;
        for (const l of ret.linhas) if (!l.nd) l.nd = (e.linhas.filter(x => x.ne === l.ne)[0] || {}).nd || '';
      }
    }
    return { sol, ret, rotuloRetorno, dev };
  }

  const seiLista = () => GM_getValue('sei_concessoes', []);
  const seiGravar = l => GM_setValue('sei_concessoes', l);
  let seiLogMsgs = [];
  function pintarLogSEI() {
    const box = campo('sfLog');
    if (!box) return;
    box.innerHTML = seiLogMsgs.map(l => `<div class="${l.tipo}">${l.t} ${esc(l.msg)}</div>`).join('');
    box.scrollTop = box.scrollHeight;
  }
  function seiLog(msg, tipo = 'info') {
    seiLogMsgs = seiLogMsgs.concat({ t: new Date().toLocaleTimeString('pt-BR'), msg, tipo }).slice(-100);
    pintarLogSEI();
  }

  // Valores iniciais da janela de conferência a partir dos documentos
  function opcoesIniciais(sol) {
    return {
      tipo: '', periodo: sol.periodo ? `${sol.periodo.inicio} A ${sol.periodo.fim}` : '',
      destino: P.destino(sol.finalidade), cambio: '', saqueBRL: {},
    };
  }
  // a mesma observação que o painel do SIAFI vai montar (prepararFila)
  function previaObservacao(c) {
    const o = c.op || {};
    try {
      return montarObservacao(config().modeloObs, {
        periodo: o.periodo || '', processo: c.sol.processo, tipo: o.tipo || '', destino: o.destino ? ' - DESTINO ' + o.destino : '',
      });
    } catch (err) { return '(' + err.message + ')'; }
  }
  const montar = c => P.montarConcessao(c.sol, c.ret, Object.assign({}, c.op, { cambio: numBR(c.op.cambio) || 0 }), c.dev || null);

  // Cartões compactos (pensado para dezenas de concessões): uma linha com processo, suprido, tipo e SF; os detalhes
  // abrem no clique ou sozinhos quando há erro além da falta do tipo (que se escolhe na própria linha).
  const cartoesAbertos = {};
  function cardConcessao(c, i) {
    if (c.erro) {
      return `<div class="card comErro aberto"><div class="cab"><span class="ic">✖</span><span class="proc">SEI ${esc(c.linha)}</span></div>
        <div class="det"><span class="msgErro">${esc(c.erro)}</span></div></div>`;
    }
    const m = montar(c);
    const marc = c.sol.marcado;
    const tipoConc = ['cartao', 'real', 'dolar', 'euro', 'numerario'].filter(k => marc[k])
      .map(k => ({ cartao: 'cartão', real: 'real', dolar: 'dólar', euro: 'euro', numerario: 'numerário' })[k]).join(' + ') || 'nenhum marcado';
    const opTipos = [''].concat(tiposSF()).concat(c.op.tipo && tiposSF().indexOf(c.op.tipo) < 0 ? [c.op.tipo] : [])
      .map(t => `<option value="${esc(t)}"${t === c.op.tipo ? ' selected' : ''}>${t ? esc(t) : '— tipo —'}</option>`).join('');
    const moeda = m.moeda === 'EUR' ? '€' : 'US$';
    const linhas = m.naturezas.map(n => `<tr><td>${n.nd}</td><td>${n.ne}</td><td>${brl(n.credito)}</td>
      <td>${n.saque ? (m.estrangeira ? moeda + ' ' : '') + brl(n.saque) : '–'}</td>
      <td>${m.estrangeira && n.saque ? `<input data-i="${i}" data-nd="${n.nd}" size="8" value="${esc(c.op.saqueBRL[n.nd] != null ? c.op.saqueBRL[n.nd] : (n.saqueBRL != null ? brl(n.saqueBRL) : ''))}">` : (n.saque ? brl(n.saqueBRL) : '–')}</td>
      <td>${brl(n.valorNE)}</td></tr>`).join('');
    const sfs = m.sfs.map(sf => `${m.reforco ? 'reforço ' : ''}${sf.situacao}${sf.sfNumero ? ' ' + sf.sfNumero : ''}: R$ ${brl(soma(sf.itens.map(x => x.valor)))} (${sf.itens.length} NE${sf.itens.length > 1 ? 's' : ''})`).join(' · ');
    const errosGraves = m.erros.filter(e => !/tipo de suprimento/.test(e));
    const aberto = cartoesAbertos[c.sol.sei] != null ? cartoesAbertos[c.sol.sei] : errosGraves.length > 0;
    const [ic, cls, dica] = errosGraves.length ? ['✖', 'comErro', 'com erro'] : m.erros.length ? ['●', 'pendente', 'falta escolher o tipo']
      : m.avisos.length ? ['⚠', 'ok', 'com aviso'] : ['✔', 'ok', 'pronta'];
    return `<div class="card ${cls}${aberto ? ' aberto' : ''}">
      <div class="cab"><span class="ic" title="${dica}">${ic}</span>
        <span class="proc">${esc(c.sol.processo)}</span>
        ${m.reforco ? '<span class="selo">REFORÇO</span>' : ''}
        <span class="peq">${esc(c.sol.nome || 'suprido sem nome')} · UG ${esc(c.ret.ug)}</span>
        ${m.reforco ? '' : `<select data-i="${i}" data-k="tipo">${opTipos}</select>`}
        <span class="resumo">${sfs || '–'}</span>
        <button class="abrir" data-abrir="${esc(c.sol.sei)}">${aberto ? 'fechar' : 'detalhes'}</button></div>
      <div class="det">
      <span class="peq">SEI ${esc(c.sol.sei)} – processo ${esc(c.sol.processo)} · UG ${esc(c.ret.ug)} · CPF ${esc(P.fmtCPF(c.ret.cpf || c.sol.cpf))} · ${esc(tipoConc)} · retorno: ${esc(c.rotuloRetorno)}</span>
      ${m.reforco ? `<span class="peq">Reforço de SF já emitido – devolução: ${esc(c.dev ? c.dev.rotulo : 'não encontrada')}${c.dev ? ` (SPF003 ${esc(c.dev.sf003 || '–')}, SPF002 ${esc(c.dev.sf002 || '–')}, UG do SF ${esc(c.dev.ug || '?')})` : ''}${c.dev && c.dev.ug && c.dev.ug !== c.ret.ug ? ` · NEs da UG ${esc(c.ret.ug)}` : ''}</span>` : ''}
      <div class="linha">Período <input data-i="${i}" data-k="periodo" size="22" value="${esc(c.op.periodo)}">
        Destino <input data-i="${i}" data-k="destino" size="28" placeholder="vazio = mensal" value="${esc(c.op.destino)}">
        ${m.estrangeira ? `Câmbio (R$ por ${moeda}) <input data-i="${i}" data-k="cambio" size="7" value="${esc(c.op.cambio)}">` : ''}</div>
      <table><tr><th>ND</th><th>NE</th><th>Crédito</th><th>Saque</th><th>Saque R$</th><th>NE R$</th></tr>${linhas}</table>
      <span>${sfs ? 'SF: ' + sfs : ''}</span>
      <span class="peq">Observação no SIAFI: <span id="sfObs${i}">${esc(previaObservacao(c))}</span></span>
      ${m.erros.length > errosGraves.length ? '<span class="msgErro">Escolha o tipo de suprimento</span>' : ''}
      </div>
      ${errosGraves.map(e => `<span class="msgErro">${esc(e)}</span>`).join('')}
      ${m.avisos.map(a => `<span class="msgAviso">${esc(a)}</span>`).join('')}
    </div>`;
  }

  // Aba Config. do SEI (montada uma vez; mudar um campo redesenha a aba Concessões)
  function montarConfigSEI() {
    const box = painel.secao('config');
    box.innerHTML = `
      <label>Tipos de suprimento (um por linha)</label><textarea id="sfTipos" style="min-height:90px"></textarea>
      <div class="linha">Texto padrão do despacho de devolução (id) <input data-cfg="textoDevolucao" size="6" value="${esc(cfgSEI().textoDevolucao)}"></div>
      <div class="linha">Bloco de assinatura <input data-cfg="bloco" size="8" value="${esc(cfgSEI().bloco)}"> <span class="peq">(vazio = não incluir)</span></div>
      <div class="linha">Tipo de documento <input data-cfg="serie" size="12" value="${esc(cfgSEI().serie)}"></div>`;
    const tipos = box.querySelector('#sfTipos');
    tipos.value = tiposSF().join('\n');
    tipos.onchange = () => {
      const l = tipos.value.split('\n').map(t => t.trim().toUpperCase()).filter(Boolean);
      GM_setValue('sf_tipos', l.length ? l : TIPOS_PADRAO);
      renderizarSEI();
    };
    box.querySelectorAll('[data-cfg]').forEach(e => {
      e.onchange = () => { const c = GM_getValue('sf_cfg_sei', {}); c[e.dataset.cfg] = e.value.trim(); GM_setValue('sf_cfg_sei', c); renderizarSEI(); };
    });
  }

  function renderizarSEI() {
    criarPainel();
    const corpo = painel.secao('principal');
    const lista = seiLista();
    const validas = lista.filter(c => !c.erro && !montar(c).erros.length);
    corpo.innerHTML = `
      <label>Solicitações de concessão – nº SEI, uma por linha
        <span class="peq">(opcional: 2º número na linha = despacho de retorno)</span></label>
      <textarea id="sfNums" style="min-height:70px"></textarea>
      <div class="linha"><button id="sfLer">Ler documentos</button><button class="sec" id="sfLimparSEI">Limpar</button></div>
      ${lista.length ? `<div class="sf-titulo"><b>Concessões</b> <span class="peq">${lista.length} lida(s) · ${validas.length} sem erro</span></div>
        <div class="ferramentas">Tipo para as que estão sem tipo:
          <select id="sfTipoTodas"><option value="">— tipo —</option>${tiposSF().map(t => `<option>${esc(t)}</option>`).join('')}</select>
          <button class="sec" id="sfAplicarTipo">Aplicar</button>
          <span class="peq" style="margin-left:auto"><a href="#" id="sfAbrirTodas">abrir todas</a> · <a href="#" id="sfFecharTodas">fechar todas</a></span></div>` : ''}
      <div id="sfLista" style="display:flex;flex-direction:column;gap:4px">${lista.map(cardConcessao).join('')}</div>
      ${lista.length ? `<div class="barra"><button id="sfEnviar"${validas.length ? '' : ' disabled'}>Enviar fila para o SIAFI (${soma(validas.map(c => montar(c).sfs.length))} SF)</button>
        <span class="peq">${validas.length} de ${lista.length} concessão(ões) sem erro</span>
        <span class="dir"><button class="sec" id="sfPlanilhaSEI"${validas.length ? '' : ' disabled'} title="Uma linha por NE, com o nº do SF quando já registrado">Baixar planilha</button></span></div>` : ''}
      ${lista.length ? secaoDespachos(lista) : ''}
      <div id="sfLog"></div>`;
    const nums = corpo.querySelector('#sfNums');
    nums.value = GM_getValue('sei_numeros', '');
    nums.oninput = () => GM_setValue('sei_numeros', nums.value);
    corpo.querySelector('#sfLer').onclick = lerTodasSEI;
    const auto = corpo.querySelector('#sfAutoDesp');
    if (auto) auto.onchange = () => { const c = GM_getValue('sf_cfg_sei', {}); c.autoDespacho = auto.checked; GM_setValue('sf_cfg_sei', c); };
    const btnDesp = corpo.querySelector('#sfGerarDesp');
    if (btnDesp) btnDesp.onclick = () => { btnDesp.disabled = true; gerarDespachosProntos(); };
    corpo.querySelector('#sfLimparSEI').onclick = () => { seiGravar([]); renderizarSEI(); };
    const on = (sel, fn) => { const x = corpo.querySelector(sel); if (x) x.onclick = ev => { ev.preventDefault(); fn(); }; };
    on('#sfAplicarTipo', () => {
      const t = corpo.querySelector('#sfTipoTodas').value;
      if (!t) return;
      const l = seiLista();
      for (const c of l) if (!c.erro && !c.op.tipo && c.ret.operacao !== 'reforco') c.op.tipo = t;
      seiGravar(l);
      renderizarSEI();
    });
    const abrirTodas = v => { for (const c of seiLista()) if (c.sol) cartoesAbertos[c.sol.sei] = v; renderizarSEI(); };
    on('#sfAbrirTodas', () => abrirTodas(true));
    on('#sfFecharTodas', () => abrirTodas(false));
    corpo.querySelectorAll('[data-abrir]').forEach(b => {
      b.onclick = () => {
        const card = b.closest('.card');
        cartoesAbertos[b.dataset.abrir] = card.classList.toggle('aberto');
        b.textContent = card.classList.contains('aberto') ? 'fechar' : 'detalhes';
      };
    });
    on('#sfPlanilhaSEI', () => {
      let sfs = [];
      for (const c of seiLista()) if (!c.erro && !montar(c).erros.length) sfs = sfs.concat(montar(c).sfs);
      baixarPlanilha(sfs);
    });
    const enviar = corpo.querySelector('#sfEnviar');
    if (enviar) enviar.onclick = enviarFilaSIAFI;
    // edição na janela de conferência: grava a cada tecla (sem redesenhar, para não perder o foco nem o clique
    // em "Enviar"); redesenha só quando o campo muda valores ou erros: tipo na hora; câmbio e saque em R$ com
    // atraso, para o clique que tirou o foco do campo ainda chegar ao botão.
    corpo.querySelectorAll('#sfLista [data-i]').forEach(e => {
      const i = +e.dataset.i;
      const gravar = () => {
        const l = seiLista(), c = l[i];
        if (e.dataset.nd) {
          if (e.value.trim()) c.op.saqueBRL[e.dataset.nd] = isFinite(numBR(e.value)) ? numBR(e.value) : e.value;
          else delete c.op.saqueBRL[e.dataset.nd];
        } else {
          const antes = c.op[e.dataset.k];
          c.op[e.dataset.k] = e.dataset.k === 'periodo' ? e.value.trim().toUpperCase() : e.value.trim();
          if (e.dataset.k === 'cambio' && antes !== c.op.cambio) c.op.saqueBRL = {}; // nova taxa recalcula os valores
        }
        seiGravar(l);
        const obs = campo('sfObs' + i);
        if (obs) obs.textContent = previaObservacao(c);
      };
      e.oninput = gravar;
      e.onchange = () => {
        gravar();
        if (e.tagName === 'SELECT') renderizarSEI();
        else if (e.dataset.nd || e.dataset.k === 'cambio') setTimeout(renderizarSEI, 300);
      };
    });
    pintarLogSEI();
  }

  // Despachos de devolução: uma linha por concessão com o estado e os números dos SF registrados
  function secaoDespachos(lista) {
    const cfg = cfgSEI();
    const rotulo = { erro: 'com erro na leitura', aguardando: 'aguardando o registro no SIAFI', pronto: 'pronto para gerar',
      bloco: 'despacho criado; falta incluir no bloco', conferir: 'despacho criado mas não preenchido – conferir no SEI', concluido: 'concluído' };
    let prontos = 0;
    const linhas = lista.filter(c => !c.erro && !montar(c).erros.length).map(c => {
      const sit = situacaoDevolucao(c);
      if (sit.estado === 'pronto' || sit.estado === 'bloco') prontos++;
      const sfs = sit.d ? [sit.d.sf003 && 'SPF003 ' + sit.d.sf003, sit.d.sf002 && 'SPF002 ' + sit.d.sf002].filter(Boolean).join(', ') : '';
      const desp = sit.reg && sit.reg.id ? ` · despacho ${esc(sit.reg.numero || sit.reg.id)}${sit.reg.bloco ? ' no bloco ' + esc(sit.reg.bloco) : ''}` : '';
      const cor = sit.estado === 'concluido' ? 'ok' : sit.estado === 'erro' || sit.estado === 'conferir' ? 'msgErro' : sit.estado === 'aguardando' ? 'peq' : 'msgAviso';
      return `<div class="${cor}">${esc((c.sol && c.sol.processo) || c.linha)}: ${rotulo[sit.estado]}${sfs ? ' (' + esc(sfs) + ')' : ''}${desp}</div>`;
    }).join('');
    return `<div class="sf-titulo"><b>Despachos de devolução</b> <span class="peq">texto padrão ${esc(cfg.textoDevolucao)}${cfg.bloco ? ' · bloco ' + esc(cfg.bloco) : ''}</span></div>
      <div class="status">${linhas || '<span class="peq">Nenhuma concessão sem erro.</span>'}
      <div class="linha"><button id="sfGerarDesp"${prontos ? '' : ' disabled'}>Gerar despachos prontos (${prontos})</button>
        <label class="peq"><input type="checkbox" id="sfAutoDesp"${cfg.autoDespacho ? ' checked' : ''}> gerar sozinho quando o SIAFI registrar (com esta aba aberta)</label></div></div>`;
  }

  async function lerTodasSEI() {
    const linhas = (campo('sfNums').value || '').split('\n').map(l => l.trim()).filter(l => /\d{6,}/.test(l));
    if (!linhas.length) return alert('Digite o número SEI de pelo menos uma solicitação de concessão.');
    const anteriores = seiLista();
    const btn = campo('sfLer');
    btn.disabled = true;
    const lista = [];
    for (const linha of linhas) {
      seiLog(`Lendo ${linha}...`);
      try {
        const lido = await lerConcessaoSEI(linha);
        const ant = anteriores.filter(a => a.sol && a.sol.sei === lido.sol.sei)[0];
        lista.push(Object.assign({ linha }, lido, { op: ant ? ant.op : opcoesIniciais(lido.sol) }));
        seiLog(`${linha}: processo ${lido.sol.processo}, UG ${lido.ret.ug}, ${lido.ret.linhas.length} NE(s) (${lido.rotuloRetorno})` +
          (lido.dev ? ` – REFORÇO do SF ${[lido.dev.sf003, lido.dev.sf002].filter(Boolean).join(' / ')} (${lido.dev.rotulo})` : lido.ret.operacao === 'reforco' ? ' – REFORÇO sem despacho de devolução' : ''), 'ok');
      } catch (err) {
        lista.push({ linha, erro: err.message });
        seiLog(`${linha}: ${err.message}`, 'erro');
      }
    }
    seiGravar(lista);
    renderizarSEI();
  }

  function enviarFilaSIAFI() {
    const lista = seiLista();
    const validas = lista.filter(c => !c.erro && !montar(c).erros.length);
    const fora = lista.length - validas.length;
    if (fora && !confirm(`${fora} concessão(ões) com erro ficarão de fora. Enviar as outras ${validas.length}?`)) return;
    let fila = [];
    for (const c of validas) fila = fila.concat(montar(c).sfs);
    // agrupa por UG (uma troca de UG por grupo no SIAFI), mantendo a ordem dentro de cada UG
    const ugs = [];
    for (const sf of fila) if (ugs.indexOf(sf.ug) < 0) ugs.push(sf.ug);
    fila = [].concat(...ugs.map(ug => fila.filter(sf => sf.ug === ug)));
    GM_setValue('sf_json', jsonTexto(fila, 2));
    GM_setValue('sf_json_origem', `SEI, ${new Date().toLocaleString('pt-BR')}, ${fila.length} SF`);
    seiLog(`Fila com ${fila.length} SF enviada. No SIAFI, ela já aparece na caixa do painel: confira e clique em "Emitir SFs".`, 'ok');
    alert(`Fila com ${fila.length} SF pronta. Abra o SIAFI: a fila já estará na caixa do painel.`);
  }

  /* ======================================================================
   * SEI: despacho de devolução ao suprido + bloco de assinatura (mecanismo do script do empenho)
   * Pronto quando todos os SF da concessão estão no registro permanente (sf_registrados, gravado pelo SIAFI).
   * Registro de despachos em 'sf_despachos' (chave = nº SEI da solicitação): nunca cria dois para a mesma concessão.
   * ==================================================================== */
  const CFG_SEI_PADRAO = { textoDevolucao: '3802', bloco: '124759', serie: 'Despacho', nivelAcesso: '0', autoDespacho: true };
  const cfgSEI = () => Object.assign({}, CFG_SEI_PADRAO, GM_getValue('sf_cfg_sei', {}));
  const despachos = () => GM_getValue('sf_despachos', {});
  function gravarDespacho(chave, dados) {
    const r = despachos();
    r[chave] = Object.assign({}, r[chave] || {}, dados, { em: new Date().toISOString() });
    GM_setValue('sf_despachos', r);
  }

  // estado do despacho de uma concessão: 'erro' | 'aguardando' (SF não registrados) | 'pronto' | 'bloco' (falta bloco) |
  // 'conferir' (criado mas não preenchido) | 'concluido'
  function situacaoDevolucao(c) {
    if (c.erro) return { estado: 'erro' };
    const m = montar(c);
    if (m.erros.length) return { estado: 'erro' };
    const d = P.dadosDevolucao(m, c.ret.ug, c.op, registroSF());
    const reg = despachos()[c.sol.sei] || null;
    if (reg && reg.id && !reg.preenchido) return { estado: 'conferir', d, reg };
    if (reg && reg.id) return { estado: !cfgSEI().bloco || reg.bloco ? 'concluido' : 'bloco', d, reg };
    if (d.pendentes.length) return { estado: 'aguardando', d, reg };
    return { estado: 'pronto', d, reg };
  }

  async function criarDespachoSEI(arv, cfg) {
    if (!arv.linkEscolherTipo) throw new Error('Link "Incluir Documento" do processo não encontrado (o processo está aberto na sua unidade?)');
    // 1. Escolher o tipo (série) do documento
    const pEsc = await seiReq(arv.linkEscolherTipo);
    const dEsc = parseHTML(pEsc.html);
    const fEsc = dEsc.querySelector('#frmDocumentoEscolherTipo');
    const series = dEsc.querySelectorAll('input[title]');
    let serie = null;
    for (let i = 0; i < series.length; i++) if (P.chave(series[i].title) === P.chave(cfg.serie)) serie = series[i];
    if (!fEsc || !serie) throw new Error(`Tipo de documento "${cfg.serie}" não encontrado no SEI`);
    const paresEsc = P.serializarForm(fEsc).filter(([k]) => !/^chkInfraItem/.test(k)).map(([k, v]) => [k, k === 'hdnIdSerie' ? serie.value : v]);
    const pGer = await seiReq(fEsc.getAttribute('action'), paresEsc);
    // 2. Gerar a partir do texto padrão
    const dGer = parseHTML(pGer.html);
    const fGer = dGer.querySelector('#frmDocumentoCadastro');
    if (!fGer) throw new Error('A tela de geração de documento não abriu');
    const urlLupa = (pGer.html.match(/infraLupaText\('txtTextoPadrao','hdnIdTextoPadrao','([^']+)'/) || [])[1];
    if (!urlLupa) throw new Error('Lista de textos padrão não encontrada');
    const dTxt = parseHTML((await seiReq(urlLupa)).html);
    const radios = dTxt.querySelectorAll('input[name="chkInfraItem"]');
    let radio = null;
    for (let i = 0; i < radios.length; i++) if (radios[i].value === String(cfg.textoDevolucao)) radio = radios[i];
    if (!radio) throw new Error(`O texto padrão ${cfg.textoDevolucao} não existe na unidade atual do SEI`);
    const campos = [
      'hdnInfraTipoPagina', 'txtDataElaboracao', 'rdoTextoInicial', 'txtProtocoloDocumentoTextoBase', 'txtTextoPadrao', 'hdnIdTextoPadrao',
      'hdnIdDocumentoTextoBase', 'txtDescricao', 'txtNumero', 'txtNomeArvore', 'txtDinValor', 'txtRemetente', 'hdnIdRemetente',
      'txtInteressado', 'hdnIdInteressado', 'txtDestinatario', 'hdnIdDestinatario', 'txtAssunto', 'hdnIdAssunto', 'txaObservacoes',
      'selGrauSigilo', 'rdoNivelAcesso', 'selHipoteseLegal', 'hdnFlagDocumentoCadastro', 'hdnAssuntos', 'hdnInteressados', 'hdnDestinatarios',
      'hdnIdSerie', 'hdnIdUnidadeGeradoraProtocolo', 'hdnStaDocumento', 'hdnIdTipoConferencia', 'hdnSinArquivamento', 'hdnStaNivelAcessoLocal',
      'hdnIdHipoteseLegal', 'hdnStaGrauSigilo', 'hdnIdDocumento', 'hdnIdProcedimento', 'hdnAnexos', 'hdnIdHipoteseLegalSugestao',
      'hdnIdTipoProcedimento', 'hdnUnidadesReabertura', 'hdnSinBloqueado', 'hdnContatoObject', 'hdnContatoIdentificador', 'hdnAssuntoIdentificador'];
    const atuais = {};
    for (const [k, v] of P.serializarForm(fGer)) atuais[k] = v;
    const forcar = { rdoTextoInicial: 'T', txtTextoPadrao: radio.title, hdnIdTextoPadrao: String(cfg.textoDevolucao),
      txtProtocoloDocumentoTextoBase: '', hdnIdDocumentoTextoBase: '', rdoNivelAcesso: cfg.nivelAcesso, hdnFlagDocumentoCadastro: '2' };
    const sel = n => { const x = fGer.querySelector(`select[name="${n}"]`); return x && x.options.length ? (x.options[x.selectedIndex] || x.options[0]).value : 'null'; };
    const paresGer = campos.map(n => [n, n in forcar ? forcar[n] : (n in atuais ? atuais[n] : (/^sel/.test(n) ? sel(n) : ''))]);
    const pNovo = await seiReq(fGer.getAttribute('action'), paresGer);
    const id = (pNovo.url.match(/id_documento=(\d+)/) || [])[1];
    if (!id) throw new Error('O SEI não confirmou a criação do despacho');
    const numero = (pNovo.html.match(/<span>[^<]*?(\d{6,})<\/span>/) || [])[1] || '';
    const linkEditor = (pNovo.html.match(/linkEditarConteudo\s*=\s*'([^']+)'/) || [])[1] || '';
    return { id, numero, linkEditor };
  }

  async function preencherDespachoSEI(linkEditor, d) {
    if (!linkEditor) throw new Error('Link de edição do despacho não encontrado');
    const pEd = await seiReq(linkEditor);
    const dEd = parseHTML(pEd.html);
    const urlSalvar = (pEd.html.match(/editor\/editor_processar\.php\?acao=editor_salvar[^"'\s]*/) || [])[0];
    if (!urlSalvar) throw new Error('Endereço de salvamento do editor não encontrado');
    const secoes = dEd.querySelectorAll('textarea[name^="txaEditor_"]');
    if (!secoes.length) throw new Error('Seções do editor não encontradas');
    let preenchidos = 0;
    const pares = [];
    for (let i = 0; i < secoes.length; i++) {
      let html = secoes[i].value;
      if (/Restituo|MODALIDADE|unidade gestora/i.test(html)) {
        const dd = parseHTML('<div id="r">' + html + '</div>');
        const raiz = dd.getElementById('r');
        const n = P.preencherDevolucao(dd, raiz, d);
        if (n) { preenchidos += n; html = raiz.innerHTML; }
      }
      pares.push([secoes[i].name, P.entidades(html)]);
    }
    if (!preenchidos) throw new Error('Não encontrei no texto padrão o parágrafo "Restituo..." nem a tabela MODALIDADE');
    for (const n of ['hdnVersao', 'hdnIgnorarNovaVersao', 'hdnSiglaUnidade', 'hdnInfraPrefixoCookie']) {
      const e = dEd.querySelector(`[name="${n}"]`);
      pares.push([n, e ? e.value : (n === 'hdnIgnorarNovaVersao' ? 'N' : '')]);
    }
    const salvo = await seiReq(urlSalvar, pares);
    if (!/^\s*OK/.test(salvo.html)) throw new Error('O editor não confirmou o salvamento: ' + P.texto(parseHTML(salvo.html).body).slice(0, 200));
  }

  async function incluirBlocoSEI(urlArvore, idDoc, bloco) {
    const link = P.linkBloco((await seiReq(urlArvore)).html, idDoc);
    if (!link) throw new Error('Link "Incluir em Bloco de Assinatura" do despacho não encontrado na árvore');
    let dPag = parseHTML((await seiReq(link)).html);
    const ja = P.blocoDoDocumento(dPag, idDoc);
    if (ja === null) throw new Error('O despacho não aparece na tela de inclusão em bloco');
    if (ja) { if (ja !== bloco) throw new Error(`O despacho já está no bloco ${ja}`); return; }
    if (!P.opcoesSelect(dPag, '#selBloco').some(o => o.valor === bloco)) throw new Error(`Bloco ${bloco} não está disponível na unidade atual do SEI`);
    // como no navegador: escolher o bloco recarrega a tela; depois "Incluir"
    const montarPares = (dd, incluir) => {
      const f = dd.querySelector('#frmBlocoEscolher');
      if (!f) throw new Error('Tela de inclusão em bloco não abriu');
      const chks = f.querySelectorAll('input[name^="chkDocumentosItem"]');
      let chk = null;
      for (let i = 0; i < chks.length; i++) if (chks[i].value === String(idDoc)) chk = chks[i];
      if (!chk) throw new Error('O despacho não aparece na tela de inclusão em bloco');
      const lista = P.serializarForm(f).filter(([k]) => !/^chkDocumentosItem/.test(k) && k !== 'selBloco')
        .map(([k, v]) => [k, k === 'hdnDocumentosItensSelecionados' ? String(idDoc) : v]);
      lista.splice(1, 0, ...(incluir ? [['sbmIncluir', 'Incluir']] : []), ['selBloco', bloco], [chk.name, String(idDoc)]);
      return { action: f.getAttribute('action'), lista };
    };
    let req = montarPares(dPag, false);
    dPag = parseHTML((await seiReq(req.action, req.lista)).html);
    req = montarPares(dPag, true);
    const fim = await seiReq(req.action, req.lista);
    if (P.blocoDoDocumento(parseHTML(fim.html), idDoc) !== bloco) throw new Error('O SEI não confirmou a inclusão no bloco');
  }

  async function gerarDevolucao(c) {
    const cfg = cfgSEI();
    const chave = c.sol.sei;
    const sit = situacaoDevolucao(c);
    if (sit.estado === 'aguardando') throw new Error('SF ainda não registrados: ' + sit.d.pendentes.join(', '));
    if (sit.estado === 'conferir') throw new Error(`Despacho ${sit.reg.numero || sit.reg.id} foi criado mas não preenchido: confira e preencha no SEI`);
    const { urlArvore, arv } = await abrirArvore(c.sol.sei);
    let reg = despachos()[chave] || {};
    if (!reg.id) {
      const novo = await criarDespachoSEI(arv, cfg);
      gravarDespacho(chave, { id: novo.id, numero: novo.numero, processo: c.sol.processo, preenchido: false });
      seiLog(`${c.sol.processo}: despacho ${novo.numero || novo.id} criado; preenchendo…`);
      await preencherDespachoSEI(novo.linkEditor, sit.d);
      gravarDespacho(chave, { preenchido: true });
      reg = despachos()[chave];
      seiLog(`${c.sol.processo}: despacho ${reg.numero || reg.id} preenchido (${[sit.d.sf003, sit.d.sf002].filter(Boolean).join(', ')})`, 'ok');
    }
    const bloco = String(cfg.bloco || '').replace(/\D/g, '');
    if (bloco && !reg.bloco) {
      await incluirBlocoSEI(urlArvore, reg.id, bloco);
      gravarDespacho(chave, { bloco });
      seiLog(`${c.sol.processo}: despacho ${reg.numero || reg.id} incluído no bloco ${bloco}`, 'ok');
    }
  }

  // Trava entre abas do SEI (duas abas abertas não podem gerar o mesmo despacho ao mesmo tempo)
  const ABA = Math.random().toString(36).slice(2);
  async function pegarTrava() {
    const t = GM_getValue('sf_trava_despacho', null);
    if (t && t.aba !== ABA && Date.now() - t.em < 120000) return false;
    GM_setValue('sf_trava_despacho', { aba: ABA, em: Date.now() });
    await esperar(300);
    const t2 = GM_getValue('sf_trava_despacho', null);
    return !!t2 && t2.aba === ABA;
  }
  let gerandoDespachos = false;
  async function gerarDespachosProntos() {
    if (gerandoDespachos) return;
    const alvo = seiLista().filter(c => ['pronto', 'bloco'].indexOf(situacaoDevolucao(c).estado) >= 0);
    if (!alvo.length) return;
    gerandoDespachos = true;
    try {
      if (!await pegarTrava()) { seiLog('Outra aba do SEI está gerando os despachos', 'aviso'); return; }
      for (const c of alvo) {
        try { await gerarDevolucao(c); } catch (err) { seiLog(`${c.sol.processo}: ${err.message}`, 'erro'); }
        GM_setValue('sf_trava_despacho', { aba: ABA, em: Date.now() });
      }
    } finally {
      GM_deleteValue('sf_trava_despacho');
      gerandoDespachos = false;
      renderizarSEI();
    }
  }

  /* ====================================================================== */
  if (location.hostname === 'protocolo.presidencia.gov.br') {
    if (/controlador\.php/.test(location.href)) {
      if (document.getElementById('sfPainel')) { console.warn('Concessão Suprimento: outra cópia do script já está ativa nesta página'); return; }
      renderizarSEI();
      // o SIAFI registrou um SF (outra aba): atualiza a lista e, se ligado, gera os despachos prontos
      if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener('sf_registrados', (nome, antes, depois, remoto) => {
          if (!remoto) return;
          renderizarSEI();
          if (cfgSEI().autoDespacho) gerarDespachosProntos();
        });
      }
    }
    return;
  }
  // Duas versões instaladas no Tampermonkey rodariam juntas e disputariam o painel.
  const outroPainel = document.getElementById('sfPainel');
  if (outroPainel) {
    if (outroPainel.dataset.versao === VERSAO) return; // esta mesma versão já está rodando nesta página
    alert(`Concessão de SF v${VERSAO}: há outra versão deste script ativa no Tampermonkey ` +
      `(${outroPainel.dataset.versao ? 'v' + outroPainel.dataset.versao : 'versão antiga'}). ` +
      'Desative ou apague a antiga no Painel do Tampermonkey e recarregue a página.');
    return;
  }
  renderizarPainel();
  executar();
})();

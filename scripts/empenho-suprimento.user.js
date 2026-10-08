// ==UserScript==
// @name         DevDu - Empenho Suprimento
// @namespace    https://github.com/devdulab
// @version      1.0.0
// @description  Lê despachos no SEI, emite/reforça/anula empenhos de suprimento de fundos no Contratos.gov.br e devolve despacho com o resultado
// @author       DevDu
// @icon         https://raw.githubusercontent.com/devdulab/scripts/main/assets/devdu-icon-64.png
// @match        https://protocolo.presidencia.gov.br/*
// @require      https://raw.githubusercontent.com/devdulab/scripts/main/lib/devdu-ui.js?v=1.0.0
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      contratos.comprasnet.gov.br
// @updateURL    https://raw.githubusercontent.com/devdulab/scripts/main/scripts/empenho-suprimento.user.js
// @downloadURL  https://raw.githubusercontent.com/devdulab/scripts/main/scripts/empenho-suprimento.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SEI_BASE = 'https://protocolo.presidencia.gov.br/';
  const CT = 'https://contratos.comprasnet.gov.br';

  // ---------------------------------------------------------------------------
  // Configuração
  // ---------------------------------------------------------------------------
  const CFG_PADRAO = {
    descricaoMinuta: 'TEXTO PADRONIZADO',
    localEntrega: 'BRASILIA/DF',
    tipoEmpenho: 'Estimativo',
    amparos: 'DECRETO 93.872 / 1986 - Artigo: 47\nDECRETO 93.872 / 1986 - Artigo: 45 - Inciso: I',
    esfera: '1',
    fontePadrao: '1000000000',
    ptres: '168492, 228546',
    subelemento: '96',
    itemPorNd: '339030=Material\n339033=Serviço\n339039=Serviço',
    textoRetorno: '4363',
    ugrs: '110014, 110799, 110013, 110017',
    serieDespacho: 'Despacho',
    nivelAcesso: '0',
    pollSegundos: '5',
    pollTentativas: '36',
    blocoAssinatura: '',
    padroesProcesso: '00150 | 168492 | 110014 | 47\n00094 | 168492 | 110014 | 47\n00200 | 168492 | 110014 | 45\n00185 | 228546 | | 47',
  };

  // ---------------------------------------------------------------------------
  // Utilidades puras (testáveis fora do navegador)
  // ---------------------------------------------------------------------------
  const U = {};

  U.norm = (s) => String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  U.semAcento = (s) => U.norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  U.digitos = (s) => String(s || '').replace(/\D/g, '');

  U.parseBRL = (s) => {
    const t = U.norm(s).replace(/R\$\s*/i, '').replace(/\s/g, '');
    if (!/\d/.test(t)) return NaN;
    return Number(t.replace(/\./g, '').replace(',', '.'));
  };
  U.fmtBRL = (n) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  U.fmtDecimalVirgula = (n) => Number(n).toFixed(2).replace('.', ',');
  U.numStr = (n) => String(Math.round(Number(n) * 100) / 100);

  U.cpfValido = (cpf) => {
    const c = U.digitos(cpf);
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
    const dv = (len) => {
      let s = 0;
      for (let i = 0; i < len; i++) s += Number(c[i]) * (len + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
  };

  U.fmtCPF = (cpf) => U.digitos(cpf).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

  // Converte para ASCII puro trocando não-ASCII por entidade HTML (para conteúdo do editor SEI)
  U.entidades = (html) => String(html).replace(/[^\x00-\x7F]/g, (ch) => '&#' + ch.codePointAt(0) + ';');

  // Codificação application/x-www-form-urlencoded em ISO-8859-1 (SEI)
  U.encLatin1 = (s) => {
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
  U.formLatin1 = (pares) => pares.map(([k, v]) => U.encLatin1(k) + '=' + U.encLatin1(v == null ? '' : v)).join('&');

  U.formUtf8 = (pares) => {
    const p = new URLSearchParams();
    pares.forEach(([k, v]) => p.append(k, v == null ? '' : String(v)));
    return p.toString();
  };

  U.chaveTexto = (s) => U.semAcento(s).replace(/\s+/g, '');
  U.lista = (txt) => String(txt || '').split(/\n/).map((x) => U.norm(x)).filter(Boolean);

  U.parseItemPorNd = (txt) => {
    const m = {};
    String(txt || '').split(/\n|;/).forEach((l) => {
      const [nd, item] = l.split('=').map((x) => U.norm(x));
      if (nd && item) m[nd] = item;
    });
    return m;
  };

  // Parâmetros de DataTables (yajra) no formato que o navegador envia
  // cols: [[data, searchable, orderable], ...]
  U.dtParams = (cols, { nomeIgualData = true, length = 100, order = null, draw = 1, busca = '' } = {}) => {
    const p = [['draw', String(draw)]];
    cols.forEach(([data, searchable, orderable], i) => {
      p.push([`columns[${i}][data]`, data]);
      p.push([`columns[${i}][name]`, nomeIgualData ? data : '']);
      p.push([`columns[${i}][searchable]`, String(searchable)]);
      p.push([`columns[${i}][orderable]`, String(orderable)]);
      p.push([`columns[${i}][search][value]`, '']);
      p.push([`columns[${i}][search][regex]`, 'false']);
    });
    if (order) {
      p.push(['order[0][column]', String(order[0])]);
      p.push(['order[0][dir]', order[1]]);
    }
    p.push(['start', '0'], ['length', String(length)], ['search[value]', busca], ['search[regex]', 'false']);
    return p;
  };

  const DT = {
    item: [['action', false, false], ['numero', true, true], ['descricao', true, true], ['codigo_siasg', true, true],
      ['descricaosimplificada', true, true], ['quantidade_saldo', true, true], ['valor_unitario', true, true], ['valor_negociado', true, true]],
    saldo: [['btn_selecionar', true, true], ['esfera', true, true], ['ptrs', true, true], ['fonte', true, true], ['nd', true, true],
      ['ugr', true, true], ['plano_interno', true, true], ['saldo', true, true], ['action', false, false]],
    sub: [['ci_id', false, false], ['descricao', false, false], ['codigo_siasg', true, true], ['numero_item', false, false],
      ['descricaosimplificada', true, true], ['qtd_item', true, true], ['valorunitario', true, true], ['valor_total_item', true, true],
      ['natureza_despesa', true, true], ['subitem', false, false], ['quantidade', false, false], ['valor_total', false, false]],
    altdt: [['ci_id', false, false], ['descricao', false, false], ['codigo_siasg', true, true], ['numero_item', false, false],
      ['descricaosimplificada', true, true], ['qtd_item', true, true], ['valorunitario', true, true], ['valor_total_item', true, true],
      ['qtd_total_item', true, true], ['vlr_total_item', true, true], ['natureza_despesa', true, true], ['subitem', false, false],
      ['tipo_alteracao', false, false], ['quantidade', false, false], ['valor_total', false, false]],
  };
  DT.minSearch = Array.from({ length: 20 }, (_, i) => [String(i), true, !(i === 0 || i === 19)]);
  DT.altSearch = Array.from({ length: 19 }, (_, i) => [String(i), true, !(i === 16 || i === 18)]);
  U.DT = DT;

  // ---------------------------------------------------------------------------
  // Parsers (recebem um parseHTML(str) → Document)
  // ---------------------------------------------------------------------------
  const P = {};

  // Documento de origem (despacho no SEI)
  P.extrairDocumento = (doc) => {
    const corpo = doc.body;
    const textoTodo = U.norm(corpo.textContent);
    const r = { erros: [], avisos: [], linhas: [] };

    const proc = textoTodo.match(/\d{5}\.\d{6}\/\d{4}-\d{2}/);
    r.processo = proc ? proc[0] : '';

    const assuntoM = textoTodo.match(/Assunto:\s*(.{0,60})/i);
    r.assunto = assuntoM ? U.norm(assuntoM[1]) : '';

    // Tabela de identificação (rótulo | valor): UNIDADE GESTORA / CPF
    const rotulos = {};
    corpo.querySelectorAll('table tr').forEach((tr) => {
      const tds = tr.querySelectorAll('td,th');
      if (tds.length !== 2) return;
      const rot = U.semAcento(tds[0].textContent);
      const val = U.norm(tds[1].textContent);
      if (/^(UNIDADE GESTORA|UG)$/.test(rot)) rotulos.ug = val;
      else if (/^CPF$/.test(rot)) rotulos.cpf = val;
    });

    // UG: tabela de identificação; senão texto "UG da SA Peculiaridades 110.809" / "na UG 110809:"
    const ugTab = (rotulos.ug || '').match(/^(\d{3})\.?(\d{3})$/);
    const ugM = ugTab || textoTodo.match(/\bUG\b[^0-9]{0,80}?(\d{3})\.?(\d{3})\b/i);
    r.ug = ugM ? ugM[1] + ugM[2] : '';
    if (rotulos.ug && !ugTab) r.erros.push(`UG inválida na tabela: ${rotulos.ug}`);

    // CPF: tabela de identificação ou texto com a palavra CPF
    const cpfs = new Set();
    if (rotulos.cpf && /\d/.test(rotulos.cpf)) cpfs.add(U.digitos(rotulos.cpf));
    const reCpf = /CPF\s*(?:n[º°o.]*\s*)?:?\s*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/gi;
    let m;
    while ((m = reCpf.exec(textoTodo))) cpfs.add(U.digitos(m[1]));
    r.cpf = '';
    if (cpfs.size > 1) r.erros.push('Mais de um CPF no documento');
    else if (cpfs.size === 1) {
      const c = [...cpfs][0];
      if (!U.cpfValido(c)) r.erros.push('CPF com dígito verificador inválido');
      else r.cpf = c;
    }

    // Tabelas
    let tipoTabela = '';
    corpo.querySelectorAll('table').forEach((tb) => {
      const trs = [...tb.querySelectorAll('tr')];
      if (!trs.length) return;
      const cab = U.semAcento(trs[0].textContent);
      let tipo = '';
      if (/NATUREZA/.test(cab) && /VALOR/.test(cab)) tipo = 'ND';
      else if (/EMPENHO/.test(cab) && /VALOR/.test(cab)) tipo = 'NE';
      if (!tipo) return;
      tipoTabela = tipoTabela || tipo;
      trs.slice(1).forEach((tr) => {
        const tds = [...tr.querySelectorAll('td')].map((td) => U.norm(td.textContent));
        if (!tds.length || !tds[0]) return;
        const chave = tds[0].replace(/\s/g, '').toUpperCase();
        // Linha do modelo não usada: sem valor, ou NE incompleta ("2026NE000") com "R$" vazio
        if (!/\d/.test(tds[1] || '')) {
          if (tipo === 'NE' && /^\d{4}NE\d{6}$/.test(chave)) r.erros.push(`Empenho ${chave} sem valor`);
          return;
        }
        const valor = U.parseBRL(tds[1] || '');
        if (tipo === 'ND') {
          if (!/^\d{6}$/.test(chave)) { r.erros.push(`Natureza inválida: ${tds[0]}`); return; }
          r.linhas.push({ nd: chave, valor });
        } else {
          if (!/^\d{4}NE\d{6}$/.test(chave)) { r.erros.push(`Nota de empenho inválida: ${tds[0]}`); return; }
          r.linhas.push({ ne: chave, valor });
        }
        if (!(valor > 0)) r.erros.push(`Valor inválido na linha ${tds[0]}`);
      });
    });

    const ref = U.semAcento(r.assunto + ' ' + textoTodo);
    if (tipoTabela === 'ND') r.operacao = 'emissao';
    else if (tipoTabela === 'NE') {
      const a = U.semAcento(r.assunto);
      if (/ANULA/.test(a)) r.operacao = 'anulacao';
      else if (/REFORC/.test(a)) r.operacao = 'reforco';
      else if (/ANULA/.test(ref)) r.operacao = 'anulacao';
      else if (/REFORC/.test(ref)) r.operacao = 'reforco';
      else r.erros.push('Não foi possível identificar se é reforço ou anulação');
    } else r.erros.push('Tabela de naturezas/empenhos não encontrada');

    if (!r.ug) r.erros.push('UG não encontrada no documento');
    if (!r.linhas.length && tipoTabela) r.erros.push('Nenhuma linha preenchida na tabela');
    if (r.operacao === 'emissao') {
      const vistos = new Set();
      r.linhas.forEach((l) => { if (vistos.has(l.nd)) r.erros.push(`Natureza ${l.nd} repetida`); vistos.add(l.nd); });
    }
    return r;
  };

  // Árvore do processo (procedimento_visualizar)
  P.arvore = (html) => {
    const nos = {};
    const reNo = /Nos\[(\d+)\]\s*=\s*new infraArvoreNo\("([A-Z_]+)","(\d+)",(?:"(\d+)"|null),"([^"]*)","[^"]*","([^"]*)"/g;
    let m;
    while ((m = reNo.exec(html))) nos[m[1]] = { tipo: m[2], id: m[3], link: m[5], rotulo: m[6] };
    const reSrc = /Nos\[(\d+)\]\.src\s*=\s*'([^']*)'/g;
    while ((m = reSrc.exec(html))) if (nos[m[1]]) nos[m[1]].src = m[2];
    const lista = Object.values(nos);
    const proc = lista.find((n) => n.tipo === 'PROCESSO');
    const esc = html.match(/controlador\.php\?acao=documento_escolher_tipo[^"'\s]*/);
    return {
      idProcedimento: proc ? proc.id : '',
      processo: proc ? proc.rotulo : '',
      linkEscolherTipo: esc ? esc[0].replace(/&amp;/g, '&') : '',
      documentos: lista.filter((n) => n.tipo === 'DOCUMENTO'),
    };
  };

  // Formulário genérico → lista de pares, imitando o navegador
  P.serializarForm = (form) => {
    const pares = [];
    [...form.elements].forEach((el) => {
      if (!el.name || el.disabled) return;
      const t = (el.type || '').toLowerCase();
      if (t === 'button' || t === 'submit' || t === 'file') return;
      if ((t === 'radio' || t === 'checkbox') && !el.checked) return;
      if (el.tagName === 'SELECT') {
        if (el.multiple) { [...el.options].filter((o) => o.selected).forEach((o) => pares.push([el.name, o.value])); return; }
        const o = el.options[el.selectedIndex] || el.options[0];
        if (o) pares.push([el.name, o.value]);
        return;
      }
      pares.push([el.name, el.value]);
    });
    return pares;
  };

  // Contratos: UG da sessão, token
  P.ugAtual = (html) => { const m = html.match(/UG\/UASG:\s*<b>\s*(\d{6})\s*<\/b>/i); return m ? m[1] : ''; };
  P.csrf = (html) => {
    const m = html.match(/name="csrf-token"\s+content="([^"]+)"/) || html.match(/name="_token"\s+value="([^"]+)"/);
    return m ? m[1] : '';
  };
  P.opcoesSelect = (doc, seletor) => {
    const sel = doc.querySelector(seletor);
    if (!sel) return [];
    return [...sel.options].map((o) => ({ valor: o.value, texto: U.norm(o.textContent) })).filter((o) => o.valor !== '');
  };
  P.mapaUgs = (doc) => {
    const r = {};
    P.opcoesSelect(doc, 'select#ug, select[name="ug"]').forEach((o) => { const c = o.texto.slice(0, 6); if (/^\d{6}$/.test(c)) r[c] = o.valor; });
    return r;
  };

  // Tela "show" da minuta: pares rótulo → valor
  P.camposShow = (doc) => {
    const r = {};
    doc.querySelectorAll('tr').forEach((tr) => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 2) return;
      const st = tds[0].querySelector('strong');
      if (!st) return;
      const span = tds[1].querySelector('span[title]');
      const v = span && span.getAttribute('title') ? span.getAttribute('title') : tds[1].textContent;
      r[U.norm(st.textContent)] = U.norm(v);
    });
    return r;
  };

  // Linhas de datatables de lista (HTML em cada célula)
  P.celTexto = (parseHTML, cel) => U.norm(parseHTML('<div>' + String(cel) + '</div>').body.textContent);

  P.erroSiafi = (msg) => /^\(\d+\)/.test(U.norm(msg));

  // Padrões da emissão pelo início do número do processo. Uma regra por linha:
  // "início do processo | PTRES | UGR | amparo | fonte" (campos vazios ou ausentes ficam de fora).
  // Amparo: número do artigo ("47", "art. 45") ou trecho do texto de um item da lista de amparos.
  P.padraoProcesso = (processo, regras, amparos) => {
    const proc = U.digitos(processo);
    if (!proc) return {};
    for (const linha of U.lista(regras)) {
      const [prefixo, ptres, ugr, amparo, fonte] = linha.split('|').map((x) => U.norm(x));
      if (!U.digitos(prefixo) || !proc.startsWith(U.digitos(prefixo))) continue;
      const r = {};
      if (U.digitos(ptres)) r.ptres = U.digitos(ptres);
      if (U.digitos(ugr)) r.ugr = U.digitos(ugr);
      if (U.digitos(fonte)) r.fonte = U.digitos(fonte);
      if (amparo) {
        const art = (amparo.match(/^(?:art\w*\.?\s*)?(\d+)$/i) || [])[1];
        const a = amparos.find((x) => (art ? new RegExp(`ARTIGO:\\s*${art}(\\D|$)`).test(U.semAcento(x)) : U.chaveTexto(x).includes(U.chaveTexto(amparo))));
        if (a) r.amparo = a;
      }
      return r;
    }
    return {};
  };

  // Linha que ficou pela metade numa execução anterior (minuta/alteração criada sem NE confirmada).
  // etapa: 'criada' (não chegou a ir ao SIAFI) ou 'enviada'; consulta: { msg, sit } lidos agora no Contratos.
  P.decidirPendente = (etapa, consulta) => {
    if (!consulta) return { acao: 'aguardar', motivo: 'não foi localizada no Contratos' };
    const msg = U.norm(consulta && consulta.msg);
    const sit = U.norm(consulta && consulta.sit);
    const ne = (msg.match(/\d{4}NE\d{6}/) || [])[0];
    if (ne && /EMITIDO/i.test(sit)) return { acao: 'concluida', ne };
    if (P.erroSiafi(msg)) return { acao: 'refazer', motivo: `foi recusada pelo SIAFI (${msg})` };
    if (etapa === 'criada' && !/PROCESSAMENTO|EMITIDO/i.test(sit)) return { acao: 'refazer', motivo: 'não chegou a ser enviada ao SIAFI' };
    return { acao: 'aguardar', motivo: sit ? `está "${sit}"` : 'está sem retorno do SIAFI' };
  };

  // SEI: link "Incluir em Bloco de Assinatura" de um documento (árvore do processo ou arvore_visualizar)
  P.linkBloco = (html, idDocumento) => {
    const re = /controlador\.php\?acao=bloco_escolher[^"'\s]*/g;
    let m;
    while ((m = re.exec(html))) {
      const u = m[0].replace(/&amp;/g, '&');
      if (new RegExp(`[?&]id_documento=${idDocumento}(&|$)`).test(u)) return u;
    }
    return '';
  };

  // SEI, tela bloco_escolher: número do bloco em que o documento já está ('' se em nenhum; null se o documento não aparece)
  P.blocoDoDocumento = (doc, idDocumento) => {
    const chk = [...doc.querySelectorAll('input[name^="chkDocumentosItem"]')].find((i) => i.value === String(idDocumento));
    if (!chk) return null;
    const a = chk.closest('tr').querySelector('a[href*="id_bloco="]');
    return a ? (a.getAttribute('href').match(/id_bloco=(\d+)/) || [])[1] || '' : '';
  };

  // Monta a tabela do despacho de retorno dentro do HTML de uma seção do editor
  P.preencherTabela = (doc, raiz, linhas) => {
    const tabelas = [...raiz.querySelectorAll('table')];
    const tb = tabelas.find((t) => {
      const tr = t.querySelector('tr');
      if (!tr) return false;
      const cab = U.semAcento(tr.textContent);
      return /VALOR/.test(cab) && (/EMPENHO/.test(cab) || /NATUREZA/.test(cab));
    });
    if (!tb) return false;
    const trs = [...tb.querySelectorAll('tr')];
    const cab = trs[0];
    const colunas = [...cab.querySelectorAll('td,th')].map((c) => {
      const t = U.semAcento(c.textContent);
      if (/NATUREZA/.test(t)) return 'nd';
      if (/EMPENHO|NOTA/.test(t)) return 'ne';
      if (/VALOR/.test(t)) return 'valor';
      if (/OPERA|TIPO/.test(t)) return 'op';
      return '';
    });
    let modelo = (trs[1] || cab).cloneNode(true);
    // Sem coluna de empenho (ex.: tabela NATUREZA × VALOR): cria "NOTA DE EMPENHO" logo após a natureza
    if (!colunas.includes('ne') && linhas.some((l) => l.ne)) {
      const idx = colunas.includes('nd') ? colunas.indexOf('nd') : 0;
      const inserir = (tr, texto) => {
        const cels = tr.querySelectorAll('td,th');
        const ref = cels[idx];
        if (!ref) return;
        const nova = ref.cloneNode(true);
        let alvo = nova;
        while (alvo.children.length === 1) alvo = alvo.children[0];
        alvo.textContent = texto;
        ref.parentNode.insertBefore(nova, ref.nextSibling);
      };
      inserir(cab, 'NOTA DE EMPENHO');
      inserir(modelo, '');
      colunas.splice(idx + 1, 0, 'ne');
    }
    trs.slice(1).forEach((tr) => tr.parentNode.removeChild(tr));
    const pai = cab.parentNode;
    linhas.forEach((l) => {
      const novo = modelo.cloneNode(true);
      [...novo.querySelectorAll('td,th')].forEach((td, i) => {
        let alvo = td;
        while (alvo.children.length === 1) alvo = alvo.children[0];
        const col = colunas[i];
        let txt = '';
        if (col === 'nd') txt = l.nd || '';
        else if (col === 'ne') txt = l.ne || '';
        else if (col === 'valor') txt = 'R$ ' + U.fmtBRL(l.valor);
        else if (col === 'op') txt = l.op || '';
        alvo.textContent = txt;
      });
      pai.appendChild(novo);
    });
    return true;
  };

  // Tabelas de rótulo/valor: primeira coluna é o rótulo, segunda recebe o dado
  P.preencherRotulos = (raiz, dados) => {
    let n = 0;
    raiz.querySelectorAll('table').forEach((tb) => {
      tb.querySelectorAll('tr').forEach((tr) => {
        const tds = tr.querySelectorAll('td,th');
        if (tds.length !== 2) return;
        const rot = U.semAcento(tds[0].textContent);
        let v = null;
        if (/^(UNIDADE GESTORA|UG)$/.test(rot)) v = dados.ug;
        else if (/^UGR$|RESPONSAVEL/.test(rot)) v = dados.ugr;
        else if (/^CPF$/.test(rot)) v = dados.cpf;
        else if (/^PROCESSO$/.test(rot)) v = dados.processo;
        if (v == null) return;
        let alvo = tds[1];
        while (alvo.children.length === 1) alvo = alvo.children[0];
        alvo.textContent = v || '-';
        n++;
      });
    });
    return n;
  };

  // Sem {OPERACAO} no texto: escreve a operação num parágrafo logo antes da tabela de empenhos
  P.inserirOperacao = (doc, raiz, texto) => {
    const tb = [...raiz.querySelectorAll('table')].find((t) => { const tr = t.querySelector('tr'); return tr && /VALOR/.test(U.semAcento(tr.textContent)); });
    if (!tb) return false;
    const p = doc.createElement('p');
    p.className = 'Texto_Alinhado_Esquerda';
    const b = doc.createElement('strong');
    b.textContent = texto;
    p.appendChild(b);
    tb.parentNode.insertBefore(p, tb);
    return true;
  };

  // Monta "N. Informo ... conforme abaixo:" + tabela NATUREZA | NOTA DE EMPENHO | VALOR antes do "Atenciosamente"
  P.inserirBlocoRetorno = (doc, raiz, intro, linhas) => {
    const ps = [...raiz.querySelectorAll('p')];
    const fecho = ps.find((p) => /^Atenciosamente/i.test(U.norm(p.textContent)));
    const numerado = ps.some((p) => /Paragrafo_Numerado_Nivel1/.test(p.className));
    const pIntro = doc.createElement('p');
    pIntro.className = numerado ? 'Paragrafo_Numerado_Nivel1' : 'Texto_Justificado';
    pIntro.textContent = intro;
    const tb = doc.createElement('table');
    tb.setAttribute('border', '1'); tb.setAttribute('cellpadding', '1'); tb.setAttribute('cellspacing', '1');
    tb.setAttribute('style', 'width:420px; margin-left:auto; margin-right:auto');
    const tbody = doc.createElement('tbody');
    const linha = (cels) => {
      const tr = doc.createElement('tr');
      cels.forEach((t) => {
        const td = doc.createElement('td');
        const p = doc.createElement('p');
        p.className = 'Tabela_Texto_Centralizado';
        p.textContent = t;
        td.appendChild(p);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    };
    linha(['NATUREZA', 'NOTA DE EMPENHO', 'VALOR (R$)']);
    linhas.forEach((l) => linha([l.nd || '', l.ne || '', U.fmtBRL(l.valor)]));
    tb.appendChild(tbody);
    const vazio = doc.createElement('p');
    vazio.className = 'Texto_Alinhado_Esquerda';
    vazio.innerHTML = '&nbsp;';
    const pai = fecho ? fecho.parentNode : raiz;
    [pIntro, tb, vazio].forEach((n) => (fecho ? pai.insertBefore(n, fecho) : pai.appendChild(n)));
    return true;
  };

  P.substituirVariaveis = (html, vars) =>
    String(html).replace(/\{(\w+)\}/g, (t, k) => (Object.prototype.hasOwnProperty.call(vars, k.toUpperCase()) ? vars[k.toUpperCase()] : t));

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { U, P, DT, CFG_PADRAO };
    return;
  }

  // ===========================================================================
  // A partir daqui: só no navegador
  // ===========================================================================
  if (window.top !== window.self) return;
  if (!/controlador\.php/.test(location.href)) return;

  const parseHTML = (s) => new DOMParser().parseFromString(s, 'text/html');
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const anoAtual = () => new Date().getFullYear();

  const cfg = () => Object.assign({}, CFG_PADRAO, GM_getValue('cfg', {}));
  const registro = () => GM_getValue('registro', {});
  const gravarRegistro = (chave, dados) => { const r = registro(); r[chave] = Object.assign({}, r[chave] || {}, dados, { em: new Date().toISOString() }); GM_setValue('registro', r); };

  // ---------------------------------------------------------------------------
  // HTTP — SEI (mesma origem, ISO-8859-1)
  // ---------------------------------------------------------------------------
  const seiAbs = (u) => new URL(u.replace(/&amp;/g, '&'), SEI_BASE).href;
  async function seiReq(url, pares) {
    const opt = { credentials: 'include' };
    if (pares) {
      opt.method = 'POST';
      opt.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      opt.body = U.formLatin1(pares);
    }
    const r = await fetch(seiAbs(url), opt);
    const buf = await r.arrayBuffer();
    const txt = new TextDecoder('windows-1252').decode(buf);
    if (!r.ok) throw new Error(`SEI respondeu ${r.status}`);
    if (/acao=(infra_)?login|sip\/login/i.test(r.url)) throw new Error('Sessão do SEI expirada');
    return { url: r.url, html: txt };
  }

  // ---------------------------------------------------------------------------
  // HTTP — Contratos (outra origem, via GM_xmlhttpRequest, UTF-8)
  // ---------------------------------------------------------------------------
  let ctToken = '';
  function gmReq({ method = 'GET', url, data, headers = {} }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url: url.startsWith('http') ? url : CT + url, data, headers, anonymous: false, timeout: 120000,
        onload: (r) => resolve({ status: r.status, url: r.finalUrl || url, texto: r.responseText }),
        onerror: () => reject(new Error('Falha de rede ao acessar o Contratos')),
        ontimeout: () => reject(new Error('Tempo esgotado no Contratos')),
      });
    });
  }
  async function ct(method, url, pares, { ajax = false } = {}) {
    const headers = {};
    if (ajax) { headers['X-Requested-With'] = 'XMLHttpRequest'; if (ctToken) headers['X-CSRF-TOKEN'] = ctToken; }
    let data;
    if (pares) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      data = U.formUtf8(pares.map(([k, v]) => [k, v === '__TOKEN__' ? ctToken : v]));
    }
    const r = await gmReq({ method, url, data, headers });
    if (/\/login|acesso\.gov|sso\.acesso/i.test(r.url)) throw new Error('Sessão do Contratos expirada: faça login em outra aba e tente de novo');
    if (r.status === 419) throw new Error('Token do Contratos expirou (419): recarregue o Contratos e tente de novo');
    if (r.status >= 400) throw new Error(`Contratos respondeu ${r.status} em ${url.split('?')[0]}`);
    if (!ajax) { const t = P.csrf(r.texto); if (t) ctToken = t; }
    return r;
  }
  const ctJson = (r) => { try { return JSON.parse(r.texto); } catch (e) { throw new Error('Resposta inesperada do Contratos'); } };
  const ctGet = (url, q) => ct('GET', q ? url + (url.includes('?') ? '&' : '?') + U.formUtf8(q) : url, null, { ajax: !!q });
  const ctDT = async (path, cols, opts = {}) => {
    const q = U.dtParams(cols, opts);
    q.push(['_', String(Date.now())]);
    return ctJson(await ctGet(path, q)).data || [];
  };
  const ctPost = (url, pares, ajax = false) => ct('POST', url, pares, { ajax });

  function alertaContratos(html) {
    const d = parseHTML(html);
    const msgs = [...d.querySelectorAll('.alert-danger, .invalid-feedback, .help-block')].map((e) => U.norm(e.textContent)).filter(Boolean);
    const js = [...html.matchAll(/new\s+PNotify\(\{[\s\S]*?text:\s*["'`]([^"'`]+)["'`]/g)].map((m) => U.norm(m[1]));
    return [...msgs, ...js].join(' | ');
  }

  // ---------------------------------------------------------------------------
  // Contratos — UG
  // ---------------------------------------------------------------------------
  async function ugDaSessao() { return P.ugAtual((await ct('GET', '/inicio')).texto); }

  async function garantirUG(ug, log) {
    const atual = await ugDaSessao();
    if (atual === ug) return atual;
    const pag = await ct('GET', '/mudar-ug');
    const mapa = P.mapaUgs(parseHTML(pag.texto));
    if (!mapa[ug]) throw new Error(`A UG ${ug} não está entre as unidades do seu acesso no Contratos`);
    log(`Trocando UG do Contratos: ${atual} → ${ug}`);
    const r = await ctPost('/mudaug', [['_method', 'PUT'], ['_token', '__TOKEN__'], ['ug', mapa[ug]]]);
    const nova = P.ugAtual(r.texto) || (await ugDaSessao());
    if (nova !== ug) throw new Error(`Não consegui trocar para a UG ${ug} (sessão está em ${nova || '?'})`);
    return atual;
  }

  // ---------------------------------------------------------------------------
  // Contratos — Emissão (uma natureza = uma minuta = uma NE)
  // ---------------------------------------------------------------------------
  async function emitir(docInfo, linha, log) {
    const c = cfg();
    const ano = anoAtual();
    const referrer = `${CT}/empenho/minuta?ano_criacao=${ano}`;
    const itemNome = U.parseItemPorNd(c.itemPorNd)[linha.nd];
    if (!itemNome) throw new Error(`Natureza ${linha.nd} sem item configurado (Material/Serviço)`);

    // 1. Credor
    await ct('GET', '/empenho/buscacompra');
    // O Contratos só acha o suprido pelo CPF formatado (xxx.xxx.xxx-xx); a UG vai como número
    const q = docInfo.cpf || docInfo.ug;
    const sup = ctJson(await ctGet('/api/suprido', [['q', docInfo.cpf ? U.fmtCPF(docInfo.cpf) : docInfo.ug], ['form[0][name]', '_token'], ['form[0][value]', ctToken],
      ['form[1][name]', 'tipoEmpenho'], ['form[1][value]', '3'], ['form[2][name]', 'http_referrer'], ['form[2][value]', referrer]]));
    const cand = (sup.data || []).filter((s) => U.digitos(String(s.cpf_cnpj_idgener).split(' - ')[0]) === q);
    if (cand.length !== 1) throw new Error(`Credor ${q} ${cand.length ? 'ambíguo' : 'não encontrado'} no Contratos`);
    const fornecedor = String(cand[0].id);

    // 2. Cria a minuta
    let r = await ctPost('/empenho/buscacompra', [['_token', '__TOKEN__'], ['tipoEmpenho', '3'], ['http_referrer', referrer], ['fornecedor_empenho_id', fornecedor]]);
    let m = r.url.match(/\/empenho\/item\/(\d+)\/(\d+)/);
    if (!m) throw new Error('Minuta não criada: ' + (alertaContratos(r.texto) || r.url));
    const minuta = m[1];
    log(`  minuta ${minuta} criada`);
    gravarRegistro(docInfo.chave(linha), { minuta, etapa: 'criada' });

    // 3. Item
    const itens = await ctDT(`/empenho/item/${minuta}/${fornecedor}`, DT.item, { order: [0, 'desc'] });
    const item = itens.find((i) => U.semAcento(i.descricao) === U.semAcento(itemNome));
    if (!item) throw new Error(`Item "${itemNome}" não encontrado na compra de suprimento`);
    r = await ctPost('/empenho/item', [['minuta_id', minuta], ['fornecedor_id', fornecedor], ['_token', '__TOKEN__'],
      ['dataTableBuilder_length', '10'], ['itens[][compra_item_id]', item.id]]);
    if (!/\/empenho\/saldo\/\d+/.test(r.url)) throw new Error('Falha ao gravar o item: ' + (alertaContratos(r.texto) || r.url));
    const pagSaldo = parseHTML(r.texto);
    const unidade = P.opcoesSelect(pagSaldo, '#cb_unidade').find((o) => o.texto.startsWith(docInfo.ug));
    if (!unidade) throw new Error(`UG ${docInfo.ug} não aparece na lista de unidades da tela de saldo`);

    // 4. Célula orçamentária (ND + UGR)
    const buscarCelulas = async () => (await ctDT(`/empenho/saldo/${minuta}`, DT.saldo))
      .filter((s) => U.norm(s.nd) === linha.nd && U.norm(s.ugr) === U.norm(docInfo.ugr) && U.norm(s.ptrs) === docInfo.ptres
        && U.norm(s.fonte) === docInfo.fonte && U.norm(s.esfera) === String(c.esfera).trim())
      .map((s) => ({ id: String(s.id), saldo: U.parseBRL(s.saldo), ptres: s.ptrs, fonte: s.fonte, pi: U.norm(s.plano_interno) }));
    let cel = await buscarCelulas();
    if (cel.length && !cel.some((x) => x.saldo >= linha.valor)) {
      log('  saldo insuficiente na lista; atualizando saldos da unidade…');
      try { await ctGet(`/api/atualizasaldos/unidade/${docInfo.ug}`, []); } catch (e) { /* segue */ }
      cel = await buscarCelulas();
    }
    const celTxt = `ND ${linha.nd} · UGR ${docInfo.ugr} · PTRES ${docInfo.ptres} · fonte ${docInfo.fonte}`;
    if (!cel.length) throw new Error(`Célula orçamentária não encontrada no Contratos (${celTxt})`);
    let escolhida;
    const comSaldo = cel.filter((x) => x.saldo >= linha.valor);
    if (!comSaldo.length) throw new Error(`Saldo insuficiente (${celTxt}; maior saldo R$ ${U.fmtBRL(Math.max(...cel.map((x) => x.saldo)))})`);
    if (comSaldo.length === 1) escolhida = comSaldo[0];
    else {
      const txt = comSaldo.map((x, i) => `${i + 1}) PI ${x.pi || '(vazio)'} · saldo R$ ${U.fmtBRL(x.saldo)}`).join('\n');
      const n = Number(prompt(`SEI ${docInfo.sei} · ${celTxt}\nMais de uma célula com saldo (plano interno diferente). Qual usar?\n\n${txt}`, '1'));
      escolhida = comSaldo[n - 1];
      if (!escolhida) throw new Error('Escolha de célula cancelada');
    }
    r = await ctPost('/empenho/saldo/gravar/saldo/minuta', [['_token', '__TOKEN__'], ['minuta_id', minuta], ['cb_unidade', unidade.valor],
      ['dataTableBuilder_length', '10'], ['saldo', escolhida.id]]);
    if (!/\/empenho\/subelemento\/\d+/.test(r.url)) throw new Error('Falha ao gravar a célula: ' + (alertaContratos(r.texto) || r.url));

    // 5. Subelemento e valor
    const subs = await ctDT(`/empenho/subelemento/${minuta}`, DT.sub, { order: [0, 'desc'] });
    const sub = subs.find((s) => String(s.compra_item_id) === String(item.id));
    if (!sub) throw new Error('Item não encontrado na tela de subelemento');
    if (sub.natureza_despesa && String(sub.natureza_despesa) !== linha.nd) throw new Error(`Natureza da célula (${sub.natureza_despesa}) difere da solicitada (${linha.nd})`);
    const dSub = parseHTML('<div>' + sub.subitem + sub.valorunitario + sub.valor_total_item + '</div>');
    const opt = [...dSub.querySelectorAll('select.subitem option, select[name="subitem[]"] option')]
      .find((o) => new RegExp('^0?' + c.subelemento + '\\s*-').test(U.norm(o.textContent)));
    if (!opt) throw new Error(`Subelemento ${c.subelemento} não disponível para a ND ${linha.nd}`);
    const hid = (n) => { const e = dSub.querySelector(`input[name="${n}"]`); return e ? e.value : ''; };
    const valorUnit = hid('valorunitario_item[]') || '1.0000';
    if (Number(valorUnit) !== 1) throw new Error(`Valor unitário inesperado no item (${valorUnit})`);
    const credito = String(sub.saldo);
    const valor = linha.valor;
    const paresSub = [['minuta_id', minuta], ['credito', credito], ['valor_utilizado', U.numStr(valor)], ['fonte_alterada', ''],
      ['_token', '__TOKEN__'], ['dataTableBuilder_length', '10'],
      ['valorunitario_item[]', valorUnit], ['valorunitario_original[]', hid('valorunitario_original[]') || valorUnit],
      ['numero_item[]', hid('numero_item[]') || sub.numero_item], ['valor_total_item[]', hid('valor_total_item[]') || '1'],
      ['compra_item_id[]', item.id], ['subitem[]', opt.value], ['qtd[]', Number(valor).toFixed(5)],
      ['quantidade_total[]', Number(sub.qtd_item || 1).toFixed(5)], ['valor_total[]', U.fmtDecimalVirgula(valor)]];
    r = await ctPost('/empenho/subelemento', paresSub);
    if (!new RegExp(`/empenho/minuta/${minuta}/edit`).test(r.url)) throw new Error('Falha ao gravar subelemento/valor: ' + (alertaContratos(r.texto) || r.url));

    // 6. Dados da minuta
    const pagEdit = parseHTML(r.texto);
    const tipo = P.opcoesSelect(pagEdit, '#tipo_empenho_id').find((o) => U.semAcento(o.texto) === U.semAcento(c.tipoEmpenho));
    const amparo = P.opcoesSelect(pagEdit, '#amparo_legal_id').find((o) => U.chaveTexto(o.texto) === U.chaveTexto(docInfo.amparo));
    if (!tipo) throw new Error(`Tipo de empenho "${c.tipoEmpenho}" não encontrado`);
    if (!amparo) throw new Error(`Amparo legal "${docInfo.amparo}" não encontrado no Contratos`);
    const vars = { PROCESSO: docInfo.processo, SEI: docInfo.sei, ND: linha.nd, UG: docInfo.ug, UGR: docInfo.ugr, CPF: docInfo.cpf, VALOR: U.fmtBRL(valor),
      PTRES: docInfo.ptres, FONTE: docInfo.fonte };
    r = await ctPost(`/empenho/minuta/${minuta}`, [['_token', '__TOKEN__'], ['_method', 'PUT'], ['http_referrer', `${CT}/empenho/subelemento/${minuta}`],
      ['numero_empenho_sequencial', ''], ['cipis[]', ''], ['data_emissao', hojeISO()], ['tipo_empenho_id', tipo.valor],
      ['fornecedor_empenho_id', fornecedor], ['processo', docInfo.processo], ['amparo_legal_id', amparo.valor], ['taxa_cambio', '0,0000'],
      ['local_entrega', c.localEntrega], ['descricao', P.substituirVariaveis(c.descricaoMinuta, vars)], ['id', minuta]]);
    if (!/\/empenho\/passivo-anterior\/\d+/.test(r.url)) throw new Error('Falha ao gravar dados da minuta: ' + (alertaContratos(r.texto) || r.url));

    // 7. Passivo anterior
    r = await ctPost('/empenho/passivo-anterior', [['_token', '__TOKEN__'], ['http_referrer', `${CT}/empenho/minuta/${minuta}/edit`],
      ['minutaempenho_id', minuta], ['passivo_anterior', '0']]);
    if (!new RegExp(`/empenho/minuta/${minuta}$`).test(r.url.split('?')[0])) throw new Error('Falha no passivo anterior: ' + (alertaContratos(r.texto) || r.url));

    // 8. Envio ao SIAFI
    const env = ctJson(await ctGet(`/api/pupula/tabelas/siafi/${minuta}`, []));
    if (!env.resultado) throw new Error('O Contratos recusou o envio ao SIAFI');
    gravarRegistro(docInfo.chave(linha), { minuta, etapa: 'enviada' });
    log(`  minuta ${minuta} enviada ao SIAFI; aguardando retorno…`);

    // 9. Retorno
    return aguardarMinuta(minuta, log);
  }

  async function consultarMinuta(minuta) {
    try { await ct('GET', `/empenho/minuta/${minuta}/atualizarsituacaominuta`); } catch (e) { /* tenta ler mesmo assim */ }
    const campos = P.camposShow(parseHTML((await ct('GET', `/empenho/minuta/${minuta}`)).texto));
    return { msg: campos['Mensagem SIAFI'] || '', sit: campos['Situação'] || '' };
  }

  async function aguardarMinuta(minuta, log) {
    const c = cfg();
    for (let i = 0; i < Number(c.pollTentativas); i++) {
      await dormir(Number(c.pollSegundos) * 1000);
      const { msg, sit } = await consultarMinuta(minuta);
      const ne = (msg.match(/\d{4}NE\d{6}/) || [])[0];
      if (ne && /EMITIDO/i.test(sit)) return { ne, minuta };
      if (P.erroSiafi(msg)) throw Object.assign(new Error(`SIAFI: ${msg}`), { minuta });
      if (i % 4 === 3) log(`  … ainda ${sit || 'processando'}`);
    }
    throw Object.assign(new Error(`Sem retorno do SIAFI para a minuta ${minuta}; confira no Contratos`), { minuta, pendente: true });
  }

  // ---------------------------------------------------------------------------
  // Contratos — Reforço / Anulação
  // ---------------------------------------------------------------------------
  async function localizarMinutaPorNE(ne) {
    const ano = ne.slice(0, 4);
    const pares = U.dtParams(DT.minSearch, { nomeIgualData: false, length: 25, busca: ne });
    const r = ctJson(await ctPost(`/empenho/minuta/search?ano_criacao=${ano}`, pares, true));
    const achadas = (r.data || []).filter((row) => P.celTexto(parseHTML, row[15]) === ne).map((row) => (String(row[0]).match(/value="(\d+)"/) || [])[1]).filter(Boolean);
    const unicas = [...new Set(achadas)];
    if (!unicas.length) throw new Error(`NE ${ne} não encontrada no Contratos (nesta UG)`);
    if (unicas.length > 1) throw new Error(`NE ${ne} aparece em mais de uma minuta`);
    return unicas[0];
  }

  async function alterar(docInfo, linha, operacao, log) {
    const minuta = await localizarMinutaPorNE(linha.ne);
    log(`  ${linha.ne} → minuta ${minuta}`);
    const create = await ct('GET', `/empenho/minuta/${minuta}/alteracao/create`);
    const dc = parseHTML(create.texto);
    const hidden = {};
    dc.querySelectorAll('input[type="hidden"][name]').forEach((e) => { if (!(e.name in hidden)) hidden[e.name] = e.value; });
    const linhasDT = await ctDT(`/empenho/minuta/${minuta}/alteracao-dt/minutaAlteracao`, DT.altdt, { order: [0, 'desc'] });
    if (linhasDT.length !== 1) throw new Error(`A minuta ${minuta} tem ${linhasDT.length} itens; esperado 1`);
    const it = linhasDT[0];
    const d = parseHTML('<div>' + it.tipo_alteracao + it.valor_total_item + '</div>');
    const rotulo = operacao === 'reforco' ? 'REFORCO' : 'ANULACAO';
    const optTipo = [...d.querySelectorAll('option')].find((o) => U.semAcento(o.textContent) === rotulo);
    if (!optTipo) throw new Error(`Opção de ${rotulo.toLowerCase()} indisponível para esta NE`);
    const empenhado = Number(it.vlr_total_item);
    if (operacao === 'anulacao' && linha.valor > empenhado + 0.001) throw new Error(`Anulação (R$ ${U.fmtBRL(linha.valor)}) maior que o empenhado (R$ ${U.fmtBRL(empenhado)})`);
    const hidItem = (n) => { const e = d.querySelector(`input[name="${n}"]`); return e ? e.value : ''; };
    const sinal = operacao === 'reforco' ? 1 : -1;
    const pares = [['sispp_servico', hidden.sispp_servico], ['tipo_item', hidden.tipo_item], ['tipo_empenho_por', hidden.tipo_empenho_por],
      ['minuta_id', minuta], ['nova_minuta_id', hidden.nova_minuta_id || ''], ['fornecedor_id', hidden.fornecedor_id], ['credito', hidden.credito],
      ['saldo_id', hidden.saldo_id || it.saldo_id], ['valor_utilizado', U.numStr(sinal * linha.valor)], ['data-emissao', hojeISO()],
      ['_token', '__TOKEN__'], ['dataTableBuilder_length', '10'],
      ['valorunitario[]', it.vlr_unitario_item || '1.0000'], ['valorunitario_original[]', it.vlr_unitario_item || '1.0000'],
      ['valor_total_item[]', hidItem('valor_total_item[]') || '1'], ['vlr_total_item[]', it.vlr_total_item], ['numero_item[]', it.numero_item],
      ['cif_id[]', it.cif_id], ['ciu_id[]', it.ciu_id], ['compra_item_id[]', it.compra_item_id], ['numseq[]', it.numseq],
      ['qtd_empenhada[]', it.qtd_total_item], ['subitem[]', it.subelemento_id], ['tipo_alteracao[]', optTipo.value],
      ['qtd[]', U.numStr(linha.valor)], ['quantidade_total[]', it.qtd_item], ['valor_total[]', U.fmtDecimalVirgula(linha.valor)]];
    const r = await ctPost(`/empenho/minuta/${minuta}/alteracao`, pares);
    const m = r.url.match(/\/alteracao\/(\d+)\/show\//);
    if (!m) throw new Error('Alteração não registrada: ' + (alertaContratos(r.texto) || r.url));
    const alt = m[1];
    gravarRegistro(docInfo.chave(linha), { minuta, alteracao: alt, etapa: 'criada', nd: String(it.natureza_despesa || '') });
    const env = ctJson(await ctGet(`/api/pupula/tabelas/siafi/${minuta}/${alt}`, []));
    if (!env.resultado) throw new Error('O Contratos recusou o envio ao SIAFI');
    gravarRegistro(docInfo.chave(linha), { etapa: 'enviada' });
    log(`  alteração ${alt} enviada ao SIAFI; aguardando retorno…`);
    return aguardarAlteracao(minuta, alt, log, String(it.natureza_despesa || ''));
  }

  async function consultarAlteracao(minuta, alt) {
    try { await ct('GET', `/empenho/minuta/${minuta}/alteracao/${alt}/atualizarsituacaominuta`); } catch (e) { /* segue */ }
    const pares = U.dtParams(DT.altSearch, { nomeIgualData: false, length: 100 });
    const r = ctJson(await ctPost(`/empenho/minuta/${minuta}/alteracao/search?`, pares, true));
    const row = (r.data || []).find((x) => new RegExp(`/alteracao/${alt}/`).test(String(x[18])));
    return row ? { msg: P.celTexto(parseHTML, row[12]), sit: P.celTexto(parseHTML, row[13]) } : null;
  }

  async function aguardarAlteracao(minuta, alt, log, nd) {
    const c = cfg();
    for (let i = 0; i < Number(c.pollTentativas); i++) {
      await dormir(Number(c.pollSegundos) * 1000);
      const atual = await consultarAlteracao(minuta, alt);
      if (atual) {
        const { msg, sit } = atual;
        if (/EMITIDO/i.test(sit) && /\d{4}NE\d{6}/.test(msg)) return { ne: msg.match(/\d{4}NE\d{6}/)[0], minuta, alteracao: alt, nd };
        if (P.erroSiafi(msg)) throw Object.assign(new Error(`SIAFI: ${msg}`), { minuta, alteracao: alt });
        if (i % 4 === 3) log(`  … ainda ${sit || 'processando'}`);
      }
    }
    throw Object.assign(new Error(`Sem retorno do SIAFI para a alteração ${alt}; confira no Contratos`), { pendente: true });
  }

  // Linha que ficou pela metade numa execução anterior: confere no Contratos antes de refazer.
  // Retorna o resultado se o SIAFI já tinha emitido; null se a linha deve ser feita de novo; erro se ainda está em processamento.
  async function resolverPendente(d, l, log) {
    const p = l.pendente;
    const ref = p.alteracao ? `alteração ${p.alteracao} (minuta ${p.minuta})` : `minuta ${p.minuta}`;
    const consulta = p.alteracao ? await consultarAlteracao(p.minuta, p.alteracao) : await consultarMinuta(p.minuta);
    const dec = P.decidirPendente(p.etapa, consulta);
    if (dec.acao === 'concluida') {
      log(`  ${ref} da execução anterior já tem NE: ${dec.ne}`);
      return { ne: dec.ne, minuta: p.minuta, alteracao: p.alteracao, nd: l.nd || p.nd || '' };
    }
    if (dec.acao === 'aguardar') throw Object.assign(new Error(`${ref} da execução anterior ${dec.motivo} — confira no Contratos e execute de novo`), { pendente: true });
    log(`  ${ref} da execução anterior ${dec.motivo}; fazendo de novo`);
    gravarRegistro(d.chave(l), { minuta: '', alteracao: '', etapa: 'descartada', descartadas: (p.descartadas || []).concat(ref) });
    l.pendente = null;
    return null;
  }

  // ---------------------------------------------------------------------------
  // SEI — leitura do documento de origem
  // ---------------------------------------------------------------------------
  function formPesquisaRapida() {
    const f = document.querySelector('#frmProtocoloPesquisaRapida') || (document.querySelector('input[name="txtPesquisaRapida"]') || {}).form;
    if (!f) throw new Error('Pesquisa rápida do SEI não encontrada nesta tela (abra o Controle de Processos)');
    return f.getAttribute('action');
  }

  async function lerDocumentoSEI(numero) {
    const r = await seiReq(formPesquisaRapida(), [['txtPesquisaRapida', numero]]);
    let urlArvore = (r.html.match(/id="ifrArvore"[^>]*src="([^"]+)"/) || r.html.match(/src="([^"]*acao=procedimento_visualizar[^"]*)"/) || [])[1];
    if (!urlArvore) throw new Error(`Documento ${numero} não encontrado (a pesquisa não abriu um processo)`);
    const arv = P.arvore((await seiReq(urlArvore)).html);
    const no = arv.documentos.find((d) => new RegExp('\\b' + numero + '$').test(U.norm(d.rotulo)));
    if (!no || !no.src) throw new Error(`Documento ${numero} não está na árvore do processo`);
    const conteudo = await seiReq(no.src);
    const info = P.extrairDocumento(parseHTML(conteudo.html));
    return Object.assign(info, {
      sei: numero, idDocumento: no.id, idProcedimento: arv.idProcedimento, processo: info.processo || arv.processo,
      linkEscolherTipo: arv.linkEscolherTipo, urlArvore,
    });
  }

  // ---------------------------------------------------------------------------
  // SEI — despacho de retorno
  // ---------------------------------------------------------------------------
  async function gerarDespacho(doc, resultados, log) {
    const c = cfg();
    const idTexto = String(c.textoRetorno || '').trim();
    if (!idTexto) throw new Error('Configure o id do texto padrão de encaminhamento (aba Configurações)');

    // árvore atualizada (links com hash válidos)
    const arv = P.arvore((await seiReq(doc.urlArvore)).html);
    if (!arv.linkEscolherTipo) throw new Error('Não consegui o link "Incluir Documento" do processo (ele está aberto na sua unidade?)');

    // 1. Escolher tipo
    const pEsc = await seiReq(arv.linkEscolherTipo);
    const dEsc = parseHTML(pEsc.html);
    const fEsc = dEsc.querySelector('#frmDocumentoEscolherTipo');
    const serie = [...dEsc.querySelectorAll('input[title]')].find((i) => U.semAcento(i.title) === U.semAcento(c.serieDespacho));
    if (!fEsc || !serie) throw new Error(`Tipo de documento "${c.serieDespacho}" não encontrado`);
    const paresEsc = P.serializarForm(fEsc).filter(([k]) => !/^chkInfraItem/.test(k)).map(([k, v]) => [k, k === 'hdnIdSerie' ? serie.value : v]);
    const pGer = await seiReq(fEsc.getAttribute('action'), paresEsc);

    // 2. Gerar documento a partir do modelo
    const dGer = parseHTML(pGer.html);
    const fGer = dGer.querySelector('#frmDocumentoCadastro');
    if (!fGer) throw new Error('Tela de geração de documento não abriu');
    const urlLupa = (pGer.html.match(/infraLupaText\('txtTextoPadrao','hdnIdTextoPadrao','([^']+)'/) || [])[1];
    if (!urlLupa) throw new Error('Lista de textos padrão não encontrada');
    const dTxt = parseHTML((await seiReq(urlLupa)).html);
    const radio = [...dTxt.querySelectorAll('input[name="chkInfraItem"]')].find((i) => i.value === idTexto);
    if (!radio) throw new Error(`O texto padrão ${idTexto} não existe na unidade atual do SEI`);

    const campos = [
      'hdnInfraTipoPagina', 'txtDataElaboracao', 'rdoTextoInicial', 'txtProtocoloDocumentoTextoBase', 'txtTextoPadrao', 'hdnIdTextoPadrao',
      'hdnIdDocumentoTextoBase', 'txtDescricao', 'txtNumero', 'txtNomeArvore', 'txtDinValor', 'txtRemetente', 'hdnIdRemetente',
      'txtInteressado', 'hdnIdInteressado', 'txtDestinatario', 'hdnIdDestinatario', 'txtAssunto', 'hdnIdAssunto', 'txaObservacoes',
      'selGrauSigilo', 'rdoNivelAcesso', 'selHipoteseLegal', 'hdnFlagDocumentoCadastro', 'hdnAssuntos', 'hdnInteressados', 'hdnDestinatarios',
      'hdnIdSerie', 'hdnIdUnidadeGeradoraProtocolo', 'hdnStaDocumento', 'hdnIdTipoConferencia', 'hdnSinArquivamento', 'hdnStaNivelAcessoLocal',
      'hdnIdHipoteseLegal', 'hdnStaGrauSigilo', 'hdnIdDocumento', 'hdnIdProcedimento', 'hdnAnexos', 'hdnIdHipoteseLegalSugestao',
      'hdnIdTipoProcedimento', 'hdnUnidadesReabertura', 'hdnSinBloqueado', 'hdnContatoObject', 'hdnContatoIdentificador', 'hdnAssuntoIdentificador'];
    const atuais = Object.fromEntries(P.serializarForm(fGer));
    const forcar = { rdoTextoInicial: 'T', txtTextoPadrao: radio.title, hdnIdTextoPadrao: idTexto,
      txtProtocoloDocumentoTextoBase: '', hdnIdDocumentoTextoBase: '', rdoNivelAcesso: c.nivelAcesso, hdnFlagDocumentoCadastro: '2' };
    const sel = (n) => { const s = fGer.querySelector(`select[name="${n}"]`); return s && s.options.length ? (s.options[s.selectedIndex] || s.options[0]).value : 'null'; };
    const paresGer = campos.map((n) => [n, n in forcar ? forcar[n] : (n in atuais ? atuais[n] : (/^sel/.test(n) ? sel(n) : ''))]);
    const pNovo = await seiReq(fGer.getAttribute('action'), paresGer);
    const idNovo = (pNovo.url.match(/id_documento=(\d+)/) || [])[1];
    if (!idNovo) throw new Error('O SEI não confirmou a criação do despacho');
    const numNovo = (pNovo.html.match(/<span>[^<]*?(\d{6,})<\/span>/) || [])[1] || '';
    log(`  despacho ${numNovo || idNovo} criado; preenchendo…`);

    // 3. Editor
    const linkEditor = (pNovo.html.match(/linkEditarConteudo\s*=\s*'([^']+)'/) || [])[1];
    if (!linkEditor) throw new Error('Link de edição do despacho não encontrado');
    const pEd = await seiReq(linkEditor);
    const dEd = parseHTML(pEd.html);
    const urlSalvar = (pEd.html.match(/editor\/editor_processar\.php\?acao=editor_salvar[^"'\s]*/) || [])[0];
    if (!urlSalvar) throw new Error('Endereço de salvamento do editor não encontrado');
    const secoes = [...dEd.querySelectorAll('textarea[name^="txaEditor_"]')];
    if (!secoes.length) throw new Error('Seções do editor não encontradas');

    const vars = {
      UG: doc.ug, UGR: doc.ugr || '', CPF: doc.cpf || '', PROCESSO: doc.processo, SEI_ORIGEM: doc.sei,
      TOTAL: 'R$ ' + U.fmtBRL(resultados.filter((x) => x.ok).reduce((s, x) => s + x.valor, 0)),
      EMPENHOS: resultados.filter((x) => x.ok).map((x) => x.ne).join(', '),
      OPERACAO: OPS_TEXTO[doc.operacao], OPERACAO_TITULO: OPS_TEXTO[doc.operacao].replace(/^./, (x) => x.toUpperCase()),
    };
    const temMarcaOperacao = secoes.some((ta) => /\{OPERACAO(_TITULO)?\}/i.test(ta.value));
    const cpfFmt = doc.cpf ? U.fmtCPF(doc.cpf) : '';
    let tabelaOk = false;
    const pares = secoes.map((ta) => {
      let html = P.substituirVariaveis(ta.value, vars);
      if (/<table/i.test(html) && !/Refer(ê|&ecirc;|&#234;)ncia/i.test(html)) {
        const d = parseHTML('<div id="r">' + html + '</div>');
        const raiz = d.getElementById('r');
        let mudou = P.preencherRotulos(raiz, { ug: doc.ug, ugr: doc.ugr || '', cpf: cpfFmt, processo: doc.processo }) > 0;
        if (!tabelaOk && P.preencherTabela(d, raiz, resultados)) {
          tabelaOk = true; mudou = true;
          if (!temMarcaOperacao) P.inserirOperacao(d, raiz, vars.OPERACAO_TITULO + ':');
        }
        if (mudou) html = raiz.innerHTML;
      }
      return [ta.name, html];
    });
    if (!tabelaOk) {
      // Texto sem tabela: acrescenta item numerado + tabela antes do "Atenciosamente" da seção do corpo
      const ehRodape = (h) => /Refer(ê|&ecirc;|&#234;)ncia/i.test(h);
      let alvo = pares.findIndex(([, h]) => /Atenciosamente/i.test(h) && !ehRodape(h));
      if (alvo < 0) {
        let maior = -1;
        pares.forEach(([, h], i) => { if (!ehRodape(h) && h.length > maior) { maior = h.length; alvo = i; } });
      }
      const d = parseHTML('<div id="r">' + pares[alvo][1] + '</div>');
      const raiz = d.getElementById('r');
      const fav = doc.cpf ? `, em favor do CPF ${cpfFmt}` : '';
      const intro = `Informo ${vars.OPERACAO} na UG ${doc.ug}${doc.operacao === 'emissao' ? fav : ''}, conforme abaixo:`;
      P.inserirBlocoRetorno(d, raiz, intro, resultados);
      pares[alvo][1] = raiz.innerHTML;
    }
    pares.forEach((p) => { p[1] = U.entidades(p[1]); });
    ['hdnVersao', 'hdnIgnorarNovaVersao', 'hdnSiglaUnidade', 'hdnInfraPrefixoCookie'].forEach((n) => {
      const e = dEd.querySelector(`[name="${n}"]`);
      pares.push([n, e ? e.value : (n === 'hdnIgnorarNovaVersao' ? 'N' : '')]);
    });
    const salvo = await seiReq(urlSalvar, pares);
    if (!/^\s*OK/.test(salvo.html)) throw new Error('O editor não confirmou o salvamento: ' + U.norm(salvo.html).slice(0, 200));
    return { numero: numNovo || idNovo, id: idNovo };
  }

  // ---------------------------------------------------------------------------
  // SEI — inclusão do despacho em bloco de assinatura
  // ---------------------------------------------------------------------------
  async function incluirEmBloco(doc, desp, log) {
    const bloco = U.digitos(cfg().blocoAssinatura);
    if (!bloco) return;
    const chave = `${doc.sei}|bloco`;
    const reg = registro()[chave];
    if (reg) { doc.bloco = reg.bloco; log(`  despacho já incluído no bloco ${reg.bloco} antes`); return; }
    if (!desp.id) { log(`  despacho ${desp.numero} é de versão anterior do script: inclua no bloco ${bloco} manualmente`); return; }

    const link = P.linkBloco((await seiReq(doc.urlArvore)).html, desp.id);
    if (!link) throw new Error('Link "Incluir em Bloco de Assinatura" do despacho não encontrado na árvore');
    let pag = await seiReq(link);
    let dPag = parseHTML(pag.html);
    const ja = P.blocoDoDocumento(dPag, desp.id);
    if (ja === null) throw new Error('O despacho não aparece na tela de inclusão em bloco');
    if (ja) {
      if (ja !== bloco) throw new Error(`O despacho já está no bloco ${ja}`);
      gravarRegistro(chave, { bloco });
      doc.bloco = bloco;
      return;
    }
    if (!P.opcoesSelect(dPag, '#selBloco').some((o) => o.valor === bloco)) throw new Error(`Bloco ${bloco} não está disponível na unidade atual do SEI`);

    // Como no navegador: escolher o bloco recarrega a tela; depois "Incluir"
    const pares = (d, incluir) => {
      const f = d.querySelector('#frmBlocoEscolher');
      if (!f) throw new Error('Tela de inclusão em bloco não abriu');
      const chk = [...f.querySelectorAll('input[name^="chkDocumentosItem"]')].find((i) => i.value === String(desp.id));
      if (!chk) throw new Error('O despacho não aparece na tela de inclusão em bloco');
      const lista = P.serializarForm(f).filter(([k]) => !/^chkDocumentosItem/.test(k) && k !== 'selBloco')
        .map(([k, v]) => [k, k === 'hdnDocumentosItensSelecionados' ? String(desp.id) : v]);
      lista.splice(1, 0, ...(incluir ? [['sbmIncluir', 'Incluir']] : []), ['selBloco', bloco], [chk.name, String(desp.id)]);
      return { action: f.getAttribute('action'), lista };
    };
    let req = pares(dPag, false);
    pag = await seiReq(req.action, req.lista);
    dPag = parseHTML(pag.html);
    req = pares(dPag, true);
    pag = await seiReq(req.action, req.lista);
    if (P.blocoDoDocumento(parseHTML(pag.html), desp.id) !== bloco) throw new Error('O SEI não confirmou a inclusão no bloco');
    gravarRegistro(chave, { bloco });
    doc.bloco = bloco;
    log(`  ✔ despacho ${desp.numero} incluído no bloco ${bloco}`);
  }

  // ---------------------------------------------------------------------------
  // Interface
  // ---------------------------------------------------------------------------
  const OPS = { emissao: 'Emissão', reforco: 'Reforço', anulacao: 'Anulação' };
  const OPS_TEXTO = { emissao: 'emissão de empenho', reforco: 'reforço de empenho', anulacao: 'anulação de empenho' };
  let docs = [];
  let rodando = false;

  // CSS do script dentro do painel DevDu (shadow DOM, isolado do CSS do SEI)
  const CSS = `
  .esf-linha{display:flex;gap:6px;align-items:flex-start;margin-bottom:8px}
  .esf-botoes{display:flex;gap:6px;margin-bottom:10px}
  #esf-numeros{flex:1;height:48px;font:inherit;padding:6px 8px;border:1px solid var(--borda);border-radius:6px;resize:vertical}
  table.esf{border-collapse:collapse;width:100%}
  table.esf th{background:var(--fundo2);text-align:left;font-weight:600;padding:5px 6px;border-bottom:1px solid var(--borda)}
  table.esf td{padding:5px 6px;border-bottom:1px solid var(--borda);vertical-align:top}
  table.esf .par{display:grid;grid-template-columns:auto auto;gap:2px 4px;align-items:center;font-size:12px}
  table.esf .par input,table.esf .par select{font:inherit;padding:1px 3px;border:1px solid var(--borda);border-radius:4px;background:#fff}
  table.esf .par input.p-fonte{width:86px}
  table.esf .par select{max-width:190px}
  .esf-ok{color:var(--ok)}.esf-erro{color:var(--erro)}.esf-aviso{color:var(--aviso)}
  #esf-log{white-space:pre-wrap;margin-top:10px}
  #esf-log:empty{display:none}
  #esf-cfg{display:grid;grid-template-columns:220px 1fr;gap:8px 10px}
  #esf-cfg label{align-self:center}
  #esf-cfg input,#esf-cfg textarea{font:inherit;padding:4px 6px;border:1px solid var(--borda);border-radius:6px}
  #esf-cfg textarea{height:54px}
  .esf-sub{color:var(--suave);font-size:12px}`;

  let painel = null;
  const campo = (id) => painel.raiz.querySelector('#' + id);

  function montarPainel() {
    // o host do painel ganha o id "esf-painel" da versão antiga (antes da DevDu): se as duas estiverem instaladas,
    // a que rodar depois vê o painel e não duplica
    if (document.getElementById('esf-painel')) { console.warn('Empenho Suprimento: outra cópia do script já está ativa nesta página'); return; }
    painel = DevDu.painel({
      id: 'empenho-suprimento', nome: 'Empenho Suprimento', largura: 980, css: CSS,
      abas: [
        { id: 'exec', titulo: 'Execução', icone: '▶️' },
        { id: 'cfg', titulo: 'Config.', icone: '⚙️', aoMostrar: () => { if (campo('esf-cfg')) montarCfg(); } },
        { id: 'sobre', titulo: 'Sobre', icone: 'ℹ️' },
      ],
    });
    painel.elemento.id = 'esf-painel';
    painel.secao('exec').innerHTML = `
      <div class="esf-linha"><textarea id="esf-numeros" placeholder="Números SEI dos despachos (separados por espaço, vírgula ou linha)"></textarea></div>
      <div class="esf-botoes"><button class="dd-btn" id="esf-btn-ler">Ler documentos</button>
        <button class="dd-btn" id="esf-btn-exec" disabled>Executar</button>
        <button class="dd-btn sec" id="esf-btn-limpar" title="Apagar os números da caixa">Limpar</button></div>
      <div id="esf-tabela"></div>
      <div id="esf-log" class="dd-log"></div>`;
    painel.secao('cfg').innerHTML = '<div id="esf-cfg"></div>';
    painel.secao('sobre').innerHTML = `<p>Lê os despachos de pedido no <b>SEI</b>, faz a <b>emissão, reforço ou anulação</b> dos empenhos
      de suprimento de fundos no <b>Contratos.gov.br</b> (que envia ao SIAFI) e devolve ao processo um despacho com as NEs.</p>
      <ol><li>Com o Contratos.gov.br logado em outra aba, informe os números SEI dos despachos e clique em <b>Ler documentos</b>.</li>
      <li>Revise a tabela (UGR, PTRES, fonte e amparo das emissões) e clique em <b>Executar</b>.</li>
      <li>O despacho de retorno fica sem assinatura, no bloco configurado em <b>Config.</b></li></ol>
      <p class="esf-sub">Problemas: fale com a Dulce informando o nome do script e a versão (no rodapé do painel).</p>`;
    // A página do SEI recarrega ao trocar de processo: a lista de números fica guardada até ser limpa
    const numeros = campo('esf-numeros');
    numeros.value = GM_getValue('numeros', '');
    numeros.oninput = () => GM_setValue('numeros', numeros.value);
    campo('esf-btn-limpar').onclick = () => { numeros.value = ''; GM_setValue('numeros', ''); numeros.focus(); };
    campo('esf-btn-ler').onclick = () => ler().catch((e) => log('ERRO: ' + e.message));
    campo('esf-btn-exec').onclick = () => executar().catch((e) => log('ERRO: ' + e.message));
    montarCfg();
  }

  function log(msg) {
    const l = campo('esf-log');
    const h = new Date().toLocaleTimeString('pt-BR');
    l.textContent += `[${h}] ${msg}\n`;
    l.scrollTop = l.scrollHeight;
  }

  const CAMPOS_CFG = [
    ['descricaoMinuta', 'Descrição da minuta', 'textarea', 'Variáveis: {PROCESSO} {SEI} {ND} {UG} {UGR} {PTRES} {FONTE} {CPF} {VALOR}'],
    ['localEntrega', 'Local de entrega'], ['tipoEmpenho', 'Tipo de empenho'],
    ['amparos', 'Amparos legais', 'textarea', 'Um por linha, como aparece no Contratos; o primeiro é o padrão'],
    ['ptres', 'PTRES sugeridos', 'input', 'Separados por vírgula'], ['fontePadrao', 'Fonte padrão'], ['esfera', 'Esfera'],
    ['subelemento', 'Subelemento'], ['itemPorNd', 'Item por natureza', 'textarea', 'Uma por linha: ND=Material ou ND=Serviço'],
    ['textoRetorno', 'Texto padrão de encaminhamento (id)', 'input', 'Variáveis: {OPERACAO} {OPERACAO_TITULO} {UG} {CPF} {PROCESSO} {SEI_ORIGEM} {TOTAL}'],
    ['ugrs', 'UGRs sugeridas', 'input', 'Separadas por vírgula'],
    ['padroesProcesso', 'Padrões por processo (emissão)', 'textarea', 'Um por linha: início do processo | PTRES | UGR | artigo do amparo (47 ou 45) | fonte (opcional). Campo vazio = último valor usado'], ['serieDespacho', 'Tipo de documento SEI'],
    ['blocoAssinatura', 'Bloco de assinatura (número)', 'input', 'O despacho é incluído nele; vazio = não incluir'],
    ['nivelAcesso', 'Nível de acesso (0 público, 1 restrito)'], ['pollSegundos', 'Intervalo de consulta ao SIAFI (s)'], ['pollTentativas', 'Tentativas de consulta'],
  ];
  function montarCfg() {
    const c = cfg();
    const box = campo('esf-cfg');
    box.innerHTML = CAMPOS_CFG.map(([k, rot, tipo, dica]) =>
      `<label for="esf-c-${k}">${rot}${dica ? `<div class="esf-sub">${dica}</div>` : ''}</label>` +
      (tipo === 'textarea' ? `<textarea id="esf-c-${k}"></textarea>` : `<input id="esf-c-${k}">`)).join('') +
      `<span></span><div><button class="dd-btn" id="esf-c-salvar">Salvar configurações</button> <button class="dd-btn sec" id="esf-c-reg">Limpar registro de execuções</button></div>`;
    CAMPOS_CFG.forEach(([k]) => { box.querySelector('#esf-c-' + k).value = c[k]; });
    box.querySelector('#esf-c-salvar').onclick = () => {
      const n = {};
      CAMPOS_CFG.forEach(([k]) => { n[k] = box.querySelector('#esf-c-' + k).value; });
      GM_setValue('cfg', n);
      log('Configurações salvas');
      abrirAba('exec');
    };
    box.querySelector('#esf-c-reg').onclick = () => {
      if (confirm('Apagar o registro de execuções? O script deixa de reconhecer o que já foi empenhado.')) { GM_setValue('registro', {}); log('Registro apagado'); }
    };
  }
  function abrirAba(nome) {
    painel.mostrarAba(nome);
  }

  async function ler() {
    if (rodando) return;
    const nums = [...new Set((campo('esf-numeros').value.match(/\d{6,}/g) || []))];
    if (!nums.length) { log('Informe ao menos um número SEI'); return; }
    rodando = true;
    campo('esf-btn-exec').disabled = true;
    docs = [];
    try {
      for (const n of nums) {
        log(`Lendo SEI ${n}…`);
        try {
          const d = await lerDocumentoSEI(n);
          d.enviar = !d.erros.length;
          if (d.operacao === 'emissao') {
            // Prioridade: padrão do processo (Configurações) → últimos valores usados → padrão geral
            const ult = GM_getValue('ultimosParametros', {});
            const c = cfg();
            const amparos = U.lista(c.amparos);
            const regra = P.padraoProcesso(d.processo, c.padroesProcesso, amparos);
            d.ugr = regra.ugr || ult.ugr || GM_getValue('ultimaUgr', '') || '';
            d.ptres = regra.ptres || ult.ptres || '';
            d.fonte = regra.fonte || ult.fonte || c.fontePadrao;
            d.amparo = regra.amparo || (ult.amparo && amparos.includes(ult.amparo) ? ult.amparo : amparos[0]);
          }
          docs.push(d);
        } catch (e) {
          docs.push({ sei: n, erros: [e.message], linhas: [], enviar: false });
        }
      }
      marcarJaFeitos();
      desenharTabela();
      campo('esf-btn-exec').disabled = !docs.some((d) => d.enviar);
      log('Leitura concluída. Revise, preencha a UGR das emissões e clique em Executar.');
    } finally { rodando = false; }
  }

  function chaveLinha(d, l) { return `${d.sei}|${d.operacao}|${l.nd || l.ne}`; }

  function marcarJaFeitos() {
    const reg = registro();
    const bloco = U.digitos(cfg().blocoAssinatura);
    docs.forEach((d) => {
      d.chave = (l) => chaveLinha(d, l);
      (d.linhas || []).forEach((l) => {
        l.feito = null; l.pendente = null;
        const r = reg[chaveLinha(d, l)];
        if (!r) return;
        if (r.ne && r.etapa === 'concluida') { l.feito = r; }
        else if (r.minuta) { l.pendente = r; }
      });
      const desp = reg[`${d.sei}|despacho`];
      if (desp) d.despacho = desp.numero;
      if (reg[`${d.sei}|bloco`]) d.bloco = reg[`${d.sei}|bloco`].bloco;
      const blocoFalta = bloco && desp && desp.id && !reg[`${d.sei}|bloco`];
      if (d.linhas && d.linhas.length && d.linhas.every((l) => l.feito) && desp && !blocoFalta) d.enviar = false;
    });
  }

  function desenharTabela() {
    const c = cfg();
    const lst = (t) => String(t || '').split(/[,;\s]+/).filter(Boolean);
    const amparos = U.lista(c.amparos);
    // Lista das Configurações + valor atual; "Outro…" pede um número fora da lista
    const escolha = (i, k, lista, atual) => {
      const vals = [...new Set([...lista, atual].filter(Boolean))];
      return `<select data-i="${i}" data-k="${k}">${atual ? '' : '<option value="" selected>—</option>'}`
        + vals.map((v) => `<option value="${v}" ${v === atual ? 'selected' : ''}>${v}</option>`).join('')
        + '<option value="__outro">Outro…</option></select>';
    };
    const curto = (a) => a.replace(/DECRETO\s*93\.872\s*\/\s*1986\s*-\s*/i, 'Dec. 93.872/86 · ');
    const linhas = docs.map((d, i) => {
      const itens = (d.linhas || []).map((l) => {
        let st = '';
        if (l.feito) st = ` <span class="esf-ok">✔ ${l.feito.ne}</span>`;
        else if (l.pendente) st = ` <span class="esf-aviso">⚠ minuta ${l.pendente.minuta} de execução anterior (${l.pendente.etapa}) — será conferida no Contratos</span>`;
        if (l.resultado) st = l.resultado.ok ? ` <span class="esf-ok">✔ ${l.resultado.ne}</span>` : ` <span class="esf-erro">✖ ${l.resultado.erro}</span>`;
        return `<div>${l.nd || l.ne} · R$ ${U.fmtBRL(l.valor)}${st}</div>`;
      }).join('');
      const fav = d.cpf ? `CPF ${U.fmtCPF(d.cpf)}` : (d.ug ? `UG ${d.ug}` : '');
      const par = d.operacao === 'emissao' ? `<div class="par">
          <span>UGR</span>${escolha(i, 'ugr', lst(c.ugrs), d.ugr)}
          <span>PTRES</span>${escolha(i, 'ptres', lst(c.ptres), d.ptres)}
          <span>Fonte</span><input class="p-fonte" data-i="${i}" data-k="fonte" value="${d.fonte || ''}">
          <span>Amparo</span><select data-i="${i}" data-k="amparo">${amparos.map((a) => `<option value="${a}" ${a === d.amparo ? 'selected' : ''}>${curto(a)}</option>`).join('')}</select>
        </div>` : '—';
      const msgs = [...(d.erros || []).map((e) => `<div class="esf-erro">${e}</div>`), ...(d.avisos || []).map((e) => `<div class="esf-aviso">${e}</div>`)].join('');
      const desp = d.despacho ? `<div class="esf-ok">Despacho ${d.despacho}${d.bloco ? ` · bloco ${d.bloco}` : ''}</div>` : '';
      return `<tr>
        <td><input type="checkbox" class="env" data-i="${i}" ${d.enviar ? 'checked' : ''} ${d.erros && d.erros.length ? 'disabled' : ''}></td>
        <td>${d.sei}<div class="esf-sub">${d.processo || ''}</div></td>
        <td>${OPS[d.operacao] || '?'}</td><td>${d.ug || ''}</td><td>${fav}</td><td>${par}</td>
        <td>${itens}${msgs}${desp}</td></tr>`;
    }).join('');
    campo('esf-tabela').innerHTML = `<table class="esf"><thead><tr><th></th><th>SEI</th><th>Operação</th><th>UG</th><th>Favorecido</th><th>Parâmetros</th><th>Linhas</th></tr></thead><tbody>${linhas}</tbody></table>`;
    painel.raiz.querySelectorAll('#esf-tabela input.env').forEach((cb) => { cb.onchange = () => { docs[cb.dataset.i].enviar = cb.checked; }; });
    painel.raiz.querySelectorAll('#esf-tabela .par [data-k]').forEach((el) => {
      const k = el.dataset.k;
      const d = docs[el.dataset.i];
      if (el.tagName === 'SELECT' && k !== 'amparo') {
        el.onchange = () => {
          if (el.value !== '__outro') { d[k] = el.value; return; }
          const v = U.digitos(prompt(`${k.toUpperCase()} para o SEI ${d.sei}:`, d[k] || '') || '');
          if (v) d[k] = v;
          desenharTabela();
        };
        return;
      }
      const f = () => { d[k] = k === 'amparo' ? el.value : U.digitos(el.value); };
      el.oninput = f; el.onchange = f;
    });
  }

  async function executar() {
    if (rodando) return;
    marcarJaFeitos(); // relê o registro: o que deu certo numa execução anterior não é refeito
    const fila = docs.filter((d) => d.enviar && !(d.erros && d.erros.length));
    const faltas = [];
    fila.filter((d) => d.operacao === 'emissao').forEach((d) => {
      const f = [];
      if (!/^\d{6}$/.test(d.ugr || '')) f.push('UGR (6 dígitos)');
      if (!/^\d{6}$/.test(d.ptres || '')) f.push('PTRES (6 dígitos)');
      if (!/^\d{10}$/.test(d.fonte || '')) f.push('fonte (10 dígitos)');
      if (!d.amparo) f.push('amparo legal');
      if (f.length) faltas.push(`${d.sei}: ${f.join(', ')}`);
    });
    if (faltas.length) { log('Preencha os parâmetros da emissão → ' + faltas.join(' | ')); return; }
    if (!fila.length) { log('Nada marcado para enviar'); return; }
    const total = fila.reduce((s, d) => s + d.linhas.filter((l) => !l.feito).length, 0);
    if (!confirm(`Confirmar ${total} operação(ões) no Contratos/SIAFI para ${fila.length} documento(s)?`)) return;
    rodando = true;
    campo('esf-btn-exec').disabled = true;
    campo('esf-btn-ler').disabled = true;
    let ugOriginal = '';
    try {
      ugOriginal = await ugDaSessao();
      if (!ugOriginal) throw new Error('Não consegui ler a UG do Contratos: confira se está logada');
      fila.sort((a, b) => a.ug.localeCompare(b.ug));
      for (const d of fila) {
        log(`SEI ${d.sei} · ${OPS[d.operacao]} · UG ${d.ug}`);
        if (d.operacao === 'emissao') GM_setValue('ultimosParametros', { ugr: d.ugr, ptres: d.ptres, fonte: d.fonte, amparo: d.amparo });
        try {
          await garantirUG(d.ug, log);
        } catch (e) { d.erros = [e.message]; log('  ✖ ' + e.message); desenharTabela(); continue; }
        for (const l of d.linhas) {
          if (l.feito) { l.resultado = { ok: true, ne: l.feito.ne, nd: l.feito.nd }; continue; }
          try {
            let res = l.pendente ? await resolverPendente(d, l, log) : null;
            if (!res) res = d.operacao === 'emissao' ? await emitir(d, l, log) : await alterar(d, l, d.operacao, log);
            l.resultado = { ok: true, ne: res.ne, nd: l.nd || res.nd };
            gravarRegistro(d.chave(l), Object.assign({}, res, { etapa: 'concluida', valor: l.valor, nd: l.nd || res.nd }));
            log(`  ✔ ${l.nd || l.ne} → ${res.ne}`);
          } catch (e) {
            l.resultado = { ok: false, erro: e.message, pendente: !!e.pendente };
            log(`  ✖ ${l.nd || l.ne}: ${e.message}`);
          }
          desenharTabela();
        }
        // Linha com erro entra no despacho como "não realizado"; mas se alguma ainda está em processamento
        // no SIAFI (pode virar NE), ou se nada deu certo, não gera
        if (d.linhas.some((l) => !l.resultado || l.resultado.pendente)) { log(`  despacho não gerado para ${d.sei}: há linha aguardando o SIAFI`); continue; }
        if (!d.linhas.some((l) => l.resultado.ok)) { log(`  despacho não gerado para ${d.sei}: nenhuma linha foi realizada`); continue; }
        let desp = registro()[`${d.sei}|despacho`];
        if (desp) {
          d.despacho = desp.numero;
          log(`  despacho já gerado antes (${desp.numero})`);
          if (d.linhas.some((l) => l.resultado.ok && !l.feito)) log(`  ⚠ linhas feitas agora não estão no despacho ${desp.numero}: informe no processo manualmente`);
        }
        else {
          try {
            const res = d.linhas.map((l) => (l.resultado.ok
              ? { ok: true, nd: l.nd || l.resultado.nd || '', ne: l.resultado.ne, valor: l.valor, op: OPS[d.operacao] }
              : { ok: false, nd: l.nd || '', ne: l.ne ? `${l.ne} - não realizado` : 'não realizado', valor: l.valor, op: OPS[d.operacao] }));
            const falhas = res.filter((x) => !x.ok).length;
            desp = await gerarDespacho(d, res, log);
            gravarRegistro(`${d.sei}|despacho`, desp);
            d.despacho = desp.numero;
            log(`  ✔ despacho ${desp.numero} salvo (falta assinar)${falhas ? ` — ${falhas} linha(s) como "não realizado"` : ''}`);
          } catch (e) { d.erros = (d.erros || []).concat('Despacho: ' + e.message); log('  ✖ despacho: ' + e.message); desenharTabela(); continue; }
        }
        // aviso (não erro): o documento continua marcável para tentar o bloco de novo
        try { await incluirEmBloco(d, desp, log); } catch (e) { d.avisos = (d.avisos || []).concat('Bloco de assinatura: ' + e.message); log('  ✖ bloco de assinatura: ' + e.message); }
        desenharTabela();
      }
    } finally {
      if (ugOriginal) { try { await garantirUG(ugOriginal, log); } catch (e) { log('Não consegui voltar para a UG original: ' + e.message); } }
      rodando = false;
      campo('esf-btn-ler').disabled = false;
      campo('esf-btn-exec').disabled = false;
      desenharTabela();
      log('Fim.');
    }
  }

  montarPainel();
})();

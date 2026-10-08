// ==UserScript==
// @name         DevDu - Instrumento de Cobrança (Planilha)
// @namespace    https://github.com/devdulab
// @version      1.0.0
// @description  Cadastra instrumentos de cobrança no Contratos.gov.br a partir de planilha Excel, via POST direto (sem cliques)
// @author       DevDu
// @icon         https://raw.githubusercontent.com/devdulab/scripts/main/assets/devdu-icon-64.png
// @match        https://contratos.sistema.gov.br/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @require      https://raw.githubusercontent.com/devdulab/scripts/main/lib/devdu-ui.js?v=1.0.0
// @grant        none
// @updateURL    https://raw.githubusercontent.com/devdulab/scripts/main/scripts/instrumento-cobranca-planilha.user.js
// @downloadURL  https://raw.githubusercontent.com/devdulab/scripts/main/scripts/instrumento-cobranca-planilha.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ================= CONFIGURAÇÃO =================
  const BASE = location.origin;
  const PAUSA_ENTRE_NOTAS_MS = 1500;
  const TEXTO_TIPO_LISTA = 'PRESTACAO DE SERVICOS';
  const TEXTO_TIPO_DOCUMENTO = 'FATURA';
  const TEXTO_PAIS = 'BRASIL';
  const DIAS_VENCIMENTO_PADRAO = 10;
  const COLUNAS_OBRIGATORIAS = ['numero_contrato', 'numero_controle', 'valor_processo', 'numero_processo',
    'nota_empenho', 'valor_empenho', 'data_atesto'];
  // Colunas opcionais: contrato_id (vários contratos de uma vez), item (nº do item da compra, ex.: 00002)
  // historico (ID ou texto do termo), subelemento (código, ex.: 16), pais_fabricacao (nome ou ID; vazio = Brasil), tipo_lista e tipo_instrumento (texto da opção ou ID),
  // serie, chave_nfe, glosa, descontar_glosa (Sim/Não), juros, multa, valor_liquido (conferência),
  // data_emissao (vazio = atesto), mes_ref e ano_ref (vazio = mês do atesto)

  const API_ITENS = '/api/listaitensparainstrumentocobranca';
  const API_EMPENHOS = id => `/api/listaempenhosparainstrumentocobranca?contrato_id%5B0%5D=${id}`;
  const API_SUBELEMENTOS = '/api/listasubelementoparainstrumentocobranca';

  let linhas = [];
  let rodando = false;
  const cache = { itens: {}, empenhos: {}, subelementos: {} };
  window.__icPayloads = [];

  // ================= UTILIDADES =================
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
  const urlLista = id => `${BASE}/meus-contratos/${id}/instrumento-cobranca`;
  const urlCreate = id => `${urlLista(id)}/create`;
  const contratoAberto = () => (location.pathname.match(/meus-contratos\/(\d+)/) || [])[1] || null;

  function parseValor(v) {
    let s = String(v ?? '').replace(/[R$\s]/g, '');
    if (!s) return NaN;
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    return Number(s);
  }

  const fmtBR = (n, casas = 2) =>
    n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

  // Glosa, juros e multa vão como o usuário digitaria no formulário: "1" ou "1,50" (sem milhar)
  const fmtSimples = n => (!n ? '' : Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));

  function normData(s) {
    s = String(s ?? '').trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const ano = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${ano}`;
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return s;
  }

  function addDiasUteis(dataBR, dias) {
    const [d, m, a] = dataBR.split('/').map(Number);
    const dt = new Date(a, m - 1, d);
    let n = 0;
    while (n < dias) {
      dt.setDate(dt.getDate() + 1);
      const w = dt.getDay();
      if (w !== 0 && w !== 6) n++;
    }
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  }

  function formatarProcesso(p) {
    const s = String(p ?? '').trim();
    const d = s.replace(/\D/g, '');
    if (d.length === 17 && !/[./-]/.test(s)) {
      return `${d.slice(0, 5)}.${d.slice(5, 11)}/${d.slice(11, 15)}-${d.slice(15)}`;
    }
    return s;
  }

  function agrupar(lista, campo) {
    const mapa = new Map();
    for (const l of lista) {
      const k = l[campo];
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(l);
    }
    return mapa;
  }

  // ================= PLANILHA =================
  async function lerPlanilha(file) {
    const buf = await file.arrayBuffer();
    // raw: CSV vira texto puro (sem converter "01/10/2026" em data UTC, que no fuso de Brasília
    // voltava um dia). Células de data reais do Excel são formatadas aqui como dd/mm/aaaa.
    const wb = XLSX.read(buf, { type: 'array', raw: true, cellNF: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    for (const [ref, c] of Object.entries(ws)) {
      if (ref[0] !== '!' && c.t === 'n' && c.z && XLSX.SSF.is_date(c.z)) c.w = XLSX.SSF.format('dd/mm/yyyy', c.v);
    }
    const rows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
    const out = rows.map(r => {
      const o = {};
      for (const [k, v] of Object.entries(r)) o[String(k).trim().toLowerCase()] = String(v).trim();
      return o;
    }).filter(o => o.numero_contrato || o.numero_controle);

    const faltando = COLUNAS_OBRIGATORIAS.filter(c => !(out[0] && c in out[0]));
    if (faltando.length) throw new Error(`Colunas ausentes na planilha: ${faltando.join(', ')}`);

    const cmp = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
    out.sort((a, b) => cmp(a.numero_contrato, b.numero_contrato) || cmp(a.numero_controle, b.numero_controle));
    return out;
  }

  // ================= ACESSO AO SISTEMA =================
  async function getDoc(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (/\/login/.test(res.url)) throw new Error('Sessão expirada: faça login de novo.');
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  }

  // Chamadas das APIs dos select2 (POST com os parâmetros no corpo; tenta GET se o POST não for aceito)
  async function api(caminho, params, token) {
    const url = new URL(caminho, BASE);
    const body = new URLSearchParams(params);
    const headers = {
      'X-CSRF-TOKEN': token,
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    };
    let res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers, body });
    if (res.status === 405) {
      for (const [k, v] of body) url.searchParams.append(k, v);
      res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' } });
    }
    if (/\/login/.test(res.url)) throw new Error('Sessão expirada: faça login de novo.');
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url.pathname}`);
    return res.json();
  }

  async function apiTodasPaginas(caminho, params, token) {
    const out = [];
    for (let page = 1; page <= 50; page++) {
      const r = await api(caminho, { ...params, page: String(page) }, token);
      const data = Array.isArray(r) ? r : (r.data || []);
      out.push(...data);
      if (Array.isArray(r) || !r.last_page || page >= r.last_page) break;
    }
    return out;
  }

  async function listarItens(historicoId, token) {
    if (!cache.itens[historicoId]) cache.itens[historicoId] = await apiTodasPaginas(API_ITENS, { contratohistorico_id: historicoId }, token);
    return cache.itens[historicoId];
  }

  async function listarEmpenhos(contratoId, token) {
    if (!cache.empenhos[contratoId]) cache.empenhos[contratoId] = await apiTodasPaginas(API_EMPENHOS(contratoId), {}, token);
    return cache.empenhos[contratoId];
  }

  async function listarSubelementos(empenhoId, token) {
    if (!cache.subelementos[empenhoId]) cache.subelementos[empenhoId] = await apiTodasPaginas(API_SUBELEMENTOS, { empenho_id: empenhoId }, token);
    return cache.subelementos[empenhoId];
  }

  // Vazio = primeiro item da lista (o do topo, igual ao ENTER do Python).
  // Aceita: nº do item da compra (00002), ID do item (5099324) ou parte da descrição.
  function escolherItem(itens, valor) {
    if (!itens.length) return { item: null };
    const v = String(valor || '').trim();
    if (!v) return { item: itens[0] };
    if (/^\d+$/.test(v)) {
      const porId = itens.find(i => String(i.id) === v);
      if (porId) return { item: porId };
      const alvo = v.padStart(5, '0');
      const porNum = itens.find(i => String(i.numero_item_compra).padStart(5, '0') === alvo);
      if (porNum) return { item: porNum };
    }
    const alvo = norm(v);
    const achados = itens.filter(i => norm(i.descricao_itens_para_inst_cobranca || i.descricao_complementar || i.descricao_item).includes(alvo));
    if (achados.length === 1) return { item: achados[0] };
    return { item: null, erro: achados.length ? `item "${v}" é ambíguo (${achados.length} itens)` : `item "${v}" não existe no histórico` };
  }

  // Vazio = primeira opção da lista (o termo do topo, igual ao ENTER do Python).
  // Aceita: ID (1677002), ou parte do texto (Termo Aditivo - 00006/2026, 00006/2026, Apostilamento - 00001/2026).
  function escolherHistorico(doc, valor) {
    const ops = opcoesDe(doc, n => n.includes('contratohistorico_id'));
    if (!ops.length) return { id: null, erro: 'nenhum histórico (termo) disponível no contrato' };
    const v = String(valor || '').trim();
    if (!v) return { id: ops[0].value, texto: ops[0].textContent.trim() };
    const porId = ops.find(o => o.value === v);
    if (porId) return { id: porId.value, texto: porId.textContent.trim() };
    const alvo = norm(v);
    const achados = ops.filter(o => norm(o.textContent).includes(alvo));
    if (achados.length === 1) return { id: achados[0].value, texto: achados[0].textContent.trim() };
    return { id: null, erro: achados.length ? `histórico "${v}" é ambíguo (${achados.length} termos)` : `histórico "${v}" não existe no contrato` };
  }

  // Sem a coluna "subelemento", usa o primeiro (igual ao ENTER do Python).
  // Com a coluna (ex.: 16), procura pelo código no início de "16 - OUTSOURCING DE IMPRESSAO".
  function escolherSubelemento(subs, codigo) {
    if (!subs.length) return null;
    if (!codigo) return subs[0];
    const alvo = String(codigo).replace(/\D/g, '').padStart(2, '0');
    return subs.find(s => (String(s.descricao_subelemento).match(/^\s*(\d+)/) || [])[1]?.padStart(2, '0') === alvo) || null;
  }

  function acharEmpenho(lista, ne) {
    const alvo = norm(ne).replace(/\s/g, '');
    const exato = lista.find(e => norm(e.numero) === alvo);
    if (exato) return exato;
    const finais = lista.filter(e => norm(e.numero).endsWith(alvo));
    return finais.length === 1 ? finais[0] : null;
  }

  // ================= LEITURA DA PÁGINA DE CRIAÇÃO =================
  function colherCampos(doc) {
    const forms = [...doc.querySelectorAll('form')];
    const form = forms.find(f => /instrumento-cobranca/.test(f.getAttribute('action') || '') && f.querySelector('[name="_token"]'))
      || forms.find(f => (f.getAttribute('method') || '').toLowerCase() === 'post');
    const base = {};
    if (form) {
      form.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
        const t = (el.type || '').toLowerCase();
        if (t === 'file' || ((t === 'checkbox' || t === 'radio') && !el.checked)) return;
        let v;
        if (el.tagName === 'SELECT') {
          const o = el.querySelector('option[selected]');
          v = o ? o.value : '';
        } else {
          v = el.value ?? el.getAttribute('value') ?? '';
        }
        if (!base[el.name]) base[el.name] = v;
      });
    }
    base._token = base._token || doc.querySelector('meta[name="csrf-token"]')?.content || '';
    return base;
  }

  function opcoesDe(doc, pred) {
    return [...doc.querySelectorAll('select')]
      .filter(s => pred(`${s.name || ''} ${s.id || ''}`.toLowerCase()))
      .flatMap(s => [...s.options].filter(o => o.value !== ''));
  }

  function acharOpcao(doc, pred, texto) {
    const alvo = norm(texto);
    const ops = opcoesDe(doc, pred);
    const exata = ops.find(o => norm(o.textContent) === alvo);
    if (exata) return exata.value;
    const parciais = ops.filter(o => norm(o.textContent).includes(alvo));
    return parciais.length === 1 ? parciais[0].value : null; // nenhum ou ambíguo (ex.: "Coreia")
  }

  // Valor da planilha: aceita o ID (ex.: 442) ou o texto da opção (ex.: Fatura, Nota Fiscal Eletrônica).
  function resolverOpcao(doc, pred, valorPlanilha, padrao) {
    const v = String(valorPlanilha || '').trim();
    if (!v) return acharOpcao(doc, pred, padrao);
    if (/^\d+$/.test(v)) return opcoesDe(doc, pred).some(o => o.value === v) ? v : null;
    return acharOpcao(doc, pred, v);
  }

  const textoOpcao = (doc, pred, valor) =>
    opcoesDe(doc, pred).find(o => o.value === String(valor))?.textContent.trim() || '';
  const ehLista = n => n.includes('tipolistafatura');
  const ehTipoDoc = n => n.includes('tipo_de_instrumento');
  const ehPais = n => n.includes('paisfabricacao');

  const primeiraOpcao = (doc, pred) => opcoesDe(doc, pred)[0]?.value || null;

  // ================= MONTAGEM DO POST =================
  function montarPayload(base, d) {
    const fd = new FormData();
    const add = (k, v) => fd.append(k, v ?? '');
    const b = k => base[k] ?? '';
    const arquivoVazio = () => new File([], '', { type: 'application/octet-stream' });

    add('_token', b('_token'));
    add('_http_referrer', b('_http_referrer') || urlLista(d.contratoId));
    add('fornecedor_id', b('fornecedor_id'));
    add('contrato_id', b('contrato_id') || d.contratoId);
    add('contratos_ids', b('contratos_ids'));
    add('user_id', b('user_id'));
    add('valor', b('valor') || '1'); // campo interno do formulário; vem da página
    add('valorliquido', fmtBR(d.liquido));
    add('valorfaturado', fmtBR(d.valor));
    add('situacao', b('situacao') || 'PEN');
    add('data_max_vencimento', d.vencimento);
    add('dataLimiteDias', String(d.diasLimite));
    add('fornecedorSubContratado', b('fornecedorSubContratado'));
    add('ugDescentralizada', b('ugDescentralizada'));
    add('origem_fornecedor', b('origem_fornecedor'));
    add('prazo', b('prazo'));
    add('processo', d.processo);
    add('tipolistafatura_id', d.tipoLista);
    add('tipo_de_instrumento_de_cobranca_id', d.tipoDoc);
    add('emissao', d.emissao || d.data);
    add('numero', d.numero);
    add('serie', d.serie);
    add('chave_nfe', d.chave);
    add('arquivo_do_instrumento_de_cobranca_clear', '');
    fd.append('arquivo_do_instrumento_de_cobranca', arquivoVazio(), '');
    add('glosa', fmtSimples(d.glosa));
    add('descontar_glosa', d.descontarGlosa);
    add('juros', fmtSimples(d.juros));
    add('multa', fmtSimples(d.multa));
    add('contratohistorico_id', d.historico);
    add('valorfaturado', fmtBR(d.valor));
    add('valorliquido', fmtBR(d.liquido));

    add('contratofaturasitem', '');
    add('contratofaturasitem[0][id]', '');
    add('contratofaturasitem[0][valorunitario_faturado]', fmtBR(d.valor, 4));
    add('contratofaturasitem[0][quantidade_faturado]', '1');
    add('contratofaturasitem[0][valortotal_faturado]', fmtBR(d.valor));
    add('contratofaturasitem[0][paisfabricacao_id]', d.pais);
    add('contratofaturasitem[0][paisescolhido]', '');
    add('contratofaturasitem[0][saldohistoricoitens_id]', d.item.id);
    add('contratofaturasitem[0][contratohistorico_id]', d.item.saldoable_id || d.historico);
    add('contratofaturasitem[0][quantidade]', d.item.quantidade);
    add('contratofaturasitem[0][valorunitario]', d.item.valorunitario);
    add('contratofaturasitem[0][descriao_item_linha]', d.item.descricao_itens_para_inst_cobranca || d.item.descricao_item || '');
    add('repactuacao', '0');
    add('repactuacao', '0');

    add('contratofaturasmesano', '');
    add('contratofaturasmesano[0][id]', '');
    add('contratofaturasmesano[0][mesref]', d.mes);
    add('contratofaturasmesano[0][anoref]', d.ano);
    add('contratofaturasmesano[0][valorref]', fmtBR(d.liquido));

    add('contratofaturasempenhos', '');
    d.empenhos.forEach((e, i) => {
      add(`contratofaturasempenhos[${i}][id]`, '');
      add(`contratofaturasempenhos[${i}][empenho]`, e.id);
      add(`contratofaturasempenhos[${i}][subelemento]`, e.sub);
      add(`contratofaturasempenhos[${i}][valorref]`, fmtBR(e.valor));
    });

    add('infcomplementar', '');
    add('arquivo_complementar_clear', '');
    fd.append('arquivo_complementar', arquivoVazio(), '');
    add('optante_simples', b('optante_simples') || '0');
    add('contratofaturatributacao', '');
    add('protocolo', d.data);
    add('ateste', d.data);
    add('vencimento', d.vencimento);
    add('justificativa_vencimento_id', '');
    add('justificativa_vencimento_outro', '');
    add('contratofaturaateste', '');
    add('justificativa', '');
    add('_current_tab', 'dados-do-instrumento-de-cobranca');
    add('_save_action', 'save_action_one');
    add('contratofaturareferencia_saldo', '0,00');
    add('contratofaturaempenhos_saldo', '0,00');
    return fd;
  }

  function extrairErros(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const msgs = [...doc.querySelectorAll('.invalid-feedback, .help-block, .alert-danger, .alert-error, .text-danger')]
      .map(e => e.textContent.trim()).filter(Boolean);
    const noty = [...html.matchAll(/text\s*:\s*["'`]([^"'`]{3,300})["'`]/g)].map(m => m[1]);
    return [...new Set([...msgs, ...noty])].slice(0, 8).join(' | ') || 'erro não identificado (confira no sistema)';
  }

  // ================= PROCESSAMENTO DE UMA NOTA =================
  async function processarNota(contratoId, linhasNota, simular) {
    const l = linhasNota[0];
    const rot = `NF ${l.numero_controle}`;
    const pend = [];
    const avisos = [];

    const doc = await getDoc(urlCreate(contratoId));
    const base = colherCampos(doc);
    const token = base._token;
    if (!token) throw new Error('não achei o _token na página de criação');

    const valor = parseValor(l.valor_processo); // valor faturado
    if (!(valor > 0)) throw new Error(`valor_processo inválido: "${l.valor_processo}"`);

    // glosa, juros e multa (opcionais). Líquido = faturado − glosa (só se descontar) + juros + multa
    const lerAcrescimo = campo => {
      const t = String(l[campo] || '').trim();
      if (!t) return 0;
      const n = parseValor(t);
      if (!(n >= 0)) { pend.push(`${campo} inválido: "${t}"`); return 0; }
      return n;
    };
    const glosa = lerAcrescimo('glosa');
    const juros = lerAcrescimo('juros');
    const multa = lerAcrescimo('multa');
    const descontarGlosa = /^(1|S|SIM|TRUE|X)$/.test(norm(l.descontar_glosa)) ? '1' : '0';
    if (glosa > 0 && descontarGlosa === '0') avisos.push('glosa informada, mas descontar_glosa = Não (não reduz o líquido)');
    const liquido = Math.round((valor - (descontarGlosa === '1' ? glosa : 0) + juros + multa) * 100) / 100;
    if (!(liquido > 0)) pend.push(`valor líquido calculado inválido (${fmtBR(liquido)})`);
    if (String(l.valor_liquido || '').trim()) {
      const informado = parseValor(l.valor_liquido);
      if (!(Math.abs(informado - liquido) <= 0.005)) {
        pend.push(`valor_liquido da planilha (${l.valor_liquido}) ≠ calculado (${fmtBR(liquido)})`);
      }
    }
    const data = normData(l.data_atesto);
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data)) throw new Error(`data_atesto inválida: "${l.data_atesto}"`);
    let [, mes, ano] = data.split('/');
    if (String(l.mes_ref || '').trim() && String(l.ano_ref || '').trim()) {
      mes = String(l.mes_ref).trim().padStart(2, '0');
      ano = String(l.ano_ref).trim();
    }
    const emissao = String(l.data_emissao || '').trim() ? normData(l.data_emissao) : data;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(emissao)) throw new Error(`data_emissao inválida: "${l.data_emissao}"`);

    const tipoLista = resolverOpcao(doc, n => n.includes('tipolistafatura'), l.tipo_lista, TEXTO_TIPO_LISTA);
    if (!tipoLista) pend.push(`tipo de lista "${l.tipo_lista || TEXTO_TIPO_LISTA}" não existe ou é ambíguo`);
    const tipoDoc = resolverOpcao(doc, n => n.includes('tipo_de_instrumento'), l.tipo_instrumento, TEXTO_TIPO_DOCUMENTO);
    if (!tipoDoc) pend.push(`tipo de instrumento "${l.tipo_instrumento || TEXTO_TIPO_DOCUMENTO}" não existe ou é ambíguo`);
    const chave = String(l.chave_nfe || '').replace(/\D/g, '');
    if (chave && chave.length !== 44) pend.push(`chave_nfe com ${chave.length} dígitos (deveria ter 44)`);
    if (/ELETRONICA/.test(norm(textoOpcao(doc, ehTipoDoc, tipoDoc))) && !chave) avisos.push('tipo é NF eletrônica e a chave_nfe está vazia');
    // país de fabricação: coluna opcional (nome ou ID); vazio = Brasil
    const pais = resolverOpcao(doc, ehPais, l.pais_fabricacao, TEXTO_PAIS);
    if (!pais) pend.push(`país de fabricação "${l.pais_fabricacao || 'Brasil'}" não existe ou é ambíguo`);

    const hist = escolherHistorico(doc, l.historico);
    const historico = hist.id;
    let item = null;
    if (!historico) {
      pend.push(hist.erro);
    } else {
      const itens = await listarItens(historico, token);
      const r = itens.length ? escolherItem(itens, l.item) : { item: null, erro: `nenhum item no histórico ${hist.texto}` };
      item = r.item;
      if (!item) pend.push(r.erro);
      else if (itens.length > 1 && !l.item) avisos.push(`histórico tem ${itens.length} itens; usando o do topo (${item.numero_item_compra}). Use a coluna "item" para escolher outro`);
    }

    const listaNE = await listarEmpenhos(contratoId, token);
    const empenhos = [];
    for (const le of linhasNota) {
      const ve = parseValor(le.valor_empenho);
      if (!(ve > 0)) pend.push(`valor do empenho ${le.nota_empenho}`);
      const e = acharEmpenho(listaNE, le.nota_empenho);
      let sub = null;
      if (!e) {
        pend.push(`empenho ${le.nota_empenho} não encontrado neste contrato`);
      } else {
        const subs = await listarSubelementos(e.id, token);
        sub = escolherSubelemento(subs, le.subelemento);
        if (!sub) pend.push(le.subelemento ? `subelemento ${le.subelemento} não existe no ${e.numero}` : `subelemento do empenho ${e.numero}`);
        else if (subs.length > 1 && !le.subelemento) avisos.push(`${e.numero} tem ${subs.length} subelementos; usando "${sub.descricao_subelemento}". Use a coluna "subelemento" para escolher outro`);
        const saldo = Number(e.aliquidar);
        if (Number.isFinite(saldo) && ve > saldo + 0.005) avisos.push(`saldo a liquidar do ${e.numero} (${fmtBR(saldo)}) é menor que ${fmtBR(ve)}`);
      }
      empenhos.push({ ne: e?.numero || le.nota_empenho, id: e?.id ?? null, sub: sub?.id ?? null, subDesc: sub?.descricao_subelemento || '', valor: ve });
    }
    const soma = empenhos.reduce((s, e) => s + (e.valor || 0), 0);
    if (Math.abs(soma - liquido) > 0.005) {
      pend.push(`soma dos empenhos (${fmtBR(soma)}) ≠ valor líquido (${fmtBR(liquido)})`);
    }

    const diasLimite = Number(base.dataLimiteDias) || DIAS_VENCIMENTO_PADRAO;
    const vencimento = addDiasUteis(data, diasLimite);

    if (simular || pend.length) {
      log(`[${simular ? 'SIMULAÇÃO' : 'VERIFICAÇÃO'}] ${rot} (contrato ${contratoId}): faturado ${fmtBR(valor)} | líquido ${fmtBR(liquido)}${glosa || juros || multa ? ` (glosa ${fmtBR(glosa)}${descontarGlosa === '1' ? ' descontada' : ' não descontada'}, juros ${fmtBR(juros)}, multa ${fmtBR(multa)})` : ''} | emissão ${emissao} | ateste ${data} | venc. ${vencimento} | ref ${mes}/${ano} | processo ${formatarProcesso(l.numero_processo)}`);
      log(`   lista=${tipoLista} (${textoOpcao(doc, ehLista, tipoLista)}) | tipo=${tipoDoc} (${textoOpcao(doc, ehTipoDoc, tipoDoc)}) | série=${l.serie || '-'} | chave=${chave || '-'}`);
      log(`   país=${pais} (${textoOpcao(doc, ehPais, pais)}) | histórico ${historico ?? '-'}: ${hist.texto || '-'}`);
      if (item) log(`   item ${item.id}: ${item.descricao_itens_para_inst_cobranca || item.descricao_item} (qtd ${item.quantidade}, unit. ${item.valorunitario})`);
      empenhos.forEach(e => log(`   ${e.ne} → id ${e.id ?? '-'} | sub ${e.sub ?? '-'} ${e.subDesc} | ${fmtBR(e.valor || 0)}`));
      if (pend.length) log(`   ⚠ PENDÊNCIAS: ${pend.join('; ')}`);
      if (avisos.length) log(`   ℹ avisos: ${avisos.join('; ')}`);
    }
    if (pend.length) return 'pendente';

    const d = {
      contratoId, valor, liquido, glosa, juros, multa, descontarGlosa, data, emissao, mes, ano, vencimento, diasLimite,
      processo: formatarProcesso(l.numero_processo),
      numero: l.numero_controle,
      tipoLista, tipoDoc, pais, historico, item, empenhos,
      serie: l.serie || '', chave,
    };
    const fd = montarPayload(base, d);

    if (simular) {
      window.__icPayloads.push({ nota: rot, contratoId, campos: [...fd.entries()].filter(([, v]) => typeof v === 'string') });
      return 'simulado';
    }

    if (avisos.length) log(`   ℹ ${rot}: ${avisos.join('; ')}`);
    const res = await fetch(urlLista(contratoId), { method: 'POST', body: fd, credentials: 'same-origin' });
    const html = await res.text();
    if (!res.ok || new URL(res.url).pathname.endsWith('/create')) {
      throw new Error(`recusada pelo sistema: ${extrairErros(html)}`);
    }
    log(`✔ ${rot} cadastrada (contrato ${contratoId})`);
    return 'ok';
  }

  // ================= FLUXO PRINCIPAL =================
  function montarFila() {
    const escolha = campo('ic-contrato').value;
    const porContrato = agrupar(linhas, 'numero_contrato');
    if (escolha) {
      const id = contratoAberto();
      if (!id) throw new Error('Abra o contrato no sistema (página meus-contratos/ID/...) ou escolha "todos" com a coluna contrato_id.');
      return [[escolha, id, porContrato.get(escolha) || []]];
    }
    return [...porContrato].map(([num, ls]) => [num, (ls[0].contrato_id || '').replace(/\D/g, '') || null, ls]);
  }

  async function cadastrar() {
    if (rodando) return;
    if (!linhas.length) return log('Selecione a planilha primeiro.');
    const simular = campo('ic-simular').checked;
    let fila;
    try { fila = montarFila(); } catch (e) { return log(e.message); }
    if (!simular && !confirm(`Envio REAL para ${fila.map(f => f[0]).join(', ')}. Continuar?`)) return;

    rodando = true;
    window.__icPayloads = [];
    const cont = { ok: 0, simulado: 0, pendente: 0, erro: 0 };
    log(`===== Início (${simular ? 'SIMULAÇÃO' : 'ENVIO REAL'}) =====`);

    try {
      for (const [numContrato, contratoId, linhasContrato] of fila) {
        const notas = agrupar(linhasContrato, 'numero_controle');
        if (!contratoId) {
          log(`✖ Contrato ${numContrato}: sem contrato_id na planilha; abra o contrato e selecione-o no painel`);
          cont.erro += notas.size;
          continue;
        }
        log(`Contrato ${numContrato} → id ${contratoId} (${notas.size} nota(s))`);
        for (const [numControle, linhasNota] of notas) {
          try {
            cont[await processarNota(contratoId, linhasNota, simular)]++;
          } catch (e) {
            cont.erro++;
            log(`✖ NF ${numControle}: ${e.message}`);
            if (/Sessão expirada/.test(e.message)) throw e;
          }
          await sleep(PAUSA_ENTRE_NOTAS_MS);
        }
      }
    } catch (e) {
      log(`Interrompido: ${e.message}`);
    } finally {
      rodando = false;
      log(`===== Fim: ${cont.ok} cadastradas, ${cont.simulado} simuladas, ${cont.pendente} pendentes, ${cont.erro} com erro =====`);
      if (simular) log('Payloads completos no console: window.__icPayloads');
    }
  }

  // ================= PAINEL =================
  function log(msg) {
    const t = campo('ic-log');
    const hora = new Date().toLocaleTimeString('pt-BR');
    t.value += `[${hora}] ${msg}\n`;
    t.scrollTop = t.scrollHeight;
    console.log('[IC]', msg);
  }

  function preencherSeletorContratos() {
    const sel = campo('ic-contrato');
    const numeros = [...agrupar(linhas, 'numero_contrato').keys()];
    sel.innerHTML = '<option value="">Todos (exige coluna contrato_id)</option>'
      + numeros.map(n => `<option value="${n}">${n}</option>`).join('');
    // tenta reconhecer o contrato aberto pelo texto da página
    if (contratoAberto()) {
      const texto = norm(document.body.innerText);
      const achados = numeros.filter(n => texto.includes(norm(n)));
      if (achados.length === 1) {
        sel.value = achados[0];
        log(`Contrato aberto reconhecido: ${achados[0]} (id ${contratoAberto()}). Confira antes de enviar.`);
      } else {
        log(`Contrato aberto: id ${contratoAberto()}. Escolha no seletor qual número da planilha ele é.`);
      }
    }
  }

  // Planilha modelo embutida (mesmas colunas e instruções do arquivo modelo_instrumento_cobranca.xlsx)
  const MODELO_XLSX_B64 = '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';

  function baixarModelo() {
    try {
      const bin = atob(MODELO_XLSX_B64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'modelo_instrumento_cobranca.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      log('Planilha modelo baixada. Apague as linhas amarelas de exemplo antes de usar.');
    } catch (e) {
      log(`Não consegui gerar o modelo: ${e.message}`);
    }
  }

  // Painel padrão DevDu (lib/devdu-ui.js, via @require): abas na lateral, lingueta verde à direita
  let painel = null;
  const campo = id => painel.raiz.getElementById(id);
  const CSS = `
    .ic-arq{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px}
    .ic-arq input{max-width:260px}
    .ic-lnk{all:unset;cursor:pointer;color:var(--teal-esc);text-decoration:underline;font-size:12px}
    .ic-check{display:flex;gap:6px;align-items:center;margin-bottom:10px}
    .ic-botoes{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
    #ic-log{width:100%;height:260px;font:11px Consolas,monospace;border:1px solid var(--borda);border-radius:6px;padding:6px;resize:vertical;background:var(--fundo2)}`;

  function criarPainel() {
    if (document.querySelector('[data-devdu="devdu:instrumento-cobranca-planilha"]')) return;
    painel = DevDu.painel({
      id: 'instrumento-cobranca-planilha', nome: 'Instrumento de Cobrança (Planilha)', largura: 460, css: CSS,
      abas: [{ id: 'cadastrar', titulo: 'Cadastrar', icone: '▶️' }, { id: 'sobre', titulo: 'Sobre', icone: 'ℹ️' }],
    });
    painel.secao('cadastrar').innerHTML = `
      <div class="ic-arq"><input type="file" id="ic-arquivo" accept=".xlsx,.xls,.csv">
        <button id="ic-modelo" type="button" class="ic-lnk">Baixar planilha modelo</button></div>
      <label class="dd-campo"><span>Contrato</span>
        <select id="ic-contrato"><option value="">(carregue a planilha)</option></select></label>
      <label class="ic-check"><input type="checkbox" id="ic-simular" checked> Simular (não envia nada)</label>
      <div class="ic-botoes"><button class="dd-btn" id="ic-cadastrar">Cadastrar notas</button>
        <button class="dd-btn sec" id="ic-copiar">Copiar log</button><button class="dd-btn sec" id="ic-limpar">Limpar</button></div>
      <textarea id="ic-log" readonly></textarea>`;
    painel.secao('sobre').innerHTML = `<p>Cadastra no <b>Contratos.gov.br</b> os instrumentos de cobrança (notas fiscais) de uma
      planilha, com a sessão já logada e sem cliques.</p>
      <ol><li>Abra o contrato no Contratos.gov.br (tela de instrumentos de cobrança).</li>
      <li><b>Baixar planilha modelo</b>, preencher (instruções na aba <i>instrucoes</i>) e escolher o arquivo.</li>
      <li>Confira o contrato, rode em <b>Simular</b>, desligue a simulação e clique em <b>Cadastrar notas</b>.</li></ol>
      <p>Use este <b>ou</b> o <b>Instrumento de Cobrança (Gercont)</b>, não os dois ao mesmo tempo.</p>
      <p style="color:var(--suave);font-size:12px">Problemas: fale com a Dulce informando o nome do script e a versão (no rodapé do painel).</p>`;
    if (document.querySelector('[data-devdu="devdu:instrumento-cobranca-gercont"]')) {
      setTimeout(() => log('⚠ O Instrumento de Cobrança (Gercont) também está ativo. Desative um dos dois no Tampermonkey.'), 0);
    }
    campo('ic-arquivo').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        linhas = await lerPlanilha(f);
        const contratos = agrupar(linhas, 'numero_contrato').size;
        const notas = new Set(linhas.map(l => `${l.numero_contrato}|${l.numero_controle}`)).size;
        log(`Planilha "${f.name}": ${linhas.length} linhas, ${contratos} contrato(s), ${notas} nota(s).`);
        preencherSeletorContratos();
      } catch (err) {
        linhas = [];
        log(`Erro ao ler planilha: ${err.message}`);
      }
    };
    campo('ic-cadastrar').onclick = cadastrar;
    campo('ic-modelo').onclick = baixarModelo;
    campo('ic-copiar').onclick = () => navigator.clipboard.writeText(campo('ic-log').value)
      .then(() => log('Log copiado.'));
    campo('ic-limpar').onclick = () => { campo('ic-log').value = ''; };
  }

  if (window.top === window.self) criarPainel();
})();

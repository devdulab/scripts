/*!
 * DevDu UI — painel lateral padrão dos scripts DevDu
 * Uso: // @require https://raw.githubusercontent.com/devdulab/scripts/main/lib/devdu-ui.js?v=1.0.0
 *
 * const painel = DevDu.painel({
 *   nome: 'Verificador SEI',
 *   abas: [
 *     { id: 'inicio', titulo: 'Início', icone: '🏠', render: (el, painel) => { ... } },
 *     { id: 'config', titulo: 'Config.', icone: '⚙️', render: (el, painel) => { ... } },
 *   ],
 *   id: 'verificador-sei',   // opcional: chave do painel (padrão: o nome)
 *   largura: 400,            // opcional: largura do painel em px
 *   css: '.minha-lista { ... }', // opcional: CSS do script (o painel é isolado do CSS da página)
 * });
 * As seções das abas existem desde o início (painel.secao(id)); render() só roda na 1ª vez que a aba aparece.
 */
(function (global) {
  'use strict';

  const UI_VERSAO = '1.0.0';

  const ICONE_SVG = `<svg viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="28" fill="#0E9A92"/><g fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"><path d="M38 50 V38 H62 A26 26 0 0 1 62 90 H38 V74"/><path d="M38 61 L50 73 L73 50"/></g></svg>`;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: Inter, "Segoe UI", Arial, sans-serif; }
    .dd { --teal:#0E9A92; --teal-esc:#0B7C76; --navy:#0D2B57; --fundo:#fff; --fundo2:#F3F6F8;
          --borda:#DCE3E8; --texto:#1C2833; --suave:#5F6F7D; --ok:#1E8E4E; --erro:#C0392B; --aviso:#B7791F;
          position: fixed; top: 0; right: 0; height: 100vh; z-index: 2147483000;
          display: flex; color: var(--texto); font-size: 13px; line-height: 1.4; }
    /* Lingueta para abrir */
    .lingueta { position: fixed; right: 0; top: calc(40% + var(--ordem, 0) * 52px); width: 40px; height: 44px; border: 0; cursor: pointer;
          background: var(--teal); border-radius: 10px 0 0 10px; padding: 6px; box-shadow: -2px 2px 8px rgba(0,0,0,.2); }
    .lingueta svg { width: 28px; height: 28px; display: block; }
    .lingueta:hover { background: var(--teal-esc); }
    .dd.aberto .lingueta { display: none; }
    /* Painel */
    .painel { display: none; height: 100%; width: var(--largura, 400px); max-width: 100vw; background: var(--fundo);
          border-left: 1px solid var(--borda); box-shadow: -6px 0 24px rgba(13,43,87,.15); }
    .dd.aberto .painel { display: flex; }
    /* Abas na lateral */
    .trilho { width: 72px; flex: none; background: var(--navy); display: flex; flex-direction: column;
          align-items: stretch; padding: 8px 0; gap: 2px; overflow-y: auto; }
    .trilho .marca { display: flex; justify-content: center; padding: 4px 0 10px; }
    .trilho .marca svg { width: 34px; height: 34px; }
    .aba { all: unset; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 3px;
          padding: 9px 4px; color: #B9C7D6; font-size: 10.5px; text-align: center; border-left: 3px solid transparent; }
    .aba .ic { font-size: 18px; line-height: 1; }
    .aba:hover { color: #fff; background: rgba(255,255,255,.06); }
    .aba[aria-selected="true"] { color: #fff; background: rgba(14,154,146,.25); border-left-color: var(--teal); }
    .aba:focus-visible { outline: 2px solid var(--teal); outline-offset: -2px; }
    .trilho .espaco { flex: 1; }
    /* Corpo */
    .corpo { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .topo { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--borda); }
    .topo h1 { all: unset; flex: 1; font-size: 15px; font-weight: 700; color: var(--navy); }
    .topo .fechar { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 6px; text-align: center;
          line-height: 28px; font-size: 18px; color: var(--suave); }
    .topo .fechar:hover { background: var(--fundo2); color: var(--texto); }
    .conteudo { flex: 1; overflow-y: auto; padding: 14px; }
    .secao[hidden] { display: none; }
    .rodape { padding: 7px 14px; border-top: 1px solid var(--borda); font-size: 11px; color: var(--suave);
          display: flex; justify-content: space-between; }
    .rodape b { color: var(--teal-esc); }
    /* Componentes */
    .dd-btn { all: unset; cursor: pointer; display: inline-block; padding: 7px 14px; border-radius: 7px;
          background: var(--teal); color: #fff; font-weight: 600; font-size: 13px; }
    .dd-btn:hover { background: var(--teal-esc); }
    .dd-btn.sec { background: var(--fundo2); color: var(--navy); border: 1px solid var(--borda); }
    .dd-btn[disabled] { opacity: .5; pointer-events: none; }
    .dd-campo { display: block; margin-bottom: 10px; }
    .dd-campo span { display: block; font-size: 12px; color: var(--suave); margin-bottom: 3px; }
    .dd-campo input, .dd-campo select, .dd-campo textarea { width: 100%; padding: 7px 9px; border: 1px solid var(--borda);
          border-radius: 6px; font-size: 13px; color: var(--texto); background: #fff; }
    .dd-log { background: var(--fundo2); border-radius: 6px; padding: 8px; max-height: 260px; overflow-y: auto;
          font-family: Consolas, monospace; font-size: 11.5px; }
    .dd-log div { padding: 1px 0; }
    .dd-log .ok { color: var(--ok); } .dd-log .erro { color: var(--erro); } .dd-log .aviso { color: var(--aviso); }
    .toast { position: fixed; bottom: 48px; right: 18px; padding: 10px 14px; border-radius: 8px; color: #fff;
          background: var(--navy); box-shadow: 0 4px 14px rgba(0,0,0,.25); font-size: 13px; max-width: 320px; }
    .toast.ok { background: var(--ok); } .toast.erro { background: var(--erro); } .toast.aviso { background: var(--aviso); }
  `;

  function armazenar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem armazenamento */ }
  }
  function ler(chave, padrao) {
    try { const v = localStorage.getItem(chave); return v === null ? padrao : JSON.parse(v); } catch (e) { return padrao; }
  }
  function esc(t) {
    return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function painel(opcoes) {
    const info = (typeof GM_info !== 'undefined' && GM_info.script) || {};
    const nome = opcoes.nome || info.name || 'DevDu';
    const versao = opcoes.versao || info.version || '';
    const abas = opcoes.abas || [];
    const chave = 'devdu:' + (opcoes.id || nome).toLowerCase().replace(/\W+/g, '-');

    const ordem = document.querySelectorAll('[data-devdu]').length; // várias linguetas empilhadas
    const host = document.createElement('div');
    host.setAttribute('data-devdu', chave);
    const raiz = host.attachShadow({ mode: 'open' });
    raiz.innerHTML = `
      <style>${CSS}${opcoes.css || ''}</style>
      <div class="dd" style="--largura:${Number(opcoes.largura) || 400}px; --ordem:${ordem}">
        <button class="lingueta" title="Abrir ${esc(nome)}" aria-label="Abrir ${esc(nome)}">${ICONE_SVG}</button>
        <div class="painel" role="dialog" aria-label="${esc(nome)}">
          <nav class="trilho" role="tablist" aria-orientation="vertical">
            <div class="marca" title="DevDu">${ICONE_SVG}</div>
            ${abas.map(a => `<button class="aba" role="tab" data-aba="${esc(a.id)}" aria-selected="false">
                <span class="ic">${a.icone || '•'}</span><span>${esc(a.titulo)}</span></button>`).join('')}
            <div class="espaco"></div>
          </nav>
          <div class="corpo">
            <header class="topo"><h1>${esc(nome)}</h1><button class="fechar" title="Fechar" aria-label="Fechar">×</button></header>
            <div class="conteudo">
              ${abas.map(a => `<section class="secao" role="tabpanel" data-secao="${esc(a.id)}" hidden></section>`).join('')}
            </div>
            <footer class="rodape"><span><b>DevDu</b> · ${esc(nome)}</span><span>v${esc(versao)}</span></footer>
          </div>
        </div>
      </div>`;
    (document.body || document.documentElement).appendChild(host);

    const $ = s => raiz.querySelector(s);
    const dd = $('.dd');
    const renderizadas = new Set();
    let abaAtual = null;

    const api = {
      raiz, elemento: host,
      abrir() { dd.classList.add('aberto'); armazenar(chave + ':aberto', true); if (!abaAtual && abas[0]) api.mostrarAba(abas[0].id); },
      fechar() { dd.classList.remove('aberto'); armazenar(chave + ':aberto', false); },
      alternar() { dd.classList.contains('aberto') ? api.fechar() : api.abrir(); },
      mostrarAba(id) {
        const aba = abas.find(a => a.id === id) || abas[0];
        if (!aba) return;
        raiz.querySelectorAll('.aba').forEach(b => b.setAttribute('aria-selected', String(b.dataset.aba === aba.id)));
        raiz.querySelectorAll('.secao').forEach(s => { s.hidden = s.dataset.secao !== aba.id; });
        const secao = raiz.querySelector(`.secao[data-secao="${aba.id}"]`);
        if (!renderizadas.has(aba.id) && typeof aba.render === 'function') {
          renderizadas.add(aba.id);
          try { aba.render(secao, api); } catch (e) { secao.textContent = 'Erro ao montar a aba: ' + e.message; console.error(e); }
        }
        abaAtual = aba.id;
        armazenar(chave + ':aba', aba.id);
        if (typeof aba.aoMostrar === 'function') aba.aoMostrar(secao, api);
      },
      secao(id) { return raiz.querySelector(`.secao[data-secao="${id}"]`); },
      toast(msg, tipo = '', ms = 3500) {
        const t = document.createElement('div');
        t.className = 'toast ' + tipo; t.textContent = msg;
        dd.appendChild(t); setTimeout(() => t.remove(), ms);
      },
      /** Cria uma área de log dentro de um elemento e devolve a função para registrar. */
      criarLog(el) {
        const box = document.createElement('div'); box.className = 'dd-log'; el.appendChild(box);
        const f = (msg, tipo = '') => {
          const l = document.createElement('div'); l.className = tipo;
          l.textContent = new Date().toLocaleTimeString('pt-BR') + '  ' + msg;
          box.appendChild(l); box.scrollTop = box.scrollHeight;
        };
        f.limpar = () => { box.innerHTML = ''; };
        return f;
      },
    };

    $('.lingueta').addEventListener('click', api.abrir);
    $('.fechar').addEventListener('click', api.fechar);
    raiz.querySelectorAll('.aba').forEach(b => b.addEventListener('click', () => api.mostrarAba(b.dataset.aba)));
    $('.trilho').addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const bts = [...raiz.querySelectorAll('.aba')];
      const i = bts.findIndex(b => b.dataset.aba === abaAtual);
      const prox = bts[(i + (e.key === 'ArrowDown' ? 1 : -1) + bts.length) % bts.length];
      if (prox) { prox.focus(); api.mostrarAba(prox.dataset.aba); e.preventDefault(); }
    });

    if (ler(chave + ':aberto', !!opcoes.abertoAoIniciar)) { api.abrir(); api.mostrarAba(ler(chave + ':aba', abas[0] && abas[0].id)); }
    return api;
  }

  global.DevDu = Object.assign(global.DevDu || {}, { painel, icone: ICONE_SVG, uiVersao: UI_VERSAO, esc });
})(window);

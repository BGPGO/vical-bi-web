#!/usr/bin/env node
/**
 * Pre-compila JSX → JS minificado em UM unico bundle.
 * Antes: 3 .jsx files transformados em runtime pelo Babel-standalone (~5MB CDN
 * + parse + transform a cada page load → muito lento).
 * Agora: 1 app.bundle.js minificado (~50-100KB), zero runtime.
 *
 * Os .jsx originais usam variaveis globais cross-file (Icon, DATE_RANGES,
 * Sidebar, etc) — nao sao modulos. Estrategia: concatena ordem importa
 * (components.jsx → pages-1.jsx → pages-2.jsx → app.jsx do index.html)
 * e roda esbuild --transform pra resolver tudo em escopo unico.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = __dirname;
const SOURCES = [
  'components.jsx',
  'pages-1.jsx',
  'pages-2.jsx',
  'pages-3.jsx',
  'pages-4.jsx',
  'pages-5.jsx',
  'upsell-pages.jsx',
];

// Lê bi.config.js (se existir) pra injetar BI_PAGE_MODE + BI_DEFAULT_STATUS
let pageModes = {};
let biCfg = null;
try {
  biCfg = require(path.join(ROOT, 'bi.config.js'));
  const flat = (obj) => {
    const out = {};
    for (const k of Object.keys(obj || {})) out[k] = obj[k];
    return out;
  };
  pageModes = { ...flat(biCfg.pages?.geral), ...flat(biCfg.pages?.outros) };
} catch (e) {
  // Sem config — todas as pages ativas (default)
}
const hasFin40 = !!(biCfg && biCfg.fontes && Array.isArray(biCfg.fontes.adapters) && biCfg.fontes.adapters.includes('fin40'));
const PAGE_MODE_INJECT = `\n// Injetado por build-jsx.cjs a partir de bi.config.js > pages\nwindow.BI_PAGE_MODE = ${JSON.stringify(pageModes)};\n` +
  // fin40 não preenche conciliado/status → "realizado" mostra vazio. Default volta pra "a_pagar_receber".
  `window.BI_DEFAULT_STATUS = ${JSON.stringify(hasFin40 ? 'a_pagar_receber' : 'realizado')};\n`;

(async () => {
  // Cada .jsx redeclara `const { useState } = React;` no topo (era pra Babel-
  // standalone funcionar com escopo isolado por <script>). Concatenado vira
  // duplicate declaration. Strip e re-injeta uma vez no inicio do bundle.
  const HOIST_HEADER = `\nvar { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment } = React;\n`;
  const stripReactHooks = (src) => src.replace(/^\s*const\s*\{[^}]*\}\s*=\s*React\s*;?\s*$/gm, '');

  const concat = HOIST_HEADER + SOURCES.map((f) => {
    const body = stripReactHooks(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    return `\n/* ===== ${f} ===== */\n${body}`;
  }).join('\n');

  // O App.jsx original esta inline no index.html. Movemos pra ca pra ficar
  // bundlado tambem. SE o operador editar index.html, manter a IIFE de boot.
  const APP_BODY = `
/* ===== App (raiz) ===== */
(function () {
  var useState = React.useState;
  var useEffect = React.useEffect;
  var PAGE_LABELS = {
    overview: '01 Visão geral',
    indicators: '02 Indicadores',
    receita: '03 Receita',
    despesa: '04 Despesa',
    fluxo: '05 Fluxo de caixa',
    tesouraria: '06 Tesouraria',
    comparativo: '07 Comparativo',
    relatorio: '08 Relatório IA',
    faturamento_produto: '09 Faturamento por Produto',
    curva_abc: '10 Curva ABC',
    marketing: '11 Marketing ADS',
    valuation: '12 Valuation',
    fluxo_diario: '12b Fluxo Diário',
    hierarquia: '13 Hierarquia ADS',
    detalhado: '14 Detalhado',
    profunda_cliente: '15 Profunda Cliente',
    crm: '16 CRM',
    dre: '09 DRE',
  };
  function App() {
    var p = useState('overview'); var page = p[0], setPage = p[1];
    var f = useState(Object.assign({}, DEFAULT_FILTERS)); var filters = f[0], setFilters = f[1];
    var fo = useState(false); var filtersOpen = fo[0], setFiltersOpen = fo[1];
    var so = useState(false); var sidebarOpen = so[0], setSidebarOpen = so[1];
    var sf = useState(function () {
      // Pega do localStorage. Mas se aquele segment tem dados=0 (ex: fin40 não preenche
      // realizado), auto-fallback pra um segment com dados (default = BI_DEFAULT_STATUS).
      var saved = null; try { saved = localStorage.getItem('bi.statusFilter'); } catch (e) {}
      var fallback = window.BI_DEFAULT_STATUS || 'realizado';
      var segHasData = function (k) {
        try {
          var s = (typeof SEGMENTS !== 'undefined') && SEGMENTS[k];
          if (!s || !s.MONTH_DATA) return false;
          return s.MONTH_DATA.some(function (m) { return (m.receita || 0) !== 0 || (m.despesa || 0) !== 0; });
        } catch (e) { return false; }
      };
      if (saved && segHasData(saved)) return saved;
      if (segHasData(fallback)) return fallback;
      // Último recurso: testa todos
      var keys = ['realizado', 'a_pagar_receber', 'tudo'];
      for (var i = 0; i < keys.length; i++) if (segHasData(keys[i])) return keys[i];
      return fallback;
    });
    var statusFilter = sf[0], setStatusFilter = sf[1];
    // Drilldown global: setado quando o usuario clica numa barra/linha de grafico.
    var dd = useState(null);
    var drilldown = dd[0], setDrilldown = dd[1];
    // Year selector: padrao = ano corrente (window.REF_YEAR)
    var ys = useState(function () {
      try { var y = parseInt(localStorage.getItem('bi.year'), 10); return y > 1900 ? y : (window.REF_YEAR || new Date().getFullYear()); } catch (e) { return window.REF_YEAR || new Date().getFullYear(); }
    });
    var year = ys[0], setYear = ys[1];
    var ms = useState(function () {
      try { var m = parseInt(localStorage.getItem('bi.month'), 10); return (m >= 0 && m <= 12) ? m : 0; } catch (e) { return 0; }
    });
    var month = ms[0], setMonth = ms[1];
    // Filtros globais Centro de Custo + Conta Bancária (Header) — multi-select
    var cc = useState(function () {
      try { var v = localStorage.getItem('bi.centro') || ''; return v ? JSON.parse(v) : []; }
      catch (e) { return []; }
    });
    var centroFiltro = cc[0], setCentroFiltro = cc[1];
    var cb = useState(function () {
      try { var v = localStorage.getItem('bi.conta') || ''; return v ? JSON.parse(v) : []; }
      catch (e) { return []; }
    });
    var contaFiltro = cb[0], setContaFiltro = cb[1];
    var ef = useState(function () {
      try { var v = localStorage.getItem('bi.empresa') || ''; return v ? JSON.parse(v) : []; }
      catch (e) { return []; }
    });
    var empresaFiltro = ef[0], setEmpresaFiltro = ef[1];

    // BI export multi-tela: array de page-ids ou null. Quando setado, renderiza
    // todas as telas em sequencia + chama window.print() depois do layout pintar.
    var pp = useState(null); var printPages = pp[0], setPrintPages = pp[1];
    useEffect(function () {
      window.startBiExport = function (pages) {
        document.body.classList.add('bi-print-mode');
        setPrintPages(pages);
      };
      return function () { window.startBiExport = null; };
    }, []);
    useEffect(function () {
      if (!printPages) return;
      var cancelled = false;
      var waitReady = function () {
        // 1) fonts
        var fontsP = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
        // 2) imagens (todas as <img> do bi-print-root tem que ter terminado)
        var imgsP = new Promise(function (resolve) {
          var imgs = Array.prototype.slice.call(document.querySelectorAll('.bi-print-root img'));
          var pending = imgs.filter(function (i) { return !i.complete; });
          if (pending.length === 0) return resolve();
          var done = 0;
          pending.forEach(function (i) {
            var fin = function () { done++; if (done >= pending.length) resolve(); };
            i.addEventListener('load', fin, { once: true });
            i.addEventListener('error', fin, { once: true });
          });
          // safety net
          setTimeout(resolve, 5000);
        });
        // 3) PageRelatorio: se foi incluído no export, esperar até ele renderizar conteudo
        //    (carrega async via fetch). Damos até 30s, polling a cada 200ms.
        var hasRelatorio = printPages.indexOf('relatorio') !== -1;
        var relatorioP = !hasRelatorio ? Promise.resolve() : new Promise(function (resolve) {
          var deadline = Date.now() + 30000;
          var poll = function () {
            if (cancelled) return resolve();
            // Sinal: PageRelatorio renderizou .report-cover OU mensagem de erro/help
            var rendered = document.querySelector('.bi-print-root .report-cover')
              || document.querySelector('.bi-print-root .report');
            if (rendered) return resolve();
            if (Date.now() > deadline) return resolve();
            setTimeout(poll, 200);
          };
          poll();
        });
        Promise.all([fontsP, imgsP, relatorioP]).then(function () {
          if (cancelled) return;
          // 2 frames pra garantir reflow final + 400ms pra layout estabilizar
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              setTimeout(function () {
                if (cancelled) return;
                window.print();
                setTimeout(function () {
                  document.body.classList.remove('bi-print-mode');
                  setPrintPages(null);
                }, 800);
              }, 400);
            });
          });
        });
      };
      waitReady();
      return function () { cancelled = true; };
    }, [printPages]);

    useEffect(function () {
      try { localStorage.setItem('bi.statusFilter', statusFilter); } catch (e) {}
      if (typeof window._makeBit === 'function') {
        window.BIT = window._makeBit(statusFilter);
      }
      setDrilldown(null);
    }, [statusFilter]);

    useEffect(function () {
      try { localStorage.setItem('bi.year', String(year)); } catch (e) {}
      setDrilldown(null);
    }, [year]);

    useEffect(function () {
      try { localStorage.setItem('bi.month', String(month)); } catch (e) {}
      setDrilldown(null);
    }, [month]);

    // CRÍTICO: sincronizar window.BI_*_FILTER DURANTE o render (não em useEffect).
    // Razão: <PageComp key={fk}> abaixo remonta quando filtros mudam, e o
    // useMemo do page faz getBit() → filterTx() que LÊ esses window globals.
    // useEffect roda só APÓS commit, então o PageComp acabaria de remontar
    // com o filtro ANTIGO ainda em vigor (efeito '1 click de atraso').
    window.BI_CENTRO_FILTER = (centroFiltro && centroFiltro.length) ? centroFiltro : null;
    window.BI_CONTA_FILTER = (contaFiltro && contaFiltro.length) ? contaFiltro : null;
    window.BI_EMPRESA_FILTER = (empresaFiltro && empresaFiltro.length) ? empresaFiltro : null;

    useEffect(function () {
      try { localStorage.setItem('bi.centro', JSON.stringify(centroFiltro || [])); } catch (e) {}
      setDrilldown(null);
    }, [centroFiltro]);

    useEffect(function () {
      try { localStorage.setItem('bi.conta', JSON.stringify(contaFiltro || [])); } catch (e) {}
      setDrilldown(null);
    }, [contaFiltro]);

    useEffect(function () {
      try { localStorage.setItem('bi.empresa', JSON.stringify(empresaFiltro || [])); } catch (e) {}
      setDrilldown(null);
    }, [empresaFiltro]);

    var handleSetPage = function (newPage) {
      setPage(newPage);
      setSidebarOpen(false);
      setDrilldown(null);
    };

    var PAGE_COMPS = {
      overview: PageOverview,
      indicators: PageIndicators,
      receita: PageReceita,
      despesa: PageDespesa,
      fluxo: PageFluxo,
      tesouraria: PageTesouraria,
      comparativo: PageComparativo,
      relatorio: PageRelatorio,
      faturamento_produto: PageFaturamentoProduto,
      curva_abc: PageCurvaABC,
      marketing: PageMarketing,
      valuation: PageValuation,
      fluxo_diario: PageFluxoDiario,
      hierarquia: PageHierarquia,
      detalhado: PageDetalhado,
      profunda_cliente: PageProfundaCliente,
      crm: PageCRM,
      dre: PageDRE,
    };
    // Modo da page atual: 'active' (default), 'upsell' (mostra UpsellPage), 'hidden' (não renderiza)
    var pageMode = (window.BI_PAGE_MODE && window.BI_PAGE_MODE[page]) || 'active';
    var PageComp = (pageMode === 'upsell' && window.UpsellPage)
      ? function (props) { return React.createElement(window.UpsellPage, { pageId: page }); }
      : PAGE_COMPS[page];

    var commonProps = {
      filters: filters,
      setFilters: setFilters,
      onOpenFilters: function () { setFiltersOpen(true); },
      statusFilter: statusFilter,
      year: year,
      setYear: setYear,
      month: month,
      setMonth: setMonth,
      drilldown: drilldown,
      setDrilldown: setDrilldown,
    };

    // Modo print multi-tela: renderiza todas as paginas selecionadas em sequencia
    if (printPages && printPages.length > 0) {
      return (
        <div className="app bi-print-root">
          {printPages.map(function (id, i) {
            var Comp = PAGE_COMPS[id];
            if (!Comp) return null;
            return (
              <div key={id + '-' + i} className="bi-print-page">
                <div className="bi-print-header">
                  <img src="assets/bgp-logo-white.png" alt="BGP" className="bi-print-logo" />
                  <div className="bi-print-title">
                    <div className="bi-print-pagenum">{PAGE_LABELS[id] || id}</div>
                    <div className="bi-print-brand">BI Financeiro</div>
                  </div>
                </div>
                <Comp {...commonProps} />
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className={'app ' + (sidebarOpen ? 'sidebar-open' : '')} data-screen-label={PAGE_LABELS[page]}>
        <Sidebar active={page} onSelect={handleSetPage} open={sidebarOpen} />
        <div className="sidebar-backdrop" onClick={function () { setSidebarOpen(false); }} />
        <div className="main">
          <Header
            page={page}
            onToggleSidebar={function () { setSidebarOpen(function (o) { return !o; }); }}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            year={year}
            setYear={setYear}
            month={month}
            setMonth={setMonth}
            empresaFiltro={empresaFiltro}
            setEmpresaFiltro={setEmpresaFiltro}
            centroFiltro={centroFiltro}
            setCentroFiltro={setCentroFiltro}
            contaFiltro={contaFiltro}
            setContaFiltro={setContaFiltro}
          />
          {(function () {
            // Force re-render quando CC/Conta mudam pq pages usam useMemo
            // com deps fixas [statusFilter, drilldown, year, month] — não
            // sabem dos filtros globais. Mudar key remonta o componente,
            // o que faz useMemo recomputar com window.BI_*_FILTER atualizados.
            // EXCETO fluxo_diario que tem dataset próprio (não usa filterTx)
            // e queremos preservar seus state locais (slicer, expansões).
            var fk = page === 'fluxo_diario'
              ? page
              : page + '|' + JSON.stringify(centroFiltro || []) + '|' + JSON.stringify(contaFiltro || []) + '|' + JSON.stringify(empresaFiltro || []);
            return <PageComp key={fk} {...commonProps} />;
          })()}
        </div>
        <FiltersDrawer open={filtersOpen} onClose={function () { setFiltersOpen(false); }} filters={filters} setFilters={setFilters} />
      </div>
    );
  }
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
`;

  const finalSource = PAGE_MODE_INJECT + concat + '\n' + APP_BODY;

  const result = await esbuild.transform(finalSource, {
    loader: 'jsx',
    jsx: 'transform',
    minify: true,
    target: ['es2017'],
  });

  const out = path.join(ROOT, 'app.bundle.js');
  fs.writeFileSync(out, result.code);
  const sizeKB = (result.code.length / 1024).toFixed(1);
  console.log(`OK app.bundle.js (${sizeKB} KB) — concat de ${SOURCES.length} .jsx + App raiz`);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });

/* BIT/BGP — Aba CRM Bitrix24 (3 telas de funil de vendas) + barra de filtros compartilhada.
 * Consome window.BITRIX_DATA (gerado por build-bitrix.cjs).
 *  - Modo real: usa BITRIX_DATA.raw {deals, leads, maps} e re-agrega no cliente
 *    conforme os filtros (Pipeline, Data início/fim, Fonte, Tipo de Cliente).
 *  - Modo referência (sem raw): cai no render antigo baseado em BITRIX_DATA.telas.
 * Telas: Entrada e venda no mesmo mês · Investimento × resultado · Entrada em qualquer mês.
 */
const { useState, useMemo, useEffect } = React;

const BIT_MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const bitFmtBRL = (v) => {
  if (v == null) return '—';
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const bitFmtInt = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
const bitFmtPct = (v) => (v == null ? '—' : Number(v).toFixed(2).replace('.', ',') + '%');
const bitFmtDias = (v) => (v == null ? '—' : Number(v).toFixed(2).replace('.', ',') + ' dias');
// rótulos compactos p/ os gráficos de linha
const bitLblMoney = (v) => {
  const a = Math.abs(v || 0);
  if (a >= 1e6) return (v / 1e6).toFixed(2).replace('.', ',') + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1).replace('.', ',') + 'k';
  return (v || 0).toFixed(0);
};
const bitLblPct = (v) => (v == null ? '' : Number(v).toFixed(1).replace('.', ',') + '%');
const bitLblInt = (v) => String(Math.round(v || 0));

/* ============================================================
 * Store de filtros compartilhado (persistido em localStorage)
 * Estado: { pipeline:'' , mesIni:0, mesFim:0, fontes:[], tipo:'' }
 *   pipeline '' = todas · mesIni/mesFim 0 = sem limite · fontes [] = todas · tipo '' = todos
 * ============================================================ */
const BIT_LS_KEY = 'bi.bitrixFilters';

function bitDefaultFiltros() {
  const raw = (typeof window !== 'undefined' && window.BITRIX_DATA && window.BITRIX_DATA.raw) || null;
  return {
    pipeline: raw && raw.pipeline_default != null ? raw.pipeline_default : '',
    mesIni: 0,
    mesFim: 0,
    fontes: [],
    tipo: '',
  };
}

let _bitFiltros = (function () {
  try {
    const saved = JSON.parse(localStorage.getItem(BIT_LS_KEY) || 'null');
    if (saved && typeof saved === 'object') return Object.assign(bitDefaultFiltros(), saved);
  } catch (e) {}
  return bitDefaultFiltros();
})();
const _bitListeners = new Set();
function _bitSet(next) {
  _bitFiltros = next;
  try { localStorage.setItem(BIT_LS_KEY, JSON.stringify(next)); } catch (e) {}
  _bitListeners.forEach((fn) => fn());
}
function useBitrixFiltros() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    _bitListeners.add(fn);
    return () => { _bitListeners.delete(fn); };
  }, []);
  const patch = (p) => _bitSet(Object.assign({}, _bitFiltros, p));
  const reset = () => _bitSet(bitDefaultFiltros());
  return [_bitFiltros, patch, reset];
}

/* ============================================================
 * Agregação client-side dos funis a partir do raw + filtros
 * ============================================================ */
function bitAgg(raw, filtros, opts) {
  const mesmoMes = !!(opts && opts.mesmoMes);
  const sources = raw.maps.sources || {};
  const srcNome = (id) => sources[id] || id || '(sem origem)';
  const fontesSet = (filtros.fontes && filtros.fontes.length) ? new Set(filtros.fontes) : null;

  const passaMes = (m) => (!filtros.mesIni || m >= filtros.mesIni) && (!filtros.mesFim || m <= filtros.mesFim);
  const passaFonte = (id) => !fontesSet || fontesSet.has(srcNome(id));

  // mês de criação de cada lead (p/ regra "mesmo mês")
  const leadMesById = {};
  for (const l of raw.leads) leadMesById[l.id] = l.m;

  // leads filtrados (data + fonte — únicos campos que existem no lead)
  const leadsF = raw.leads.filter((l) => passaMes(l.m) && passaFonte(l.src));

  // negócios filtrados (pipeline + fonte + tipo + data)
  let dealsF = raw.deals.filter((d) =>
    (filtros.pipeline === '' || d.cat === filtros.pipeline) &&
    passaFonte(d.src) &&
    (filtros.tipo === '' || d.tipo === filtros.tipo) &&
    passaMes(d.m));
  if (mesmoMes) dealsF = dealsF.filter((d) => d.lead && leadMesById[d.lead] === d.m);

  const ganhos = dealsF.filter((d) => d.sem === 'S');
  const negociosValor = dealsF.reduce((s, d) => s + (d.op || 0), 0);
  const ganhosValor = ganhos.reduce((s, d) => s + (d.op || 0), 0);
  const leadsValor = leadsF.reduce((s, l) => s + (l.op || 0), 0);
  const conversao = dealsF.length ? (ganhos.length / dealsF.length) * 100 : 0;

  const media = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
  const vidaNeg = media(dealsF.map((d) => d.vida).filter((v) => v != null));
  const vidaLead = media(leadsF.map((l) => l.vida).filter((v) => v != null));

  // séries mensais (índice 0..11 = Jan..Dez)
  const mkArr = () => Array(12).fill(0);
  const negValor = mkArr(), negCount = mkArr(), gValor = mkArr(), gCount = mkArr(), leadCount = mkArr();
  for (const d of dealsF) {
    const i = (d.m || 0) - 1; if (i < 0 || i > 11) continue;
    negValor[i] += d.op || 0; negCount[i] += 1;
    if (d.sem === 'S') { gValor[i] += d.op || 0; gCount[i] += 1; }
  }
  for (const l of leadsF) { const i = (l.m || 0) - 1; if (i >= 0 && i <= 11) leadCount[i] += 1; }
  const ticket = gCount.map((c, i) => (c ? gValor[i] / c : 0));
  const convMes = negCount.map((c, i) => (c ? (gCount[i] / c) * 100 : 0));
  const convCotVenda = negValor.map((v, i) => (v ? (gValor[i] / v) * 100 : 0)); // venda ÷ cotação

  // recorte por origem (fonte) — investimento × resultado
  const gOrig = {};
  for (const d of dealsF) {
    const nome = srcNome(d.src);
    if (!gOrig[nome]) gOrig[nome] = { origem: nome, negocios: 0, negocios_valor: 0, ganhos: 0, ganhos_valor: 0 };
    gOrig[nome].negocios++; gOrig[nome].negocios_valor += d.op || 0;
    if (d.sem === 'S') { gOrig[nome].ganhos++; gOrig[nome].ganhos_valor += d.op || 0; }
  }
  const porOrigem = Object.values(gOrig).sort((a, b) => b.negocios_valor - a.negocios_valor);

  return {
    leads: { count: leadsF.length, valor: leadsValor },
    negocios: { count: dealsF.length, valor: negociosValor },
    ganhos: { count: ganhos.length, valor: ganhosValor },
    conversao_pct: conversao,
    vida_lead_dias: vidaLead,
    vida_negocio_dias: vidaNeg,
    series: {
      venda_valor: gValor, cotacao_valor: negValor, quantidade: gCount,
      ticket, conversao_pct: convMes, conv_cot_venda: convCotVenda,
      leads_count: leadCount, negocios_count: negCount,
    },
    por_origem: porOrigem,
    funil_valor: [
      { etapa: 'Leads', count: leadsF.length, valor: leadsValor },
      { etapa: 'Negócios', count: dealsF.length, valor: negociosValor },
      { etapa: 'Negócios ganhos', count: ganhos.length, valor: ganhosValor },
    ],
    funil_count: [
      { etapa: 'Leads', count: leadsF.length },
      { etapa: 'Negócios', count: dealsF.length },
      { etapa: 'Pedidos (ganhos)', count: ganhos.length },
    ],
  };
}

/* ============================================================
 * Componentes visuais
 * ============================================================ */

// Gráfico de linha por mês com rótulos de dados (reusa CSS .trend do tema)
const BitLine = ({ values, color = 'var(--cyan)', fmt = bitLblMoney, height = 190, gradientId = 'bg' }) => {
  const w = 1000, h = height, padX = 46, padY = 30;
  const max = Math.max(1, ...values.map((v) => Math.abs(v || 0)));
  const min = Math.min(0, ...values);
  const range = (max - min) || 1;
  const stepX = (w - padX * 2) / (values.length - 1);
  const pts = values.map((v, i) => [padX + i * stepX, padY + (1 - ((v || 0) - min) / range) * (h - padY * 2)]);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = path + ` L ${pts[pts.length - 1][0].toFixed(1)} ${h - padY} L ${pts[0][0].toFixed(1)} ${h - padY} Z`;
  return (
    <svg className="trend" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3].map((i) => {
        const y = padY + (i / 3) * (h - padY * 2);
        return <line key={i} className="grid" x1={padX} y1={y} x2={w - padX} y2={y} />;
      })}
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r="3" fill={color} />
          {(values[i] || 0) !== 0 && (
            <text className="point-label" x={p[0]} y={p[1] - 8} textAnchor="middle">{fmt(values[i])}</text>
          )}
        </g>
      ))}
      {BIT_MESES.map((l, i) => (
        <text key={'x' + i} className="axis-text" x={padX + i * stepX} y={h - 6} textAnchor="middle">{l}</text>
      ))}
    </svg>
  );
};

// Card de gráfico mensal
const BitLineCard = ({ titulo, values, color, fmt, gradientId }) => (
  <div className="card">
    <h2 className="card-title">{titulo}</h2>
    <BitLine values={values} color={color} fmt={fmt} gradientId={gradientId} />
  </div>
);

// Placeholder "pendente" (Investimento/ROI/CAC — fonte de verba a definir)
const BitPendente = ({ titulo, nota }) => (
  <div className="card" style={{ borderLeft: '3px solid var(--amber, #f59e0b)' }}>
    <h2 className="card-title">{titulo}</h2>
    <div style={{ padding: '18px 8px', color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6 }}>
      <b style={{ color: 'var(--amber, #f59e0b)' }}>Pendente</b> — {nota || 'depende da fonte de verba de anúncio (campo custom do Bitrix ou planilha ADS), ainda a definir com o cliente.'}
    </div>
  </div>
);

// Funil horizontal por VALOR (Leads → Negócios → Negócios ganhos)
const BitFunilValor = ({ funil }) => {
  const cores = ['var(--cyan)', 'var(--blue, #60a5fa)', 'var(--green)'];
  const maxVal = Math.max(1, ...funil.map((f) => Math.abs(f.valor || 0)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {funil.map((f, i) => {
        const wd = Math.max(6, (Math.abs(f.valor || 0) / maxVal) * 100);
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{f.etapa}</span>
              <span style={{ color: 'var(--muted)' }}>
                {f.count != null ? bitFmtInt(f.count) + ' · ' : ''}<b style={{ color: 'inherit' }}>{bitFmtBRL(f.valor)}</b>
              </span>
            </div>
            <div style={{ height: 26, background: 'rgba(255,255,255,0.05)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ width: wd + '%', height: '100%', background: cores[i % cores.length], borderRadius: 6, transition: 'width .3s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Funil por CONTAGEM com taxa de conversão em cada etapa (Leads → Negócios → Pedidos)
const BitFunilCount = ({ funil }) => {
  const cores = ['var(--amber, #f59e0b)', 'var(--blue, #60a5fa)', 'var(--green)'];
  const base = Math.max(1, funil[0].count || 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {funil.map((f, i) => {
        const wd = Math.max(6, ((f.count || 0) / base) * 100);
        const prev = i > 0 ? (funil[i - 1].count || 0) : null;
        const pct = (prev && prev > 0) ? (f.count / prev) * 100 : null;
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{f.etapa}</span>
              <span style={{ color: 'var(--muted)' }}>
                <b style={{ color: 'inherit' }}>{bitFmtInt(f.count)}</b>
                {pct != null ? <span style={{ color: 'var(--green)', marginLeft: 8 }}>{bitFmtPct(pct)}</span> : ''}
              </span>
            </div>
            <div style={{ height: 30, background: 'rgba(255,255,255,0.05)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ width: wd + '%', height: '100%', background: cores[i % cores.length], borderRadius: 6, transition: 'width .3s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Tabela combinada mensal: Leads / Negócios / Ganhos (qtd) / Tx Conversão
const BitComboMensal = ({ series }) => (
  <div className="t-scroll">
    <table className="t">
      <thead>
        <tr><th></th>{BIT_MESES.map((m, i) => <th key={i} className="num">{m}</th>)}</tr>
      </thead>
      <tbody>
        <tr><td>Leads</td>{series.leads_count.map((v, i) => <td key={i} className="num">{v}</td>)}</tr>
        <tr><td>Negócios</td>{series.negocios_count.map((v, i) => <td key={i} className="num">{v}</td>)}</tr>
        <tr><td>Vendas (qtd)</td>{series.quantidade.map((v, i) => <td key={i} className="num green">{v}</td>)}</tr>
        <tr><td>Tx conversão</td>{series.conversao_pct.map((v, i) => <td key={i} className="num">{v ? v.toFixed(1).replace('.', ',') + '%' : '0%'}</td>)}</tr>
      </tbody>
    </table>
  </div>
);

// Cartão de vida útil (lead + negócio)
const BitVidaUtil = ({ agg }) => (
  <div className="card">
    <h2 className="card-title">Vida útil média</h2>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 4px' }}>
      <div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>Vida útil do lead</div>
        <div style={{ fontSize: 26, fontWeight: 700 }}>{bitFmtDias(agg.vida_lead_dias)}</div>
      </div>
      <div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>Vida útil do negócio</div>
        <div style={{ fontSize: 26, fontWeight: 700 }}>{bitFmtDias(agg.vida_negocio_dias)}</div>
      </div>
    </div>
  </div>
);

/* ============================================================
 * Barra de filtros compartilhada
 * ============================================================ */
const BitSelect = ({ label, value, onChange, children, width = 150 }) => (
  <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
    <span style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
    <select className="filter-select" value={value} onChange={(e) => onChange(e.target.value)}
      style={{ minWidth: width, height: 32, padding: '0 28px 0 10px', fontSize: 12 }}>
      {children}
    </select>
  </label>
);

const BitrixFilterBar = ({ data }) => {
  const [filtros, patch, reset] = useBitrixFiltros();
  const raw = data.raw;
  const pipelines = raw.maps.pipelines || {};
  const fontesOpts = useMemo(() => Array.from(new Set(Object.values(raw.maps.sources || {}))).sort(), [raw]);
  const tipos = raw.maps.tipos || [];

  return (
    <div className="card" style={{ marginBottom: 12, padding: '12px 12px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <BitSelect label="Período" value={String(data.ano)} onChange={() => {}} width={90}>
          <option value={String(data.ano)}>Ano {data.ano}</option>
        </BitSelect>

        <BitSelect label="Pipeline" value={filtros.pipeline} onChange={(v) => patch({ pipeline: v })} width={190}>
          <option value="">Todas as pipelines</option>
          {Object.keys(pipelines).map((id) => <option key={id} value={id}>{pipelines[id]}</option>)}
        </BitSelect>

        <BitSelect label="Data início" value={String(filtros.mesIni)} onChange={(v) => patch({ mesIni: parseInt(v, 10) })} width={110}>
          <option value="0">—</option>
          {BIT_MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </BitSelect>

        <BitSelect label="Data término" value={String(filtros.mesFim)} onChange={(v) => patch({ mesFim: parseInt(v, 10) })} width={110}>
          <option value="0">—</option>
          {BIT_MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </BitSelect>

        <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Fonte (canal de entrada)</span>
          <MultiSelectFilter label="Fonte" value={filtros.fontes} onChange={(arr) => patch({ fontes: arr })} options={fontesOpts} width={150} />
        </div>

        <BitSelect label="Tipo de cliente" value={filtros.tipo} onChange={(v) => patch({ tipo: v })} width={160}>
          <option value="">Todos os tipos</option>
          {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
        </BitSelect>

        <button type="button" onClick={reset}
          style={{
            height: 32, padding: '0 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
            background: 'rgba(255,255,255,0.04)', color: 'var(--muted)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}>Limpar filtros</button>
      </div>
      <div className="status-line" style={{ marginTop: 8 }}>
        Fonte: Bitrix24 CRM · ano {data.ano}
        {data.gerado_em ? ' · atualizado ' + new Date(data.gerado_em).toLocaleString('pt-BR') : ''}
      </div>
    </div>
  );
};

/* ============================================================
 * Telas (modo real com raw + filtros)
 * ============================================================ */
const BitKpiRow = ({ agg }) => (
  <div className="row row-4">
    <KpiTile label="Conversão (ganhos ÷ negócios)" value={Number(agg.conversao_pct).toFixed(2).replace('.', ',')} unit="%" tone="green" nonMonetary />
    <KpiTile label="Leads" value={bitFmtInt(agg.leads.count)} tone="cyan" nonMonetary />
    <KpiTile label="Negócios (valor)" value={Number(agg.negocios.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tone="cyan" />
    <KpiTile label="Negócios ganhos (valor)" value={Number(agg.ganhos.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tone="green" />
  </div>
);

// ---- Tela #1 — Entrada e venda no mesmo mês ----
const PageBitrixMesmoMes = () => {
  const data = (typeof window !== 'undefined' && window.BITRIX_DATA) || null;
  if (!data) return <BitrixIndisponivel titulo="Entrada e venda no mesmo mês" />;
  if (!data.raw) return <BitrixRefTela titulo="Entrada e venda no mesmo mês" tela={data.telas.mesmo_mes} data={data} />;
  const [filtros] = useBitrixFiltros();
  const agg = useMemo(() => bitAgg(data.raw, filtros, { mesmoMes: true }), [data, filtros]);
  return (
    <div className="page">
      <div className="page-title"><div>
        <h1>Entrada e venda no mesmo mês</h1>
        <div className="status-line">Negócios criados no mesmo mês de entrada do lead</div>
      </div></div>
      <BitrixFilterBar data={data} />
      <BitKpiRow agg={agg} />
      <div className="row row-1-1">
        <BitLineCard titulo="Venda (valor dos ganhos por mês)" values={agg.series.venda_valor} color="var(--green)" fmt={bitLblMoney} gradientId="m1venda" />
        <BitLineCard titulo="Conversão por mês (ganhos ÷ negócios)" values={agg.series.conversao_pct} color="var(--cyan)" fmt={bitLblPct} gradientId="m1conv" />
      </div>
      <div className="row row-1-1">
        <BitPendente titulo="Investimento por mês" />
        <BitPendente titulo="Conversão Investimento ÷ Venda" nota="depende do valor de investimento (verba de anúncio), ainda sem fonte." />
      </div>
      <div className="row" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' }}>
        <div className="card"><h2 className="card-title">Funil de vendas (valor)</h2><BitFunilValor funil={agg.funil_valor} /></div>
        <BitVidaUtil agg={agg} />
      </div>
    </div>
  );
};

// ---- Tela #2 — Investimento × resultado ----
const PageBitrixInvestimento = () => {
  const data = (typeof window !== 'undefined' && window.BITRIX_DATA) || null;
  if (!data) return <BitrixIndisponivel titulo="Investimento × resultado" />;
  if (!data.raw) return <BitrixRefTela titulo="Investimento × resultado" tela={data.telas.investimento} data={data} />;
  const [filtros] = useBitrixFiltros();
  const agg = useMemo(() => bitAgg(data.raw, filtros, { mesmoMes: false }), [data, filtros]);
  return (
    <div className="page">
      <div className="page-title"><div>
        <h1>Investimento × resultado</h1>
        <div className="status-line">Cotação e venda por mês · investimento pendente de fonte de verba</div>
      </div></div>
      <BitrixFilterBar data={data} />
      <div className="row row-4">
        <KpiTile label="Investimento" value="—" tone="red" />
        <KpiTile label="ROI (ganhos ÷ invest.)" value="—" tone="green" nonMonetary />
        <KpiTile label="CAC (invest. ÷ ganhos)" value="—" tone="cyan" />
        <KpiTile label="Negócios ganhos" value={bitFmtInt(agg.ganhos.count)} tone="green" nonMonetary />
      </div>
      <div className="row row-1-1">
        <BitLineCard titulo="Cotação (valor dos negócios por mês)" values={agg.series.cotacao_valor} color="var(--blue, #60a5fa)" fmt={bitLblMoney} gradientId="m2cot" />
        <BitLineCard titulo="Venda (valor dos ganhos por mês)" values={agg.series.venda_valor} color="var(--green)" fmt={bitLblMoney} gradientId="m2venda" />
      </div>
      <div className="row row-1-1">
        <BitPendente titulo="Investimento por mês" />
        <BitLineCard titulo="Conversão Cotação × Venda (valor ganho ÷ valor negócios)" values={agg.series.conv_cot_venda} color="var(--cyan)" fmt={bitLblPct} gradientId="m2ccv" />
      </div>
      {agg.por_origem && agg.por_origem.length > 0 && (
        <div className="card">
          <h2 className="card-title">Negócios por origem (fonte)</h2>
          <div className="t-scroll">
            <table className="t">
              <thead><tr><th>Origem</th><th className="num">Negócios</th><th className="num">Valor negócios</th><th className="num">Ganhos</th><th className="num">Valor ganhos</th></tr></thead>
              <tbody>
                {agg.por_origem.map((o, i) => (
                  <tr key={i}>
                    <td>{o.origem}</td>
                    <td className="num">{bitFmtInt(o.negocios)}</td>
                    <td className="num">{bitFmtBRL(o.negocios_valor)}</td>
                    <td className="num">{bitFmtInt(o.ganhos)}</td>
                    <td className="num green">{bitFmtBRL(o.ganhos_valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ---- Tela #3 — Tudo que vendeu no mês (entrou em qualquer data) ----
const PageBitrixQualquerMes = () => {
  const data = (typeof window !== 'undefined' && window.BITRIX_DATA) || null;
  if (!data) return <BitrixIndisponivel titulo="Entrada em qualquer mês" />;
  if (!data.raw) return <BitrixRefTela titulo="Entrada em qualquer mês" tela={data.telas.qualquer_mes} data={data} />;
  const [filtros] = useBitrixFiltros();
  const agg = useMemo(() => bitAgg(data.raw, filtros, { mesmoMes: false }), [data, filtros]);
  const vendaTotal = agg.series.venda_valor.reduce((s, v) => s + v, 0);
  const qtdTotal = agg.series.quantidade.reduce((s, v) => s + v, 0);
  const ticketGeral = qtdTotal ? vendaTotal / qtdTotal : 0;
  return (
    <div className="page">
      <div className="page-title"><div>
        <h1>Tudo que vendeu no mês (entrou em qualquer data)</h1>
        <div className="status-line">Vendas do mês independentemente de quando o lead entrou</div>
      </div></div>
      <BitrixFilterBar data={data} />
      <div className="row row-4">
        <KpiTile label="Conversão (ganhos ÷ negócios)" value={Number(agg.conversao_pct).toFixed(2).replace('.', ',')} unit="%" tone="green" nonMonetary />
        <KpiTile label="Venda total" value={Number(vendaTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tone="green" />
        <KpiTile label="Ticket médio" value={Number(ticketGeral).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tone="cyan" />
        <KpiTile label="Quantidade de vendas" value={bitFmtInt(qtdTotal)} tone="cyan" nonMonetary />
      </div>
      <div className="row" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <BitLineCard titulo="Venda (valor por mês)" values={agg.series.venda_valor} color="var(--green)" fmt={bitLblMoney} gradientId="m3venda" />
        <BitLineCard titulo="Ticket médio (por mês)" values={agg.series.ticket} color="var(--muted)" fmt={bitLblMoney} gradientId="m3ticket" />
        <BitLineCard titulo="Quantidade de vendas (por mês)" values={agg.series.quantidade} color="var(--cyan)" fmt={bitLblInt} gradientId="m3qtd" />
      </div>
      <div className="row" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)' }}>
        <div className="card"><h2 className="card-title">Funil Leads → Negócios → Pedidos</h2><BitFunilCount funil={agg.funil_count} /></div>
        <div className="card"><h2 className="card-title">Leads / Negócios / Vendas / Conversão por mês</h2><BitComboMensal series={agg.series} /></div>
      </div>
    </div>
  );
};

/* ============================================================
 * Fallback modo referência (sem raw) — render simples baseado em telas
 * ============================================================ */
const BitrixRefTela = ({ titulo, tela, data }) => (
  <div className="page">
    <div className="page-title"><div><h1>{titulo}</h1><div className="status-line">Dados de referência</div></div></div>
    <div className="card" style={{ borderLeft: '3px solid var(--amber, #f59e0b)', marginBottom: 12 }}>
      <p style={{ padding: '4px 4px', color: 'var(--muted)', fontSize: 12.5, margin: 0 }}>
        <b style={{ color: 'var(--amber, #f59e0b)' }}>Dados de referência</b> — o webhook do Bitrix ainda não trouxe dados brutos.
        Rode <code>node fetch-bitrix.cjs</code> + <code>node build-bitrix.cjs</code> para habilitar os filtros.
      </p>
    </div>
    <div className="row row-4">
      <KpiTile label="Conversão" value={tela.conversao_pct != null ? Number(tela.conversao_pct).toFixed(2).replace('.', ',') : '—'} unit="%" tone="green" nonMonetary />
      <KpiTile label="Leads (valor)" value={tela.leads.valor != null ? Number(tela.leads.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} tone="cyan" />
      <KpiTile label="Negócios (valor)" value={tela.negocios.valor != null ? Number(tela.negocios.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} tone="cyan" />
      <KpiTile label="Negócios ganhos" value={tela.ganhos.valor != null ? Number(tela.ganhos.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} tone="green" />
    </div>
    <div className="card"><h2 className="card-title">Funil de vendas</h2><BitFunilValor funil={tela.funil} /></div>
  </div>
);

const BitrixIndisponivel = ({ titulo }) => (
  <div className="page">
    <div className="page-title"><div><h1>{titulo}</h1></div></div>
    <div className="card"><p style={{ padding: 16, color: 'var(--muted)' }}>Dados do Bitrix indisponíveis. Rode <code>node build-bitrix.cjs</code>.</p></div>
  </div>
);

Object.assign(window, { PageBitrixMesmoMes, PageBitrixInvestimento, PageBitrixQualquerMes });

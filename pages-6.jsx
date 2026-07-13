/* BIT/BGP — Aba CRM Bitrix24 (3 telas de funil de vendas)
 * Consome window.BITRIX_DATA (gerado por build-bitrix.cjs).
 * Telas: Entrada e venda no mesmo mês · Investimento × resultado · Entrada em qualquer mês.
 */
const { useState, useMemo } = React;

const bitFmtBRL = (v) => {
  if (v == null) return '—';
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const bitFmtInt = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
const bitFmtPct = (v) => (v == null ? '—' : Number(v).toFixed(2).replace('.', ',') + '%');
const bitFmtDias = (v) => (v == null ? '—' : Number(v).toFixed(2).replace('.', ',') + ' dias');

// Banner de fonte (modo referência x dados reais)
const BitrixFonteBanner = ({ data }) => {
  if (!data) return null;
  if (data.fonte === 'bitrix') {
    return (
      <div className="status-line" style={{ marginBottom: 12 }}>
        Fonte: Bitrix24 CRM · ano {data.ano}
        {data.gerado_em ? ' · atualizado ' + new Date(data.gerado_em).toLocaleString('pt-BR') : ''}
      </div>
    );
  }
  return (
    <div className="card" style={{ borderLeft: '3px solid var(--amber, #f59e0b)', marginBottom: 12 }}>
      <p style={{ padding: '4px 4px', color: 'var(--muted)', fontSize: 12.5, margin: 0 }}>
        <b style={{ color: 'var(--amber, #f59e0b)' }}>Dados de referência</b> — números do painel
        "Funil de vendas (com conversões)" do Bitrix. O webhook ainda não está conectado.
        Configure <code>BITRIX_WEBHOOK_URL</code> no <code>.env</code> para puxar dados ao vivo.
      </p>
    </div>
  );
};

// Funil horizontal (Leads → Negócios → Negócios ganhos) — largura proporcional ao valor
const BitrixFunil = ({ funil }) => {
  const cores = ['var(--cyan)', 'var(--blue, #60a5fa)', 'var(--green)'];
  const maxVal = Math.max(1, ...funil.map((f) => Math.abs(f.valor || 0)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {funil.map((f, i) => {
        const w = Math.max(6, (Math.abs(f.valor || 0) / maxVal) * 100);
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{f.etapa}</span>
              <span style={{ color: 'var(--muted)' }}>
                {f.count != null ? bitFmtInt(f.count) + ' · ' : ''}<b style={{ color: 'inherit' }}>{bitFmtBRL(f.valor)}</b>
              </span>
            </div>
            <div style={{ height: 26, background: 'rgba(255,255,255,0.05)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ width: w + '%', height: '100%', background: cores[i % cores.length], borderRadius: 6, transition: 'width .3s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Barras mensais simples (contagem de negócios / ganhos por mês)
const BitrixBarrasMes = ({ porMes, showLabels }) => {
  if (!porMes) return <p style={{ padding: 16, color: 'var(--muted)', fontSize: 12 }}>Distribuição mensal indisponível no modo referência.</p>;
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const max = Math.max(1, ...porMes.map((m) => m.negocios || 0));
  // headroom no topo só quando há rótulo (não altera a tela sem labels)
  const scale = showLabels ? 88 : 100;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 200, padding: '8px 0' }}>
      {porMes.map((m, i) => {
        const h = (m.negocios / max) * scale;
        const hg = m.negocios ? (m.ganhos / m.negocios) * h : 0;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ position: 'relative', width: '100%', height: 160, display: 'flex', alignItems: 'flex-end' }}
              title={`${meses[i]}: ${m.negocios} negócios, ${m.ganhos} ganhos`}>
              {showLabels && m.negocios > 0 && (
                <div style={{ position: 'absolute', bottom: h + '%', left: 0, right: 0, textAlign: 'center', fontSize: 9.5, lineHeight: 1.1, fontWeight: 700, transform: 'translateY(-3px)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                  {m.negocios}
                  {m.ganhos > 0 && <span style={{ color: 'var(--green)', fontWeight: 600 }}> · {m.ganhos}</span>}
                </div>
              )}
              <div style={{ width: '100%', height: h + '%', background: 'rgba(34,211,238,0.35)', borderRadius: '4px 4px 0 0', position: 'relative' }}>
                <div style={{ position: 'absolute', bottom: 0, width: '100%', height: (h ? (hg / h) * 100 : 0) + '%', background: 'var(--green)', borderRadius: '0' }} />
              </div>
            </div>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{meses[i]}</span>
          </div>
        );
      })}
    </div>
  );
};

// View compartilhada de uma tela de funil
const BitrixFunilView = ({ tela, subtitulo, data, children }) => {
  return (
    <div className="page">
      <div className="page-title">
        <div>
          <h1>{tela.titulo}</h1>
          <div className="status-line">{subtitulo}</div>
        </div>
      </div>

      <BitrixFonteBanner data={data} />

      <div className="row row-4">
        <KpiTile label="Conversão" value={tela.conversao_pct != null ? Number(tela.conversao_pct).toFixed(2).replace('.', ',') : '—'} unit="%" tone="green" nonMonetary />
        <KpiTile label="Leads (valor)" value={tela.leads.valor != null ? Number(tela.leads.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} tone="cyan" />
        <KpiTile label="Negócios (valor)" value={tela.negocios.valor != null ? Number(tela.negocios.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} tone="cyan" />
        <KpiTile label="Negócios ganhos" value={tela.ganhos.valor != null ? Number(tela.ganhos.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} tone="green" />
      </div>

      <div className="row" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' }}>
        <div className="card">
          <h2 className="card-title">Funil de vendas</h2>
          <BitrixFunil funil={tela.funil} />
        </div>
        <div className="card">
          <h2 className="card-title">Vida útil média</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 4px' }}>
            <div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>Vida útil do lead</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{bitFmtDias(tela.vida_lead_dias)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>Vida útil do negócio</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{bitFmtDias(tela.vida_negocio_dias)}</div>
            </div>
          </div>
        </div>
      </div>

      {children}
    </div>
  );
};

/* ===== Tela #1 — Entrada e venda no mesmo mês ===== */
const PageBitrixMesmoMes = () => {
  const data = (typeof window !== 'undefined' && window.BITRIX_DATA) || null;
  if (!data) return <BitrixIndisponivel titulo="Entrada e venda no mesmo mês" />;
  const tela = data.telas.mesmo_mes;
  return (
    <BitrixFunilView tela={tela} data={data}
      subtitulo="Funil considerando apenas negócios criados no mesmo mês de entrada do lead">
      <div className="card">
        <h2 className="card-title">Negócios por mês (verde = ganhos)</h2>
        <BitrixBarrasMes porMes={tela.por_mes} showLabels />
      </div>
    </BitrixFunilView>
  );
};

/* ===== Tela #3 — Entrada em qualquer mês ===== */
const PageBitrixQualquerMes = () => {
  const data = (typeof window !== 'undefined' && window.BITRIX_DATA) || null;
  if (!data) return <BitrixIndisponivel titulo="Entrada em qualquer mês" />;
  const tela = data.telas.qualquer_mes;
  return (
    <BitrixFunilView tela={tela} data={data}
      subtitulo="Funil sem exigir que a venda ocorra no mesmo mês da entrada do lead">
      <div className="card">
        <h2 className="card-title">Negócios por mês (verde = ganhos)</h2>
        <BitrixBarrasMes porMes={tela.por_mes} showLabels />
      </div>
    </BitrixFunilView>
  );
};

/* ===== Tela #2 — Investimento × resultado ===== */
const PageBitrixInvestimento = () => {
  const data = (typeof window !== 'undefined' && window.BITRIX_DATA) || null;
  if (!data) return <BitrixIndisponivel titulo="Investimento × resultado" />;
  const tela = data.telas.investimento;
  const temInvest = tela.investimento_valor != null;
  const roi = temInvest && tela.investimento_valor > 0 ? (tela.ganhos.valor / tela.investimento_valor) : null;
  const cac = temInvest && tela.ganhos.count ? (tela.investimento_valor / tela.ganhos.count) : null;

  return (
    <BitrixFunilView tela={tela} data={data}
      subtitulo="Comparação entre investimento e resultado em vendas">

      {/* KPIs de investimento (ou pendência) */}
      <div className="row row-4">
        <KpiTile label="Investimento" value={temInvest ? Number(tela.investimento_valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} tone="red" />
        <KpiTile label="ROI (ganhos ÷ invest.)" value={roi != null ? roi.toFixed(2).replace('.', ',') : '—'} unit="x" tone="green" nonMonetary />
        <KpiTile label="CAC (invest. ÷ ganhos)" value={cac != null ? Number(cac).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} tone="cyan" />
        <KpiTile label="Negócios ganhos" value={tela.ganhos.count != null ? String(tela.ganhos.count) : '—'} tone="green" nonMonetary />
      </div>

      {tela.nota && (
        <div className="card" style={{ borderLeft: '3px solid var(--amber, #f59e0b)' }}>
          <p style={{ padding: 4, margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>{tela.nota}</p>
        </div>
      )}

      {/* Recorte por origem (investimento × resultado, mesmo sem campo de custo) */}
      {tela.por_origem && tela.por_origem.length > 0 && (
        <div className="card">
          <h2 className="card-title">Negócios por origem</h2>
          <div className="t-scroll">
            <table className="t">
              <thead>
                <tr>
                  <th>Origem</th>
                  <th className="num">Negócios</th>
                  <th className="num">Valor negócios</th>
                  <th className="num">Ganhos</th>
                  <th className="num">Valor ganhos</th>
                </tr>
              </thead>
              <tbody>
                {tela.por_origem.map((o, i) => (
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

      {/* Campos de investimento detectados (ajuda a definir a fonte de custo) */}
      {tela.campos_investimento_detectados && tela.campos_investimento_detectados.length > 0 && (
        <div className="card">
          <h2 className="card-title">Campos de custo/investimento detectados no Bitrix</h2>
          <div className="t-scroll">
            <table className="t">
              <thead><tr><th>Entidade</th><th>Código</th><th>Título</th><th>Tipo</th></tr></thead>
              <tbody>
                {tela.campos_investimento_detectados.map((c, i) => (
                  <tr key={i}>
                    <td>{c.entidade}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{c.code}</td>
                    <td>{c.titulo}</td>
                    <td>{c.tipo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </BitrixFunilView>
  );
};

const BitrixIndisponivel = ({ titulo }) => (
  <div className="page">
    <div className="page-title"><div><h1>{titulo}</h1></div></div>
    <div className="card"><p style={{ padding: 16, color: 'var(--muted)' }}>Dados do Bitrix indisponíveis. Rode <code>node build-bitrix.cjs</code>.</p></div>
  </div>
);

Object.assign(window, { PageBitrixMesmoMes, PageBitrixInvestimento, PageBitrixQualquerMes });

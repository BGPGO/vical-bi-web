/* BIT/BGP Finance — Pages 5: Fluxo Diário (projeção futura Conta Azul) */
const { useState, useMemo } = React;

// Lê window.BIT_EXTRAS.fluxo_ca produzido por build-data-extras.cjs:
//   { hoje, contas: [{conta, saldo_inicial, is_investimento}],
//     aberto_por_conta_dia: {conta: {dia: {a_receber, a_pagar, n}}},
//     aberto_lista: [{d, c, cat, v, contato, desc, is_inv}],
//     totais: {saldo_hoje_normais, saldo_hoje_invest, saldo_hoje_total} }

const PageFluxoDiario = () => {
  const EX = (typeof window !== 'undefined' && window.BIT_EXTRAS && window.BIT_EXTRAS.fluxo_ca) || null;

  if (!EX) {
    return (
      <div className="page">
        <div className="page-title"><div><h1>Fluxo Diário</h1></div></div>
        <div className="card"><p style={{ padding: 16, color: 'var(--muted)' }}>Base do Conta Azul indisponível.</p></div>
      </div>
    );
  }

  const HOJE = EX.hoje;

  // -- State
  const [dias, setDias] = useState(90);              // janela (preset)
  const [dataFimCustom, setDataFimCustom] = useState(''); // override data fim (vazio = usa preset)
  const [contaFiltro, setContaFiltro] = useState(null); // null = todas; "conta" = filtra
  const [incluirInvest, setIncluirInvest] = useState(false); // toggle saldo invest
  const [linhaExpandida, setLinhaExpandida] = useState(null); // dia expandido na tabela

  // -- Helpers
  const fmt = (v) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtShort = (v) => {
    const a = Math.abs(v || 0);
    if (a >= 1e6) return 'R$ ' + (v / 1e6).toFixed(2).replace('.', ',') + 'M';
    if (a >= 1e3) return 'R$ ' + (v / 1e3).toFixed(0) + 'k';
    return 'R$ ' + (v || 0).toFixed(0);
  };
  const fmtData = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const addDias = (iso, n) => {
    const dt = new Date(iso + 'T00:00:00');
    dt.setDate(dt.getDate() + n);
    return dt.toISOString().slice(0, 10);
  };
  // dataFim: usa custom se setada e > hoje, senão preset
  const dataFim = useMemo(() => {
    if (dataFimCustom && dataFimCustom > HOJE) return dataFimCustom;
    return addDias(HOJE, dias);
  }, [dias, dataFimCustom]);
  // Dias efetivos entre HOJE e dataFim (pra labels)
  const diasEfetivos = useMemo(() => {
    const ms = new Date(dataFim + 'T00:00:00') - new Date(HOJE + 'T00:00:00');
    return Math.round(ms / 86400000);
  }, [dataFim]);

  // -- Filtra contas (visíveis sempre nas tabelas, mas o grafico considera apenas as relevantes)
  const contasNormais = useMemo(() => EX.contas.filter(c => !c.is_investimento), []);
  const contasInvest = useMemo(() => EX.contas.filter(c => c.is_investimento), []);

  // -- Projeção dia-a-dia
  // Pra cada conta: começa em saldo_inicial, vai somando aberto_por_conta_dia até dataFim.
  // Quando contaFiltro != null, considera só essa conta.
  // Quando incluirInvest == false, exclui contas is_investimento da agregação do gráfico.
  const projecao = useMemo(() => {
    const contasAtivas = EX.contas.filter(c => {
      if (contaFiltro && c.conta !== contaFiltro) return false;
      if (!incluirInvest && c.is_investimento) return false;
      return true;
    });

    // Saldo inicial agregado (HOJE)
    let saldoAcum = contasAtivas.reduce((s, c) => s + c.saldo_inicial, 0);

    // Aberto por dia (agregado das contas ativas)
    const abertoAgg = {};   // {dia: {a_receber, a_pagar}}
    for (const c of contasAtivas) {
      const d = EX.aberto_por_conta_dia[c.conta] || {};
      for (const [dia, vals] of Object.entries(d)) {
        if (dia > dataFim) continue;
        abertoAgg[dia] = abertoAgg[dia] || { a_receber: 0, a_pagar: 0 };
        abertoAgg[dia].a_receber += vals.a_receber;
        abertoAgg[dia].a_pagar += vals.a_pagar;
      }
    }

    // Constrói série dia-a-dia de HOJE até dataFim
    const serie = [];
    let cur = HOJE;
    // No "dia 0" (hoje) já mostra o saldo_inicial. As movimentações de hoje vão somar a esse saldo.
    while (cur <= dataFim) {
      const a = abertoAgg[cur] || { a_receber: 0, a_pagar: 0 };
      saldoAcum += a.a_receber + a.a_pagar;
      serie.push({ d: cur, saldo: saldoAcum, a_receber: a.a_receber, a_pagar: a.a_pagar });
      cur = addDias(cur, 1);
    }
    return serie;
  }, [dias, contaFiltro, incluirInvest, dataFim]);

  // -- Tabela de contas: enriquece com a_receber/a_pagar dentro da janela
  const enriqueceTabela = (contas) => {
    return contas.map(c => {
      const d = EX.aberto_por_conta_dia[c.conta] || {};
      let aRec = 0, aPag = 0;
      for (const [dia, v] of Object.entries(d)) {
        if (dia > dataFim) continue;
        aRec += v.a_receber;
        aPag += v.a_pagar;
      }
      return {
        ...c,
        a_receber: aRec,
        a_pagar: aPag,
        saldo_fim: c.saldo_inicial + aRec + aPag,
      };
    }).sort((a, b) => Math.abs(b.saldo_inicial) - Math.abs(a.saldo_inicial));
  };
  const tblNormais = useMemo(() => enriqueceTabela(contasNormais), [dataFim]);
  const tblInvest = useMemo(() => enriqueceTabela(contasInvest), [dataFim]);

  // Totais das tabelas
  const totalRow = (rows) => rows.reduce((acc, r) => ({
    saldo_inicial: acc.saldo_inicial + r.saldo_inicial,
    a_receber: acc.a_receber + r.a_receber,
    a_pagar: acc.a_pagar + r.a_pagar,
    saldo_fim: acc.saldo_fim + r.saldo_fim,
  }), { saldo_inicial: 0, a_receber: 0, a_pagar: 0, saldo_fim: 0 });
  const totN = totalRow(tblNormais);
  const totI = totalRow(tblInvest);

  // -- Lançamentos do dia (pra expandir na tabela detalhe)
  const movsDoDia = (dia) => {
    return EX.aberto_lista.filter(m => {
      if (m.d !== dia) return false;
      if (contaFiltro && m.c !== contaFiltro) return false;
      if (!incluirInvest && m.is_inv) return false;
      return true;
    }).sort((a, b) => b.v - a.v);
  };

  // -- SVG mix chart (linha saldo + barras a_receber/a_pagar)
  const renderChart = () => {
    if (projecao.length === 0) return <div style={{ color: 'var(--muted)', padding: 16 }}>Sem projeção.</div>;
    const W = 1200, H = 280, padL = 70, padR = 30, padT = 16, padB = 36;
    const saldos = projecao.map(p => p.saldo);
    const barras = projecao.flatMap(p => [p.a_receber, p.a_pagar]);
    const yMin = Math.min(0, ...saldos, ...barras);
    const yMax = Math.max(0, ...saldos, ...barras);
    const yRange = yMax - yMin || 1;
    const n = projecao.length;
    const bw = Math.max(1, (W - padL - padR) / n - 1);
    const x = (i) => padL + (i + 0.5) * ((W - padL - padR) / n);
    const y = (v) => padT + (1 - (v - yMin) / yRange) * (H - padT - padB);
    const linePath = saldos.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

    // 5 ticks Y
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => yMin + t * yRange);
    // 6 ticks X (1º, ~20%, ~40%, ~60%, ~80%, último)
    const xTickIdx = n > 6 ? [0, Math.floor(n / 5), Math.floor(n * 2 / 5), Math.floor(n * 3 / 5), Math.floor(n * 4 / 5), n - 1] : projecao.map((_, i) => i);

    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 320 }}>
        {/* grid Y */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
            <text x={padL - 8} y={y(t) + 3} fill="rgba(255,255,255,0.5)" fontSize="10" textAnchor="end">{fmtShort(t)}</text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.2)" />

        {/* Barras (verde a_receber acima de 0, vermelho a_pagar abaixo de 0) */}
        {projecao.map((p, i) => (
          <g key={i}>
            {p.a_receber > 0 && (
              <rect x={x(i) - bw / 2} y={y(p.a_receber)} width={bw} height={Math.max(1, y(0) - y(p.a_receber))} fill="rgba(34,197,94,0.7)">
                <title>{`${fmtData(p.d)}\nA receber: ${fmt(p.a_receber)}`}</title>
              </rect>
            )}
            {p.a_pagar < 0 && (
              <rect x={x(i) - bw / 2} y={y(0)} width={bw} height={Math.max(1, y(p.a_pagar) - y(0))} fill="rgba(239,68,68,0.7)">
                <title>{`${fmtData(p.d)}\nA pagar: ${fmt(p.a_pagar)}`}</title>
              </rect>
            )}
          </g>
        ))}

        {/* Linha saldo */}
        <path d={linePath} stroke="#22d3ee" strokeWidth="2.5" fill="none" />

        {/* Rótulos saldo — seleção inteligente: extremos globais + primeiro/último +
            ~4-5 pontos extras espaçados, com mínimo de 90px entre rótulos pra não poluir */}
        {(() => {
          // 1. candidatos prioritários: primeiro, último, índice do max global, índice do min global
          const idxMax = saldos.indexOf(Math.max(...saldos));
          const idxMin = saldos.indexOf(Math.min(...saldos));
          const candidatos = new Set([0, n - 1, idxMax, idxMin]);

          // 2. adiciona pontos a cada ~N intervalos pra preencher (alvo 6-8 rótulos)
          const alvo = Math.min(8, Math.max(4, Math.round(n / 15)));
          const passo = Math.max(1, Math.floor(n / alvo));
          for (let i = passo; i < n; i += passo) candidatos.add(i);

          // 3. ordena por índice e aplica mínimo de espaçamento horizontal (90px)
          const ordenados = [...candidatos].sort((a, b) => a - b);
          const MIN_DX = 90;
          const finais = [];
          let lastX = -Infinity;
          // Prioridade: nunca remove primeiro/último/max/min — só remove os "fillers"
          const prioritarios = new Set([0, n - 1, idxMax, idxMin]);
          for (const i of ordenados) {
            const px = x(i);
            if (px - lastX >= MIN_DX || prioritarios.has(i)) {
              finais.push(i);
              lastX = px;
            }
          }
          // Render: caixa pill com fundo escuro pra legibilidade
          return finais.map(i => {
            const py = y(saldos[i]);
            const px = x(i);
            // posiciona acima do ponto se houver espaço, senão abaixo
            const acima = py - padT > 22;
            const ty = acima ? py - 8 : py + 16;
            const txt = fmtShort(saldos[i]);
            const tw = txt.length * 5.5 + 8;
            return (
              <g key={'lbl-' + i}>
                <circle cx={px} cy={py} r="3" fill="#22d3ee" stroke="#0c1117" strokeWidth="1.5" />
                <rect x={px - tw / 2} y={ty - 9} width={tw} height={13} rx="2" fill="rgba(12,17,23,0.85)" stroke="rgba(34,211,238,0.4)" strokeWidth="0.5" />
                <text x={px} y={ty + 1} fill="#22d3ee" fontSize="9.5" fontWeight="600" textAnchor="middle">{txt}</text>
              </g>
            );
          });
        })()}

        {/* Ticks X */}
        {xTickIdx.map(i => (
          <text key={i} x={x(i)} y={H - 12} fill="rgba(255,255,255,0.55)" fontSize="10" textAnchor="middle">{fmtData(projecao[i].d)}</text>
        ))}

        {/* Legenda */}
        <g transform={`translate(${padL + 10}, ${padT + 14})`}>
          <rect x={0} y={-7} width={10} height={10} fill="#22d3ee" />
          <text x={14} y={2} fill="rgba(255,255,255,0.85)" fontSize="11">Saldo</text>
          <rect x={60} y={-7} width={10} height={10} fill="rgba(34,197,94,0.7)" />
          <text x={74} y={2} fill="rgba(255,255,255,0.85)" fontSize="11">A receber</text>
          <rect x={140} y={-7} width={10} height={10} fill="rgba(239,68,68,0.7)" />
          <text x={154} y={2} fill="rgba(255,255,255,0.85)" fontSize="11">A pagar</text>
        </g>
      </svg>
    );
  };

  // -- Render tabela de contas
  const renderTabelaContas = (titulo, rows, totais) => (
    <div className="card">
      <h2 className="card-title">{titulo} ({rows.length})</h2>
      <div style={{ maxHeight: 320, overflow: 'auto' }}>
        <table className="bi-table" style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: '#0c1117', zIndex: 1 }}>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Conta</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Saldo hoje</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>A receber</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>A pagar</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Saldo fim {dias}d</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const ativo = contaFiltro === r.conta;
              return (
                <tr key={r.conta}
                    onClick={() => setContaFiltro(ativo ? null : r.conta)}
                    style={{ cursor: 'pointer', background: ativo ? 'rgba(34,211,238,0.12)' : 'transparent', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <td style={{ padding: '6px 10px' }} title={r.conta}>{r.conta.length > 42 ? r.conta.slice(0, 40) + '…' : r.conta}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: r.saldo_inicial >= 0 ? '#86efac' : '#fca5a5' }}>{fmt(r.saldo_inicial)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: r.a_receber > 0 ? '#86efac' : 'rgba(255,255,255,0.4)' }}>{r.a_receber ? fmt(r.a_receber) : '—'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: r.a_pagar < 0 ? '#fca5a5' : 'rgba(255,255,255,0.4)' }}>{r.a_pagar ? fmt(r.a_pagar) : '—'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: r.saldo_fim >= 0 ? '#86efac' : '#fca5a5' }}>{fmt(r.saldo_fim)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.03)', fontWeight: 700 }}>
              <td style={{ padding: '8px 10px' }}>TOTAL</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', color: totais.saldo_inicial >= 0 ? '#86efac' : '#fca5a5' }}>{fmt(totais.saldo_inicial)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', color: '#86efac' }}>{fmt(totais.a_receber)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', color: '#fca5a5' }}>{fmt(totais.a_pagar)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', color: totais.saldo_fim >= 0 ? '#86efac' : '#fca5a5' }}>{fmt(totais.saldo_fim)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  // -- Render slicer
  const renderSlicer = () => {
    const customAtivo = !!(dataFimCustom && dataFimCustom > HOJE);
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Período:</span>
        {[7, 30, 60, 90, 180, 365].map(d => (
          <button key={d}
            onClick={() => { setDias(d); setDataFimCustom(''); }}
            style={{
              padding: '4px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
              background: (d === dias && !customAtivo) ? '#22d3ee' : 'rgba(255,255,255,0.06)',
              color: (d === dias && !customAtivo) ? '#0c1117' : 'inherit',
              border: '1px solid ' + ((d === dias && !customAtivo) ? '#22d3ee' : 'rgba(255,255,255,0.12)'),
              fontWeight: (d === dias && !customAtivo) ? 700 : 400,
            }}>
            {d}d
          </button>
        ))}
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: '0 4px' }}>ou até:</span>
        <input
          type="date"
          value={dataFimCustom}
          min={addDias(HOJE, 1)}
          onChange={e => setDataFimCustom(e.target.value)}
          style={{
            padding: '4px 8px', fontSize: 12, borderRadius: 4,
            background: customAtivo ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.06)',
            color: 'inherit',
            border: '1px solid ' + (customAtivo ? '#22d3ee' : 'rgba(255,255,255,0.12)'),
            colorScheme: 'dark',
          }}
        />
        {customAtivo && (
          <button onClick={() => setDataFimCustom('')}
            title="Limpar data customizada"
            style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'inherit', borderRadius: 4, cursor: 'pointer' }}>×</button>
        )}
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginLeft: 8 }}>
          {fmtData(HOJE)} → {fmtData(dataFim)} ({diasEfetivos}d)
        </span>
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-title">
        <div>
          <h1>Fluxo Diário</h1>
          <div className="status-line">Projeção HOJE → futuro · Conta Azul + lógica cartões aplicada</div>
        </div>
        <div className="actions">{renderSlicer()}</div>
      </div>

      {contaFiltro && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.3)', borderRadius: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 12 }}>Filtrado por conta: <b>{contaFiltro}</b></span>
          <button onClick={() => setContaFiltro(null)} style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'inherit', borderRadius: 4, cursor: 'pointer' }}>Limpar</button>
        </div>
      )}

      {/* Métricas hoje */}
      <div className="metric-strip">
        <div className="metric">
          <div className="m-label">Saldo hoje · contas normais</div>
          <div className="m-value">{fmt(EX.totais.saldo_hoje_normais)}</div>
          <div className="m-pct">{contasNormais.length} contas</div>
        </div>
        <div className="metric">
          <div className="m-label">Saldo hoje · investimento</div>
          <div className="m-value" style={{ color: 'var(--cyan)' }}>{fmt(EX.totais.saldo_hoje_invest)}</div>
          <div className="m-pct">{contasInvest.length} contas · CDB/fundos</div>
        </div>
        <div className="metric">
          <div className="m-label">Saldo hoje · total</div>
          <div className="m-value" style={{ fontWeight: 700 }}>{fmt(EX.totais.saldo_hoje_total)}</div>
          <div className="m-pct">normais + investimento</div>
        </div>
        <div className="metric">
          <div className="m-label">Saldo fim do período</div>
          <div className="m-value" style={{ color: projecao.length && projecao[projecao.length - 1].saldo >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {fmt(projecao.length ? projecao[projecao.length - 1].saldo : 0)}
          </div>
          <div className="m-pct">{incluirInvest ? 'incluindo invest' : 'sem invest'} · {dias}d</div>
        </div>
      </div>

      {/* Chart */}
      <div className="card">
        <div className="card-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="card-title">Projeção diária — saldo + a receber + a pagar</h2>
          <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={incluirInvest} onChange={e => setIncluirInvest(e.target.checked)} />
            <span>Somar investimento no saldo</span>
          </label>
        </div>
        {renderChart()}
      </div>

      {/* Tabelas: contas normais + investimento */}
      {renderTabelaContas('Contas normais (correntes + aplicações de liquidez)', tblNormais, totN)}
      {renderTabelaContas('Contas investimento (CDB/fundos)', tblInvest, totI)}

      {/* Detalhe diário */}
      <div className="card">
        <h2 className="card-title">Detalhe diário · clique pra expandir lançamentos</h2>
        <div style={{ maxHeight: 480, overflow: 'auto' }}>
          <table className="bi-table" style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0c1117', zIndex: 1 }}>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Data</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Saldo</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>A receber</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>A pagar</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>Δ dia</th>
              </tr>
            </thead>
            <tbody>
              {projecao.map((p, i) => {
                const delta = p.a_receber + p.a_pagar;
                const tem_movs = delta !== 0;
                const expanded = linhaExpandida === p.d;
                const movs = expanded ? movsDoDia(p.d) : [];
                return (
                  <React.Fragment key={p.d}>
                    <tr onClick={() => tem_movs && setLinhaExpandida(expanded ? null : p.d)}
                        style={{ cursor: tem_movs ? 'pointer' : 'default', background: expanded ? 'rgba(34,211,238,0.08)' : 'transparent', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <td style={{ padding: '6px 10px' }}>
                        {tem_movs && <span style={{ display: 'inline-block', width: 12, fontSize: 9, color: 'var(--cyan)' }}>{expanded ? '▼' : '▶'}</span>}
                        {fmtData(p.d)}
                        {p.d === HOJE && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--cyan)', fontWeight: 700 }}>HOJE</span>}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: p.saldo >= 0 ? '#86efac' : '#fca5a5' }}>{fmt(p.saldo)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: p.a_receber > 0 ? '#86efac' : 'rgba(255,255,255,0.3)' }}>{p.a_receber ? fmt(p.a_receber) : '—'}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: p.a_pagar < 0 ? '#fca5a5' : 'rgba(255,255,255,0.3)' }}>{p.a_pagar ? fmt(p.a_pagar) : '—'}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: delta > 0 ? '#86efac' : delta < 0 ? '#fca5a5' : 'rgba(255,255,255,0.3)' }}>{delta ? fmt(delta) : '—'}</td>
                    </tr>
                    {expanded && movs.map((m, j) => (
                      <tr key={p.d + '-' + j} style={{ background: 'rgba(0,0,0,0.2)', fontSize: 10 }}>
                        <td colSpan={2} style={{ padding: '4px 10px 4px 30px', color: 'rgba(255,255,255,0.65)' }}>
                          <span title={m.c}>{m.c.length > 30 ? m.c.slice(0, 28) + '…' : m.c}</span>
                          {m.is_inv ? <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--cyan)' }}>[INV]</span> : null}
                        </td>
                        <td colSpan={2} style={{ padding: '4px 10px', color: 'rgba(255,255,255,0.5)' }}>
                          <span title={m.cat}>{m.cat}</span>
                          {m.cc && (
                            <span title={`CC: ${m.cc}`}
                                  style={{ marginLeft: 6, padding: '1px 5px', fontSize: 9, color: 'var(--cyan)', background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.25)', borderRadius: 3 }}>
                              {m.cc.length > 14 ? m.cc.slice(0, 12) + '…' : m.cc}
                            </span>
                          )}
                          <span style={{ color: 'rgba(255,255,255,0.5)' }}> · {m.contato || '—'} · </span>
                          <span style={{ color: 'rgba(255,255,255,0.4)' }}>{m.desc ? (m.desc.length > 40 ? m.desc.slice(0, 38) + '…' : m.desc) : ''}</span>
                        </td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', color: m.v >= 0 ? '#86efac' : '#fca5a5' }}>{fmt(m.v)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/* ===== PageDRE — Demonstração do Resultado do Exercício ===== */
const PageDRE = () => {
  const { useState, useMemo } = React;
  const DRE = (typeof window !== 'undefined' && window.DRE_DATA) || null;

  const [empresa, setEmpresa] = useState('Vical Instrumentos');

  if (!DRE) {
    return (
      <div className="page">
        <div className="page-title"><div><h1>DRE</h1></div></div>
        <div className="card"><p style={{ padding: 16, color: 'var(--muted)' }}>Dados de DRE indisponveis. Rode build-dre.cjs.</p></div>
      </div>
    );
  }

  const fmtBRL = (v) => {
    if (v === 0) return '\u2014';
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const rows = useMemo(() => {
    if (empresa === 'Consolidado') {
      // Sum both companies row-by-row (same structure)
      const a = DRE.dados[DRE.empresas[0]] || [];
      const b = DRE.dados[DRE.empresas[1]] || [];
      const len = Math.max(a.length, b.length);
      const merged = [];
      for (let i = 0; i < len; i++) {
        const ra = a[i] || { cat: '', level: 2, isTotal: false, valores: [] };
        const rb = b[i] || { cat: '', level: 2, isTotal: false, valores: [] };
        const vals = [];
        const numCols = Math.max(ra.valores.length, rb.valores.length);
        for (let c = 0; c < numCols; c++) {
          vals.push((ra.valores[c] || 0) + (rb.valores[c] || 0));
        }
        merged.push({ cat: ra.cat || rb.cat, level: ra.level, isTotal: ra.isTotal, valores: vals });
      }
      return merged;
    }
    return DRE.dados[empresa] || [];
  }, [empresa]);

  const colunas = DRE.colunas || [];

  // Check if a row is "receita" related (sections 01, 05, 06 with positive orientation)
  const isReceitaSection = (cat) => /^(01|05|06)/.test(cat);

  const valColor = (v, cat) => {
    if (v === 0) return 'rgba(255,255,255,0.3)';
    if (v < 0) return '#fca5a5';
    if (v > 0 && isReceitaSection(cat)) return '#86efac';
    return 'rgba(255,255,255,0.85)';
  };

  const rowStyle = (row) => {
    if (row.isTotal) {
      return {
        fontWeight: 700,
        background: 'rgba(226,232,240,0.08)',
        borderTop: '2px solid rgba(255,255,255,0.18)',
        fontSize: 12,
      };
    }
    if (row.level === 0) {
      return {
        fontWeight: 700,
        background: 'rgba(248,249,250,0.04)',
        fontSize: 12,
      };
    }
    if (row.level === 1) {
      return {
        fontWeight: 600,
        paddingLeft: 20,
        fontSize: 11.5,
      };
    }
    // level 2 detail
    return {
      fontWeight: 400,
      paddingLeft: 36,
      fontSize: 11,
      color: 'rgba(255,255,255,0.75)',
    };
  };

  return (
    <div className="page">
      <div className="page-title">
        <div>
          <h1>DRE</h1>
          <div className="status-line">Demonstrativo do Resultado do Exercicio</div>
        </div>
      </div>

      {/* Company filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {DRE.empresas.concat(['Consolidado']).map(e => (
          <button key={e}
            onClick={() => setEmpresa(e)}
            style={{
              padding: '6px 16px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
              background: empresa === e ? '#22d3ee' : 'rgba(255,255,255,0.06)',
              color: empresa === e ? '#0c1117' : 'inherit',
              border: '1px solid ' + (empresa === e ? '#22d3ee' : 'rgba(255,255,255,0.12)'),
              fontWeight: empresa === e ? 700 : 400,
            }}>
            {e}
          </button>
        ))}
      </div>

      {/* DRE Table */}
      <div className="card">
        <h2 className="card-title">DRE — {empresa}</h2>
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.15)' }}>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 700, fontSize: 12, color: 'rgba(255,255,255,0.9)' }}>Categoria</th>
                {colunas.map((col, ci) => (
                  <th key={ci} style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 700, fontSize: 12, color: 'rgba(255,255,255,0.9)', whiteSpace: 'nowrap' }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const rs = rowStyle(row);
                return (
                  <tr key={ri} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', ...rs }}>
                    <td style={{ padding: '6px 12px', paddingLeft: rs.paddingLeft || 12, fontWeight: rs.fontWeight, fontSize: rs.fontSize, color: rs.color || 'inherit' }}>
                      {row.cat}
                    </td>
                    {row.valores.map((v, ci) => (
                      <td key={ci} style={{
                        padding: '6px 12px',
                        textAlign: 'right',
                        fontWeight: rs.fontWeight,
                        fontSize: rs.fontSize,
                        color: valColor(v, row.cat),
                        fontFamily: "'JetBrains Mono', monospace",
                        whiteSpace: 'nowrap',
                      }}>
                        {fmtBRL(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

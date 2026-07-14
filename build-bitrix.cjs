#!/usr/bin/env node
/**
 * build-bitrix.cjs — Constrói os 3 funis de vendas do CRM Bitrix24 e gera
 * bitrix-data.js com window.BITRIX_DATA (consumido por pages-6.jsx).
 *
 * Espelha a mecânica do build-dre.cjs: lê JSON cru de data/, computa, escreve
 * um único global. Fica FORA do fluxo do build-data (fonte independente).
 *
 * Fonte crua: data/bitrix_leads.json + bitrix_deals.json (de fetch-bitrix.cjs).
 * Se não existirem → modo "referência": usa os números do relatório (Vical.md)
 * pra as telas renderizarem enquanto o webhook não está conectado.
 *
 * As 3 telas (todas = funil Leads → Negócios → Negócios ganhos, período = ano):
 *  1) mesmo_mes     — só negócios cujo mês(DATE_CREATE) == mês(DATE_CREATE do lead vinculado)
 *  2) investimento  — mesmo funil + recorte por origem/UTM (investimento×resultado);
 *                     campo de custo é auto-descoberto (Vical.md: fonte a validar)
 *  3) qualquer_mes  — mesmo funil, sem restrição de mês entre lead e negócio
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const cfg = (() => { try { return require('./bi.config.js'); } catch (e) { return {}; } })();
const ANO = (cfg.meta && cfg.meta.ano_corrente)
  || (cfg.fontes && cfg.fontes['conta-azul-xlsx'] && cfg.fontes['conta-azul-xlsx'].ano_corrente)
  || new Date().getFullYear();

const DATA = path.join(__dirname, 'data');
const MONTHS_FULL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Números observados no painel "Funil de vendas (com conversões)" (Vical.md) —
// usados como modo referência E como alvo de validação quando os dados reais chegarem.
const REFERENCIA = {
  fonte_painel: 'Análise do CRM → Vendas → Funil de vendas (com conversões)',
  mesmo_mes: {
    conversao_pct: 4.35, leads_valor: 192984.48, negocios_valor: 219806.74,
    ganhos_valor: 8533.70, vida_lead_dias: 3.24, vida_negocio_dias: 1.39,
  },
  qualquer_mes: {
    conversao_pct: 1.72, leads_valor: 192984.48, negocios_valor: 740894.55,
    ganhos_valor: 8533.70, vida_lead_dias: 3.24, vida_negocio_dias: 2.72,
  },
};

function readJSON(name) {
  const p = path.join(DATA, name);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
// mês '01'..'12' a partir de data Bitrix 'YYYY-MM-DD...' (evita bug de timezone)
const mesDe = (dt) => (typeof dt === 'string' && dt.length >= 7) ? dt.slice(5, 7) : null;
const anoDe = (dt) => (typeof dt === 'string' && dt.length >= 4) ? parseInt(dt.slice(0, 4), 10) : null;
function diasEntre(ini, fim) {
  const a = Date.parse(ini), b = Date.parse(fim);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = (b - a) / 86400000;
  return d >= 0 ? d : null;
}
const media = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

// ---------- funil a partir de um conjunto de negócios ----------
function funilDe(leads, deals, leadValorTotal, leadCount) {
  const negociosValor = deals.reduce((s, d) => s + num(d.OPPORTUNITY), 0);
  const ganhos = deals.filter((d) => d.STAGE_SEMANTIC_ID === 'S');
  const ganhosValor = ganhos.reduce((s, d) => s + num(d.OPPORTUNITY), 0);

  // vida útil média do negócio: negócios já fechados (ganho ou perdido) com CLOSEDATE
  const vidasNeg = deals
    .filter((d) => (d.CLOSED === 'Y' || d.STAGE_SEMANTIC_ID === 'S' || d.STAGE_SEMANTIC_ID === 'F') && d.CLOSEDATE)
    .map((d) => diasEntre(d.DATE_CREATE, d.CLOSEDATE))
    .filter((v) => v != null);

  // conversão: negócios ganhos ÷ leads (base do funil), em contagem
  const conversao = leadCount > 0 ? (ganhos.length / leadCount) * 100 : 0;

  // distribuição mensal (por mês de criação do negócio)
  const porMes = MONTHS_FULL.map((_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    const dsMes = deals.filter((d) => mesDe(d.DATE_CREATE) === mm);
    return {
      negocios: dsMes.length,
      negocios_valor: dsMes.reduce((s, d) => s + num(d.OPPORTUNITY), 0),
      ganhos: dsMes.filter((d) => d.STAGE_SEMANTIC_ID === 'S').length,
    };
  });

  return {
    leads: { count: leadCount, valor: leadValorTotal },
    negocios: { count: deals.length, valor: negociosValor },
    ganhos: { count: ganhos.length, valor: ganhosValor },
    conversao_pct: conversao,
    vida_negocio_dias: media(vidasNeg),
    por_mes: porMes,
    funil: [
      { etapa: 'Leads', count: leadCount, valor: leadValorTotal },
      { etapa: 'Negócios', count: deals.length, valor: negociosValor },
      { etapa: 'Negócios ganhos', count: ganhos.length, valor: ganhosValor },
    ],
  };
}

// ---------- descoberta de campos de custo/investimento (Tela #2) ----------
// Só campos NUMÉRICOS (money/double/integer) com termos de custo/verba — e
// exclui ruído ("CUSTOMER" contém "custo"; UTM_* são atribuição, não custo).
function descobrirCamposInvestimento(fieldsDeal, fieldsLead) {
  const rx = /invest|\bverba\b|\bgasto\b|budget|\bcusto\b|\bm[ií]dia\b|\bads\b|\bcpc\b|\bcpl\b|\bcpa\b|tr[aá]fego/i;
  const tiposNum = new Set(['money', 'double', 'integer']);
  const out = [];
  for (const [ent, fields] of [['deal', fieldsDeal], ['lead', fieldsLead]]) {
    if (!fields) continue;
    for (const [code, def] of Object.entries(fields)) {
      if (/CUSTOMER|^UTM_/i.test(code)) continue;
      const titulo = (def && (def.title || def.formLabel || def.listLabel)) || code;
      const tipo = def && def.type;
      if (tiposNum.has(tipo) && (rx.test(titulo) || rx.test(code))) {
        out.push({ entidade: ent, code, titulo, tipo });
      }
    }
  }
  return out;
}

// ---------- mapa SOURCE_ID → nome ----------
function mapaOrigens(statuses) {
  const m = {};
  if (Array.isArray(statuses)) {
    for (const s of statuses) {
      if (s.ENTITY_ID === 'SOURCE') m[s.STATUS_ID] = s.NAME;
    }
  }
  return m;
}

// ---------- recorte investimento × resultado por origem (Tela #2) ----------
function porOrigem(deals, origensMap) {
  const g = {};
  for (const d of deals) {
    const key = d.SOURCE_ID || '(sem origem)';
    const nome = origensMap[key] || d.UTM_SOURCE || key;
    if (!g[nome]) g[nome] = { origem: nome, negocios: 0, negocios_valor: 0, ganhos: 0, ganhos_valor: 0 };
    g[nome].negocios++;
    g[nome].negocios_valor += num(d.OPPORTUNITY);
    if (d.STAGE_SEMANTIC_ID === 'S') { g[nome].ganhos++; g[nome].ganhos_valor += num(d.OPPORTUNITY); }
  }
  return Object.values(g).sort((a, b) => b.negocios_valor - a.negocios_valor);
}

// ======================= MAIN =======================
console.log(`[build-bitrix] gerando funis Bitrix ${ANO}...`);

const leads = readJSON('bitrix_leads.json');
const deals = readJSON('bitrix_deals.json');
const fieldsDeal = readJSON('bitrix_fields_deal.json');
const fieldsLead = readJSON('bitrix_fields_lead.json');
const statuses = readJSON('bitrix_statuses.json');
const categories = readJSON('bitrix_categories.json');   // pipelines (id→nome)
const companies = readJSON('bitrix_companies.json');      // empresas (id→COMPANY_TYPE)

// ---------- mapas de nome (SOURCE / pipeline / COMPANY_TYPE) ----------
function mapaStatus(entidade) {
  const m = {};
  if (Array.isArray(statuses)) for (const s of statuses) if (s.ENTITY_ID === entidade) m[s.STATUS_ID] = s.NAME;
  return m;
}
function mapaPipelines() {
  const m = {};
  if (Array.isArray(categories)) for (const c of categories) m[String(c.ID)] = c.NAME;
  return m;
}
// COMPANY_ID → nome do tipo de cliente (via COMPANY_TYPE da empresa → status name)
function mapaCompanyTipo() {
  const tipoName = mapaStatus('COMPANY_TYPE');
  const m = {};
  if (Array.isArray(companies)) for (const c of companies) {
    if (c.COMPANY_TYPE) m[String(c.ID)] = tipoName[c.COMPANY_TYPE] || c.COMPANY_TYPE;
  }
  return m;
}
// mês inteiro 1..12 a partir de data Bitrix
const mesInt = (dt) => { const mm = mesDe(dt); return mm ? parseInt(mm, 10) : null; };

let out;

if (!leads || !deals || !leads.length || !deals.length) {
  // -------- modo referência (webhook ainda não conectado) --------
  console.warn('[build-bitrix] sem data/bitrix_leads.json|bitrix_deals.json — modo REFERÊNCIA (números do Vical.md).');
  const refFunil = (r) => ({
    leads: { count: null, valor: r.leads_valor },
    negocios: { count: null, valor: r.negocios_valor },
    ganhos: { count: null, valor: r.ganhos_valor },
    conversao_pct: r.conversao_pct,
    vida_lead_dias: r.vida_lead_dias,
    vida_negocio_dias: r.vida_negocio_dias,
    por_mes: null,
    funil: [
      { etapa: 'Leads', count: null, valor: r.leads_valor },
      { etapa: 'Negócios', count: null, valor: r.negocios_valor },
      { etapa: 'Negócios ganhos', count: null, valor: r.ganhos_valor },
    ],
  });
  out = {
    ano: ANO,
    fonte: 'referencia_md',
    gerado_em: new Date().toISOString(),
    telas: {
      mesmo_mes: { titulo: 'Entrada e venda no mesmo mês', ...refFunil(REFERENCIA.mesmo_mes) },
      investimento: {
        titulo: 'Investimento × resultado', ...refFunil(REFERENCIA.mesmo_mes),
        investimento_valor: null, por_origem: null,
        campos_investimento_detectados: [],
        nota: 'Fonte de investimento a validar com o time de marketing/CRM (Vical.md). Conecte o webhook para descobrir campos de custo/UTM.',
      },
      qualquer_mes: { titulo: 'Entrada em qualquer mês', ...refFunil(REFERENCIA.qualquer_mes) },
    },
    referencia: REFERENCIA,
  };
} else {
  // -------- modo real --------
  const leadsAno = leads.filter((l) => anoDe(l.DATE_CREATE) === ANO);
  const dealsAno = deals.filter((d) => anoDe(d.DATE_CREATE) === ANO);

  const leadValorTotal = leadsAno.reduce((s, l) => s + num(l.OPPORTUNITY), 0);
  const leadCount = leadsAno.length;

  // vida útil média do lead (leads fechados com DATE_CLOSED)
  const vidasLead = leadsAno
    .filter((l) => l.DATE_CLOSED)
    .map((l) => diasEntre(l.DATE_CREATE, l.DATE_CLOSED))
    .filter((v) => v != null);
  const vidaLeadDias = media(vidasLead);

  // mês de criação de cada lead (por ID) p/ regra "mesmo mês"
  const leadMesById = {};
  const leadIdSet = new Set();
  for (const l of leadsAno) { leadMesById[String(l.ID)] = mesDe(l.DATE_CREATE); leadIdSet.add(String(l.ID)); }

  // Funil "com conversões" parte dos LEADS: "Negócios" = negócios ORIGINADOS
  // dos leads do ano (LEAD_ID no conjunto). NÃO são todos os negócios do CRM —
  // muitos são criados direto, fora do funil de conversão de leads (Vical.md:
  // "cruzar crm.lead.list + crm.deal.list").
  const dealsLinked = dealsAno.filter((d) => d.LEAD_ID && leadIdSet.has(String(d.LEAD_ID)));

  // Tela 3 — qualquer mês: negócios vinculados aos leads, sem restrição de mês
  const funQualquer = funilDe(leadsAno, dealsLinked, leadValorTotal, leadCount);
  funQualquer.vida_lead_dias = vidaLeadDias;

  // Tela 1 — mesmo mês: negócio vinculado a lead E mês(negócio)==mês(lead)
  const dealsMesmoMes = dealsLinked.filter((d) => mesDe(d.DATE_CREATE) === leadMesById[String(d.LEAD_ID)]);
  const funMesmo = funilDe(leadsAno, dealsMesmoMes, leadValorTotal, leadCount);
  funMesmo.vida_lead_dias = vidaLeadDias;

  // Tela 2 — investimento × resultado: base = qualquer mês + recorte por origem
  const origensMap = mapaOrigens(statuses);
  const camposInvest = descobrirCamposInvestimento(fieldsDeal, fieldsLead);
  // Se houver campo de custo detectado e populado nos negócios, soma-o
  let investimentoValor = null;
  const campoCusto = camposInvest.find((c) => c.entidade === 'deal' && /custo|invest|verba|gasto|cost/i.test(c.titulo + c.code));
  if (campoCusto && dealsLinked.some((d) => num(d[campoCusto.code]) > 0)) {
    investimentoValor = dealsLinked.reduce((s, d) => s + num(d[campoCusto.code]), 0);
  }
  const funInvest = funilDe(leadsAno, dealsLinked, leadValorTotal, leadCount);
  funInvest.vida_lead_dias = vidaLeadDias;
  funInvest.por_origem = porOrigem(dealsLinked, origensMap);
  funInvest.investimento_valor = investimentoValor;
  funInvest.campo_custo = campoCusto ? campoCusto.code : null;
  funInvest.campos_investimento_detectados = camposInvest;
  funInvest.nota = investimentoValor != null
    ? `Investimento somado do campo "${campoCusto.titulo}" (${campoCusto.code}).`
    : 'Nenhum campo de custo/investimento populado nos negócios do Bitrix. Recorte por origem exibido abaixo; defina a fonte de verba (planilha ADS ou campo custom) para CAC/ROI.';

  // ---------- bloco RAW p/ filtros interativos client-side ----------
  // Envia TODOS os negócios do ano (não só os vinculados) p/ o filtro Pipeline
  // ser útil, com marcador `lead` (LEAD_ID quando originado de lead). A agregação
  // dos funis é refeita no navegador (pages-6.jsx) conforme os filtros.
  const pipelinesMap = mapaPipelines();
  const companyTipo = mapaCompanyTipo();
  const sourcesMap = origensMap; // reaproveita mapaOrigens(statuses) já computado

  const rawDeals = dealsAno.map((d) => {
    const tipo = (d.COMPANY_ID && d.COMPANY_ID !== '0') ? (companyTipo[String(d.COMPANY_ID)] || null) : null;
    return {
      id: String(d.ID),
      m: mesInt(d.DATE_CREATE),
      sem: d.STAGE_SEMANTIC_ID || null,     // 'S' ganho, 'F' perdido, 'P' em aberto
      op: num(d.OPPORTUNITY),
      lead: (d.LEAD_ID && leadIdSet.has(String(d.LEAD_ID))) ? String(d.LEAD_ID) : null,
      src: d.SOURCE_ID || '',
      cat: String(d.CATEGORY_ID != null ? d.CATEGORY_ID : '0'),
      tipo,                                  // nome do tipo de cliente (ou null)
      vida: (d.CLOSEDATE && (d.CLOSED === 'Y' || d.STAGE_SEMANTIC_ID === 'S' || d.STAGE_SEMANTIC_ID === 'F'))
        ? diasEntre(d.DATE_CREATE, d.CLOSEDATE) : null,
    };
  });
  const rawLeads = leadsAno.map((l) => ({
    id: String(l.ID),
    m: mesInt(l.DATE_CREATE),
    src: l.SOURCE_ID || '',
    op: num(l.OPPORTUNITY),
    vida: l.DATE_CLOSED ? diasEntre(l.DATE_CREATE, l.DATE_CLOSED) : null,
  }));

  // tipos de cliente presentes (p/ o select), incluindo "(sem empresa)"
  const tiposPresentes = Array.from(new Set(rawDeals.map((d) => d.tipo).filter(Boolean))).sort();
  // fontes presentes (id→nome) — só as que aparecem em negócios/leads
  const srcPresentes = {};
  for (const d of rawDeals) if (d.src) srcPresentes[d.src] = sourcesMap[d.src] || d.src;
  for (const l of rawLeads) if (l.src) srcPresentes[l.src] = sourcesMap[l.src] || l.src;
  // pipelines presentes em negócios (id→nome)
  const pipePresentes = {};
  for (const d of rawDeals) pipePresentes[d.cat] = pipelinesMap[d.cat] || ('Pipeline ' + d.cat);

  out = {
    ano: ANO,
    fonte: 'bitrix',
    gerado_em: new Date().toISOString(),
    telas: {
      mesmo_mes: { titulo: 'Entrada e venda no mesmo mês', ...funMesmo },
      investimento: { titulo: 'Investimento × resultado', ...funInvest },
      qualquer_mes: { titulo: 'Entrada em qualquer mês', ...funQualquer },
    },
    raw: {
      deals: rawDeals,
      leads: rawLeads,
      maps: {
        sources: srcPresentes,       // { SOURCE_ID: nome }
        pipelines: pipePresentes,    // { CATEGORY_ID: nome }
        tipos: tiposPresentes,       // [ nome, ... ]
      },
      // pipeline default = Pipeline de Cotação (id 0), igual ao painel do cliente
      pipeline_default: pipePresentes['0'] != null ? '0' : (Object.keys(pipePresentes)[0] || ''),
    },
    campos: {
      lead: fieldsLead ? Object.keys(fieldsLead).length : 0,
      deal: fieldsDeal ? Object.keys(fieldsDeal).length : 0,
    },
    referencia: REFERENCIA,
  };

  console.log(`  raw: ${rawDeals.length} negócios · ${rawLeads.length} leads · ${Object.keys(srcPresentes).length} fontes · ${Object.keys(pipePresentes).length} pipelines · ${tiposPresentes.length} tipos`);

  console.log(`  leads ${leadCount} · negócios(ano) ${dealsAno.length} · mesmo-mês ${dealsMesmoMes.length}`);
  console.log(`  conversão mesmo-mês ${funMesmo.conversao_pct.toFixed(2)}% · qualquer-mês ${funQualquer.conversao_pct.toFixed(2)}%`);
  console.log(`  campos de investimento detectados: ${camposInvest.length}${camposInvest.length ? ' → ' + camposInvest.map((c) => c.code).join(', ') : ''}`);
}

const outPath = path.join(__dirname, 'bitrix-data.js');
const js = `// Auto-generated by build-bitrix.cjs — NÃO EDITE\nwindow.BITRIX_DATA = ${JSON.stringify(out)};\n`;
fs.writeFileSync(outPath, js, 'utf8');
console.log(`[build-bitrix] OK bitrix-data.js (${(js.length / 1024).toFixed(1)} KB) — fonte=${out.fonte}`);

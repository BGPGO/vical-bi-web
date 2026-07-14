#!/usr/bin/env node
/**
 * fetch-bitrix.cjs — Puxa dados do CRM Bitrix24 via Webhook de entrada (REST).
 * Escreve data/bitrix_*.json (leads, deals, campos, statuses).
 *
 * Credencial (NUNCA hardcode): BITRIX_WEBHOOK_URL no .env, formato
 *   https://vicalinstrumentosdemedio.bitrix24.com.br/rest/{ID_USUARIO}/{TOKEN}/
 * Escopos mínimos do webhook: crm (+ user pra nomes dos responsáveis).
 *
 * Se BITRIX_WEBHOOK_URL não estiver setado → sai 0 (skip silencioso), pra não
 * quebrar o refresh do server. build-bitrix.cjs cai no modo "referência".
 *
 * Docs seguidas (Vical.md):
 *  - Paginação: 50 reg/página; método rápido start=-1 + filter[>ID] + order[ID]=ASC
 *    (desativa a contagem cara, recomendado p/ volume).
 *  - Rate limit ~2 req/s por webhook → throttle de 300ms entre chamadas.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch (e) {}

const cfg = (() => { try { return require('./bi.config.js'); } catch (e) { return {}; } })();
const ANO = (cfg.meta && cfg.meta.ano_corrente)
  || (cfg.fontes && cfg.fontes['conta-azul-xlsx'] && cfg.fontes['conta-azul-xlsx'].ano_corrente)
  || new Date().getFullYear();

let WEBHOOK = (process.env.BITRIX_WEBHOOK_URL || '').trim();
if (!WEBHOOK) {
  console.warn('[bitrix] BITRIX_WEBHOOK_URL não definido no .env — pulando fetch (build-bitrix usa modo referência).');
  process.exit(0);
}
if (!WEBHOOK.endsWith('/')) WEBHOOK += '/';

const OUT = path.join(__dirname, 'data');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = 300;

// ---------- chamada REST genérica ----------
async function call(method, params = {}, retries = 6) {
  const url = `${WEBHOOK}${method}.json`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (netErr) {
    if (retries > 0) {
      const wait = Math.min(20000, 1500 * (7 - retries));
      console.error(`  [network] ${method} → ${netErr.message} → wait ${wait}ms (left ${retries - 1})`);
      await sleep(wait);
      return call(method, params, retries - 1);
    }
    throw netErr;
  }
  let j;
  try { j = await res.json(); }
  catch (e) {
    if (retries > 0) { await sleep(1500); return call(method, params, retries - 1); }
    throw new Error(`${method}: JSON inválido (HTTP ${res.status})`);
  }
  if (j.error) {
    // QUERY_LIMIT_EXCEEDED = rate limit → backoff
    const transient = /QUERY_LIMIT|OVERLOAD|INTERNAL|Service Unavailable|timeout/i.test(String(j.error) + String(j.error_description || ''));
    if (transient && retries > 0) {
      const wait = Math.min(20000, 1500 * (7 - retries));
      console.error(`  [retry] ${method} → ${j.error} → wait ${wait}ms (left ${retries - 1})`);
      await sleep(wait);
      return call(method, params, retries - 1);
    }
    throw new Error(`${method}: ${j.error} — ${j.error_description || ''}`);
  }
  await sleep(THROTTLE_MS);
  return j;
}

// ---------- listagem paginada rápida (start=-1 + filter[>ID]) ----------
// Dedup por ID + break quando o maior ID não avança. Protege contra métodos
// (ex: crm.status.list) que ignoram filter[>ID] e devolvem a lista inteira a
// cada chamada — sem isso vira loop infinito.
async function listAll(method, { filter = {}, select = [] } = {}, label = method) {
  const all = [];
  const seen = new Set();
  let lastId = 0;
  let page = 0;
  for (;;) {
    const params = {
      order: { ID: 'ASC' },
      filter: { ...filter, '>ID': lastId },
      select: select.length ? select : undefined,
      start: -1, // desativa contagem (método rápido)
    };
    const j = await call(method, params);
    const rows = Array.isArray(j.result) ? j.result : [];
    if (rows.length === 0) break;
    let fresh = 0;
    let maxId = lastId;
    for (const r of rows) {
      const id = String(r.ID);
      const nId = parseInt(r.ID, 10);
      if (Number.isFinite(nId) && nId > maxId) maxId = nId;
      if (!seen.has(id)) { seen.add(id); all.push(r); fresh++; }
    }
    page++;
    process.stdout.write(`\r  [${label}] ${all.length} registros (pág ${page})   `);
    // sem registros novos OU maior ID não avançou → fim (evita loop em métodos
    // que não respeitam a paginação por ID)
    if (fresh === 0 || maxId <= lastId) break;
    lastId = maxId;
    if (rows.length < 50) break;
  }
  process.stdout.write('\n');
  return all;
}

function writeJSON(name, data) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  console.log(`  → data/${name} (${Array.isArray(data) ? data.length + ' itens' : (JSON.stringify(data).length / 1024).toFixed(1) + ' KB'})`);
}

(async () => {
  console.log(`[bitrix] pull CRM ano=${ANO} de ${WEBHOOK.replace(/\/rest\/\d+\/[^/]+\//, '/rest/***/***/')}`);
  const dtIni = `${ANO}-01-01T00:00:00`;
  const dtFim = `${ANO}-12-31T23:59:59`;

  // 1) Metadados: campos (p/ descobrir custom fields de investimento/UTM) + statuses (nomes)
  try {
    const lf = await call('crm.lead.fields');
    writeJSON('bitrix_fields_lead.json', lf.result || {});
  } catch (e) { console.warn(`  WARN crm.lead.fields: ${e.message}`); }
  try {
    const df = await call('crm.deal.fields');
    writeJSON('bitrix_fields_deal.json', df.result || {});
  } catch (e) { console.warn(`  WARN crm.deal.fields: ${e.message}`); }
  try {
    const st = await listAll('crm.status.list', { select: ['ID', 'ENTITY_ID', 'STATUS_ID', 'NAME', 'SORT'] }, 'status');
    writeJSON('bitrix_statuses.json', st);
  } catch (e) { console.warn(`  WARN crm.status.list: ${e.message}`); }

  // Pipelines (categorias de negócio) → id -> nome. entityTypeId 2 = deal.
  // Fallback p/ crm.dealcategory.list (APIs antigas). Filtro "Pipeline".
  try {
    let cats = null;
    try {
      const cr = await call('crm.category.list', { entityTypeId: 2 });
      const list = (cr.result && cr.result.categories) || cr.result || [];
      cats = list.map((c) => ({ ID: String(c.id != null ? c.id : c.ID), NAME: c.name || c.NAME }));
    } catch (e1) {
      const dc = await call('crm.dealcategory.list', {});
      const list = Array.isArray(dc.result) ? dc.result : [];
      cats = list.map((c) => ({ ID: String(c.ID), NAME: c.NAME }));
    }
    // A categoria 0 ("Pipeline de Cotação"/geral) às vezes não vem na lista → garante.
    if (!cats.some((c) => c.ID === '0')) cats.unshift({ ID: '0', NAME: 'Geral' });
    writeJSON('bitrix_categories.json', cats);
  } catch (e) { console.warn(`  WARN pipelines (category.list): ${e.message}`); }

  // Empresas (ID -> COMPANY_TYPE) p/ o filtro "Tipo de Cliente - CO" (join via COMPANY_ID).
  try {
    const comps = await listAll('crm.company.list', {
      select: ['ID', 'COMPANY_TYPE'],
    }, 'empresas');
    writeJSON('bitrix_companies.json', comps.map((c) => ({ ID: String(c.ID), COMPANY_TYPE: c.COMPANY_TYPE || null })));
  } catch (e) { console.warn(`  WARN crm.company.list: ${e.message}`); }

  // 2) Leads do ano
  const leads = await listAll('crm.lead.list', {
    filter: { '>=DATE_CREATE': dtIni, '<=DATE_CREATE': dtFim },
    select: ['ID', 'TITLE', 'DATE_CREATE', 'DATE_CLOSED', 'STATUS_ID', 'STATUS_SEMANTIC_ID',
      'OPPORTUNITY', 'CURRENCY_ID', 'SOURCE_ID', 'ASSIGNED_BY_ID',
      'UTM_SOURCE', 'UTM_MEDIUM', 'UTM_CAMPAIGN', 'UTM_CONTENT', 'UTM_TERM'],
  }, 'leads');
  writeJSON('bitrix_leads.json', leads);

  // 3) Negócios do ano — CRIADOS no ano OU FECHADOS no ano (união).
  //    A "venda" no CRM da Vical é contada pela data de FECHAMENTO (CLOSEDATE),
  //    e inclui negócios criados em anos anteriores mas ganhos no ano corrente
  //    (preset "TOTAL DE VENDAS 2026": início=qualquer data, término=ano). Por
  //    isso puxamos os dois conjuntos e deduplicamos por ID.
  const DEAL_SELECT = ['ID', 'TITLE', 'DATE_CREATE', 'BEGINDATE', 'CLOSEDATE', 'CLOSED',
    'STAGE_ID', 'STAGE_SEMANTIC_ID', 'CATEGORY_ID', 'TYPE_ID', 'OPPORTUNITY', 'CURRENCY_ID',
    'LEAD_ID', 'COMPANY_ID', 'SOURCE_ID', 'ASSIGNED_BY_ID',
    'UTM_SOURCE', 'UTM_MEDIUM', 'UTM_CAMPAIGN'];
  const dealsCriados = await listAll('crm.deal.list', {
    filter: { '>=DATE_CREATE': dtIni, '<=DATE_CREATE': dtFim }, select: DEAL_SELECT,
  }, 'deals(criados)');
  const dealsFechados = await listAll('crm.deal.list', {
    filter: { '>=CLOSEDATE': dtIni, '<=CLOSEDATE': dtFim }, select: DEAL_SELECT,
  }, 'deals(fechados)');
  const dealsById = new Map();
  for (const d of dealsCriados) dealsById.set(String(d.ID), d);
  for (const d of dealsFechados) dealsById.set(String(d.ID), d);
  const deals = Array.from(dealsById.values());
  console.log(`  união: ${dealsCriados.length} criados + ${dealsFechados.length} fechados → ${deals.length} negócios únicos`);
  writeJSON('bitrix_deals.json', deals);

  writeJSON('bitrix_summary.json', {
    ano: ANO,
    puxado_em: new Date().toISOString(),
    leads: leads.length,
    deals: deals.length,
  });

  console.log(`[bitrix] OK — ${leads.length} leads, ${deals.length} negócios.`);
})().catch((e) => { console.error('[bitrix] ERRO:', e.message); process.exit(1); });

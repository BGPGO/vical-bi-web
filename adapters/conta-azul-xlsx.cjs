/**
 * Adapter: Conta Azul XLSX (extrato_financeiro_<cliente>.xlsx)
 *
 * Lê o extrato Conta Azul (cumulativo, atualizado diário pelo `Contazulunido.R`)
 * e aplica a lógica de cartões + fusão de aplicação (replica pipeline M do pbix).
 *
 * EMITE:
 *  - movimentos.json: schema canonical Omie-style (build-data.cjs digere)
 *  - empresa.json, categorias.json, departamentos.json, clientes.json,
 *    contas_correntes.json: side-tables que build-data.cjs lê.
 *  - fluxo_ca.json + cartoes_map.json: pra page Fluxo Diário (BIT_EXTRAS).
 *
 * SEMÂNTICA DE SITUAÇÃO:
 *   Quitado/Conciliado/Transferido → cStatus='PAGO'|'RECEBIDO', realizado=true
 *   Em aberto → cStatus='A VENCER', realizado=false
 *   Atrasado → DESCARTADO (mesma regra do Fluxo Diário, decisão do user)
 *
 * Config bi.config.js (modo multi-empresa):
 *   fontes: {
 *     adapters: ["conta-azul-xlsx"],
 *     "conta-azul-xlsx": {
 *       extratos: [
 *         { extrato_path: "...VicalBrasil.xlsx", empresa_nome: "Vical Brasil" },
 *         { extrato_path: "...Vicalinstrumentos.xlsx", empresa_nome: "Vical Instrumentos" },
 *       ],
 *       empresa_nome: "VICAL Instrumentos",
 *       ano_corrente: 2026,
 *     }
 *   }
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

function num(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function isoDate(v) {
  if (!v) return null;
  if (typeof v === 'number' && v > 1000) {
    const ms = (v - 25569) * 86400 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function isoToBr(iso) {
  if (!iso || iso.length < 10) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function readSheet(file, sheetName) {
  const wb = XLSX.readFile(file);
  const sn = sheetName || wb.SheetNames[0];
  if (!wb.Sheets[sn]) throw new Error(`sheet '${sn}' não existe em ${file}. Sheets: ${wb.SheetNames.join(', ')}`);
  return XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
}

/**
 * Saldo OFICIAL por conta direto do Conta Azul (endpoint do dashboard de
 * conciliação). É a única fonte que bate ao centavo com a tela de Saldos do CA
 * — somar movimentos do extrato nunca bate (saldo de abertura, conciliação,
 * integração bancária não são todos lançamentos).
 *
 * REGRA DE AGREGAÇÃO:
 *  - APPLICATIONACCOUNT (aplicação automática) → AGREGA na conta-mãe (mesmo
 *    banco, varrição automática). Ex: "JE - Bradesco - Aplicação" soma no
 *    "JE - Bradesco".
 *  - CREDITCARDACCOUNT (cartão) → STANDALONE, NÃO dobra na mãe (dobrar inflava
 *    o saldo da mãe — errado). O cross-plug cartão→mãe vale SÓ pro CAR/CAP
 *    (projeção a-receber/a-pagar), tratado nos movimentos, nunca no saldo.
 *  - INVESTMENTACCOUNT → separado (is_investimento, toggle do Fluxo Diário).
 *  - Demais (corrente/caixa) → standalone com balance próprio.
 */
async function fetchSaldosDashboard(apiToken) {
  const r = await fetch('https://services.contaazul.com/contaazul-bff/dashboard/v1/financial-accounts', {
    headers: {
      'X-Authorization': apiToken,
      'Accept': 'application/json',
      'Origin': 'https://pro.contaazul.com',
      'Referer': 'https://pro.contaazul.com/',
    },
  });
  if (!r.ok) throw new Error(`dashboard/financial-accounts HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const accts = Array.isArray(j.dashboardBankAccounts) ? j.dashboardBankAccounts : [];

  const porConta = {};
  const meta = {};   // conta → { is_investimento }
  const raw = [];
  for (const x of accts) {
    const ba = x.bankAccount || {};
    const nm = ba.nmBanco ? String(ba.nmBanco).trim() : '';
    if (!nm) continue;
    const type = ba.accountType || '';
    const parent = ba.parentAccount && ba.parentAccount.nmBanco ? String(ba.parentAccount.nmBanco).trim() : null;
    const bal = typeof x.balance === 'number' ? x.balance : 0;

    // Aplicação automática agrega na mãe; resto fica standalone. Normaliza o
    // typo do Enol pra casar com o nome usado nos movimentos.
    let conta;
    if (type === 'APPLICATIONACCOUNT') {
      const mae = parent || nm.replace(/ - Aplica[cç][aã]o$/i, '');
      conta = mae.replace(/^Enol -Bradesco$/i, 'Enol - Bradesco');
    } else {
      conta = nm.replace(/^Enol -Bradesco$/i, 'Enol - Bradesco');
    }
    const isInv = type === 'INVESTMENTACCOUNT' || /^Investimento - /i.test(conta);

    porConta[conta] = (porConta[conta] || 0) + bal;
    if (!meta[conta]) meta[conta] = { is_investimento: isInv, tipo: type, parent };
    raw.push({
      nmBanco: nm,
      accountType: type,
      parent,
      balance: bal,
      pend_concil: x.numberOfPendingConciliations || 0,
      integracao: x.bankIntegrationStatus ? (x.bankIntegrationStatus.message || x.bankIntegrationStatus.header || null) : null,
    });
  }

  const total = Object.values(porConta).reduce((s, v) => s + v, 0);
  return {
    fetched_at: new Date().toISOString(),
    fonte: 'contaazul-bff/dashboard/v1/financial-accounts',
    total,
    n_contas: accts.length,
    por_conta: porConta,
    meta,
    raw,
  };
}

module.exports = {
  id: 'conta-azul-xlsx',
  label: 'Conta Azul XLSX (extrato cumulativo + lógica cartões)',
  required_env: [],
  // Primary adapter: emite movimentos canonical pro build-data.cjs digerir
  contributes_movimentos: true,

  validate(config) {
    const errors = [];
    const cfg = config.fontes && (config.fontes['conta-azul-xlsx'] || config.fontes.conta_azul_xlsx);
    if (!cfg) { errors.push('config.fontes["conta-azul-xlsx"] não definido'); return { ok: false, errors }; }
    // Modo multi-empresa: array extratos[]
    if (Array.isArray(cfg.extratos) && cfg.extratos.length) {
      for (const ext of cfg.extratos) {
        if (!ext.extrato_path) errors.push('extrato_path obrigatório em cada entrada de extratos[]');
        else if (!fs.existsSync(ext.extrato_path)) errors.push(`extrato_path não existe: ${ext.extrato_path}`);
      }
      return { ok: errors.length === 0, errors };
    }
    // Modo API: precisa token + cartoes_map (inline ou path)
    const apiToken = cfg.api_token_env ? process.env[cfg.api_token_env] : null;
    if (apiToken) {
      if (!cfg.cartoes_map && (!cfg.contas_path || !fs.existsSync(cfg.contas_path))) {
        errors.push('modo API: precisa de cartoes_map (inline) ou contas_path acessível');
      }
      return { ok: errors.length === 0, errors };
    }
    // Modo arquivo single: precisa de extrato_path + contas_path no Drive
    if (!cfg.extrato_path) errors.push('extrato_path obrigatório (ou setar api_token_env ou usar extratos[])');
    else if (!fs.existsSync(cfg.extrato_path)) errors.push(`extrato_path não existe: ${cfg.extrato_path}`);
    if (cfg.contas_path && !fs.existsSync(cfg.contas_path)) errors.push(`contas_path não existe: ${cfg.contas_path}`);
    return { ok: errors.length === 0, errors };
  },

  async pull(config, dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    const cfg = config.fontes['conta-azul-xlsx'] || config.fontes.conta_azul_xlsx;
    const empresaNome = cfg.empresa_nome || config.cliente?.nome || 'Empresa';
    const apiToken = cfg.api_token_env ? process.env[cfg.api_token_env] : null;

    // --- 1. Lookup cartão → pagamento
    let cartaoLookup = {};
    if (cfg.cartoes_map) {
      // Inline (modo API geralmente)
      for (const [k, v] of Object.entries(cfg.cartoes_map)) {
        if (k && v) cartaoLookup[String(k).trim()] = String(v).trim();
      }
    } else if (cfg.contas_path && fs.existsSync(cfg.contas_path)) {
      try {
        const cartaoRows = readSheet(cfg.contas_path, 'cartão de crédito');
        for (const r of cartaoRows) {
          const k = r['Cartão de crédito'];
          const v = r['Pagamento'];
          if (k && v) cartaoLookup[String(k).trim()] = String(v).trim();
        }
      } catch (e) {
        console.warn(`  [conta-azul-xlsx] aviso: sheet 'cartão de crédito' não lida: ${e.message}`);
      }
    }
    console.log(`  [conta-azul-xlsx] cartões mapeados: ${Object.keys(cartaoLookup).length}`);

    // --- 2. Lê extrato (API, arquivo single, ou multi-empresa)
    let rows;
    const empresasDisponiveis = new Set();
    if (Array.isArray(cfg.extratos) && cfg.extratos.length) {
      // Modo multi-empresa: lê cada arquivo e tagga com _empresaTag
      rows = [];
      for (const ext of cfg.extratos) {
        const wb = XLSX.readFile(ext.extrato_path);
        const sn = wb.SheetNames.find(n => n === 'Sheet1' || /extrato/i.test(n)) || wb.SheetNames[0];
        const extRows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
        const tag = ext.empresa_nome || path.basename(ext.extrato_path, '.xlsx');
        empresasDisponiveis.add(tag);
        for (const r of extRows) r._empresaTag = tag;
        rows.push(...extRows);
        console.log(`  [conta-azul-xlsx] extrato ${tag}: ${extRows.length} rows`);
      }
    } else if (apiToken) {
      console.log(`  [conta-azul-xlsx] modo API: baixando via X-Authorization (${cfg.api_token_env})`);
      const r = await fetch('https://services.contaazul.com/finance-pro-reports/v1/financial-statement-view/export', {
        method: 'POST',
        headers: {
          'X-Authorization': apiToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ quickFilter: 'ALL' }),
      });
      if (!r.ok) throw new Error(`API CA falhou: HTTP ${r.status} ${await r.text()}`);
      const buf = Buffer.from(await r.arrayBuffer());
      console.log(`  [conta-azul-xlsx] API ok: ${(buf.length / 1024).toFixed(0)} KB`);
      if (cfg.extrato_path) {
        try { fs.mkdirSync(path.dirname(cfg.extrato_path), { recursive: true }); fs.writeFileSync(cfg.extrato_path, buf); } catch (e) { /* ok se path local não disponível */ }
      }
      const wb = XLSX.read(buf, { type: 'buffer' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
    } else {
      const wb = XLSX.readFile(cfg.extrato_path);
      const sn = wb.SheetNames.find(n => n === 'Sheet1' || /extrato/i.test(n)) || wb.SheetNames[0];
      rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
    }
    console.log(`  [conta-azul-xlsx] extrato total: ${rows.length} rows brutos`);

    // --- 3. Normaliza cada row (lógica cartões + fusão aplicação + descarta Atrasado)
    const REAL = new Set(['Quitado', 'Conciliado', 'Transferido']);
    const ABERTO = new Set(['Em aberto']);
    // Sets pra side-tables (categorias, contas, contatos, centros de custo)
    const categoriasSet = new Map(); // categoria → tipo (R/D)
    const contatosSet = new Set();
    const centrosSet = new Set();
    const contasSet = new Set();

    const fluxoCaList = [];      // pra page Fluxo Diário (não passa por filtro de Atrasado)
    const movimentosCanonical = []; // pra build-data.cjs (sem Atrasado)
    let rowId = 0;
    let descartadosAtrasado = 0;

    for (const r of rows) {
      let contaBruta = r['Conta bancária'] ? String(r['Conta bancária']).trim() : null;
      if (!contaBruta) continue;

      // Normalização conta (replica pipeline M do pbix)
      const contaPosAplic = contaBruta.replace(/ - Aplica[cç][aã]o$/i, '');
      const contaNorm = contaPosAplic.replace(/^Enol -Bradesco$/i, 'Enol - Bradesco');
      const conta = cartaoLookup[contaNorm] || contaNorm;
      const isInvestimento = /^Investimento - /i.test(conta);

      const dataMov = isoDate(r['Data movimento']);
      const valor = num(r['Valor (R$)']);
      const situacao = r['Situação'] ? String(r['Situação']).trim() : null;
      const categoria = r['Categoria 1'] ? String(r['Categoria 1']).trim() : '(Sem categoria)';
      // Centro de custo principal: pega o PRIMEIRO "Centro de Custo *" não-vazio.
      // Nome varia entre fonte (API: "Centro de Custo 1"; XLSX-R-pivoted: "Centro de Custo 1...27")
      let ccusto = null;
      for (const k of Object.keys(r)) {
        if (!/^Centro de Custo \d/i.test(k)) continue;
        if (/^Valor no /i.test(k)) continue;
        if (r[k] != null && String(r[k]).trim()) { ccusto = String(r[k]).trim(); break; }
      }
      const tipo = r['Tipo'] ? String(r['Tipo']).trim() : null;  // "Receita" | "Despesa"
      const contato = r['Nome do fornecedor/cliente'] ? String(r['Nome do fornecedor/cliente']).trim() : null;
      const empresaTag = r._empresaTag || empresaNome;

      // Sempre vai pro fluxo_ca (Fluxo Diário tem sua própria lógica)
      fluxoCaList.push({
        data: dataMov,
        conta_original: contaBruta,
        conta,
        is_cartao: Boolean(cartaoLookup[contaBruta]),
        is_investimento: isInvestimento,
        tipo,
        forma_pgto: r['Forma de pgto/recbto'] || null,
        categoria,
        centro_custo: ccusto,
        valor,
        situacao,
        contato,
        descricao: r['Descrição'] || null,
        data_competencia: isoDate(r['Data de competência']),
        data_prevista: isoDate(r['Data prevista']),
        origem: r['Origem do lançamento'] || null,
        empresa: empresaTag,
      });

      // Filtro pro canonical (BI demais telas):
      // - Descarta Atrasado (decisão user)
      // - Descarta movs de contas de investimento (não-operacional)
      // - Descarta linhas Saldo Inicial (categoria especial, não-operacional)
      if (!REAL.has(situacao) && !ABERTO.has(situacao)) { descartadosAtrasado++; continue; }
      if (isInvestimento) continue;
      if (/^Saldo Inicial$/i.test(categoria)) continue;

      const realizado = REAL.has(situacao);
      const cNatureza = tipo === 'Receita' ? 'R' : 'P';
      const cStatusFinal = realizado ? (cNatureza === 'R' ? 'RECEBIDO' : 'PAGO') : 'A VENCER';
      const cGrupo = cNatureza === 'R'
        ? (realizado ? 'CONTA_CORRENTE_REC' : 'CONTA_A_RECEBER')
        : (realizado ? 'CONTA_CORRENTE_PAG' : 'CONTA_A_PAGAR');

      const dataVenc = r['Data prevista'] ? isoDate(r['Data prevista']) : dataMov;
      const dataPagamento = realizado ? dataMov : null;

      const valorAbs = Math.abs(valor);

      // Catalogos
      if (categoria) categoriasSet.set(categoria, cNatureza === 'R' ? 'R' : 'D');
      if (contato) contatosSet.add(contato);
      if (ccusto) centrosSet.add(ccusto);
      if (conta) contasSet.add(conta);

      rowId++;
      movimentosCanonical.push({
        detalhes: {
          nCodTitulo: 'ca-' + rowId,
          cNatureza,
          cStatus: cStatusFinal,
          cGrupo,
          cCodCateg: categoria,
          nCodCliente: contato || '',
          dDtVenc: dataVenc ? isoToBr(dataVenc) : '',
          dDtPagamento: dataPagamento ? isoToBr(dataPagamento) : '',
          dDtEmissao: dataMov ? isoToBr(dataMov) : '',
          cNumDocFiscal: '',
          cNumParcela: '',
          nValorTitulo: valorAbs,
          nCodCC: conta,
        },
        resumo: {
          nValPago: realizado ? valorAbs : 0,
          nValAberto: realizado ? 0 : valorAbs,
          nValLiquido: valor,
        },
        departamentos: ccusto ? [{ cCodDepartamento: ccusto }] : [],
        _ca: {
          situacao,
          conta_original: contaBruta,
          is_cartao: Boolean(cartaoLookup[contaBruta]),
          empresa: empresaTag,
        },
      });
    }

    // --- 4. Catálogos canonical
    const empresa = {
      nome_fantasia: empresaNome,
      codigo: 'vical',
      cnpj: '',
      cidade: '',
      uf: '',
    };
    const categoriasJson = [...categoriasSet.entries()].map(([nome, tipo]) => ({
      codigo: nome,
      descricao: nome,
      natureza: tipo,   // R = receita, D = despesa
    }));
    const departamentosJson = [...centrosSet].map(c => ({ codigo: c, descricao: c }));
    const clientesJson = [...contatosSet].map(c => ({ codigo_cliente_omie: c, nome_fantasia: c, razao_social: c }));
    const contasCorrentesJson = [...contasSet].map(c => ({ id: c, nome: c, banco: c, codigo_banco: '', saldo_inicial: 0 }));

    // --- 4b. Saldo oficial por conta (modo API): bate ao centavo com a tela de
    //          Saldos do CA. Só roda em modo API (precisa do X-Authorization).
    let saldosCa = null;
    if (apiToken) {
      try {
        saldosCa = await fetchSaldosDashboard(apiToken);
        fs.writeFileSync(path.join(dataDir, 'saldos_ca.json'), JSON.stringify(saldosCa));
        console.log(`  [conta-azul-xlsx] saldos oficiais (standalone): ${Object.keys(saldosCa.por_conta).length} contas | total R$ ${saldosCa.total.toFixed(2)}`);
      } catch (e) {
        console.warn(`  [conta-azul-xlsx] aviso: saldos do dashboard não obtidos (${e.message}). Fluxo Diário cai no saldo preservado/por-movimento.`);
      }
    }

    // --- 4c. Lista de empresas (modo multi-empresa)
    const empresasList = [...empresasDisponiveis].sort();

    // --- 5. Output
    fs.writeFileSync(path.join(dataDir, 'movimentos.json'), JSON.stringify(movimentosCanonical));
    fs.writeFileSync(path.join(dataDir, 'empresa.json'), JSON.stringify(empresa, null, 2));
    fs.writeFileSync(path.join(dataDir, 'categorias.json'), JSON.stringify(categoriasJson, null, 2));
    fs.writeFileSync(path.join(dataDir, 'departamentos.json'), JSON.stringify(departamentosJson, null, 2));
    fs.writeFileSync(path.join(dataDir, 'clientes.json'), JSON.stringify(clientesJson, null, 2));
    fs.writeFileSync(path.join(dataDir, 'contas_correntes.json'), JSON.stringify(contasCorrentesJson, null, 2));
    fs.writeFileSync(path.join(dataDir, 'fluxo_ca.json'), JSON.stringify(fluxoCaList));
    fs.writeFileSync(path.join(dataDir, 'cartoes_map.json'), JSON.stringify({ cartao: cartaoLookup }, null, 2));
    if (empresasList.length > 0) {
      fs.writeFileSync(path.join(dataDir, 'empresas.json'), JSON.stringify(empresasList, null, 2));
      console.log(`  [conta-azul-xlsx] empresas: ${empresasList.join(', ')}`);
    }

    const realizadosN = movimentosCanonical.filter(m => m.detalhes.cStatus !== 'A VENCER').length;
    const abertosN = movimentosCanonical.length - realizadosN;
    console.log(`  [conta-azul-xlsx] canonical: ${movimentosCanonical.length} movs (${realizadosN} realizado + ${abertosN} aberto) | ${descartadosAtrasado} atrasados descartados`);
    console.log(`  [conta-azul-xlsx] catálogos: ${categoriasJson.length} cats, ${departamentosJson.length} ccusto, ${clientesJson.length} contatos, ${contasCorrentesJson.length} contas`);

    return {
      fetched: movimentosCanonical.length,
      summary: {
        adapter: 'conta-azul-xlsx',
        timestamp: new Date().toISOString(),
        records: movimentosCanonical.length,
        realizados: realizadosN,
        abertos: abertosN,
        atrasados_descartados: descartadosAtrasado,
        cartoes_redirecionados: fluxoCaList.filter(m => m.is_cartao).length,
        cartoes_mapeados: Object.keys(cartaoLookup).length,
        saldos_ca_total: saldosCa ? saldosCa.total : null,
        saldos_ca_contas: saldosCa ? Object.keys(saldosCa.por_conta).length : null,
      },
    };
  },
};

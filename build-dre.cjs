#!/usr/bin/env node
/**
 * build-dre.cjs — Constrói DRE a partir dos movimentos (data/movimentos.json)
 * usando a estrutura hierárquica dos XLSX como template.
 *
 * Gera dre-data.js com window.DRE_DATA contendo todos os meses do ano corrente.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const cfg = require('./bi.config.js');
const DRIVE = (cfg.fontes && cfg.fontes.drive && cfg.fontes.drive.base_path) || '';
const ANO = (cfg.meta && cfg.meta.ano_corrente) || new Date().getFullYear();

const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const DRE_FILES = [
  {
    empresa: 'Vical Brasil',
    path: process.env.VICAL_BASES_DIR
      ? path.join(process.env.VICAL_BASES_DIR, 'DRE Vical Brasil.xlsx')
      : path.join(DRIVE, 'DRE Vical Brasil.xlsx'),
  },
  {
    empresa: 'Vical Instrumentos',
    path: process.env.VICAL_BASES_DIR
      ? path.join(process.env.VICAL_BASES_DIR, 'DRE Vical Instrumentos.xlsx')
      : path.join(DRIVE, 'DRE Vical Instrumentos.xlsx'),
  },
];

// ---------- Lê movimentos ----------
const MOVS_FILE = path.join(__dirname, 'data', 'movimentos.json');
if (!fs.existsSync(MOVS_FILE)) {
  console.error('[build-dre] movimentos.json não encontrado. Rode build-data primeiro.');
  process.exit(1);
}
const movimentos = JSON.parse(fs.readFileSync(MOVS_FILE, 'utf8'));

// ---------- Agrupa movimentos por empresa + categoria + mês ----------
// Cada movimento tem: detalhes.cCodCateg (categoria), _ca.empresa (tag empresa),
// detalhes.dDtPagamento ou dDtEmissao (data), resumo.nValLiquido (valor com sinal)
function buildCatMonthMap(movs, empresaTag) {
  const map = {}; // { categoria: { '01': valor, '02': valor, ... } }
  for (const m of movs) {
    // Filtra por empresa se especificada
    if (empresaTag && m._ca && m._ca.empresa !== empresaTag) continue;
    // Só movimentos realizados (PAGO/RECEBIDO)
    const st = m.detalhes && m.detalhes.cStatus;
    if (st !== 'PAGO' && st !== 'RECEBIDO') continue;

    const cat = (m.detalhes && m.detalhes.cCodCateg) || '(Sem categoria)';
    // Data: usa dDtPagamento se disponível, senão dDtEmissao
    const dtStr = (m.detalhes && (m.detalhes.dDtPagamento || m.detalhes.dDtEmissao)) || '';
    // Formato dd/mm/yyyy
    const parts = dtStr.split('/');
    if (parts.length !== 3) continue;
    const yr = parseInt(parts[2], 10);
    if (yr !== ANO) continue;
    const mes = parts[1]; // '01'..'12'

    const valor = m.resumo && m.resumo.nValLiquido != null ? m.resumo.nValLiquido : 0;

    if (!map[cat]) map[cat] = {};
    map[cat][mes] = (map[cat][mes] || 0) + valor;
  }
  return map;
}

// ---------- Lê estrutura DRE do XLSX ----------
function detectLevel(cat) {
  if (/^\d{2}T\s/.test(cat)) return { level: 0, isTotal: true };
  if (/^\d{2}\.\d/.test(cat)) return { level: 1, isTotal: false };
  if (/^\d{2}\s/.test(cat)) return { level: 0, isTotal: false };
  return { level: 2, isTotal: false };
}

function parseStructure(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`  WARN: ${filePath} não encontrado`);
    return [];
  }
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const rows = [];
  for (let i = 2; i < raw.length; i++) {
    const cat = String(raw[i][0] || '').trim();
    if (!cat || cat === 'Sem lançamentos') continue;
    const { level, isTotal } = detectLevel(cat);
    rows.push({ cat, level, isTotal });
  }
  return rows;
}

// ---------- Monta DRE com valores dos movimentos ----------
function buildDRE(structure, catMonthMap) {
  // Para cada linha da estrutura, se é detalhe (level 2), busca valores no map
  // Se é header/subtotal, os valores serão computados pela hierarquia

  const meses = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const result = [];

  // Primeiro: preenche detalhes com valores dos movimentos
  for (const row of structure) {
    const valores = meses.map(m => {
      if (row.level === 2 && !row.isTotal) {
        return (catMonthMap[row.cat] && catMonthMap[row.cat][m]) || 0;
      }
      return 0; // headers e totals serão computados depois
    });
    // Total (última coluna)
    const total = valores.reduce((s, v) => s + v, 0);
    result.push({ ...row, valores: [...valores, total] });
  }

  // Agora: computa sub-headers (level 1) como soma dos seus filhos (level 2)
  // e sections (level 0, não total) como soma dos sub-headers
  // e subtotais (isTotal) como soma acumulada da seção

  // Hierarquia: section(0) -> subheader(1) -> detail(2)
  // Subtotal(0,isTotal) = soma de toda a seção acima até o subtotal anterior

  // Passo 1: sub-headers = soma dos filhos level 2 abaixo até próximo level <=1
  for (let i = 0; i < result.length; i++) {
    if (result[i].level !== 1) continue;
    const childSum = meses.map(() => 0);
    for (let j = i + 1; j < result.length; j++) {
      if (result[j].level <= 1) break;
      for (let m = 0; m < meses.length; m++) {
        childSum[m] += result[j].valores[m];
      }
    }
    const total = childSum.reduce((s, v) => s + v, 0);
    result[i].valores = [...childSum, total];
  }

  // Passo 2: sections (level 0, !isTotal) = soma dos sub-headers abaixo
  for (let i = 0; i < result.length; i++) {
    if (result[i].level !== 0 || result[i].isTotal) continue;
    const childSum = meses.map(() => 0);
    for (let j = i + 1; j < result.length; j++) {
      if (result[j].level === 0) break;
      if (result[j].level === 1) {
        for (let m = 0; m < meses.length; m++) {
          childSum[m] += result[j].valores[m];
        }
      }
    }
    const total = childSum.reduce((s, v) => s + v, 0);
    result[i].valores = [...childSum, total];
  }

  // Passo 3: subtotais (isTotal) = soma acumulada das seções desde o subtotal anterior
  let lastTotalIdx = -1;
  for (let i = 0; i < result.length; i++) {
    if (!result[i].isTotal) continue;
    const acum = meses.map(() => 0);
    for (let j = lastTotalIdx + 1; j < i; j++) {
      if (result[j].level === 0 && !result[j].isTotal) {
        for (let m = 0; m < meses.length; m++) {
          acum[m] += result[j].valores[m];
        }
      }
    }
    // Subtotal acumulativo: soma com subtotal anterior
    if (lastTotalIdx >= 0) {
      for (let m = 0; m < meses.length; m++) {
        acum[m] += result[lastTotalIdx].valores[m];
      }
    }
    const total = acum.reduce((s, v) => s + v, 0);
    result[i].valores = [...acum, total];
    lastTotalIdx = i;
  }

  return result;
}

// ---------- Main ----------
console.log(`[build-dre] Construindo DRE ${ANO} a partir dos movimentos...`);

const empresas = [];
const dados = {};
const colunas = [...MONTH_NAMES.map((m, i) => `${m}/${ANO}`), 'Total'];

for (const f of DRE_FILES) {
  console.log(`  ${f.empresa}: estrutura de ${f.path}`);
  const structure = parseStructure(f.path);
  if (structure.length === 0) {
    console.warn(`  WARN: sem estrutura para ${f.empresa}`);
    continue;
  }
  const catMap = buildCatMonthMap(movimentos, f.empresa);
  const dreRows = buildDRE(structure, catMap);
  empresas.push(f.empresa);
  dados[f.empresa] = dreRows;
  console.log(`  ${f.empresa}: ${dreRows.length} linhas, ${Object.keys(catMap).length} categorias com movimentos`);
}

const dreData = { empresas, colunas, dados, ano: ANO };

const outPath = path.join(__dirname, 'dre-data.js');
const js = `// Auto-generated by build-dre.cjs — NÃO EDITE\nwindow.DRE_DATA = ${JSON.stringify(dreData)};\n`;
fs.writeFileSync(outPath, js, 'utf8');

const sizeKB = (js.length / 1024).toFixed(1);
console.log(`[build-dre] OK dre-data.js (${sizeKB} KB) — ${empresas.length} empresas, ${colunas.length} colunas`);

// Configuração do cliente VICAL INSTRUMENTOS. Gerada via clone ESA (2026-07-02).
// NUNCA commite credenciais aqui — use .env.
//
// Após editar, rode `node bgp-bi.cjs build` pra validar.
module.exports = {
  cliente: {
    nome: "VICAL Instrumentos",
    subdomain: "vical-bi",
    coolify_app_uuid: "lrg057rcj4o2z7dr5bd2qney",
    cor_primaria: "#22d3ee",
  },

  fontes: {
    adapters: ["conta-azul-xlsx"],
    "conta-azul-xlsx": {
      // Modo multi-empresa: combina dois extratos com campo empresa
      extratos: [
        {
          extrato_path: process.env.VICAL_BASES_DIR
            ? require('path').join(process.env.VICAL_BASES_DIR, 'extrato_financeiroVicalBrasil.xlsx')
            : "G:/Meu Drive/BGP/CLIENTES/BI/406. VICAL INSTRUMENTOS/BASES/extrato_financeiroVicalBrasil.xlsx",
          empresa_nome: "Vical Brasil",
        },
        {
          extrato_path: process.env.VICAL_BASES_DIR
            ? require('path').join(process.env.VICAL_BASES_DIR, 'extrato_financeiroVicalinstrumentos.xlsx')
            : "G:/Meu Drive/BGP/CLIENTES/BI/406. VICAL INSTRUMENTOS/BASES/extrato_financeiroVicalinstrumentos.xlsx",
          empresa_nome: "Vical Instrumentos",
        },
      ],
      empresa_nome: "VICAL Instrumentos",
      ano_corrente: 2026,
    },
    fin40: {
      filtrar_transferencias: true,
      excluir_categorias: [],
    },
    drive: {
      base_path: "G:/Meu Drive/BGP/CLIENTES/BI/406. VICAL INSTRUMENTOS/BASES",
    },
  },

  refresh: {
    substrato: "manual",
    agenda: "manual",
    responsavel: "",
    nota: "Dados via XLSX no Drive, atualização manual",
  },

  pages: {
    geral: {
      overview: "active",
      receita: "active",
      despesa: "active",
      fluxo: "active",
      tesouraria: "hidden",
      comparativo: "active",
      dre: "active",
      relatorio: "active",
      valuation: "hidden",
    },
    outros: {
      fluxo_diario: "hidden",
      indicators: "hidden",
      faturamento_produto: "hidden",
      curva_abc: "hidden",
      marketing: "hidden",
      hierarquia: "hidden",
      detalhado: "hidden",
      profunda_cliente: "hidden",
      crm: "hidden",
      aimo: "hidden",
      // Aba CRM Bitrix24 — 3 telas de funil de vendas
      bitrix_mesmo_mes: "active",
      bitrix_investimento: "active",
      bitrix_qualquer_mes: "active",
    },
  },

  meta: {
    ano_corrente: 2026,
    valuation_premissas: { wacc: 25, growth_year2: 20, growth_year3: 20, ipca: 4.5, perpetuity_growth: 10 },
  },

  template: {
    version_when_created: "1.1.0",
    version_last_synced: "1.1.0",
  },
};

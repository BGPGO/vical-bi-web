// Configuração do cliente VICAL INSTRUMENTOS. Gerada via clone ESA (2026-07-02).
// NUNCA commite credenciais aqui — use .env.
//
// Após editar, rode `node bgp-bi.cjs build` pra validar.
module.exports = {
  cliente: {
    nome: "VICAL Instrumentos",
    subdomain: "vical-bi",
    coolify_app_uuid: "i127ccccxbb72ba1jqoaoi6p",
    cor_primaria: "#22d3ee",
  },

  fontes: {
    adapters: ["conta-azul-xlsx"],
    "conta-azul-xlsx": {
      // Modo multi-empresa: combina dois extratos com campo empresa
      extratos: [
        {
          extrato_path: "G:/Meu Drive/BGP/CLIENTES/BI/406. VICAL INSTRUMENTOS/BASES/extrato_financeiroVicalBrasil.xlsx",
          empresa_nome: "Vical Brasil",
        },
        {
          extrato_path: "G:/Meu Drive/BGP/CLIENTES/BI/406. VICAL INSTRUMENTOS/BASES/extrato_financeiroVicalinstrumentos.xlsx",
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

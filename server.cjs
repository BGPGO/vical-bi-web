#!/usr/bin/env node
/**
 * server.cjs — Express tiny que serve o BI static (data.js, app.bundle.js,
 * index.html, etc) + cron interno + API trigger.
 *
 * - Cron `17 * * * *`: roda fetch-data + build-data + build-data-extras
 *   dentro do container. Atualiza data.js + data-extras.js em tempo real
 *   (Express serve from disk, próxima request pega novos dados).
 * - POST /api/trigger-refresh: roda o mesmo refresh on-demand. Botão Atualizar
 *   espera retorno (~10s) e recarrega.
 * - GET /api/last-run-status: status do último refresh (interno).
 *
 * Substitui o GH Actions schedule (que era unreliable). O workflow_dispatch
 * do GH ainda existe como fallback manual via gh CLI.
 */
'use strict';

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const cron = require('node-cron');
const { spawn } = require('node:child_process');
const { sendAlert } = require('./lib/mailer.cjs');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

const PORT = parseInt(process.env.PORT, 10) || 80;
const CRON_EXPR = process.env.REFRESH_CRON || '17 * * * *';   // 17min de cada hora UTC

// Status do último refresh (in-memory)
let lastRun = {
  status: 'idle',          // idle | running | success | failure
  started_at: null,
  finished_at: null,
  duration_ms: null,
  trigger: null,           // 'cron' | 'manual' | 'startup'
  error: null,
  stdout_tail: '',
};
let activeRun = null;      // Promise se está rodando

// Contador de falhas consecutivas (alerta dispara em 2+ falhas seguidas)
let consecutiveFailures = 0;
let alertSent = false;     // evita spam (1 email por sequência de falhas)
const ALERT_THRESHOLD = parseInt(process.env.ALERT_FAILURE_THRESHOLD, 10) || 2;
const BI_NAME = process.env.BI_CLIENT_NAME || 'VICAL Instrumentos';
const BI_URL = process.env.BI_PUBLIC_URL || 'https://vical-bi.187.77.238.125.sslip.io';

async function maybeNotifyOnFailure(run) {
  consecutiveFailures += 1;
  console.warn(`[alert] falha consecutiva #${consecutiveFailures} (threshold=${ALERT_THRESHOLD})`);
  if (consecutiveFailures < ALERT_THRESHOLD) return;
  if (alertSent) return;   // já alertou pra essa sequência
  const subject = `[BI ${BI_NAME}] 🔴 Refresh falhou ${consecutiveFailures}× consecutivas`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px;">
      <h2 style="color: #dc2626;">🔴 BI ${BI_NAME} — Refresh falhando</h2>
      <p><b>${consecutiveFailures} falhas consecutivas</b> no pipeline de atualização.</p>
      <ul>
        <li><b>Trigger:</b> ${run.trigger}</li>
        <li><b>Iniciado:</b> ${run.started_at}</li>
        <li><b>Finalizado:</b> ${run.finished_at}</li>
        <li><b>Duração:</b> ${(run.duration_ms / 1000).toFixed(1)}s</li>
        <li><b>Erro:</b> <code style="background:#fee;padding:2px 6px">${(run.error || '').slice(0, 500)}</code></li>
      </ul>
      <p><b>Output (últimas linhas):</b></p>
      <pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:11px;overflow:auto;max-height:300px">${(run.stdout_tail || '').slice(-1500)}</pre>
      <p>BI continua servindo dados <b>do último refresh OK</b>. Cron tentará novamente na próxima hora cheia (:17 UTC).</p>
      <p><a href="${BI_URL}" style="display:inline-block;background:#22d3ee;color:#000;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600">Abrir BI</a></p>
    </div>
  `;
  const text = `BI ${BI_NAME} — Refresh falhou ${consecutiveFailures}× consecutivas.\nErro: ${run.error}\nÚltima saída:\n${(run.stdout_tail || '').slice(-1000)}`;
  await sendAlert({ subject, html, text });
  alertSent = true;
}

async function maybeNotifyOnRecovery(run) {
  if (consecutiveFailures === 0) return;   // não tava em falha
  const prevFailures = consecutiveFailures;
  consecutiveFailures = 0;
  if (!alertSent) return;   // não tinha alertado, não precisa "resolver"
  alertSent = false;
  const subject = `[BI ${BI_NAME}] ✅ Refresh voltou OK (após ${prevFailures} falhas)`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px;">
      <h2 style="color: #16a34a;">✅ BI ${BI_NAME} — Refresh restabelecido</h2>
      <p>O pipeline voltou a funcionar após <b>${prevFailures} falhas consecutivas</b>.</p>
      <ul>
        <li><b>Duração:</b> ${(run.duration_ms / 1000).toFixed(1)}s</li>
        <li><b>Trigger:</b> ${run.trigger}</li>
      </ul>
      <p><a href="${BI_URL}" style="display:inline-block;background:#22d3ee;color:#000;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600">Abrir BI</a></p>
    </div>
  `;
  await sendAlert({ subject, html });
}

function runScript(script, label) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [script], { cwd: __dirname, env: process.env });
    let tail = '';
    const cap = (chunk) => {
      const s = chunk.toString();
      tail = (tail + s).slice(-2000);
      process.stdout.write(`[${label}] ${s}`);
    };
    proc.stdout.on('data', cap);
    proc.stderr.on('data', cap);
    proc.on('close', (code) => code === 0 ? resolve({ ok: true, tail }) : reject(new Error(`${label} exit ${code}\n${tail}`)));
    proc.on('error', reject);
  });
}

async function doRefresh(trigger) {
  if (activeRun) {
    console.log(`[refresh] já em andamento (trigger=${trigger}) — anexando`);
    return activeRun;
  }
  const startedAt = new Date().toISOString();
  lastRun = { status: 'running', started_at: startedAt, finished_at: null, duration_ms: null, trigger, error: null, stdout_tail: '' };
  console.log(`\n=== REFRESH start [${trigger}] @ ${startedAt} ===`);

  activeRun = (async () => {
    const t0 = Date.now();
    try {
      // Fetch: só roda se extrato_path estiver acessível (Drive montado ou API token).
      // No container Coolify sem Drive, pula fetch e rebuild a partir dos JSONs existentes.
      try { await runScript('fetch-data.cjs', 'fetch'); }
      catch (e) { console.warn(`[refresh] fetch-data pulado (${e.message.split('\n')[0]})`); }
      const b = await runScript('build-data.cjs', 'build');
      const c = await runScript('build-data-extras.cjs', 'extras');
      const dur = Date.now() - t0;
      lastRun = {
        status: 'success',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: dur,
        trigger,
        error: null,
        stdout_tail: c.tail,
      };
      console.log(`=== REFRESH OK [${trigger}] em ${(dur / 1000).toFixed(1)}s ===\n`);
      // Se tava em sequência de falha, notifica recuperação
      maybeNotifyOnRecovery(lastRun).catch(e => console.error('[alert] recovery exc:', e));
    } catch (e) {
      const dur = Date.now() - t0;
      lastRun = {
        status: 'failure',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: dur,
        trigger,
        error: String(e.message || e),
        stdout_tail: (e.message || '').slice(-2000),
      };
      console.error(`=== REFRESH FAIL [${trigger}] em ${(dur / 1000).toFixed(1)}s: ${e.message} ===\n`);
      // Conta falha e talvez dispara alerta (>= ALERT_THRESHOLD consecutivas)
      maybeNotifyOnFailure(lastRun).catch(e => console.error('[alert] failure exc:', e));
    } finally {
      activeRun = null;
    }
  })();
  return activeRun;
}

// --- API
app.post('/api/trigger-refresh', async (req, res) => {
  try {
    const startedAt = new Date().toISOString();
    // Dispara e ESPERA terminar (botão usa await pra mostrar spinner até OK)
    await doRefresh('manual');
    res.json({
      ok: lastRun.status === 'success',
      started_at: startedAt,
      finished_at: lastRun.finished_at,
      duration_ms: lastRun.duration_ms,
      error: lastRun.error,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/last-run-status', (req, res) => res.json(lastRun));
app.get('/api/health', (req, res) => res.json({
  ok: true,
  cron: CRON_EXPR,
  last_status: lastRun.status,
  last_finished: lastRun.finished_at,
  consecutive_failures: consecutiveFailures,
  alert_sent: alertSent,
  alert_threshold: ALERT_THRESHOLD,
  mailer_configured: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD && (process.env.ALERT_EMAIL_TO || process.env.EMAIL_TO)),
}));

// Endpoint pra testar email (debug). Body: { to?: "..." }
app.post('/api/test-alert', async (req, res) => {
  const r = await sendAlert({
    subject: `[BI ${BI_NAME}] 🧪 Teste de alerta`,
    html: `<p>Teste de alerta enviado às ${new Date().toISOString()}. Sistema OK.</p>`,
    text: `Teste de alerta às ${new Date().toISOString()}`,
  });
  res.json(r);
});

// --- Static
const NO_CACHE = new Set(['/data.js', '/data-extras.js', '/app.bundle.js', '/', '/index.html']);
app.use((req, res, next) => {
  if (NO_CACHE.has(req.path)) res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});
app.use(express.static(__dirname, {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (/report.*\.json$/.test(filePath) || /\/assets\//.test(filePath)) {
      res.set('Cache-Control', 'public, max-age=3600');
    }
  },
}));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  console.log(`[bi-server] up on :${PORT} | cron=${CRON_EXPR}`);
});

// --- Cron interno (Coolify nativo Scheduled Tasks ainda não tem API REST estável)
if (cron.validate(CRON_EXPR)) {
  cron.schedule(CRON_EXPR, () => {
    doRefresh('cron').catch(e => console.error('[cron] refresh exc:', e));
  });
  console.log(`[cron] schedule '${CRON_EXPR}' (UTC) registrado`);
} else {
  console.error(`[cron] expr inválida: '${CRON_EXPR}' — cron NÃO registrado`);
}

// Refresh inicial no boot (atualizar tudo na primeira subida)
if (process.env.REFRESH_ON_START !== 'false') {
  setTimeout(() => doRefresh('startup').catch(e => console.error('[startup] refresh exc:', e)), 5000);
}

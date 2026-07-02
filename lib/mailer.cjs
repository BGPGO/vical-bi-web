/**
 * lib/mailer.cjs — wrapper Gmail SMTP pra alertas do BI.
 *
 * Reaproveita credenciais Gmail do sales-coach (smtp.gmail.com:587 STARTTLS +
 * App Password 16 chars). NÃO faz cadastro novo — usa as mesmas credenciais
 * que mandam relatórios de reunião pra equipe BGP.
 *
 * Variáveis env esperadas:
 *   GMAIL_USER          — endereço do remetente
 *   GMAIL_APP_PASSWORD  — app password (16 chars, sem espaços)
 *   ALERT_EMAIL_TO      — destinatários (csv) pros alertas do BI
 */
'use strict';

const nodemailer = require('nodemailer');

let _transporter = null;
function transporter() {
  if (_transporter) return _transporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('GMAIL_USER ou GMAIL_APP_PASSWORD não definidos');
  _transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
  });
  return _transporter;
}

function recipients() {
  const csv = process.env.ALERT_EMAIL_TO || process.env.EMAIL_TO || '';
  return csv.split(',').map(s => s.trim()).filter(Boolean);
}

async function sendAlert({ subject, html, text }) {
  const to = recipients();
  if (to.length === 0) {
    console.warn('[mailer] sem ALERT_EMAIL_TO — alerta NÃO enviado');
    return { ok: false, error: 'no recipients' };
  }
  try {
    const info = await transporter().sendMail({
      from: process.env.GMAIL_USER,
      to: to.join(', '),
      subject,
      text: text || subject,
      html: html || `<pre>${subject}</pre>`,
    });
    console.log(`[mailer] OK to=${to.join(',')} subject="${subject}"`);
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    console.error(`[mailer] FAIL to=${to.join(',')} subject="${subject}" err=${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendAlert };

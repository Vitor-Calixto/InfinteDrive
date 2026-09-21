import nodemailer from 'nodemailer';

// Nodemailer opcional: sem SMTP configurado, o link de reset vai só para o
// log do servidor (modo dev). Com SMTP, vai por e-mail de verdade.
// Resposta da API é sempre genérica — nunca revela se o e-mail existe.
let transporter = null;

function getTransporter() {
  if (transporter !== null) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST) return (transporter = false);
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS || '' } : undefined,
  });
  return transporter;
}

export function mailConfigured() {
  return !!getTransporter();
}

export async function sendResetEmail(to, link) {
  const t = getTransporter();
  if (!t) {
    console.log(`[dev] link de recuperação para ${to}: ${link}`);
    return { dev: true };
  }
  const brand = 'Deploy Center';
  await t.sendMail({
    from: process.env.SMTP_FROM || `${brand} <no-reply@localhost>`,
    to,
    subject: `Recupere sua senha — ${brand}`,
    text: `Olá!\n\nRecebemos um pedido de troca de senha da sua conta ${brand}.\n\nDefina a nova senha aqui (vale 1 hora): ${link}\n\nSe não foi você, ignore este e-mail — sua senha continua a mesma.\n\nEquipe ${brand}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#121212;color:#fff;border-radius:16px;padding:28px">
      <div style="font-size:20px;font-weight:800;margin-bottom:12px"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#1DB954"></span> ${brand}</div>
      <p>Olá! Recebemos um pedido de troca de senha da sua conta.</p>
      <p><a href="${link}" style="display:inline-block;background:#1DB954;color:#000;font-weight:700;text-decoration:none;border-radius:999px;padding:12px 28px">Definir nova senha</a></p>
      <p style="color:#a1a1aa;font-size:12px">O link vale 1 hora. Se não foi você, ignore — sua senha continua a mesma.</p>
    </div>`,
  });
  return { dev: false };
}

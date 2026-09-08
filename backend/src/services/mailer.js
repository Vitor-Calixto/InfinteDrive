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
  await t.sendMail({
    from: process.env.SMTP_FROM || 'Deploy Center <no-reply@localhost>',
    to,
    subject: 'Recupere sua senha — Deploy Center',
    text: `Troque sua senha (vale 1h): ${link}\nSe não foi você, ignore.`,
    html: `<p>Troque sua senha (vale 1h):</p><p><a href="${link}">Definir nova senha</a></p><p>Se não foi você, ignore.</p>`,
  });
  return { dev: false };
}

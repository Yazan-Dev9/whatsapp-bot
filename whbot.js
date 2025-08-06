const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { spawn } = require('child_process');
const qrcode = require('qrcode-terminal');

const OWNER_ID = "963996125895@s.whatsapp.net";

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('connection closed due to', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
      if (shouldReconnect) startSock();
    } else if (connection === 'open') {
      console.log('Connected!');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message) return;

    // استخراج النص
    const text =
      msg.message.conversation ||
      (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text
);

    // إذا لم يوجد نص أو لا يبدأ بـ #
    if (!text || !text.startsWith('#')) return;

    // تحديد المرسل
    const sender = msg.key.participant || msg.key.remoteJid;

    // حذف رسالة غير المالك فقط
    if (sender !== OWNER_ID) {
      try {
        await sock.sendMessage(
          msg.key.remoteJid,
          { delete: {
              remoteJid: msg.key.remoteJid,
              fromMe: true,
              id: msg.key.id,
              participant: msg.key.participant
            }
          }
        );
      } catch (e) {
        console.error('خطأ أثناء حذف رسالة المستخدم من المجموعة:', e);
      }
    }

    const userText = text.slice(1).trim();
    if (!userText) {
      return sock.sendMessage(
        msg.key.remoteJid,
        { text: "يرجى كتابة سؤال بعد #" },
        { quoted: msg }
      );
    }

    const child = spawn('./tgpt4', ['--provider', 'pollinations', '-w']);
    let output = '';

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += '\n⚠️ ' + data.toString();
 });

    child.stdin.write(userText + '\n');
    child.stdin.end();

    child.on('close', async () => {
      if (!output.trim()) {
        await sock.sendMessage(msg.key.remoteJid, { text: "لم أتمكن من فهم أو معالجة سؤالك." }, { quoted: msg });
        return;
      }
      const MAX_LENGTH = 4096;
      let parts = [];
      for (let i = 0; i < output.length; i += MAX_LENGTH) {
        parts.push(output.slice(i, i + MAX_LENGTH));
      }
      for (const part of parts.slice(0, 3)) {
        await sock.sendMessage(msg.key.remoteJid, { text: part.trim() }, { quoted: msg });
      }
    });

    child.on('error', (err) => {
      console.error(err);
      sock.sendMessage(msg.key.remoteJid, { text: "حدث خطأ في تشغيل الذكاء الاصطناعي." }, { quoted: msg });
    });
  });

  sock.ev.on('creds.update', saveCreds);
}

startSock();

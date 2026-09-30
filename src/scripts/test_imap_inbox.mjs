import tls from 'tls';

const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';

console.log(`[IMAP Test] Connecting to imap.gmail.com:993 for ${user}...`);

const socket = tls.connect(993, 'imap.gmail.com', { rejectUnauthorized: false }, () => {
  console.log('[IMAP Test] Connected to TLS socket');
});

let tagIndex = 1;
function sendCommand(cmd) {
  const tag = `A${tagIndex++}`;
  const full = `${tag} ${cmd}\r\n`;
  console.log(`> ${full.trim()}`);
  socket.write(full);
}

socket.on('data', (data) => {
  const str = data.toString();
  console.log(`< ${str.trim()}`);

  if (str.includes('* OK')) {
    sendCommand(`LOGIN "${user}" "${pass}"`);
  } else if (str.includes('A1 OK')) {
    sendCommand('SELECT INBOX');
  } else if (str.includes('A2 OK')) {
    sendCommand('SEARCH UNSEEN');
  } else if (str.includes('A3 OK')) {
    console.log('[IMAP Test] Successfully logged in and searched UNSEEN emails!');
    sendCommand('LOGOUT');
  } else if (str.includes('A4 OK')) {
    socket.end();
  }
});

socket.on('error', (err) => {
  console.error('[IMAP Error]', err.message);
});

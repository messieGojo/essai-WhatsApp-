const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, getCodeFromWASocket } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

let sock;
let connectionState = { status: 'disconnected', code: null, message: 'Prêt' };

const AUTH_FOLDER = 'auth_info_baileys';

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

        sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true,
            auth: state,
            browser: ['Node Server', 'Chrome', '1.0.0']
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                connectionState = { status: 'waiting', code: null, message: 'Scan QR Code' };
            }

            if (connection === 'open') {
                connectionState = { 
                    status: 'connected', 
                    code: sock.user?.id, 
                    message: `Connecté: ${sock.user?.id || 'inconnu'}` 
                };
            } else if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                connectionState = { 
                    status: 'disconnected', 
                    code: null, 
                    message: shouldReconnect ? 'Reconnexion...' : 'Déconnecté' 
                };
                if (shouldReconnect) {
                    setTimeout(connectToWhatsApp, 10000);
                }
            }
        });
    } catch (error) {
        console.error('Connection error:', error);
        setTimeout(connectToWhatsApp, 10000);
    }
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/generate-code', async (req, res) => {
    const phoneNumber = req.body.phone?.replace(/[^0-9]/g, '');

    if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
        return res.status(400).json({ error: 'Numéro invalide' });
    }

    try {
        const { code } = await getCodeFromWASocket({
            phoneNumber,
            socketConfig: {
                logger: pino({ level: 'silent' })
            }
        });

        res.json({ code: code.match(/.{1,3}/g).join('-') });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/status', (req, res) => {
    res.json(connectionState);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    connectToWhatsApp();
});

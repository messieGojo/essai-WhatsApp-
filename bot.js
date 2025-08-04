const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

let sock;
let connectionStatus = { status: 'disconnected', qr: null, code: null };

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Serveur Node.js', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            connectionStatus = { status: 'qr', qr: qr, code: null };
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = { status: 'disconnected', qr: null, code: null };
            if (shouldReconnect) {
                // La reconnexion n'est pas gérée activement ici pour simplifier le flux de pairage.
                // L'utilisateur devra demander un nouveau code.
            }
        } else if (connection === 'open') {
            connectionStatus = { status: 'connected', qr: null, code: sock.user.id };
            console.log('Connexion réussie, ID:', sock.user.id);
        }
    });

    return sock;
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/generate-code', async (req, res) => {
    const phoneNumber = req.body.phone;

    if (!phoneNumber) {
        return res.status(400).json({ error: 'Le numéro de téléphone est requis.' });
    }
    
    if (!sock || sock.ev.listenerCount('connection.update') === 0) {
        await connectToWhatsApp();
    }
    
    try {
        if (!sock.user) {
            const formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
            const code = await sock.requestPairingCode(formattedNumber);
            connectionStatus = { status: 'pairing', qr: null, code: code };
            return res.json({ pairCode: code });
        } else {
            return res.status(400).json({ error: 'Un appareil est déjà connecté.' });
        }
    } catch (error) {
        console.error('Erreur lors de la génération du code:', error);
        return res.status(500).json({ error: 'Impossible de générer le code de pairage.' });
    }
});

app.get('/status', (req, res) => {
    res.json(connectionStatus);
});

app.listen(PORT, () => {
    console.log(`Le serveur est en écoute sur le port ${PORT}`);
    connectToWhatsApp().catch(err => console.error("Erreur initiale de connexion WhatsApp:", err));
});
  

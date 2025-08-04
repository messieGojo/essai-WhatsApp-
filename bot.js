const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

let sock;
let connectionState = { status: 'disconnected', code: null, message: 'Le service est prêt.' };

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Serveur Node.js', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            connectionState = { status: 'connected', code: sock.user.id, message: `Connecté avec succès à ${sock.user.id}` };
            console.log('Connexion réussie, ID:', sock.user.id);
        } else if (connection === 'close') {
            const isLoggedOut = lastDisconnect.error?.output?.statusCode === DisconnectReason.loggedOut;
            const message = isLoggedOut ? 'Appareil déconnecté.' : 'Connexion fermée. Redémarrage...';
            connectionState = { status: 'disconnected', code: null, message: message };
            console.log(message);
            if (!isLoggedOut) {
                setTimeout(connectToWhatsApp, 10000);
            }
        }
    });
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/generate-code', async (req, res) => {
    const phoneNumber = req.body.phone;

    if (!phoneNumber || !/^\+?[1-9]\d{1,14}$/.test(phoneNumber)) {
        return res.status(400).json({ message: 'Numéro de téléphone invalide.' });
    }

    if (sock && sock.user) {
        return res.status(400).json({ message: 'Un appareil est déjà connecté.' });
    }
    
    connectionState = { status: 'pairing', code: null, message: 'Demande de code de pairage en cours...' };
    res.status(202).json({ message: 'La génération du code a commencé. Veuillez patienter.' });

    try {
        const formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
        const code = await sock.requestPairingCode(formattedNumber);
        connectionState = { status: 'code_ready', code: code, message: 'Veuillez entrer ce code sur votre téléphone.' };
        console.log(`Code de pairage pour ${phoneNumber}: ${code}`);
    } catch (error) {
        console.error('Erreur lors de la génération du code:', error);
        connectionState = { status: 'error', code: null, message: 'Impossible de générer le code. Réessayez.' };
    }
});

app.get('/status', (req, res) => {
    res.json(connectionState);
});

app.listen(PORT, () => {
    console.log(`Le serveur est en écoute sur le port ${PORT}`);
    connectToWhatsApp().catch(err => console.error("Erreur initiale de connexion WhatsApp:", err));
});

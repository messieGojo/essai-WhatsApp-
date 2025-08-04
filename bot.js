const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

let sock;
let connectionState = { status: 'disconnected', code: null, message: 'Le service est prêt.' };

const AUTH_FOLDER = 'auth_info_baileys';

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

        sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true, // Activer pour le débogage
            auth: state,
            browser: ['Serveur Node.js', 'Chrome', '1.0.0']
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                connectionState = { status: 'waiting', code: null, message: 'Scannez le QR Code' };
                console.log('QR Code disponible pour scan');
            }

            if (connection === 'open') {
                connectionState = { 
                    status: 'connected', 
                    code: sock.user?.id, 
                    message: `Connecté avec succès à ${sock.user?.id || 'inconnu'}` 
                };
                console.log('Connexion réussie');
            } else if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                const message = shouldReconnect ? 'Connexion fermée. Redémarrage...' : 'Appareil déconnecté.';
                connectionState = { status: 'disconnected', code: null, message: message };
                console.log(message);
                if (shouldReconnect) {
                    setTimeout(connectToWhatsApp, 10000);
                }
            }
        });
    } catch (error) {
        console.error('Erreur de connexion:', error);
        connectionState = { status: 'error', code: null, message: 'Erreur de connexion: ' + error.message };
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
        return res.status(400).json({ message: 'Numéro de téléphone invalide.' });
    }
    
    if (sock && connectionState.status === 'connected') {
        return res.status(400).json({ 
            message: `Un appareil est déjà connecté. Veuillez d'abord le déconnecter.` 
        });
    }

    try {
        // Utilisez la même socket si elle existe
        if (!sock) {
            const { state } = await useMultiFileAuthState(AUTH_FOLDER);
            sock = makeWASocket({
                logger: pino({ level: 'silent' }),
                printQRInTerminal: true,
                auth: state
            });
        }

        const code = await sock.requestRegistrationCode(phoneNumber, {
            method: 'sms', // ou 'voice'
            length: 6
        });

        res.json({ code: code.match(/.{1,3}/g).join('-') });
        console.log(`Code de vérification demandé pour: ${phoneNumber}`);
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ 
            message: 'Erreur: ' + (error.message || 'Impossible de générer le code') 
        });
    }
});

app.get('/status', (req, res) => {
    res.json(connectionState);
});

app.listen(PORT, () => {
    console.log(`Serveur en écoute sur ${PORT}`);
    connectToWhatsApp().catch(console.error);
});

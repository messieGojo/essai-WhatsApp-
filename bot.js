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
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

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
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            const message = shouldReconnect ? 'Connexion fermée. Redémarrage...' : 'Appareil déconnecté.';
            connectionState = { status: 'disconnected', code: null, message: message };
            console.log(message);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 10000);
            } else {
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

    if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber.replace(/[^0-9]/g, ''))) {
        return res.status(400).json({ message: 'Numéro de téléphone invalide.' });
    }
    
    if (sock && sock.user) {
        return res.status(400).json({ message: `Un appareil est déjà connecté : ${sock.user.id}. Veuillez d'abord le déconnecter.` });
    }

    try {
        const tempSock = makeWASocket({
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false
        });
        
        console.log(`Demande de code de pairage pour le numéro : ${phoneNumber}`);
        const code = await tempSock.requestPairingCode(phoneNumber);

        const formattedCode = code.match(/.{1,4}/g).join('-');
        
        res.json({ code: formattedCode });
        console.log(`Code de pairage généré : ${formattedCode}`);

    } catch (error) {
        console.error('Erreur lors de la génération du code:', error);
        res.status(500).json({ message: 'Impossible de générer le code. Le numéro est-il bien un numéro WhatsApp valide ?' });
    }
});


app.get('/status', (req, res) => {
    res.json(connectionState);
});

app.listen(PORT, () => {
    console.log(`Le serveur est en écoute sur le port ${PORT}`);
    connectToWhatsApp().catch(err => console.error("Erreur initiale de connexion WhatsApp:", err));
});
              

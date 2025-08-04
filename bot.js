const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const express = require('express')
const path = require('path')
const fs = require('fs')
const pino = require('pino')
const aiCommand = require('./commands/ai')

const app = express()
const PORT = process.env.PORT || 3000

let sock
let connectionState = { status: 'disconnected', code: null, message: 'Service prêt' }

app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static(path.join(__dirname)))

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'))
})

app.post('/generate-code', async (req, res) => {
    const phoneNumber = req.body.phone
    if (!phoneNumber || !/^\+?[1-9]\d{1,14}$/.test(phoneNumber)) {
        return res.status(400).json({ message: 'Numéro invalide' })
    }

    if (fs.existsSync('./auth_info_baileys')) {
        fs.rmSync('./auth_info_baileys', { recursive: true, force: true })
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['CyberCodex', 'Chrome', '1.0.0'],
        logger: pino({ level: 'silent' }),
        syncFullHistory: false
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            connectionState = { status: 'connected', code: sock.user.id, message: `Connecté à ${sock.user.id}` }
        } else if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode
            const loggedOut = code === DisconnectReason.loggedOut
            connectionState = { status: 'disconnected', code: null, message: loggedOut ? 'Déconnecté' : 'Déconnecté. Reconnexion...' }
        }
    })

    try {
        connectionState = { status: 'pairing', code: null, message: 'Génération du code...' }
        const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''))
        connectionState = { status: 'code_ready', code, message: 'Entrez ce code sur WhatsApp' }
        res.status(200).json({ code })
    } catch (err) {
        connectionState = { status: 'error', code: null, message: 'Erreur lors du code' }
        res.status(500).json({ message: 'Erreur lors de la génération du code' })
    }
})

app.get('/status', (req, res) => {
    res.json(connectionState)
})

app.listen(PORT, () => {
    console.log(`Serveur actif sur le port ${PORT}`)
})

const express = require('express');
const axios = require('axios');
const mime = require('mime-types');  
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const qrcode = require('qrcode');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
require('dotenv').config();


const { Client, Location, Poll, List, Buttons, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const app = express();
const port = 3000;
const jwtSecret = process.env.JWT_SECRET || 'fallback_secret';
app.use(express.json());

// --- CONFIGURACIÓN DEL CLIENTE ---
const client = new Client({
    authStrategy: new LocalAuth(),
    // proxyAuthentication: { username: 'username', password: 'password' },
    puppeteer: { 
        // args: ['--proxy-server=proxy-server-that-requires-authentication.example.com'],
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let qrCodeData = null;

// --- EVENTOS DE WHATSAPP ---

client.on('loading_screen', (percent, message) => {
    console.log('LOADING SCREEN', percent, message);
});

client.on('qr', (qr) => {
    console.log('NUEVO QR RECIBIDO');
    qrCodeData = qr; 
});

client.on('authenticated', () => {
    console.log('AUTENTICADO CORRECTAMENTE');
    qrCodeData = null; // Limpiar QR una vez autenticado
});

client.on('auth_failure', msg => {
    console.error('ERROR DE AUTENTICACIÓN', msg);
});

client.on('ready', async () => {
    console.log('CLIENTE LISTO');
    const debugWWebVersion = await client.getWWebVersion();
    console.log(`Versión de WWeb: ${debugWWebVersion}`);
});

client.on('message', async msg => {
    // Comandos básicos de respuesta
    console.log('MESSAGE RECEIVED', msg);
    // if (msg.body === '!ping') {
    //     client.sendMessage(msg.from, 'pong');
    // }
    
    // if (msg.body.startsWith('!sendto ')) {
    //     let [_, number, ...messageParts] = msg.body.split(' ');
    //     let message = messageParts.join(' ');
    //     let formattedNumber = number.includes('@c.us') ? number : `${number}@c.us`;
    //     client.sendMessage(formattedNumber, message);
    // }
});

client.on('disconnected', async (reason) => {
    console.log('Cliente desconectado', reason);
    qrCodeData = null;
    // Intento de reinicio automático vía PM2 si está disponible
    setTimeout(() => {
        exec('pm2 restart all');
    }, 5000);
});

// --- MIDDLEWARE Y RUTAS API ---

const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, jwtSecret, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

app.post('/login', (req, res) => {
    const { username } = req.body;
    if(username === 'vicenteriverodexa') {
        const user = { name: username };
        const accessToken = jwt.sign(user, jwtSecret);
        return res.json({ accessToken });
    }
    res.sendStatus(401);
});

app.get('/qr', authenticateToken, (req, res) => {
    if (qrCodeData) {
        qrcode.toDataURL(qrCodeData, (err, src) => {
            if (err) return res.status(500).send('Error generando QR');
            res.send(`<html><body><h1>Escanea el QR</h1><img src="${src}" /></body></html>`);
        });
    } else {
        res.send('QR no disponible. El cliente ya podría estar conectado.');
    }
});

app.post('/send-message', authenticateToken, async (req, res) => {
    const { number, message, mediaUrl } = req.body;

    try {
        // Formato para México (52 + 1 + número)
        const chatId = `521${number}@c.us`;

        if (mediaUrl) {
            const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
            const mimeType = mime.lookup(mediaUrl) || 'image/jpeg';
            const media = new MessageMedia(mimeType, Buffer.from(response.data).toString('base64'));
            
            await client.sendMessage(chatId, media, { caption: message || '' });
        } else {
            await client.sendMessage(chatId, message);
        }

        res.status(200).json({ status: 'success', message: 'Enviado correctamente' });
    } catch (error) {
        console.error('Error en send-message:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});
app.post('/send-group-by-name', authenticateToken, async (req, res) => {
    const { groupName, message, mediaUrl } = req.body;

    try {
        // En lugar de getChats(), obtenemos los diálogos activos
        // Si falla, intentamos una estrategia de búsqueda por iteración
        const chats = await client.getChats(); 
        
        let targetGroup = chats.find(chat => 
            chat.isGroup && chat.name.toLowerCase() === groupName.toLowerCase()
        );

        if (!targetGroup) {
            return res.status(404).json({ 
                status: 'error', 
                message: `No se encontró el grupo "${groupName}". Asegúrate de que el bot tenga un mensaje reciente en ese grupo.` 
            });
        }

        const chatId = targetGroup.id._serialized;

        if (mediaUrl) {
            const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
            const media = new MessageMedia(
                mime.lookup(mediaUrl) || 'image/jpeg', 
                Buffer.from(response.data).toString('base64')
            );
            await client.sendMessage(chatId, media, { caption: message });
        } else {
            await client.sendMessage(chatId, message);
        }

        res.json({ status: 'success', group: targetGroup.name, id: chatId });

    } catch (error) {
        console.error('Error detallado:', error);
        res.status(500).json({ 
            status: 'error', 
            message: "Error de sincronización con WhatsApp. Intenta enviar un mensaje manual al grupo primero." 
        });
    }
});
// --- FUNCIONES DE LIMPIEZA Y ARRANQUE ---

const deleteFoldersSync = (folderPath) => {
    if (fs.existsSync(folderPath)) {
        try {
            // Uso de fs.rmSync para asegurar que se borre antes de seguir
            fs.rmSync(folderPath, { recursive: true, force: true });
            console.log(`Eliminado: ${folderPath}`);
        } catch (err) {
            console.error(`No se pudo eliminar ${folderPath}:`, err.message);
        }
    }
};

app.listen(port, () => {
    console.log(`Servidor API en puerto ${port}`);
    
    const authFolderPath = path.join(__dirname, '.wwebjs_auth');
    const cacheFolderPath = path.join(__dirname, '.wwebjs_cache');

    // Limpiamos carpetas para evitar conflictos de sesión corrupta
    deleteFoldersSync(authFolderPath);
    deleteFoldersSync(cacheFolderPath);

    // Inicialización del cliente de WhatsApp
    client.initialize().catch(err => console.error("Error al inicializar cliente:", err));
});
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const mysql = require('mysql2');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
const webhookhavuzu = new Map();
const olusturmakilitleri = new Set();
const dcclient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});
dcclient.once('clientReady', () => {
    dcclient.user.setPresence({
        activities: [{ name: 'of course its all under control' }],
        status: 'dnd'
    });
    console.log(`${dcclient.user.tag} aktif ve izlemede.`);
    setTimeout(kanallitemizle, 10000);
    setInterval(kanallitemizle, 12 * 60 * 60 * 1000);
});

dcclient.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("Discord Bot giriş hatası:", err);
});

const app = express();
const serverhttp = http.createServer(app);
const pool = mysql.createPool({
    host: process.env.MYSQLHOST || 'localhost',
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD || '',
    database: process.env.MYSQLDATABASE || 'railway',
    port: process.env.MYSQLPORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
}).promise();

async function initdb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                naoyaindex VARCHAR(50) PRIMARY KEY,
                token VARCHAR(100),
                nick VARCHAR(100),
                foto TEXT,
                status INT DEFAULT 1
            )
        `);
        console.log("MySQL Tablosu Hazır (Volume Aktif)");
    } catch (err) {
        console.error("DB Başlatma Hatası:", err);
    }
}
initdb();

const io = new Server(serverhttp, {
    pingTimeout: 60000,
    pingInterval: 25000,
    cors: {
        origin: (origin, callback) => {
            if (!origin || origin.includes("gartic.io")) {
                callback(null, true);
            } else {
                callback(new Error("Access denied"));
            }
        },
        methods: ["GET", "POST"]
    }
});
async function ipbilgisi(socket, naoyaindex, oda) {
    if (
        yetkililer.includes(String(naoyaindex)) ||
        zenins.includes(String(naoyaindex))
    ) {
        return "";
    }

    let ip =
        socket.handshake.headers['cf-connecting-ip'] ||
        socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        socket.handshake.address ||
         "";

    ip = ip.replace(/^::ffff:/, '');

    if (!ip || ip === '127.0.0.1' || ip === '::1') {
        return "";
    }

    const cachekey = `${oda}:${ip}`;

    if (ipcache.has(cachekey)) {
        return ipcache.get(cachekey);
    }

    try {
        const { data } = await axios.get(
            `https://ipinfo.io/${ip}/json?token=${process.env.IPINFO_TOKEN}`
        );

        const sonuc =
            `ip: ${ip} | ${data.country || "?"} / ${data.region || "?"} / ${data.city || "?"}`;

        ipcache.set(cachekey, sonuc);

        return sonuc;
    } catch {
        return `ip: ${ip}`;
    }
}
async function kanallitemizle() {
    const guildid = process.env.GUILD_ID;
    if (!guildid) return;

    try {
        const guild = await dcclient.guilds.fetch(guildid);
        if (!guild) return;

        const kanallar = await guild.channels.fetch();
        const suan = Date.now();
        const otuzgunmilisaniye = 30 * 24 * 60 * 60 * 1000; 

        for (const [id, kanal] of kanallar) {
            if (kanal.type === 0) {
                try {
                    const mesajlar = await kanal.messages.fetch({ limit: 1 });
                    const sonmesaj = mesajlar.first();
                    
                    let sonaktiflik = kanal.createdTimestamp;
                    if (sonmesaj) {
                        sonaktiflik = sonmesaj.createdTimestamp;
                    }

                    if (suan - sonaktiflik > otuzgunmilisaniye) {
                        await kanal.delete("30 gün boyunca işlem yapılmadığı için otomatik silindi.");
                        console.log(`${kanal.name} kanalı pasiflik nedeniyle yok edildi.`);
                        webhookhavuzu.delete(kanal.name);
                        olusturmakilitleri.delete(kanal.name);
                    }
                } catch (kanalhatasi) {
                    console.error(`${kanal.name} kontrol edilirken hata oluştu:`, kanalhatasi);
                }
            }
        }
    } catch (hata) {
        console.error("kanal temizleme döngüsünde genel hata:", hata);
    }
}
async function discordlogla(nick, foto, mesaj, oda, extrabilgi = "") {
    const guildid = process.env.GUILD_ID;
    if (!guildid) return;

    const kanaladi = `oda-${oda}`.toLowerCase();

    if (olusturmakilitleri.has(kanaladi)) {
        setTimeout(() => discordlogla(nick, foto, mesaj, oda), 300);
        return;
    }

    try {
        const guild = await dcclient.guilds.fetch(guildid);
        if (!guild) return;

        let aktifwebhook = webhookhavuzu.get(kanaladi);

        if (!aktifwebhook) {
            olusturmakilitleri.add(kanaladi);

            const kanallar = await guild.channels.fetch();
            let hedefkanal = kanallar.find(c => c.name === kanaladi && c.type === 0);

            if (!hedefkanal) {
                hedefkanal = await guild.channels.create({
                    name: kanaladi,
                    type: 0
                });
            }

            const mevcutwebhooklar = await hedefkanal.fetchWebhooks();
            // HATA ÇÖZÜMÜ: Sadece geçerli token'a sahip olan webhook'u alıyoruz.
            aktifwebhook = mevcutwebhooklar.find(wh => wh.token);

            if (!aktifwebhook) {
                aktifwebhook = await hedefkanal.createWebhook({
                    name: "zeninsabitlog" 
                });
            }
            
            webhookhavuzu.set(kanaladi, aktifwebhook);
            olusturmakilitleri.delete(kanaladi);
        }

      let profilresmi = undefined;
        if (foto !== undefined && foto !== null && foto !== "") {
            const temizfoto = String(foto).trim();
            if (temizfoto.startsWith("http")) {
                profilresmi = temizfoto;
            } else if (!isNaN(temizfoto) && temizfoto !== "") {
                profilresmi = `https://raw.githubusercontent.com/kingofhell0666/blksdjslkdjfgvs/refs/heads/main/${temizfoto}.png`;
            }
        }

        const saniyepoch = Math.floor(Date.now() / 1000);
        const zenginmesaj = `${mesaj} <t:${saniyepoch}:t>\n${extrabilgi}`;
        
        await aktifwebhook.send({
            content: zenginmesaj,
            username: nick.substring(0, 32) || "Log",
            avatarURL: profilresmi
        });

    } catch (hata) {
        console.error(" loglama döngü hatası:", hata);
        webhookhavuzu.delete(kanaladi);
        olusturmakilitleri.delete(kanaladi);
    }
}
const izleyicilistesi = new Map();
const socketdata = new Map();
const ipcache = new Map();
const yetkililer = ["10074131","11518347","10257356","11719040","10673780","6138826","9105931","11250797","9968677","12470476"];
const sir = "zenin-ozel-anahtar-123-cok-gizli";
const zenins = ["10074131","11518347","10257356","11719040","10673780","6138826","9105931","11250797","12470476"];
const mp3listesi = [
    "https://github.com/melascurixx-dot/bru-wut/raw/refs/heads/main/iori-symbol.mp3"
];

function zeninsifrele() {
    const rastgeleses = mp3listesi[Math.floor(Math.random() * mp3listesi.length)];
    const veri = JSON.stringify({
        ids: zenins,
        sesler: [rastgeleses]
    });

    const iv = crypto.randomBytes(16);
    const anahtar = crypto.createHash('sha256').update(sir).digest();
    const cipher = crypto.createCipheriv('aes-256-cbc', anahtar, iv);
    
    let sifreli = cipher.update(veri, 'utf8', 'base64');
    sifreli += cipher.final('base64');
    
    return `${iv.toString('base64')}.${sifreli}`;
}

function yetkilisifrele() {
    const veri = JSON.stringify(yetkililer);
    const iv = crypto.randomBytes(16);
    const anahtar = crypto.createHash('sha256').update(sir).digest(); 
    const cipher = crypto.createCipheriv('aes-256-cbc', anahtar, iv);
    let sifreli = cipher.update(veri, 'utf8', 'base64');
    sifreli += cipher.final('base64');
    return `${iv.toString('base64')}.${sifreli}`;
}

io.on('connection', (socket) => {
    socket.on('zeninkatil', async (odakodu, naoyaindex, naoyafoto, naoyanick, clienttoken) => {
        if (!odakodu) return;

        await socket.join(odakodu);

        if (!naoyaindex || naoyaindex == 0) {
            if (clienttoken) {
                try {
                    const tokenlar = String(clienttoken).split(',').map(t => t.trim());
                    const [izleyiciler] = await pool.query(
                        "SELECT naoyaindex, nick, foto FROM users WHERE token IN (?) LIMIT 1", 
                        [tokenlar]
                    );

                    if (izleyiciler.length > 0) {
                        const izleyici = izleyiciler[0];
                        const isadmin = yetkililer.includes(String(izleyici.naoyaindex));
                        
                        if (!isadmin) {
                            izleyicilistesi.set(socket.id, { 
                                nick: izleyici.nick, 
                                foto: izleyici.foto, 
                                oda: odakodu 
                            });

                            io.to(odakodu).emit('zeninizleyiciguncelle', { 
                                tip: 'katildi', 
                                sid: socket.id, 
                                nick: izleyici.nick, 
                                foto: izleyici.foto 
                            });
                        }
                    }
                } catch (hata) {
                    console.error("izleyici tarama hatası:", hata);
                }
            }
            socket.emit('yetkililer', yetkilisifrele());
            socket.emit('zeninozeller', zeninsifrele());
            return;
        }

        const sindex = String(naoyaindex).trim();

        try {
            const [rows] = await pool.query("SELECT * FROM users WHERE naoyaindex = ?", [sindex]);
            const user = rows[0];

            if (!user) {
                const newtoken = crypto.randomBytes(16).toString('hex');
                await pool.query("INSERT INTO users (naoyaindex, token, nick, foto) VALUES (?, ?, ?, ?)", 
                    [sindex, newtoken, naoyanick, naoyafoto]);

                socketdata.set(socket.id, {
                    naoyaindex: sindex,
                    token: newtoken,
                    room: odakodu,
                    nick: naoyanick,
                    foto: naoyafoto,
                    msgcount: 0,
                    windowstart: Date.now(),
                    muteduntil: 0
                });

                if (!zenins.includes(sindex)) {
                    const extrabilgi = await ipbilgisi(socket, sindex, odakodu);
                    discordlogla(
                        naoyanick,
                        naoyafoto,
                        `yeni kayıt oluşturdu ve odaya katıldı`,
                        odakodu,
                        extrabilgi
                    );
                }

                socket.emit('zeninauthekrani', { type: 'new', token: newtoken, msg: "yeni kimlik oluşturuldu" });
                socket.emit('yetkililer', yetkilisifrele());
                socket.emit('zeninozeller', zeninsifrele());

                if (!yetkililer.includes(sindex)) {
                    io.to(odakodu).emit('zeninkullaniciguncelle', {
                        tip: 'katildi',
                        nick: naoyanick,
                        id: sindex,
                        foto: naoyafoto
                    });
                }
            } else {
                const temiztoken = clienttoken ? String(clienttoken).trim() : "";

                if (temiztoken && user.token === temiztoken) {
                    await pool.query("UPDATE users SET nick = ?, foto = ? WHERE naoyaindex = ?", 
                        [naoyanick || user.nick, naoyafoto || user.foto, sindex]);

                    socketdata.set(socket.id, {
                        naoyaindex: sindex,
                        token: user.token,
                        room: odakodu,
                        nick: naoyanick || user.nick,
                        foto: naoyafoto || user.foto,
                        msgcount: 0,
                        windowstart: Date.now(),
                        muteduntil: 0
                    });
                    
                    if (!zenins.includes(sindex)) {
                        const extrabilgi = await ipbilgisi(socket, sindex, odakodu);
                        discordlogla(
                            naoyanick || user.nick,
                            naoyafoto || user.foto,
                            `odaya katıldı`,
                            odakodu,
                            extrabilgi
                        );
                    }
                    socket.emit('zeninauthbasarili');
                    socket.emit('yetkililer', yetkilisifrele());
                    socket.emit('zeninozeller', zeninsifrele());

                    if (!yetkililer.includes(sindex)) {
                        io.to(odakodu).emit('zeninkullaniciguncelle', {
                            tip: 'katildi',
                            nick: naoyanick || user.nick,
                            id: sindex,
                            foto: naoyafoto || user.foto
                        });
                    } else {
                        const mevcutlar = Array.from(socketdata.values())
                            .filter(u => u.room === odakodu && !yetkililer.includes(u.naoyaindex));
                        socket.emit('zeninmevcutliste', mevcutlar);
                    }

                    if (zenins.includes(sindex)) {
                        setTimeout(() => {
                            io.to(odakodu).emit('zeningirdi', {
                                id: sindex,
                                nick: naoyanick || user.nick
                            });
                        }, 200);
                    }
                } else {
                    socket.emit('zeninauthekrani', { 
                        type: 'input', 
                        msg: clienttoken ? "girilen token hatalı veya eksik" : "bu id kayıtlı sana verilen tokeni gir eğer doğru girmene rağmen hata alıyorsan veya hatırlamıyorsan discord: solusinapice" 
                    });
                    socket.emit('yetkililer', yetkilisifrele());
                    socket.emit('zeninozeller', zeninsifrele());
                }
            }
        } catch (dberr) {
            console.error("sistem hatası:", dberr);
        }
    });

    socket.on('zeninmesajat', (data) => {
        const userdata = socketdata.get(socket.id);
        if (!userdata || !data.token) return;

        const gelentoken = String(data.token).trim();
        if (gelentoken !== userdata.token) return;
       
        const isadmin = yetkililer.includes(userdata.naoyaindex);
        const now = Date.now();
        
        if (!isadmin) {
            if (now < userdata.muteduntil) return;

            if (now - userdata.windowstart > 2000) {
                userdata.windowstart = now;
                userdata.msgcount = 1;
            } else {
                userdata.msgcount++;
            }

            if (userdata.msgcount > 10) {
                userdata.muteduntil = now + 10000;
                socket.emit('errormsg', 'sakin ol ufaklık 10 saniye susturuldun');
                return;
            }
        }

        if (userdata.room) {
            let mesaj = String(data.msg).trim();

            if (mesaj.startsWith('<')) {
                mesaj = mesaj.substring(1).trim();
                if (mesaj === "") return;
            }

            const regex = /^\/\(([^)]+)\)\s*(.*)$/;
            const match = mesaj.match(regex);

            if (match) {
                const hedefnick = match[1].trim();
                const safmesaj = match[2].trim();
                
                if (safmesaj === "") return;

                const hedefkullanici = Array.from(socketdata.entries()).find(([sid, u]) => 
                    u.room === userdata.room && u.nick === hedefnick
                );

                if (hedefkullanici) {
                    const hedefsodid = hedefkullanici[0];

                    if (socket.id !== hedefsodid) {
                        io.to(hedefsodid).emit('zeninmesajlar', {
                            nick: `[${userdata.nick}] kişisinden sana`,
                            msg: safmesaj,
                            senderid: userdata.naoyaindex,
                            zeninpfp: userdata.foto,
                            room: userdata.room,
                            private: true
                        });

                        socket.emit('zeninmesajlar', {
                            nick: `benden [${hedefnick}] kişisine`,
                            msg: safmesaj,
                            senderid: userdata.naoyaindex,
                            zeninpfp: userdata.foto,
                            room: userdata.room,
                            private: true
                        });
                    } else {
                        socket.emit('zeninmesajlar', {
                            nick: `benden kendime`,
                            msg: safmesaj,
                            senderid: userdata.naoyaindex,
                            zeninpfp: userdata.foto,
                            room: userdata.room,
                            private: true
                        });
                    }

                    Array.from(socketdata.entries()).forEach(([sid, u]) => {
                        if (u.room === userdata.room && zenins.includes(u.naoyaindex)) {
                            if (sid !== socket.id && sid !== hedefsodid) {
                                io.to(sid).emit('zeninmesajlar', {
                                    nick: `${userdata.nick} -> ${hedefnick}`,
                                    msg: safmesaj,
                                    senderid: userdata.naoyaindex,
                                    zeninpfp: userdata.foto,
                                    room: userdata.room,
                                    private: true
                                });
                            }
                        }
                    });

                    discordlogla(userdata.nick, userdata.foto, `*(${hedefnick} kişisine fısıldadı):* ${safmesaj}`, userdata.room);
                }
            } else {
                io.to(userdata.room).emit('zeninmesajlar', {
                    nick: userdata.nick,
                    msg: data.msg,
                    senderid: userdata.naoyaindex,
                    zeninpfp: userdata.foto,
                    room: userdata.room
                });

                discordlogla(userdata.nick, userdata.foto, data.msg, userdata.room);
            }
        }
    });
    socket.on('disconnect', () => {
        const userdata = socketdata.get(socket.id);
        if (userdata) {
            if (!yetkililer.includes(userdata.naoyaindex)) {
                io.to(userdata.room).emit('zeninkullaniciguncelle', {
                    tip: 'ayrildi',
                    id: userdata.naoyaindex
                });
            }
            socketdata.delete(socket.id);
        }
        
        const izleyici = izleyicilistesi.get(socket.id);
        if (izleyici) {
            io.to(izleyici.oda).emit('zeninizleyiciguncelle', { 
                tip: 'ayrildi', 
                sid: socket.id 
            });
            izleyicilistesi.delete(socket.id);
        }
    });
});

const port = process.env.PORT || 8080;
serverhttp.listen(port, "0.0.0.0", () => {
    console.log(`ZENIN Sunucu Port ${port} üzerinde aktif`);
});

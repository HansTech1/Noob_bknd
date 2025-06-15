import mineflayer from 'mineflayer';

export class BotInstance {
  constructor({ id, userId, serverIp, serverPort = 25565, username }) {
    this.id = id;
    this.userId = userId;
    this.serverIp = serverIp;
    this.serverPort = serverPort;
    this.username = username || `NoobBot_${Math.random().toString(36).substring(2, 8)}`;
    this.state = 'idle';
    this.logs = [];
    this.commandHistory = [];
    this.bot = null;
    this.wsClients = new Set();
    this.lastCommandAt = null;
    this.error = null;
    this.chatInterval = null;
    this.moveInterval = null;
    this.attackInterval = null;
  }

  log(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 1000) this.logs.shift();
    console.log(`Bot[${this.id}]: ${msg}`);

    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ type: 'log', botId: this.id, message: line }));
        } catch (err) {
          console.error('Erreur WebSocket log :', err);
        }
      }
    }
  }

  getInfo() {
    return {
      id: this.id,
      userId: this.userId,
      username: this.username,
      serverIp: this.serverIp,
      serverPort: this.serverPort,
      state: this.state,
      lastCommandAt: this.lastCommandAt,
      error: this.error,
      logs: this.logs.slice(-20),
      commandHistory: this.commandHistory.slice(-10),
    };
  }

  spawn() {
    if (this.bot) {
      this.log('Bot déjà existant, déconnexion...');
      this.disconnect();
    }

    this.state = 'connecting';
    this.error = null;
    this.log(`Connexion à ${this.serverIp}:${this.serverPort} en tant que ${this.username}...`);

    try {
      this.bot = mineflayer.createBot({
        host: this.serverIp,
        port: this.serverPort,
        username: this.username,
        version: false,
        auth: 'offline',
        hideErrors: false,
      });

      const timeout = setTimeout(() => {
        if (this.state === 'connecting') {
          this.log('⏱️ Timeout de connexion');
          this.state = 'error';
          this.error = 'Timeout de connexion';
          if (this.bot) this.bot.quit();
        }
      }, 30000);

      this.bot.once('login', () => {
        clearTimeout(timeout);
        this.state = 'connected';
        this.log('✅ Connecté avec succès');
        this.startRandomBehavior();
      });

      this.bot.once('end', (reason) => {
        clearTimeout(timeout);
        this.state = 'disconnected';
        this.log(`🔌 Déconnecté : ${reason || 'Raison inconnue'}`);
        this.stopBehavior();
      });

      this.bot.once('error', (err) => {
        clearTimeout(timeout);
        this.state = 'error';
        this.error = err.message || String(err);
        this.log(`❌ Erreur : ${this.error}`);
        this.stopBehavior();
      });

      this.bot.on('chat', (username, message) => {
        const chatLog = `[CHAT] <${username}> ${message}`;
        this.log(chatLog);

        for (const ws of this.wsClients) {
          if (ws.readyState === 1) {
            try {
              ws.send(JSON.stringify({
                type: 'chat',
                botId: this.id,
                username,
                message
              }));
            } catch (err) {
              console.error('Erreur WebSocket chat :', err);
            }
          }
        }
      });

      this.bot.on('kicked', (reason) => {
        this.log(`🚫 Expulsé : ${reason}`);
        this.state = 'error';
        this.error = `Expulsé : ${reason}`;
      });

    } catch (err) {
      this.state = 'error';
      this.error = err.message || String(err);
      this.log(`❌ Création échouée : ${this.error}`);
    }
  }

  startRandomBehavior() {
    if (!this.bot || this.state !== 'connected') return;

    const randomChats = [
      "Y'a t-il quelqu'un ?",
      "Quelqu’un dans les parages ?",
      "Je visite la zone 👀",
      "Je teste un peu ce serveur.",
      "C’est calme ici 😶",
      "Hmm, personne ?",
      "J’avance un peu...",
      "Ce monde est grand !",
      "Hello ?"
    ];

    const hostileMobs = ['zombie', 'skeleton', 'creeper', 'spider', 'witch'];

    this.chatInterval = setInterval(() => {
      if (this.bot && this.state === 'connected') {
        const msg = randomChats[Math.floor(Math.random() * randomChats.length)];
        this.bot.chat(msg);
        this.log(`💬 Message auto : ${msg}`);
      }
    }, 900000 + Math.random() * 600000); // 15–25 minutes

    this.moveInterval = setInterval(() => {
      if (!this.bot || this.state !== 'connected') return;

      const directions = ['forward', 'back', 'left', 'right'];
      const dir = directions[Math.floor(Math.random() * directions.length)];

      this.bot.setControlState(dir, true);
      this.log(`🚶 Bouge vers : ${dir}`);

      setTimeout(() => {
        if (this.bot) this.bot.setControlState(dir, false);
      }, 1000 + Math.random() * 1000);
    }, 5000 + Math.random() * 5000); // 5–10 secondes

    this.attackInterval = setInterval(() => {
      if (!this.bot || this.state !== 'connected') return;

      const entity = this.bot.nearestEntity(e =>
        e.type === 'mob' &&
        hostileMobs.includes(e.name) &&
        this.bot.entity.position.distanceTo(e.position) < 10
      );

      if (entity) {
        try {
          this.bot.lookAt(entity.position.offset(0, entity.height, 0), true, () => {
            this.bot.attack(entity);
            this.log(`⚔️ Attaque de ${entity.name}`);
          });
        } catch (err) {
          this.log(`❌ Erreur d’attaque : ${err.message}`);
        }
      }
    }, 30000 + Math.random() * 15000); // 30–45 secondes
  }

  stopBehavior() {
    if (this.chatInterval) clearInterval(this.chatInterval);
    if (this.moveInterval) clearInterval(this.moveInterval);
    if (this.attackInterval) clearInterval(this.attackInterval);
    this.chatInterval = this.moveInterval = this.attackInterval = null;
  }

  sendCommand(command) {
    if (this.state !== 'connected' || !this.bot) {
      this.log('❌ Bot non connecté');
      return false;
    }

    this.lastCommandAt = new Date();
    this.commandHistory.push({ command, timestamp: this.lastCommandAt });
    this.log(`💬 Commande envoyée : ${command}`);

    try {
      this.bot.chat(command);
      return true;
    } catch (err) {
      this.log(`❌ Erreur d’envoi : ${err.message}`);
      return false;
    }
  }

  disconnect() {
    this.stopBehavior();

    if (this.bot) {
      try {
        if (this.state === 'connected' || this.state === 'connecting') {
          this.bot.quit('Déconnecté par l’utilisateur');
        }
      } catch (err) {
        this.log(`❌ Erreur déconnexion : ${err.message}`);
      }
      this.bot = null;
    }

    if (this.state !== 'error') {
      this.state = 'disconnected';
    }

    this.log('🔌 Bot déconnecté.');
  }

  attachWS(ws) {
    this.wsClients.add(ws);
    this.log(`🔗 Client WS connecté (${this.wsClients.size})`);
  }

  detachWS(ws) {
    this.wsClients.delete(ws);
    this.log(`❌ Client WS déconnecté (${this.wsClients.size})`);
  }
}

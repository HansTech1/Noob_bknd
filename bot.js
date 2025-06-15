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
      this.log('Déconnexion du bot existant...');
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
        auth: 'offline',
        version: false,
      });

      const connectionTimeout = setTimeout(() => {
        if (this.state === 'connecting') {
          this.log('⏱ Timeout de connexion.');
          this.state = 'error';
          this.error = 'Timeout de connexion';
          this.bot.quit();
        }
      }, 30000);

      this.bot.once('login', () => {
        clearTimeout(connectionTimeout);
        this.state = 'connected';
        this.log('✅ Bot connecté avec succès !');
        this.startRandomBehavior();
      });

      this.bot.once('end', (reason) => {
        clearTimeout(connectionTimeout);
        this.state = 'disconnected';
        this.log(`🔌 Déconnecté : ${reason || 'Raison inconnue'}`);
        this.stopBehavior();
      });

      this.bot.once('error', (err) => {
        clearTimeout(connectionTimeout);
        this.state = 'error';
        this.error = err.message || String(err);
        this.log(`❌ Erreur de connexion : ${this.error}`);
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
        this.log(`⚠️ Bot expulsé : ${reason}`);
        this.state = 'error';
        this.error = `Expulsé : ${reason}`;
      });

    } catch (err) {
      this.state = 'error';
      this.error = err.message || String(err);
      this.log(`❌ Erreur de création du bot : ${this.error}`);
    }
  }

  // 💬 + 🤖 Chat et mouvements aléatoires
  startRandomBehavior() {
    if (!this.bot || this.state !== 'connected') return;

    const randomChats = [
      "Y'a t-il quelqu'un ?",
      "Salut les amis.",
      "Je découvre ce serveur 😄",
      "Quelqu’un veut papoter ?",
      "Explorons un peu.",
      "Pas mal ici.",
      "Je suis nouveau ici !",
      "Serveur calme aujourd'hui...",
      "Qui est là ?",
      "Un jour parfait pour jouer."
    ];

    // 💬 Message toutes les 20 min
    this.chatInterval = setInterval(() => {
      if (this.bot && this.state === 'connected') {
        const msg = randomChats[Math.floor(Math.random() * randomChats.length)];
        this.bot.chat(msg);
        this.log(`🗨️ Chat auto : ${msg}`);
      }
    }, 20 * 60 * 1000); // 20 minutes

    // 🤖 Mouvement toutes les 15 sec
    const directions = ['forward', 'back', 'left', 'right'];
    this.moveInterval = setInterval(() => {
      if (!this.bot || this.state !== 'connected') return;

      // Stop all movement
      directions.forEach(dir => this.bot.setControlState(dir, false));

      const dir = directions[Math.floor(Math.random() * directions.length)];
      this.bot.setControlState(dir, true);

      this.log(`🚶 Déplacement : ${dir}`);

      // Stop movement after 1.5-3 seconds
      setTimeout(() => {
        if (this.bot) this.bot.setControlState(dir, false);
      }, 1500 + Math.random() * 1500);
    }, 15000);
  }

  stopBehavior() {
    if (this.chatInterval) {
      clearInterval(this.chatInterval);
      this.chatInterval = null;
    }
    if (this.moveInterval) {
      clearInterval(this.moveInterval);
      this.moveInterval = null;
    }
  }

  sendCommand(command) {
    if (this.state !== 'connected' || !this.bot) {
      this.log('Impossible d’envoyer la commande : bot non connecté.');
      return false;
    }
    this.lastCommandAt = new Date();
    this.commandHistory.push({ command, timestamp: this.lastCommandAt });
    this.log(`Commande envoyée : ${command}`);
    try {
      this.bot.chat(command);
      return true;
    } catch (err) {
      this.log(`Erreur d’envoi : ${err.message}`);
      return false;
    }
  }

  disconnect() {
    this.stopBehavior();
    if (this.bot) {
      try {
        if (this.state === 'connected' || this.state === 'connecting') {
          this.bot.quit('Déconnecté par utilisateur');
        }
      } catch (err) {
        this.log(`Erreur de déconnexion : ${err.message}`);
      }
      this.bot = null;
    }
    if (this.state !== 'error') this.state = 'disconnected';
    this.log('Bot déconnecté.');
  }

  attachWS(ws) {
    this.wsClients.add(ws);
    this.log(`Client WebSocket ajouté. Total : ${this.wsClients.size}`);
  }

  detachWS(ws) {
    this.wsClients.delete(ws);
    this.log(`Client WebSocket retiré. Total : ${this.wsClients.size}`);
  }
}

import mineflayer from 'mineflayer';
import { pathfinder, Movements, goals } from 'mineflayer-pathfinder';
import minecraftData from 'minecraft-data';

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
    this.behaviorInterval = null;
    this.chatInterval = null;
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
          console.error('Échec WebSocket log :', err);
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
          this.log('⏳ Timeout de connexion');
          this.state = 'error';
          this.error = 'Timeout de connexion';
          if (this.bot) this.bot.quit();
        }
      }, 30000);

      this.bot.once('login', () => {
        clearTimeout(timeout);
        this.state = 'connected';
        this.log('✅ Connecté avec succès !');
        this.startRandomBehavior();
      });

      this.bot.once('end', (reason) => {
        clearTimeout(timeout);
        this.state = 'disconnected';
        this.log(`❌ Déconnecté : ${reason || 'inconnu'}`);
        this.stopBehavior();
      });

      this.bot.once('error', (err) => {
        clearTimeout(timeout);
        this.state = 'error';
        this.error = err.message || String(err);
        this.log(`❗ Erreur : ${this.error}`);
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
        this.log(`❌ Expulsé : ${reason}`);
        this.state = 'error';
        this.error = `Expulsé : ${reason}`;
      });

    } catch (err) {
      this.state = 'error';
      this.error = err.message || String(err);
      this.log(`Erreur de création : ${this.error}`);
    }
  }

  startRandomBehavior() {
    if (!this.bot || this.state !== 'connected') return;

    this.bot.loadPlugin(pathfinder);
    const mcData = minecraftData(this.bot.version);
    const defaultMove = new Movements(this.bot, mcData);
    this.bot.pathfinder.setMovements(defaultMove);

    const safeRandomGoal = () => {
      const pos = this.bot.entity.position;
      const dx = (Math.random() - 0.5) * 10;
      const dz = (Math.random() - 0.5) * 10;
      return new goals.GoalNear(pos.x + dx, pos.y, pos.z + dz, 1);
    };

    this.behaviorInterval = setInterval(() => {
      if (this.bot && this.state === 'connected') {
        const goal = safeRandomGoal();
        this.bot.pathfinder.setGoal(goal);
        this.log(`🚶 Se déplace vers une position proche...`);
      }
    }, 30000 + Math.random() * 30000); // toutes les 30-60s

    const normalMessages = [
      "Y'a quelqu'un ici ? 👀",
      "Salut 👋",
      "C'est calme aujourd'hui...",
      "Je visite un peu le coin",
      "J'aime bien cet endroit",
      "Quelqu’un veut papoter ?",
      "Un serveur tranquille",
      "Je suis nouveau ici",
      "Hmm... intéressant ici",
      "Ça va ?"
    ];

    this.chatInterval = setInterval(() => {
      if (this.bot && this.state === 'connected') {
        const msg = normalMessages[Math.floor(Math.random() * normalMessages.length)];
        this.bot.chat(msg);
        this.log(`💬 Message auto : ${msg}`);
      }
    }, 20 * 60 * 1000); // toutes les 20 min
  }

  stopBehavior() {
    if (this.chatInterval) {
      clearInterval(this.chatInterval);
      this.chatInterval = null;
    }
    if (this.behaviorInterval) {
      clearInterval(this.behaviorInterval);
      this.behaviorInterval = null;
    }
  }

  sendCommand(command) {
    if (this.state !== 'connected' || !this.bot) {
      this.log('❌ Bot non connecté.');
      return false;
    }

    this.lastCommandAt = new Date();
    this.commandHistory.push({ command, timestamp: this.lastCommandAt });
    this.log(`📤 Commande envoyée : ${command}`);

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
          this.bot.quit('Déconnecté par l’utilisateur');
        }
      } catch (err) {
        this.log(`Erreur de déconnexion : ${err.message}`);
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
    this.log(`🔗 WebSocket connecté (${this.wsClients.size} total)`);
  }

  detachWS(ws) {
    this.wsClients.delete(ws);
    this.log(`❎ WebSocket déconnecté (${this.wsClients.size} restants)`);
  }
}

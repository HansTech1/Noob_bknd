import mineflayer from 'mineflayer';

export class BotInstance {
  constructor({ id, userId, serverIp, serverPort = 25565, username }) {
    this.id = id; // Identifiant du bot
    this.userId = userId; // Identifiant de l'utilisateur propriétaire
    this.serverIp = serverIp; // IP du serveur Minecraft
    this.serverPort = serverPort; // Port du serveur (par défaut 25565)
    this.username = username || `NoobBot_${Math.random().toString(36).substring(2, 8)}`; // Nom d'utilisateur, généré si absent
    this.state = 'idle'; // État initial du bot
    this.logs = []; // Historique des logs
    this.commandHistory = []; // Historique des commandes envoyées
    this.bot = null; // Instance mineflayer du bot
    this.wsClients = new Set(); // Clients WebSocket connectés
    this.lastCommandAt = null; // Date de la dernière commande envoyée
    this.error = null; // Dernière erreur rencontrée
    this.behaviorInterval = null; // Intervalle pour comportement aléatoire
    this.chatInterval = null; // Intervalle pour chat automatique
  }

  // Ajoute une ligne de log avec timestamp et diffuse aux clients WS
  log(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 1000) this.logs.shift(); // Limite des logs à 1000 lignes
    console.log(`Bot[${this.id}]: ${msg}`);

    // Envoie les logs à tous les clients WebSocket connectés
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(JSON.stringify({ type: 'log', botId: this.id, message: line }));
        } catch (err) {
          console.error('Échec de l’envoi du log via WebSocket :', err);
        }
      }
    }
  }

  // Retourne les infos essentielles sur le bot
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
      logs: this.logs.slice(-20), // 20 derniers logs
      commandHistory: this.commandHistory.slice(-10), // 10 dernières commandes
    };
  }

  // Création / connexion du bot au serveur Minecraft
  spawn() {
    if (this.bot) {
      this.log('Le bot existe déjà, déconnexion en cours...');
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

      // Timeout de connexion 30 secondes
      const connectionTimeout = setTimeout(() => {
        if (this.state === 'connecting') {
          this.log('Timeout de connexion - trop long à se connecter');
          this.state = 'error';
          this.error = 'Timeout de connexion';
          if (this.bot) {
            this.bot.quit();
          }
        }
      }, 30000);

      this.bot.once('login', () => {
        clearTimeout(connectionTimeout);
        this.state = 'connected';
        this.log('Bot connecté au serveur avec succès !');
        this.startRandomBehavior();
      });

      this.bot.once('end', (reason) => {
        clearTimeout(connectionTimeout);
        this.state = 'disconnected';
        this.log(`Bot déconnecté : ${reason || 'Raison inconnue'}`);
        this.stopBehavior();
      });

      this.bot.once('error', (err) => {
        clearTimeout(connectionTimeout);
        this.state = 'error';
        this.error = err.message || String(err);
        this.log(`Erreur de connexion : ${this.error}`);
        this.stopBehavior();
      });

      // Gestion des messages de chat reçus
      this.bot.on('chat', (username, message) => {
        const chatLog = `[CHAT] <${username}> ${message}`;
        this.log(chatLog);

        // Diffuse les messages chat aux clients WS
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
              console.error('Échec de l’envoi du chat via WebSocket :', err);
            }
          }
        }
      });

      // Gestion du kick du bot
      this.bot.on('kicked', (reason) => {
        this.log(`Bot expulsé : ${reason}`);
        this.state = 'error';
        this.error = `Expulsé : ${reason}`;
      });

    } catch (err) {
      this.state = 'error';
      this.error = err.message || String(err);
      this.log(`Échec de création du bot : ${this.error}`);
    }
  }

  // Lance un comportement aléatoire (chat + mouvements)
  startRandomBehavior() {
    if (!this.bot || this.state !== 'connected') return;

    const randomChats = [
      "Salut tout le monde ! 👋",
      "Ça va ?",
      "Serveur sympa !",
      "Je suis un Noob",
      "Beaux builds ici !",
      "Quelqu’un veut discuter ?",
      "Explorons ensemble !",
      "Besoin d’aide ?",
      "NoobBot est là pour aider !",
      "J’adore ce serveur ! ❤️"
    ];

    // Chat aléatoire toutes les 30-60 secondes
    this.chatInterval = setInterval(() => {
      if (this.bot && this.state === 'connected') {
        const message = randomChats[Math.floor(Math.random() * randomChats.length)];
        this.bot.chat(message);
        this.log(`Chat automatique : ${message}`);
      }
    }, 30000 + Math.random() * 30000);

    // Mouvement et regard aléatoires toutes les 15-30 secondes
    this.behaviorInterval = setInterval(() => {
      if (this.bot && this.state === 'connected') {
        // Regarder autour aléatoirement
        const yaw = Math.random() * 2 * Math.PI;
        const pitch = (Math.random() - 0.5) * Math.PI * 0.5;
        this.bot.look(yaw, pitch, true);

        // Sauter aléatoirement
        if (Math.random() < 0.3) {
          this.bot.setControlState('jump', true);
          setTimeout(() => {
            if (this.bot) this.bot.setControlState('jump', false);
          }, 500);
        }

        this.log('Comportement aléatoire en cours...');
      }
    }, 15000 + Math.random() * 15000);
  }

  // Arrête les comportements aléatoires
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

  // Envoie une commande de chat au serveur via le bot
  sendCommand(command) {
    if (this.state !== 'connected' || !this.bot) {
      this.log('Impossible d’envoyer la commande : bot non connecté.');
      return false;
    }

    this.lastCommandAt = new Date();
    this.commandHistory.push({ command, timestamp: this.lastCommandAt });
    this.log(`Envoi de la commande : ${command}`);

    try {
      this.bot.chat(command);
      return true;
    } catch (err) {
      this.log(`Échec d’envoi de la commande : ${err.message}`);
      return false;
    }
  }

  // Déconnecte proprement le bot
  disconnect() {
    this.stopBehavior();

    if (this.bot) {
      try {
        if (this.state === 'connected' || this.state === 'connecting') {
          this.bot.quit('Déconnecté par l’utilisateur');
        }
      } catch (err) {
        this.log(`Erreur lors de la déconnexion : ${err.message}`);
      }
      this.bot = null;
    }

    if (this.state !== 'error') {
      this.state = 'disconnected';
    }
    this.log('Bot déconnecté.');
  }

  // Ajoute un client WebSocket à la liste
  attachWS(ws) {
    this.wsClients.add(ws);
    this.log(`Client WebSocket connecté. Nombre total : ${this.wsClients.size}`);
  }

  // Retire un client WebSocket de la liste
  detachWS(ws) {
    this.wsClients.delete(ws);
    this.log(`Client WebSocket déconnecté. Nombre total : ${this.wsClients.size}`);
  }
}

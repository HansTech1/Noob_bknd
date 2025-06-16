import mineflayer from 'mineflayer';
import { pathfinder, Movements, goals } from 'mineflayer-pathfinder';
import collectBlock from 'mineflayer-collectblock';
import pvp from 'mineflayer-pvp';
import autoeat from 'mineflayer-auto-eat';
import { Vec3 } from 'vec3';
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
    this.intervals = [];
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

      this.bot.loadPlugin(pathfinder);
      this.bot.loadPlugin(collectBlock);
      this.bot.loadPlugin(pvp);
      this.bot.loadPlugin(autoeat);

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
        this.startIntelligentBehavior();
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
              ws.send(JSON.stringify({ type: 'chat', botId: this.id, username, message }));
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

  async startIntelligentBehavior() {
    if (!this.bot || this.state !== 'connected') return;
    const mcData = minecraftData(this.bot.version);
    const defaultMove = new Movements(this.bot, mcData);
    this.bot.pathfinder.setMovements(defaultMove);

    // Auto-eat config
    this.bot.autoEat.options = {
      priority: 'foodPoints',
      startAt: 14,
      bannedFood: []
    };

    await this.collectWood(mcData);
    await this.craftSword(mcData);
    this.startPvp(mcData);
    this.monitorHealth();
  }

  async collectWood(mcData) {
    const blockType = mcData.blocksByName.oak_log;
    const blocks = this.bot.findBlocks({
      matching: blockType.id,
      maxDistance: 32,
      count: 5
    });

    for (let pos of blocks) {
      const block = this.bot.blockAt(pos);
      try {
        await this.bot.collectBlock.collect(block);
        this.log('🌲 Bois collecté');
      } catch (err) {
        this.log('❌ Erreur collecte: ' + err.message);
      }
    }
  }

  async craftSword(mcData) {
    const craftingTable = this.bot.findBlock({
      matching: mcData.blocksByName.crafting_table.id,
      maxDistance: 32
    });

    if (!craftingTable) {
      this.log("Pas de table de craft");
      return;
    }

    const swordRecipe = this.bot.recipesFor(mcData.itemsByName.wooden_sword.id, null, 1, craftingTable)[0];
    if (!swordRecipe) {
      this.log("Recette épée indisponible");
      return;
    }

    try {
      await this.bot.craft(swordRecipe, 1, craftingTable);
      this.log("⚔️ Épée craftée");
    } catch (err) {
      this.log("❌ Craft échoué: " + err.message);
    }
  }

  startPvp(mcData) {
    const hostileMobs = ['zombie', 'skeleton', 'creeper', 'spider', 'witch'];
    const interval = setInterval(() => {
      if (!this.bot || this.state !== 'connected') return;

      const target = this.bot.nearestEntity(e =>
        e.type === 'mob' &&
        hostileMobs.includes(e.mobType || e.name) &&
        this.bot.entity.position.distanceTo(e.position) < 6
      );

      if (target) {
        try {
          this.bot.pvp.attack(target);
          this.log(`⚔️ Combat contre ${target.name}`);
        } catch (err) {
          this.log("❌ Erreur combat: " + err.message);
        }
      }
    }, 5000);

    this.intervals.push(interval);
  }

  monitorHealth() {
    this.bot.on('health', () => {
      if (this.bot.health < 10) {
        const retreatPos = this.bot.entity.position.offset(10, 0, 10);
        this.bot.pathfinder.setGoal(new goals.GoalNear(retreatPos.x, retreatPos.y, retreatPos.z, 1));
        this.log('🚑 Repli de sécurité');
      }
    });
  }

  stopBehavior() {
    for (const interval of this.intervals) clearInterval(interval);
    this.intervals = [];
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

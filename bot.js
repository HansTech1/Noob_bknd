import mineflayer from 'mineflayer';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
import { Vec3 } from 'vec3';

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

    this.brainLoop = null;
    this.attackLoop = null;
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
          console.error('WebSocket log error:', err);
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
      this.log('Bot already exists, disconnecting...');
      this.disconnect();
    }

    this.state = 'connecting';
    this.error = null;
    this.log(`Connecting to ${this.serverIp}:${this.serverPort} as ${this.username}...`);

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

      const timeout = setTimeout(() => {
        if (this.state === 'connecting') {
          this.log('⏱️ Connection timeout');
          this.state = 'error';
          this.error = 'Connection timeout';
          if (this.bot) this.bot.quit();
        }
      }, 30000);

      this.bot.once('login', () => {
        clearTimeout(timeout);
        this.state = 'connected';
        this.log('✅ Successfully connected');
        this.initPathfinder();
        this.startBrain();
        this.startCombat();
      });

      this.bot.once('end', (reason) => {
        clearTimeout(timeout);
        this.state = 'disconnected';
        this.log(`🔌 Disconnected: ${reason || 'Unknown reason'}`);
        this.stopBrain();
      });

      this.bot.once('error', (err) => {
        clearTimeout(timeout);
        this.state = 'error';
        this.error = err.message || String(err);
        this.log(`❌ Error: ${this.error}`);
        this.stopBrain();
      });

    } catch (err) {
      this.state = 'error';
      this.error = err.message || String(err);
      this.log(`❌ Failed to create: ${this.error}`);
    }
  }

  initPathfinder() {
    if (!this.bot) return;
    const defaultMove = new Movements(this.bot);
    defaultMove.allowSprinting = true;
    defaultMove.allowParkour = true;
    this.bot.pathfinder.setMovements(defaultMove);
  }

  startBrain() {
    if (!this.bot || this.state !== 'connected') return;

    let mode = 'idle';
    let lastChat = Date.now();

    const chatPhrases = [
      "Just wandering...",
      "It's a nice day.",
      "Looking for some resources.",
      "Exploring the area...",
      "Staying alert."
    ];

    this.brainLoop = setInterval(async () => {
      try {
        await this.manageHealth();

        if (Date.now() - lastChat > (60_000 + Math.random() * 120_000)) {
          const message = chatPhrases[Math.floor(Math.random() * chatPhrases.length)];
          this.bot.chat(message);
          this.log(`💬 Human Chat: ${message}`);
          lastChat = Date.now();
        }

        if (mode === 'idle' && Math.random() < 0.3) {
          mode = 'exploring';
          await this.explore();
          mode = 'idle';
        }
      } catch (err) {
        this.log(`🧠 Brain error: ${err.message}`);
      }
    }, 2000);
  }

  async manageHealth() {
    if (!this.bot) return;
    if (this.bot.food < 15) {
      const foodItem = this.bot.inventory.items().find(item => item.name.includes('bread') || item.name.includes('apple'));
      if (foodItem) {
        await this.bot.equip(foodItem, 'hand');
        await this.bot.consume();
        this.log('🍞 Eating to regenerate.');
      }
    }
  }

  async explore() {
    const pos = this.bot.entity.position;
    const goal = new goals.GoalNear(
      pos.x + (Math.random() * 30 - 15),
      pos.y,
      pos.z + (Math.random() * 30 - 15),
      1
    );
    this.log(`🚶 Exploring towards ${goal.x.toFixed(1)} ${goal.z.toFixed(1)}`);
    await this.bot.pathfinder.goto(goal);
  }

  startCombat() {
    if (!this.bot || this.state !== 'connected') return;

    const hostileMobs = ['zombie', 'skeleton', 'creeper', 'spider'];

    this.attackLoop = setInterval(() => {
      try {
        const mob = this.bot.nearestEntity(e => 
          e.type === 'mob' &&
          hostileMobs.includes(e.name) &&
          this.bot.entity.position.distanceTo(e.position) < 8
        );

        if (mob) {
          this.bot.lookAt(mob.position.offset(0, mob.height / 2, 0), true);
          this.bot.attack(mob);
          this.log(`⚔️ Attacked ${mob.name}`);
        }
      } catch (err) {
        this.log(`❌ Combat error: ${err.message}`);
      }
    }, 2000);
  }

  stopBrain() {
    if (this.brainLoop) clearInterval(this.brainLoop);
    if (this.attackLoop) clearInterval(this.attackLoop);
  }

  sendCommand(command) {
    if (this.state !== 'connected' || !this.bot) {
      this.log('❌ Bot not connected');
      return false;
    }
    this.lastCommandAt = new Date();
    this.commandHistory.push({ command, timestamp: this.lastCommandAt });
    this.log(`💬 Command sent: ${command}`);

    try {
      this.bot.chat(command);
      return true;
    } catch (err) {
      this.log(`❌ Send error: ${err.message}`);
      return false;
    }
  }

  disconnect() {
    this.stopBrain();
    if (this.bot) {
      try {
        if (this.state === 'connected' || this.state === 'connecting') {
          this.bot.quit('User disconnected');
        }
      } catch (err) {
        this.log(`❌ Disconnect error: ${err.message}`);
      }
      this.bot = null;
    }
    if (this.state !== 'error') {
      this.state = 'disconnected';
    }
    this.log('🔌 Bot disconnected.');
  }

  attachWS(ws) {
    this.wsClients.add(ws);
    this.log(`🔗 WS client connected (${this.wsClients.size})`);
  }

  detachWS(ws) {
    this.wsClients.delete(ws);
    this.log(`❌ WS client disconnected (${this.wsClients.size})`);
  }
}

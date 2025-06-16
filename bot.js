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

    this.chatInterval = null;
    this.behaviorTimeout = null;
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
        this.startBehaviorLoop();
        this.startAttackLoop();
      });

      this.bot.once('end', (reason) => {
        clearTimeout(timeout);
        this.state = 'disconnected';
        this.log(`🔌 Disconnected: ${reason || 'Unknown reason'}`);
        this.stopBehavior();
      });

      this.bot.once('error', (err) => {
        clearTimeout(timeout);
        this.state = 'error';
        this.error = err.message || String(err);
        this.log(`❌ Error: ${this.error}`);
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
              console.error('WebSocket chat error:', err);
            }
          }
        }
      });

      this.bot.on('kicked', (reason) => {
        this.log(`🚫 Kicked: ${reason}`);
        this.state = 'error';
        this.error = `Kicked: ${reason}`;
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
    this.bot.pathfinder.setMovements(defaultMove);
  }

  startBehaviorLoop() {
    if (!this.bot || this.state !== 'connected') return;

    const randomChats = ["Je suis là.", "Je visite...", "Hmm...", "Beau monde ici."];
    this.chatInterval = setInterval(() => {
      if (this.state === 'connected') {
        const msg = randomChats[Math.floor(Math.random() * randomChats.length)];
        this.bot.chat(msg);
        this.log(`💬 Sent: ${msg}`);
      }
    }, 15 * 60_000 + Math.random() * 15 * 60_000);

    const behavior = async () => {
      if (!this.bot || this.state !== 'connected') return;
      try {
        const sneak = Math.random() < 0.2;
        const sprint = !sneak && Math.random() < 0.3;
        this.bot.setControlState('sneak', sneak);
        this.bot.setControlState('sprint', sprint);

        const pos = this.bot.entity.position;
        const dx = Math.random() * 20 - 10;
        const dz = Math.random() * 20 - 10;
        const targetX = Math.floor(pos.x + dx);
        const targetZ = Math.floor(pos.z + dz);
        const targetY = await this.findSafeY(targetX, pos.y, targetZ);

        const randomGoal = new goals.GoalNear(targetX, targetY, targetZ, 1);
        this.log(`🚶 Walking to (${randomGoal.x}, ${randomGoal.y}, ${randomGoal.z}) [Sneak=${sneak}, Sprint=${sprint}]`);

        await Promise.race([
          this.bot.pathfinder.goto(randomGoal),
          this.pathTimeout(8000)
        ]);

        for (let i = 0; i < 5; i++) {
          if (this.state !== 'connected') break;
          const yaw = this.bot.entity.yaw + (Math.random() * 1 - 0.5);
          const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.bot.entity.pitch + (Math.random() * 0.4 - 0.2)));
          this.bot.look(yaw, pitch, true);
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
        }

        if (Math.random() < 0.3) {
          this.log('🛑 Pausing to simulate human idle');
          await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
        }

        this.bot.setControlState('sneak', false);
        this.bot.setControlState('sprint', false);

      } catch (err) {
        this.log(`❌ Behavior error: ${err.message}`);
        this.bot.pathfinder.setGoal(null);
      }

      if (this.state === 'connected') {
        this.behaviorTimeout = setTimeout(behavior, 1000);
      }
    };
    behavior();
  }

  pathTimeout(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Pathfinding timeout")), ms);
    });
  }

  async findSafeY(x, baseY, z) {
    const pos = new Vec3(x, baseY, z);
    let block = this.bot.blockAt(pos);
    let attempts = 0;
    while (block && block.boundingBox !== 'empty' && attempts < 5) {
      pos.y += 1;
      block = this.bot.blockAt(pos);
      attempts++;
    }
    return pos.y;
  }

  startAttackLoop() {
    if (!this.bot || this.state !== 'connected') return;
    const hostileMobs = ['zombie', 'skeleton', 'creeper', 'spider', 'witch'];
    this.attackInterval = setInterval(() => {
      if (!this.bot || this.state !== 'connected') return;
      const entity = this.bot.nearestEntity(e => e.type === 'mob' && hostileMobs.includes(e.name) && this.bot.entity.position.distanceTo(e.position) < 6);
      if (entity && Math.random() < 0.7) {
        try {
          this.bot.lookAt(entity.position.offset(0, entity.height / 2, 0), true, () => {
            this.bot.attack(entity);
            this.log(`⚔️ Attacked ${entity.name}`);
          });
        } catch (err) {
          this.log(`❌ Attack error: ${err.message}`);
        }
      }
    }, 8000 + Math.random() * 7000);
  }

  stopBehavior() {
    if (this.chatInterval) clearInterval(this.chatInterval);
    if (this.behaviorTimeout) clearTimeout(this.behaviorTimeout);
    if (this.attackInterval) clearInterval(this.attackInterval);
    this.chatInterval = null;
    this.behaviorTimeout = null;
    this.attackInterval = null;
    if (this.bot) {
      this.bot.setControlState('sneak', false);
      this.bot.setControlState('sprint', false);
    }
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
    this.stopBehavior();
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

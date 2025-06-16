import mineflayer from 'mineflayer';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
import { Vec3 } from 'vec3';
const mcDataLoader = require('minecraft-data');

export class BotInstance {
  /**
   * Returns basic status for API and UI
   */
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

  constructor({ id, userId, serverIp, serverPort = 25565, username }) { {
  constructor({ id, userId, serverIp, serverPort = 25565, username }) {
    this.id = id;
    this.userId = userId;
    this.serverIp = serverIp;
    this.serverPort = serverPort;
    this.username = username || `Survivor_${Math.random().toString(36).substring(2, 8)}`;
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
        this.mcData = mcDataLoader(this.bot.version);
        this.movements = new Movements(this.bot, this.mcData);
        this.bot.pathfinder.setMovements(this.movements);
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
              ws.send(JSON.stringify({ type: 'chat', botId: this.id, username, message }));
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

  startBehaviorLoop() {
    if (!this.bot || this.state !== 'connected') return;
    const loop = async () => {
      if (!this.bot || this.state !== 'connected') return;
      try {
        await this.fullSurvivalLogic();
      } catch (err) {
        this.log(`❌ Behavior error: ${err.message}`);
      }
      if (this.state === 'connected') {
        this.behaviorTimeout = setTimeout(loop, 2000);
      }
    };
    loop();
  }

  async fullSurvivalLogic() {
    if (!this.bot || !this.mcData) return;

    // If hungry => eat
    if (typeof this.bot.food === 'number' && this.bot.food < 18) await this.eatFood();

    // Ensure sword & pickaxe
    const sword = this.bot.inventory.items().find(item => item.name.includes('sword'));
    if (!sword) await this.craftTool('wooden_sword');

    const pickaxe = this.bot.inventory.items().find(item => item.name.includes('pickaxe'));
    if (!pickaxe) await this.craftTool('wooden_pickaxe');

    // Mining basic resources
    await this.mineNearby(['log', 'stone', 'coal_ore']);
  }() {
    if (!this.bot) return;

    // If hungry => eat
    if (this.bot.food < 18) await this.eatFood();

    // If night => seek shelter
    if (this.bot.time.isNight) await this.seekShelter();

    // Ensure sword & pickaxe
    const sword = this.bot.inventory.items().find(item => item.name.includes('sword'));
    if (!sword) await this.craftTool('wooden_sword');

    const pickaxe = this.bot.inventory.items().find(item => item.name.includes('pickaxe'));
    if (!pickaxe) await this.craftTool('wooden_pickaxe');

    // Mining basic resources
    await this.mineNearby(['log', 'stone', 'coal_ore']);
  }

  async mineNearby(blockNames) {
    for (let name of blockNames) {
      const blockType = this.mcData.blocksByName[name];
      const target = this.bot.findBlock({ matching: blockType.id, maxDistance: 20 });
      if (target) {
        await this.goto(target.position);
        await this.bot.dig(target);
        this.log(`⛏️ Mined ${name}`);
      }
    }
  }

  async seekShelter() {
    const shelter = this.bot.findBlock({ matching: b => b.boundingBox === 'empty', maxDistance: 10 });
    if (shelter) await this.goto(shelter.position);
  }

  async craftTool(toolType) {
    const table = this.bot.findBlock({ matching: this.mcData.blocksByName.crafting_table.id, maxDistance: 32 });
    if (!table) return;
    await this.goto(table.position);
    const toolName = toolType;
    const recipe = this.bot.recipesFor(this.mcData.itemsByName[toolName].id)[0];
    if (recipe) await this.bot.craft(recipe, 1, table);
  }

  async eatFood() {
    const foodItem = this.bot.inventory.items().find(item => item.name.includes('beef') || item.name.includes('pork') || item.name.includes('chicken') || item.name.includes('mutton'));
    if (foodItem) {
      await this.bot.equip(foodItem, 'hand');
      await this.bot.consume();
      this.log('🍖 Ate food');
    }
  }

  async goto(pos) {
    const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 1);
    await this.bot.pathfinder.goto(goal);
  }

  startAttackLoop() {
    if (!this.bot || this.state !== 'connected') return;
    const hostileMobs = ['zombie', 'skeleton', 'creeper', 'spider', 'witch'];
    this.attackInterval = setInterval(() => {
      if (!this.bot || this.state !== 'connected') return;
      const entity = this.bot.nearestEntity(e => e.type === 'mob' && hostileMobs.includes(e.name) && this.bot.entity.position.distanceTo(e.position) < 6);
      if (entity) {
        try {
          this.bot.lookAt(entity.position.offset(0, entity.height / 2, 0));
          this.bot.attack(entity);
          this.log(`⚔️ Attacked ${entity.name}`);
        } catch (err) {
          this.log(`❌ Attack error: ${err.message}`);
        }
      }
    }, 7000);
  }

  stopBehavior() {
    if (this.chatInterval) clearInterval(this.chatInterval);
    if (this.behaviorTimeout) clearTimeout(this.behaviorTimeout);
    if (this.attackInterval) clearInterval(this.attackInterval);
    this.chatInterval = null;
    this.behaviorTimeout = null;
    this.attackInterval = null;
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

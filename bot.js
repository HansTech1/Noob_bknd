const mineflayer = require('mineflayer');
const minecraftData = require('minecraft-data');
const Vec3 = require('vec3');
const pathfinderPlugin = require('mineflayer-pathfinder');
const pvpPlugin = require('mineflayer-pvp').plugin;
const collectBlock = require('mineflayer-collectblock').plugin;
const autoeat = require('mineflayer-auto-eat').plugin;

const { pathfinder, Movements, goals } = pathfinderPlugin;
const { GoalNear } = goals;

class BotInstance {
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
      this.log('Bot exists, disconnecting...');
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
        auth: 'offline'
      });

      // Load plugins before spawn
      this.bot.loadPlugin(pathfinder);
      this.bot.loadPlugin(pvpPlugin);
      this.bot.loadPlugin(collectBlock);
      this.bot.loadPlugin(autoeat);

      const timeout = setTimeout(() => {
        if (this.state === 'connecting') {
          this.log('⏱️ Connection timeout');
          this.state = 'error';
          this.error = 'Timeout';
          this.bot.quit();
        }
      }, 30000);

      this.bot.once('login', () => {
        clearTimeout(timeout);
        this.state = 'connected';
        this.log('✅ Connected');
      });

      this.bot.once('spawn', () => {
        const mcData = minecraftData(this.bot.version);
        const defaultMove = new Movements(this.bot, mcData);
        this.bot.pathfinder.setMovements(defaultMove);
        this.startAI(mcData);
      });

      this.bot.once('end', (reason) => {
        clearTimeout(timeout);
        this.state = 'disconnected';
        this.log(`🔌 Disconnected: ${reason || 'Unknown reason'}`);
      });

      this.bot.once('error', (err) => {
        clearTimeout(timeout);
        this.state = 'error';
        this.error = err.message || String(err);
        this.log(`❌ Error: ${this.error}`);
      });

    } catch (err) {
      this.state = 'error';
      this.error = err.message || String(err);
      this.log(`❌ Failed to create: ${this.error}`);
    }
  }

  startAI(mcData) {
    const hostileMobs = ['zombie', 'skeleton', 'spider', 'witch', 'creeper'];

    // Auto eat
    this.bot.autoEat.options = {
      priority: 'foodPoints',
      startAt: 16,
      bannedFood: []
    };

    const loop = async () => {
      if (!this.bot || this.state !== 'connected') return;

      try {
        const sword = this.bot.inventory.items().find(item => item.name.includes('sword'));
        if (!sword) await this.craftSword(mcData);

        if (this.bot.food < 15) await this.bot.autoEat.eat();

        const entity = this.bot.nearestEntity(e => e.type === 'mob' && hostileMobs.includes(e.name));
        if (entity) {
          await this.attackMob(entity);
        } else {
          await this.mineTree(mcData);
        }
      } catch (err) {
        this.log(`⚠️ AI loop error: ${err.message}`);
      }

      setTimeout(loop, 3000);
    };

    loop();
  }

  async mineTree(mcData) {
    const logBlock = this.bot.findBlock({
      matching: mcData.blocksByName.oak_log.id,
      maxDistance: 20
    });

    if (logBlock) {
      this.log('🌳 Found tree, mining...');
      await this.bot.collectBlock.collect(logBlock);
    }
  }

  async craftSword(mcData) {
    this.log('🛠️ Crafting sword...');
    const workbench = this.bot.findBlock({
      matching: mcData.blocksByName.crafting_table.id,
      maxDistance: 10
    });

    const swordRecipe = this.bot.recipesFor(mcData.itemsByName.wooden_sword.id, null, workbench)[0];
    if (swordRecipe) {
      await this.bot.craft(swordRecipe, 1, workbench);
      this.log('🗡️ Sword crafted.');
    } else {
      this.log('⚠️ No recipe found for sword.');
    }
  }

  async attackMob(entity) {
    this.log(`⚔️ Attacking ${entity.name}`);
    await this.bot.pvp.attack(entity);
  }

  disconnect() {
    if (this.bot) {
      try {
        this.bot.quit('Disconnected');
      } catch (err) {
        this.log(`❌ Disconnect error: ${err.message}`);
      }
      this.bot = null;
    }

    this.state = 'disconnected';
    this.log('🔌 Bot disconnected.');
  }
}

module.exports = { BotInstance };

import mineflayer from 'mineflayer';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
import { Vec3 } from 'vec3';
const mcDataLoader = require('minecraft-data');

export class BotInstance {
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

  /** Returns basic info for API/UI */
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

  /** Connects and starts the bot */
  spawn() {
    if (this.bot) this.disconnect();
    this.state = 'connecting';
    this.log(`Connecting to ${this.serverIp}:${this.serverPort} as ${this.username}...`);

    try {
      this.bot = mineflayer.createBot({
        host: this.serverIp,
        port: this.serverPort,
        username: this.username,
        auth: 'offline',
        version: false
      });
      this.bot.loadPlugin(pathfinder);

      const timeout = setTimeout(() => {
        if (this.state === 'connecting') {
          this.error = 'Connection timeout';
          this.log(`❌ ${this.error}`);
          this.bot.quit();
        }
      }, 30000);

      this.bot.once('login', () => {
        clearTimeout(timeout);
        this.state = 'connected';
        this.log('✅ Logged in');
        this.mcData = mcDataLoader(this.bot.version);
        this.movements = new Movements(this.bot, this.mcData);
        this.bot.pathfinder.setMovements(this.movements);
        this.startBehaviorLoop();
        this.startAttackLoop();
        this.startChatLoop();
      });

      this.bot.on('end', reason => {
        this.state = 'disconnected';
        this.log(`🔌 Disconnected: ${reason}`);
        this.stopBehavior();
        setTimeout(() => this.spawn(), 5000);
      });

      this.bot.on('error', err => {
        this.error = err.message;
        this.log(`❌ Error: ${this.error}`);
        this.stopBehavior();
      });
    } catch (err) {
      this.log(`❌ Spawn failed: ${err.message}`);
    }
  }

  /** Main survival loop */
  startBehaviorLoop() {
    const loop = async () => {
      if (this.state !== 'connected') return;
      try {
        await this.eatIfHungry();
        await this.craftIfNeeded();
        await this.gatherResources();
        await this.buildShelterIfNight();
        await this.randomWander();
      } catch (err) {
        this.log(`❌ Behavior error: ${err.message}`);
      }
      this.behaviorTimeout = setTimeout(loop, 4000);
    };
    loop();
  }

  /** Eats when food < threshold */
  async eatIfHungry() {
    if (this.bot.food < 15) {
      const food = this.bot.inventory.items().find(i => i.name.startsWith('cooked_'));
      if (food) {
        await this.bot.equip(food, 'hand');
        await this.bot.consume();
        this.log('🍖 Ate food');
      } else {
        await this.huntAnimals();
      }
    }
  }

  /** Crafts tools and furnace/armor if missing */
  async craftIfNeeded() {
    const inv = items => this.bot.inventory.items().some(i => items.includes(i.name));
    if (!inv(['wooden_pickaxe'])) await this.craft('wooden_pickaxe');
    if (!inv(['stone_pickaxe']) && inv(['cobblestone'])) await this.craft('stone_pickaxe');
    if (!inv(['furnace']) && inv(['cobblestone'])) await this.craft('furnace');
  }

  /** Gathers wood, stone, coal, iron ore */
  async gatherResources() {
    const targets = ['log','stone','coal_ore','iron_ore'];
    for (let name of targets) {
      const block = this.bot.findBlock({ matching: b => b.name.includes(name), maxDistance: 20 });
      if (block) {
        await this.goto(block.position);
        await this.bot.dig(block);
        this.log(`⛏️ Mined ${name}`);
        return;
      }
    }
  }

  /** Builds a simple 2x2 shelter at night */
  async buildShelterIfNight() {
    if (this.bot.time.timeOfDay > 13000) {
      const base = this.bot.entity.position.offset(0, -1, 0);
      // build 2x2 walls around
      const offsets = [ [1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1] ];
      for (let [dx,dz] of offsets) {
        const pos = base.offset(dx,0,dz);
        const block = this.mcData.blocksByName.dirt;
        await this.bot.placeBlock(this.bot.blockAt(pos), new Vec3(0,1,0));
      }
      this.log('🏠 Built shelter');
    }
  }

  /** Hunts nearest animal for food */
  async huntAnimals() {
    const prey = ['cow','pig','chicken','sheep'];
    const animal = this.bot.nearestEntity(e => prey.includes(e.name));
    if (animal) {
      await this.goto(animal.position);
      this.bot.attack(animal);
      this.log(`⚔️ Hunted ${animal.name}`);
    }
  }

  /** Random wandering */
  async randomWander() {
    const pos = this.bot.entity.position;
    const goal = new goals.GoalNear(pos.x + this.rand(-10,10), pos.y, pos.z + this.rand(-10,10), 1);
    try { await this.bot.pathfinder.goto(goal); }
    catch {}
  }

  /** Attack hostile mobs */
  startAttackLoop() {
    const hostiles = ['zombie','skeleton','creeper','spider','witch'];
    this.attackInterval = setInterval(() => {
      const target = this.bot.nearestEntity(e => hostiles.includes(e.name));
      if (target) {
        this.bot.lookAt(target.position.offset(0,target.height/2,0), true).then(()=>{ this.bot.attack(target); this.log(`⚔️ Attacked ${target.name}`); });
      }
    }, 5000);
  }

  /** Navigates to position */
  async goto(pos) {
    const goal = new goals.GoalNear(pos.x,pos.y,pos.z,1);
    await this.bot.pathfinder.goto(goal);
  }

  sendCommand(cmd) {
    if (this.state !== 'connected') return false;
    this.lastCommandAt = new Date();
    this.commandHistory.push({ cmd, timestamp: this.lastCommandAt });
    this.bot.chat(cmd);
    return true;
  }

  stopBehavior() {
    clearTimeout(this.behaviorTimeout);
    clearInterval(this.attackInterval);
    clearInterval(this.chatInterval);
  }

  disconnect() {
    this.stopBehavior();
    if (this.bot) { this.bot.quit(); this.bot=null; }
    this.state = 'disconnected';
    this.log('🔌 Disconnected');
  }

  attachWS(ws){ this.wsClients.add(ws); this.log(`WS clients: ${this.wsClients.size}`); }
  detachWS(ws){ this.wsClients.delete(ws); this.log(`WS clients: ${this.wsClients.size}`); }

  startChatLoop() {
    this.chatInterval = setInterval(() => {
      const msgs = ['Exploring...','Gathering resources','Need food','Building shelter','Hmm...'];
      if (Math.random()<0.3) {
        this.bot.chat(msgs[Math.floor(Math.random()*msgs.length)]);
      }
    }, this.rand(30000,120000));
  }

  rand(min,max){return Math.floor(Math.random()*(max-min+1)+min);}  
}

import { BotInstance } from './BotInstance.js';

export class BotManager {
  constructor() {
    this.bots = new Map();
  }

  createBot(options) {
    const { id } = options;
    if (this.bots.has(id)) {
      throw new Error(`Bot with id ${id} already exists`);
    }
    const bot = new BotInstance(options);
    this.bots.set(id, bot);
    bot.spawn();
    return bot;
  }

  getBot(id) {
    return this.bots.get(id);
  }

  getAllBotsInfo() {
    return Array.from(this.bots.values()).map(bot => bot.getInfo());
  }

  sendCommandToBot(id, command) {
    const bot = this.getBot(id);
    if (!bot) throw new Error(`No bot with id ${id}`);
    return bot.sendCommand(command);
  }

  disconnectBot(id) {
    const bot = this.getBot(id);
    if (bot) {
      bot.disconnect();
      this.bots.delete(id);
    }
  }

  attachWSClientToBot(id, ws) {
    const bot = this.getBot(id);
    if (!bot) throw new Error(`No bot with id ${id}`);
    bot.attachWS(ws);
  }

  detachWSClientFromBot(id, ws) {
    const bot = this.getBot(id);
    if (!bot) throw new Error(`No bot with id ${id}`);
    bot.detachWS(ws);
  }
}


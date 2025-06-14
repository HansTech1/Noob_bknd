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
    this.behaviorInterval = null;
    this.chatInterval = null;
  }

  log(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 1000) this.logs.shift();
    console.log(`Bot[${this.id}]: ${msg}`);
    
    // Broadcast logs to connected WS clients
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(JSON.stringify({ type: 'log', botId: this.id, message: line }));
        } catch (err) {
          console.error('Failed to send log to WebSocket:', err);
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
      this.log('Bot already exists, disconnecting first...');
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

      // Set connection timeout
      const connectionTimeout = setTimeout(() => {
        if (this.state === 'connecting') {
          this.log('Connection timeout - taking too long to connect');
          this.state = 'error';
          this.error = 'Connection timeout';
          if (this.bot) {
            this.bot.quit();
          }
        }
      }, 30000); // 30 second timeout

      this.bot.once('login', () => {
        clearTimeout(connectionTimeout);
        this.state = 'connected';
        this.log('Bot connected to server successfully!');
        this.startRandomBehavior();
      });

      this.bot.once('end', (reason) => {
        clearTimeout(connectionTimeout);
        this.state = 'disconnected';
        this.log(`Bot disconnected: ${reason || 'Unknown reason'}`);
        this.stopBehavior();
      });

      this.bot.once('error', (err) => {
        clearTimeout(connectionTimeout);
        this.state = 'error';
        this.error = err.message || String(err);
        this.log(`Connection error: ${this.error}`);
        this.stopBehavior();
      });

      this.bot.on('chat', (username, message) => {
        const chatLog = `[CHAT] <${username}> ${message}`;
        this.log(chatLog);
        
        // Broadcast chat to WS clients
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
              console.error('Failed to send chat to WebSocket:', err);
            }
          }
        }
      });

      this.bot.on('kicked', (reason) => {
        this.log(`Bot was kicked: ${reason}`);
        this.state = 'error';
        this.error = `Kicked: ${reason}`;
      });

    } catch (err) {
      this.state = 'error';
      this.error = err.message || String(err);
      this.log(`Failed to create bot: ${this.error}`);
    }
  }

  startRandomBehavior() {
    if (!this.bot || this.state !== 'connected') return;

    const randomChats = [
      "Hey everyone! 👋",
      "What's up?",
      "Cool server!",
      "I'm a NoobBot 🤖",
      "Nice builds here!",
      "Anyone want to chat?",
      "Let's explore together!",
      "Need any help?",
      "NoobBot is here to help!",
      "I love this server! ❤️"
    ];

    // Random chat every 30-60 seconds
    this.chatInterval = setInterval(() => {
      if (this.bot && this.state === 'connected') {
        const message = randomChats[Math.floor(Math.random() * randomChats.length)];
        this.bot.chat(message);
        this.log(`Auto-chat: ${message}`);
      }
    }, 30000 + Math.random() * 30000);

    // Random movement and looking every 15-30 seconds
    this.behaviorInterval = setInterval(() => {
      if (this.bot && this.state === 'connected') {
        // Random look around
        const yaw = Math.random() * 2 * Math.PI;
        const pitch = (Math.random() - 0.5) * Math.PI * 0.5;
        this.bot.look(yaw, pitch, true);

        // Random jump occasionally
        if (Math.random() < 0.3) {
          this.bot.setControlState('jump', true);
          setTimeout(() => {
            if (this.bot) this.bot.setControlState('jump', false);
          }, 500);
        }

        this.log('Performing random behavior...');
      }
    }, 15000 + Math.random() * 15000);
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
      this.log('Cannot send command: bot not connected.');
      return false;
    }
    
    this.lastCommandAt = new Date();
    this.commandHistory.push({ command, timestamp: this.lastCommandAt });
    this.log(`Sending command: ${command}`);
    
    try {
      this.bot.chat(command);
      return true;
    } catch (err) {
      this.log(`Failed to send command: ${err.message}`);
      return false;
    }
  }

  disconnect() {
    this.stopBehavior();
    
    if (this.bot) {
      try {
        if (this.state === 'connected' || this.state === 'connecting') {
          this.bot.quit('Disconnected by user');
        }
      } catch (err) {
        this.log(`Error during disconnect: ${err.message}`);
      }
      this.bot = null;
    }
    
    if (this.state !== 'error') {
      this.state = 'disconnected';
    }
    this.log('Bot disconnected.');
  }

  attachWS(ws) {
    this.wsClients.add(ws);
    this.log(`WebSocket client connected. Total clients: ${this.wsClients.size}`);
  }

  detachWS(ws) {
    this.wsClients.delete(ws);
    this.log(`WebSocket client disconnected. Total clients: ${this.wsClients.size}`);
  }
}

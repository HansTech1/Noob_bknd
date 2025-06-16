/**
 * MinecraftBot Platform Backend
 * Refactored with separate bot module and improved connection handling
 **/

import express from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import bodyParser from 'body-parser';
import cors from 'cors';
import crypto from 'crypto';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { BotInstance } from './bot.js';

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkeychange';

// In-memory stores (replace with DB for production)
const users = new Map(); // userId => { username, passwordHash }
const userBots = new Map(); // userId => Set(botId)
const bots = new Map(); // botId => BotInstance

// Utils
const hashPassword = (pw) => crypto.createHash('sha256').update(pw).digest('hex');
const generateId = (len = 16) => crypto.randomBytes(len).toString('hex');
const generateToken = (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: '12h' });
const verifyToken = (token) => {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
};

// Express setup
const app = express();
const server = http.createServer(app);
app.use(morgan('tiny'));
app.use(cors());
app.use(bodyParser.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, slow down.',
});
app.use(apiLimiter);

// Auth middleware
function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'Missing Authorization header' });
  const token = auth.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing token' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });
  req.userId = decoded.userId;
  next();
}

// --- User Routes ---

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
  if ([...users.values()].some(u => u.username === username)) {
    return res.status(409).json({ error: 'Username exists' });
  }
  const userId = generateId(8);
  users.set(userId, { username, passwordHash: hashPassword(password) });
  userBots.set(userId, new Set());
  res.json({ message: 'Registered', userId, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
  const found = [...users.entries()].find(([, u]) => u.username === username);
  if (!found) return res.status(401).json({ error: 'Invalid creds' });
  const [userId, user] = found;
  if (user.passwordHash !== hashPassword(password)) return res.status(401).json({ error: 'Invalid creds' });
  const token = generateToken(userId);
  res.json({ message: 'Logged in', token });
});

// --- Bot management routes ---

// Create bot
app.post('/api/bots', authMiddleware, (req, res) => {
  const userId = req.userId;
  const { serverIp, serverPort, username } = req.body;
  if (!serverIp) return res.status(400).json({ error: 'Missing serverIp' });

  const botId = generateId(12);
  
  // Generate random username if not provided
  const botUsername = username || `NoobBot_${Math.random().toString(36).substring(2, 8)}`;
  
  const bot = new BotInstance({ 
    id: botId, 
    userId, 
    serverIp, 
    serverPort: serverPort || 25565, 
    username: botUsername 
  });

  bots.set(botId, bot);
  if (!userBots.has(userId)) userBots.set(userId, new Set());
  userBots.get(userId).add(botId);

  // Start the bot connection
  bot.spawn();

  res.json({ message: 'Bot created and connecting', botId, info: bot.getInfo() });
});

// List user's bots
app.get('/api/bots', authMiddleware, (req, res) => {
  const userId = req.userId;
  const ids = [...(userBots.get(userId) || [])];
  const infos = ids.map(id => bots.get(id)?.getInfo()).filter(Boolean);
  res.json(infos);
});

// Get bot info
app.get('/api/bots/:botId', authMiddleware, (req, res) => {
  const userId = req.userId;
  const bot = bots.get(req.params.botId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  if (bot.userId !== userId) return res.status(403).json({ error: 'Forbidden' });
  res.json(bot.getInfo());
});

// Send chat command to bot
app.post('/api/bots/:botId/command', authMiddleware, (req, res) => {
  const userId = req.userId;
  const bot = bots.get(req.params.botId);
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Missing command' });
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  if (bot.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

  const sent = bot.sendCommand(command);
  if (!sent) return res.status(400).json({ error: 'Bot not connected' });

  res.json({ message: `Command sent: ${command}` });
});

// Disconnect bot
app.post('/api/bots/:botId/disconnect', authMiddleware, (req, res) => {
  const userId = req.userId;
  const bot = bots.get(req.params.botId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  if (bot.userId !== userId) return res.status(403).json({ error: 'Forbidden' });
  bot.disconnect();
  res.json({ message: 'Bot disconnect requested' });
});

// Delete bot
app.delete('/api/bots/:botId', authMiddleware, (req, res) => {
  const userId = req.userId;
  const botId = req.params.botId;
  const bot = bots.get(botId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  if (bot.userId !== userId) return res.status(403).json({ error: 'Forbidden' });
  bot.disconnect();
  bots.delete(botId);
  userBots.get(userId).delete(botId);
  res.json({ message: 'Bot deleted' });
});

// --- WebSocket server for real-time bot interaction ---

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  let botId = null;
  let userId = null;

  try {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const token = params.get('token');
    botId = params.get('botId');
    
    if (!token || !botId) {
      ws.send(JSON.stringify({ error: 'Missing token or botId query params' }));
      return ws.close();
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
      ws.send(JSON.stringify({ error: 'Invalid token' }));
      return ws.close();
    }
    
    userId = decoded.userId;
    const bot = bots.get(botId);
    if (!bot) {
      ws.send(JSON.stringify({ error: 'Bot not found' }));
      return ws.close();
    }
    
    if (bot.userId !== userId) {
      ws.send(JSON.stringify({ error: 'Forbidden for this bot' }));
      return ws.close();
    }

    // Attach WS to bot
    bot.attachWS(ws);

    // Send initial bot info
    ws.send(JSON.stringify({ type: 'info', bot: bot.getInfo() }));

    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'command' && typeof msg.command === 'string') {
          const success = bot.sendCommand(msg.command);
          if (!success) {
            ws.send(JSON.stringify({ type: 'error', message: 'Bot not connected' }));
          }
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type or invalid data' }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON format' }));
      }
    });

    ws.on('close', () => {
      if (botId && bots.has(botId)) {
        bots.get(botId).detachWS(ws);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      if (botId && bots.has(botId)) {
        bots.get(botId).detachWS(ws);
      }
    });

  } catch (err) {
    console.error('WebSocket connection error:', err);
    ws.send(JSON.stringify({ error: 'Server error on connection' }));
    ws.close();
  }
});

// Cleanup disconnected bots periodically
setInterval(() => {
  for (const [botId, bot] of bots.entries()) {
    if (bot.state === 'error' && bot.wsClients.size === 0) {
      // Clean up bots that errored and have no active connections
      const userId = bot.userId;
      if (userBots.has(userId)) {
        userBots.get(userId).delete(botId);
      }
      bot.disconnect();
      bots.delete(botId);
      console.log(`Cleaned up abandoned bot: ${botId}`);
    }
  }
}, 60000); // Check every minute

// --- Start server ---

server.listen(PORT, () => {
  console.log(`MinecraftBot Platform Backend running on http://localhost:${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}/ws`);
});

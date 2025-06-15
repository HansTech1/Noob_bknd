import mineflayer from 'mineflayer'
import { pathfinder, Movements, goals } from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

export class BotInstance {
  constructor({ id, userId, serverIp, serverPort = 25565, username }) {
    this.id = id
    this.userId = userId
    this.serverIp = serverIp
    this.serverPort = serverPort
    this.username = username || `NoobBot_${Math.random().toString(36).substring(2, 8)}`
    this.state = 'idle'
    this.logs = []
    this.commandHistory = []
    this.bot = null
    this.wsClients = new Set()
    this.lastCommandAt = null
    this.error = null
    this.behaviorInterval = null
    this.chatInterval = null
  }

  log(msg) {
    const timestamp = new Date().toISOString()
    const line = `[${timestamp}] ${msg}`
    this.logs.push(line)
    if (this.logs.length > 1000) this.logs.shift()
    console.log(`Bot[${this.id}]: ${msg}`)

    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ type: 'log', botId: this.id, message: line }))
        } catch (err) {
          console.error('Échec de l’envoi du log via WebSocket :', err)
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
    }
  }

  spawn() {
    if (this.bot) {
      this.log('Le bot existe déjà, déconnexion en cours...')
      this.disconnect()
    }

    this.state = 'connecting'
    this.error = null
    this.log(`Connexion à ${this.serverIp}:${this.serverPort} en tant que ${this.username}...`)

    try {
      this.bot = mineflayer.createBot({
        host: this.serverIp,
        port: this.serverPort,
        username: this.username,
        auth: 'offline'
      })

      const connectionTimeout = setTimeout(() => {
        if (this.state === 'connecting') {
          this.log('Timeout de connexion - trop long à se connecter')
          this.state = 'error'
          this.error = 'Timeout de connexion'
          if (this.bot) this.bot.quit()
        }
      }, 30000)

      this.bot.once('login', () => {
        clearTimeout(connectionTimeout)
        this.state = 'connected'
        this.log('Bot connecté au serveur avec succès !')
        this.bot.loadPlugin(pathfinder)
        this.startRandomBehavior()
      })

      this.bot.once('end', (reason) => {
        clearTimeout(connectionTimeout)
        this.state = 'disconnected'
        this.log(`Bot déconnecté : ${reason || 'Raison inconnue'}`)
        this.stopBehavior()
      })

      this.bot.once('error', (err) => {
        clearTimeout(connectionTimeout)
        this.state = 'error'
        this.error = err.message || String(err)
        this.log(`Erreur de connexion : ${this.error}`)
        this.stopBehavior()
      })

      this.bot.on('chat', (username, message) => {
        const chatLog = `[CHAT] <${username}> ${message}`
        this.log(chatLog)

        for (const ws of this.wsClients) {
          if (ws.readyState === 1) {
            try {
              ws.send(JSON.stringify({
                type: 'chat',
                botId: this.id,
                username,
                message
              }))
            } catch (err) {
              console.error('Échec de l’envoi du chat via WebSocket :', err)
            }
          }
        }
      })

      this.bot.on('kicked', (reason) => {
        this.log(`Bot expulsé : ${reason}`)
        this.state = 'error'
        this.error = `Expulsé : ${reason}`
      })

    } catch (err) {
      this.state = 'error'
      this.error = err.message || String(err)
      this.log(`Échec de création du bot : ${this.error}`)
    }
  }

  startRandomBehavior() {
    if (!this.bot || this.state !== 'connected') return

    const humanMessages = [
      "Y'a quelqu'un ici ?",
      "C’est calme…",
      "Quelqu’un veut jouer ?",
      "Je suis là 😄",
      "Hello 👋",
      "On fait quoi ?",
      "Vous êtes où ?"
    ]

    // Envoi de messages humains toutes les 20-25 minutes
    this.chatInterval = setInterval(() => {
      if (this.bot && this.state === 'connected') {
        const msg = humanMessages[Math.floor(Math.random() * humanMessages.length)]
        this.bot.chat(msg)
        this.log(`Chat automatique : ${msg}`)
      }
    }, 20 * 60 * 1000 + Math.random() * 5 * 60 * 1000)

    const mcData = require('minecraft-data')(this.bot.version)
    const defaultMove = new Movements(this.bot, mcData)

    // Comportement de mouvement toutes les 2-4 minutes
    this.behaviorInterval = setInterval(async () => {
      if (!this.bot || this.state !== 'connected') return

      const pos = this.bot.entity.position
      const offset = new Vec3(
        Math.floor(Math.random() * 10 - 5),
        0,
        Math.floor(Math.random() * 10 - 5)
      )
      const dest = pos.plus(offset)

      try {
        this.bot.pathfinder.setMovements(defaultMove)
        this.bot.pathfinder.setGoal(new goals.GoalBlock(dest.x, dest.y, dest.z))
        this.log('Déplacement vers un endroit proche...')

        // Rarement casser un bloc de bois s’il en trouve
        if (Math.random() < 0.2) {
          const logBlock = this.bot.findBlock({
            matching: block => block.name.includes('log'),
            maxDistance: 10
          })
          if (logBlock) {
            this.log(`Bloc de bois trouvé, tentative de cassage...`)
            await this.bot.dig(logBlock)
            this.log(`Bloc de bois cassé.`)
          }
        }
      } catch (err) {
        this.log(`Erreur de déplacement : ${err.message}`)
      }
    }, 2 * 60 * 1000 + Math.random() * 2 * 60 * 1000)
  }

  stopBehavior() {
    if (this.chatInterval) clearInterval(this.chatInterval)
    if (this.behaviorInterval) clearInterval(this.behaviorInterval)
    this.chatInterval = null
    this.behaviorInterval = null
  }

  sendCommand(command) {
    if (this.state !== 'connected' || !this.bot) {
      this.log('Impossible d’envoyer la commande : bot non connecté.')
      return false
    }

    this.lastCommandAt = new Date()
    this.commandHistory.push({ command, timestamp: this.lastCommandAt })
    this.log(`Envoi de la commande : ${command}`)

    try {
      this.bot.chat(command)
      return true
    } catch (err) {
      this.log(`Échec d’envoi de la commande : ${err.message}`)
      return false
    }
  }

  disconnect() {
    this.stopBehavior()
    if (this.bot) {
      try {
        if (this.state === 'connected' || this.state === 'connecting') {
          this.bot.quit('Déconnecté par l’utilisateur')
        }
      } catch (err) {
        this.log(`Erreur lors de la déconnexion : ${err.message}`)
      }
      this.bot = null
    }
    if (this.state !== 'error') this.state = 'disconnected'
    this.log('Bot déconnecté.')
  }

  attachWS(ws) {
    this.wsClients.add(ws)
    this.log(`Client WebSocket connecté. Nombre total : ${this.wsClients.size}`)
  }

  detachWS(ws) {
    this.wsClients.delete(ws)
    this.log(`Client WebSocket déconnecté. Nombre total : ${this.wsClients.size}`)
  }
}

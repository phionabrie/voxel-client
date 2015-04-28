var url = require('url')
var websocket = require('websocket-stream')
var engine = require('voxel-engine')
//var duplexEmitter = require('duplex-emitter')
var EventEmitter = require('events').EventEmitter
var randomName = require('./randomname')
var crunch = require('voxel-crunch')
var emitChat = require('./chat')
var highlight = require('voxel-highlight')
var skin = require('minecraft-skin')
var player = require('voxel-player')
var texturePath = "/textures/"

var throttle = function(callback, max) {
  var last = 0
  var timeout
  // cache last call's arguments, for the timeout
  return function() {
    var now = Date.now()
    var diff = now - last
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
    if (diff < max) {
      // If it's too soon to trigger the callback, schedule for later
      setTimeout(
        callback(),
        // try to schedule it to be right on time
        max - diff + 10
      )
      return
    }
    callback()
    last = now
  }
}

//var game
// My own DuplexEmitter that works in Chrome
var de = function(socket) {
  var self = this;
  var ee = new EventEmitter();//.call(this);

  socket.on('data', function(data) {
    var d 
    try {
      d = JSON.parse(data.toString())
    } catch(err) {
      return;
    }
    ee.emit.apply(ee, d);
  });

  this.on = function() {
    ee.on.apply(ee, Array.prototype.slice.apply(arguments));
  }

  this.emit = function() {
    var message = JSON.stringify(Array.prototype.slice.apply(arguments)) + '\n';
    socket.write(message);
  };
};


module.exports = Client

function Client(server, game) {
  if(!(this instanceof Client)) {
    return new Client(server, game)
  }
  this.playerID
  this.lastProcessedSeq = 0
  this.localInputs = []
  this.connected = false
  this.currentMaterial = 1
  this.lerpPercent = 0.1
  this.server = server || 'ws://' + url.parse(window.location.href).host
  this.others = {}
  this.connect(server, game)
  this.game
  window.others = this.others
}

Client.prototype.connect = function(server, game) {
  var self = this
  var socket = websocket(server)
  socket.on('end', function() { self.connected = false })
  this.socket = socket
  this.bindEvents(socket, game)
}

Client.prototype.bindEvents = function(socket, game) {
  var self = this
  //this.emitter = duplexEmitter(socket)
  var emitter = this.emitter = new de(socket)
  this.connected = true

  emitter.on('id', function(id) {
    console.log('got id', id)
    self.playerID = id
    if (game != null) {
  	  self.game = game
  	  console.log("Sending local settings to the server.")
  	  emitter.emit('clientSettings', self.game.settings)
    } else {
  	  emitter.emit('clientSettings', null)
    }
  })
  
  emitter.on('settings', function(settings) {
    settings.isClient = true
    settings.texturePath = texturePath
    settings.generateChunks = false
	//deserialise the voxel.generator function.
	if (settings.generatorToString != null) {
		settings.generate = eval("(" + settings.generatorToString + ")")
	}
    self.game = self.createGame(settings, game)	
	emitter.emit('created')
    emitter.on('chunk', function(encoded, chunk) {
      chunk.voxels = crunch.decode(encoded, new Uint8Array(chunk.length))
      chunk.dims = [settings.chunkSize, settings.chunkSize, settings.chunkSize]
      self.game.showChunk(chunk)
    })
  })

  // fires when server sends us voxel edits
  emitter.on('set', function(pos, val) {
    self.game.setBlock(pos, val)
  })
}

Client.prototype.createGame = function(settings, game) {
  var self = this
  var emitter = this.emitter
  settings.controlsDisabled = false
  self.game = engine(settings)
  self.game.settings = settings

  var sendState = throttle(
    function() {
      if (!self.connected) return
      var player = self.game.controls.target()
      var state = {
        position: player.yaw.position,
        rotation: {
          y: player.yaw.rotation.y,
          x: player.pitch.rotation.x
        }
      }
      emitter.emit('state', state)
    },
    50
  )
  
  var name = localStorage.getItem('name')
  if (!name) {
    name = randomName()
    localStorage.setItem('name', name)
  }

  self.game.controls.on('data', function(state) {
    var interacting = false
    Object.keys(state).map(function(control) {
      if (state[control] > 0) interacting = true
    })
    // should debounce this
    if (interacting) sendState()
  })
    
  emitChat(name, emitter)

  // setTimeout is because three.js seems to throw errors if you add stuff too soon
  setTimeout(function() {
    emitter.on('update', function(updates) {      
      Object.keys(updates.positions).map(function(player) {
        var update = updates.positions[player]
        if (player === self.playerID) return self.onServerUpdate(update) // local player
        self.updatePlayerPosition(player, update) // other players
      })
    })
  }, 1000)

  emitter.on('leave', function(id) {
    if (!self.others[id]) return
    self.game.scene.remove(self.others[id].mesh)
    delete self.others[id]
  })

  self.game.voxels.on('missingChunk', function(chunkPos) {
    var chunkID = chunkPos.join('|')
    emitter.emit('need', chunkID)
  })

  return self.game
}

Client.prototype.onServerUpdate = function(update) {
  // todo use server sent location
}

Client.prototype.lerpMe = function(position) {
  var to = new this.game.THREE.Vector3()
  to.copy(position)
  var from = this.game.controls.target().yaw.position
  from.copy(from.lerp(to, this.lerpPercent))  
}

Client.prototype.updatePlayerPosition = function(id, update) {
  var pos = update.position
  var player = this.others[id]
  if (!player) {
    var playerSkin = skin(this.game.THREE, 'player.png', {
      scale: new this.game.THREE.Vector3(0.04, 0.04, 0.04)
    })
    var playerMesh = playerSkin.mesh
    this.others[id] = playerSkin
    playerMesh.children[0].position.y = 10
    this.game.scene.add(playerMesh)
  }
  var playerSkin = this.others[id]
  var playerMesh = playerSkin.mesh
  playerMesh.position.copy(playerMesh.position.lerp(pos, this.lerpPercent))
  
  // playerMesh.position.y += 17
  playerMesh.children[0].rotation.y = update.rotation.y + (Math.PI / 2)
  playerSkin.head.rotation.z = scale(update.rotation.x, -1.5, 1.5, -0.75, 0.75)
}

function scale( x, fromLow, fromHigh, toLow, toHigh ) {
  return ( x - fromLow ) * ( toHigh - toLow ) / ( fromHigh - fromLow ) + toLow
}

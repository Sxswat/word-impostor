const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

const wordBank = {
  "Animals": ["Elephant", "Penguin", "Crocodile", "Flamingo", "Kangaroo", "Dolphin", "Cheetah", "Gorilla"],
  "Food": ["Spaghetti", "Sushi", "Hamburger", "Croissant", "Tacos", "Ramen", "Pizza", "Biryani"],
  "Sports": ["Basketball", "Cricket", "Swimming", "Gymnastics", "Badminton", "Wrestling", "Archery", "Surfing"],
  "Places": ["Eiffel Tower", "Amazon Jungle", "Sahara Desert", "Great Wall", "Times Square", "Colosseum", "Taj Mahal", "Niagara Falls"],
  "Movies": ["Inception", "Titanic", "Avatar", "Interstellar", "The Matrix", "Joker", "Avengers", "Parasite"],
  "Technology": ["Smartphone", "Laptop", "Bluetooth", "Robot", "Satellite", "3D Printer", "Drone", "Virtual Reality"],
  "Professions": ["Astronaut", "Surgeon", "Architect", "Detective", "Pilot", "Firefighter", "Chef", "Scientist"],
  "Nature": ["Volcano", "Tornado", "Rainbow", "Glacier", "Coral Reef", "Waterfall", "Thunder", "Eclipse"],
};

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function randomFrom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function pickWordAndCategory() {
  const categories = Object.keys(wordBank);
  const category = randomFrom(categories);
  const word = randomFrom(wordBank[category]);
  return { word, category };
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function calculateScores(room, impostorId) {
  const players = room.players;
  const nonImpostorCount = players.length - 1;
  let correctVotes = 0;
  const voteTargets = Object.values(room.votes);
  voteTargets.forEach(votedId => {
    if (votedId === impostorId) correctVotes++;
  });

  let impostorPoints = 0;
  if (correctVotes === 0) {
    impostorPoints = 2;
  } else if (correctVotes < nonImpostorCount / 2) {
    impostorPoints = 1;
  } else {
    impostorPoints = 0;
  }

  players.forEach(player => {
    if (player.id === impostorId) {
      player.score += impostorPoints;
      player.timesAsImpostor = (player.timesAsImpostor || 0) + 1;
    } else {
      const theirVote = room.votes[player.id];
      if (theirVote === impostorId) {
        player.score += 1;
      }
      player.timesAsRegular = (player.timesAsRegular || 0) + 1;
    }
  });

  return { correctVotes, impostorPoints, nonImpostorCount };
}

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on("create_room", ({ playerName }) => {
    let roomCode;
    do { roomCode = generateRoomCode(); } while (rooms[roomCode]);

    rooms[roomCode] = {
      code: roomCode,
      hostId: socket.id,
      players: [],
      gameState: "lobby",
      currentWord: null,
      currentCategory: null,
      impostorId: null,
      turnOrder: [],
      votes: {},
      roundNumber: 0,
    };

    rooms[roomCode].players.push({
      id: socket.id,
      name: playerName,
      score: 0,
      timesAsImpostor: 0,
      timesAsRegular: 0,
      isHost: true,
    });

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.emit("room_created", { roomCode, playerId: socket.id });
    console.log(`Room ${roomCode} created by ${playerName}`);
  });

  socket.on("join_room", ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) { socket.emit("error", { message: "Room not found! Check the code." }); return; }
    if (room.gameState !== "lobby") {
      // Allow rejoin if player was already in the room
      const existingPlayer = room.players.find(p => p.name === playerName);
      if (!existingPlayer) {
        socket.emit("error", { message: "Game already started!" }); 
        return; 
      }
    }
    if (room.players.length >= 15) { socket.emit("error", { message: "Room is full!" }); return; }

    room.players.push({
      id: socket.id,
      name: playerName,
      score: 0,
      timesAsImpostor: 0,
      timesAsRegular: 0,
      isHost: false,
    });

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.emit("room_joined", { roomCode, playerId: socket.id });
    io.to(roomCode).emit("players_updated", { players: room.players });
    console.log(`${playerName} joined room ${roomCode}`);
  });

  socket.on("start_game", () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 3) { socket.emit("error", { message: "Need at least 3 players!" }); return; }

    const { word, category } = pickWordAndCategory();
    const impostorIndex = Math.floor(Math.random() * room.players.length);
    const impostor = room.players[impostorIndex];
    const turnOrder = shuffle(room.players.map(p => ({ id: p.id, name: p.name })));

    room.gameState = "playing";
    room.currentWord = word;
    room.currentCategory = category;
    room.impostorId = impostor.id;
    room.turnOrder = turnOrder;
    room.votes = {};
    room.roundNumber += 1;

    room.players.forEach(player => {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (!playerSocket) return;
      if (player.id === impostor.id) {
        playerSocket.emit("game_started", { role: "impostor", word: null, category, turnOrder, roundNumber: room.roundNumber, players: room.players });
      } else {
        playerSocket.emit("game_started", { role: "regular", word, category, turnOrder, roundNumber: room.roundNumber, players: room.players });
      }
    });
    console.log(`Game started in ${roomCode}. Word: ${word}, Impostor: ${impostor.name}`);
  });

  socket.on("start_voting", () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    room.gameState = "voting";
    room.votes = {};
    io.to(roomCode).emit("voting_started", { players: room.players.map(p => ({ id: p.id, name: p.name })) });
  });

  socket.on("cast_vote", ({ votedPlayerId }) => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];
    if (!room || room.gameState !== "voting") return;
    if (votedPlayerId === socket.id) { socket.emit("error", { message: "Can't vote for yourself!" }); return; }
    room.votes[socket.id] = votedPlayerId;
    io.to(roomCode).emit("vote_update", { votesCount: Object.keys(room.votes).length, totalPlayers: room.players.length });
    if (Object.keys(room.votes).length === room.players.length) {
      revealResults(roomCode);
    }
  });

  socket.on("reveal_results", () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    revealResults(roomCode);
  });

  socket.on("end_game", () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    const leaderboard = [...room.players].sort((a, b) => b.score - a.score);
    io.to(roomCode).emit("game_ended", { leaderboard });
  });

  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];

    // Mark player as disconnected instead of removing them
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.disconnected = true;
      player.oldId = socket.id;
    }

    // Give them 30 seconds to rejoin before removing them
    setTimeout(() => {
      if (!rooms[roomCode]) return;
      const p = room.players.find(p => p.oldId === socket.id && p.disconnected);
      if (p) {
        room.players = room.players.filter(p => p.oldId !== socket.id);
        if (room.players.length === 0) { delete rooms[roomCode]; return; }
        if (room.hostId === socket.id && room.players.length > 0) {
          room.hostId = room.players[0].id;
          room.players[0].isHost = true;
        }
        io.to(roomCode).emit("players_updated", { players: room.players });
      }
    }, 30000);

    io.to(roomCode).emit("players_updated", { players: room.players });
  });

  socket.on("rejoin_room", ({ roomCode, playerName, isHost }) => {
    const room = rooms[roomCode];
    if (!room) { 
      socket.emit("rejoin_failed"); 
      return; 
    }

    // Find the disconnected player by name
    const existingPlayer = room.players.find(p => p.name === playerName);
    if (!existingPlayer) { 
      socket.emit("rejoin_failed"); 
      return; 
    }

    // Update their socket ID to the new connection
    const oldId = existingPlayer.id;
    existingPlayer.id = socket.id;
    existingPlayer.disconnected = false;

    // If this player was the host, update hostId
    if (room.hostId === oldId) {
      room.hostId = socket.id;
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;

    // Send them back their game state
    socket.emit("rejoined", {
      roomCode,
      playerId: socket.id,
      isHost: room.hostId === socket.id,
      gameState: room.gameState,
      players: room.players,
      turnOrder: room.turnOrder,
      roundNumber: room.roundNumber,
      impostorId: room.impostorId,
      word: room.currentWord,
      category: room.currentCategory,
    });

    io.to(roomCode).emit("players_updated", { players: room.players });
    console.log(`${playerName} rejoined room ${roomCode}`);
  });
});

function revealResults(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const impostorId = room.impostorId;
  const { correctVotes, impostorPoints, nonImpostorCount } = calculateScores(room, impostorId);
  const impostor = room.players.find(p => p.id === impostorId);
  const voteBreakdown = {};
  Object.entries(room.votes).forEach(([voterId, votedId]) => {
    const voter = room.players.find(p => p.id === voterId);
    const voted = room.players.find(p => p.id === votedId);
    if (voter && voted) voteBreakdown[voter.name] = voted.name;
  });
  room.gameState = "results";
  io.to(roomCode).emit("results_revealed", {
    impostorId, impostorName: impostor?.name, impostorPoints, correctVotes,
    nonImpostorCount, word: room.currentWord, category: room.currentCategory,
    voteBreakdown, players: room.players,
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
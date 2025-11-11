const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Servi file statici dalla cartella 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Route principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Gestione giocatori e partite
let players = {};
let games = {};

io.on('connection', (socket) => {
    console.log('🔗 Nuovo giocatore connesso:', socket.id);

    // Nuovo giocatore si unisce
    socket.on('player_join', (playerData) => {
        const playerName = playerData.name || `Giocatore${Object.keys(players).length + 1}`;
        
        players[socket.id] = {
            id: socket.id,
            name: playerName,
            ballPosition: { x: 50 + (Object.keys(players).length * 30), y: 450 },
            shots: 0,
            color: getPlayerColor(Object.keys(players).length),
            room: playerData.room || 'public'
        };

        // Unisciti alla stanza
        socket.join(players[socket.id].room);

        // Notifica tutti nella stanza
        io.to(players[socket.id].room).emit('players_update', getRoomPlayers(players[socket.id].room));
        io.to(players[socket.id].room).emit('chat_message', {
            player: 'Sistema',
            message: `🎮 ${players[socket.id].name} si è unito alla partita!`,
            type: 'system'
        });

        console.log(`👥 Giocatori online: ${Object.keys(players).length}`);
    });

    // Gestione colpi
    socket.on('player_shot', (shotData) => {
        if (players[socket.id]) {
            players[socket.id].ballPosition = shotData.endPos;
            players[socket.id].shots++;
            
            // Invia a tutti tranne al mittente nella stessa stanza
            socket.to(players[socket.id].room).emit('player_shot', {
                playerId: socket.id,
                playerName: players[socket.id].name,
                startPos: shotData.startPos,
                endPos: shotData.endPos,
                power: shotData.power
            });

            // Controlla se ha fatto buca
            checkHoleCompletion(socket.id, shotData.endPos);
        }
    });

    // Gestione chat
    socket.on('chat_message', (messageData) => {
        if (players[socket.id]) {
            io.to(players[socket.id].room).emit('chat_message', {
                player: players[socket.id].name,
                message: messageData.message,
                type: 'player'
            });
        }
    });

    // Creazione stanza privata
    socket.on('create_room', (roomData) => {
        const roomId = generateRoomId();
        games[roomId] = {
            id: roomId,
            name: roomData.name,
            password: roomData.password,
            players: []
        };
        
        socket.emit('room_created', { roomId: roomId });
        console.log(`🏠 Nuova stanza creata: ${roomId}`);
    });

    // Unione a stanza privata
    socket.on('join_room', (joinData) => {
        const room = games[joinData.roomId];
        if (room) {
            if (!room.password || room.password === joinData.password) {
                players[socket.id].room = joinData.roomId;
                socket.join(joinData.roomId);
                
                socket.emit('room_joined', { success: true, roomName: room.name });
                io.to(joinData.roomId).emit('players_update', getRoomPlayers(joinData.roomId));
            } else {
                socket.emit('room_joined', { success: false, error: 'Password errata' });
            }
        } else {
            socket.emit('room_joined', { success: false, error: 'Stanza non trovata' });
        }
    });

    // Disconnessione
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            const playerName = players[socket.id].name;
            const room = players[socket.id].room;
            
            delete players[socket.id];
            
            io.to(room).emit('players_update', getRoomPlayers(room));
            io.to(room).emit('chat_message', {
                player: 'Sistema',
                message: `👋 ${playerName} ha lasciato la partita`,
                type: 'system'
            });

            console.log(`❌ ${playerName} disconnesso. Giocatori rimanenti: ${Object.keys(players).length}`);
        }
    });
});

function getPlayerColor(index) {
    const colors = ['#FF5252', '#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#00BCD4'];
    return colors[index % colors.length];
}

function getRoomPlayers(roomId) {
    return Object.values(players).filter(player => player.room === roomId);
}

function checkHoleCompletion(playerId, ballPos) {
    const holePos = { x: 750, y: 100 }; // Posizione fissa della buca
    const dx = ballPos.x - holePos.x;
    const dy = ballPos.y - holePos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 25 && players[playerId]) {
        io.to(players[playerId].room).emit('hole_completed', {
            playerId: playerId,
            playerName: players[playerId].name,
            shots: players[playerId].shots
        });

        io.to(players[playerId].room).emit('chat_message', {
            player: 'Sistema',
            message: `🎉 ${players[playerId].name} ha completato la buca in ${players[playerId].shots} colpi!`,
            type: 'system'
        });
    }
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server Mini Golf Multiplayer running on port ${PORT}`);
    console.log(`📍 Accesso: http://localhost:${PORT}`);
});
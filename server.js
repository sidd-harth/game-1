const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Game state management
let gameState = {
    isActive: false,
    timer: 30,
    redCount: 0,
    blueCount: 0,
    players: {
        red: [],
        blue: []
    },
    playerClicks: {},
    interval: null,
    gameId: null
};

// Game history storage
const gameHistory = new Map();

// Game rules
const gameRules = [
    "Time limit is 30 seconds.",
    "You can only click your team's color block.",
    "The team with the most clicks wins.",
    "Have fun and good luck!"
];

// Routes
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/game', (req, res) => {
    res.sendFile(__dirname + '/public/game.html');
});

app.get('/admin', (req, res) => {
    res.sendFile(__dirname + '/public/admin.html');
});

// Game state management functions
function resetGameState() {
    gameState.redCount = 0;
    gameState.blueCount = 0;
    gameState.playerClicks = {};
    gameState.timer = 30;
    gameState.gameId = uuidv4();

    // Initialize click counts for all players
    Object.values(gameState.players).flat().forEach(name => {
        gameState.playerClicks[name] = 0;
    });
}

function clearGameInterval() {
    if (gameState.interval) {
        clearInterval(gameState.interval);
        gameState.interval = null;
    }
}


function endGameAndShowResults() {
    clearGameInterval();
    gameState.isActive = false;
  
    // Generate leaderboard
    const leaderboard = Object.entries(gameState.playerClicks)
      .map(([name, clicks]) => ({
        name,
        clicks,
        team: [...gameState.players.red, ...gameState.players.blue].includes(name) ?
          (gameState.players.red.includes(name) ? 'red' : 'blue') : 'unknown'
      }))
      .sort((a, b) => b.clicks - a.clicks);
  
    const winner = gameState.redCount > gameState.blueCount ? 'Red' :
      gameState.redCount < gameState.blueCount ? 'Blue' : 'Tie';
  
    // Create game result with PROPERLY STRUCTURED SCORES
    const gameResult = {
      gameId: gameState.gameId,
      scores: {
        red: gameState.redCount,  // Explicitly include scores
        blue: gameState.blueCount
      },
      winner,
      leaderboard
    };
  
    gameHistory.set(gameState.gameId, gameResult);
    
    // Emit the FULL game result
    io.emit('gameEnded', gameResult); // Include all relevant data
  }
function startGameTimer() {
    clearGameInterval();
    resetGameState();
    gameState.isActive = true;

    // Broadcast game start with 3-second countdown
    let countdown = 3;
    io.emit('countdown', countdown);

    const countdownInterval = setInterval(() => {
        countdown--;
        io.emit('countdown', countdown);

        if (countdown <= 0) {
            clearInterval(countdownInterval);
            io.emit('gameStarted', { gameId: gameState.gameId });

            // Start the 30-second game timer
            gameState.interval = setInterval(() => {
                gameState.timer--;
                io.emit('updateTimer', gameState.timer);

                if (gameState.timer <= 0) {
                    endGameAndShowResults();
                }
            }, 1000);
        }
    }, 1000);
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    // Handle player joining a team
    socket.on('joinTeam', (data) => {
        const { name, team } = data;

        // Remove player from any existing team
        gameState.players.red = gameState.players.red.filter(player => player !== name);
        gameState.players.blue = gameState.players.blue.filter(player => player !== name);

        // Add player to selected team
        gameState.players[team].push(name);
        gameState.playerClicks[name] = 0;

        // Store player info in socket
        socket.playerName = name;
        socket.team = team;

        // Broadcast updated player lists
        io.emit('updatePlayers', gameState.players);

        // Send game rules to the player
        socket.emit('showRules', gameRules);
    });

    // Handle block clicks
    socket.on('blockClick', (team) => {
        if (gameState.isActive && socket.team === team) {
            // Increment team score
            if (team === 'red') {
                gameState.redCount++;
            } else if (team === 'blue') {
                gameState.blueCount++;
            }

            // Increment player's individual score
            if (socket.playerName) {
                gameState.playerClicks[socket.playerName]++;
            }

            // Broadcast updated scores
            io.emit('updateCounts', {
                red: gameState.redCount,
                blue: gameState.blueCount,
                playerClicks: gameState.playerClicks
            });
        }
    });

    // Admin controls
    socket.on('startGame', () => {
        startGameTimer();
    });

    socket.on('restartGame', () => {
        startGameTimer();
    });

    socket.on('endGame', () => {
        endGameAndShowResults();
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        if (socket.playerName) {
            // Remove player from their team
            gameState.players.red = gameState.players.red.filter(name => name !== socket.playerName);
            gameState.players.blue = gameState.players.blue.filter(name => name !== socket.playerName);

            // Remove player's click count
            delete gameState.playerClicks[socket.playerName];

            // Broadcast updated player lists
            io.emit('updatePlayers', gameState.players);
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Handle server shutdown
process.on('SIGTERM', () => {
    http.close(() => {
        console.log('Server shutting down');
        process.exit(0);
    });
});
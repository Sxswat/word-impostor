import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import "./App.css";

const BACKEND_URL = "https://word-impostor-zyxb.onrender.com";
const socket = io(BACKEND_URL, { autoConnect: false });
const STORAGE_KEY = "word-impostor-session";

const AVATAR_COLORS = ["#7c3aed","#06b6d4","#f59e0b","#ef4444","#22c55e","#ec4899","#8b5cf6","#14b8a6","#f97316","#84cc16","#e879f9","#38bdf8","#fb923c","#a3e635","#34d399"];

function getInitial(name) { return name ? name[0].toUpperCase() : "?"; }
function getAvatarColor(index) { return AVATAR_COLORS[index % AVATAR_COLORS.length]; }

export default function App() {
  const [screen, setScreen] = useState("home");
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [playerId, setPlayerId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState("");
  const [role, setRole] = useState(null);
  const [word, setWord] = useState(null);
  const [category, setCategory] = useState(null);
  const [turnOrder, setTurnOrder] = useState([]);
  const [roundNumber, setRoundNumber] = useState(0);
  const [selectedVote, setSelectedVote] = useState(null);
  const [votesCount, setVotesCount] = useState(0);
  const [hasVoted, setHasVoted] = useState(false);
  const [results, setResults] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);

  useEffect(() => {
    // Check if player was in a room before reload
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      const { roomCode, playerName, isHost } = JSON.parse(saved);
      socket.connect();
      socket.emit("rejoin_room", { roomCode, playerName, isHost });
    } else {
      socket.connect();
    }
    socket.on("room_created", ({ roomCode, playerId }) => {
      setRoomCode(roomCode); setPlayerId(playerId); setIsHost(true); setScreen("lobby");
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ roomCode, playerName, isHost: true }));
    });
    socket.on("room_joined", ({ roomCode, playerId }) => {
      setRoomCode(roomCode); setPlayerId(playerId); setIsHost(false); setScreen("lobby");
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ roomCode, playerName, isHost: false }));
    });
    socket.on("players_updated", ({ players }) => setPlayers(players));
    socket.on("game_started", ({ role, word, category, turnOrder, roundNumber, players }) => {
      setRole(role); setWord(word); setCategory(category); setTurnOrder(turnOrder);
      setRoundNumber(roundNumber); setPlayers(players); setSelectedVote(null);
      setHasVoted(false); setVotesCount(0); setResults(null); setScreen("game");
    });
    socket.on("voting_started", ({ players }) => {
      setPlayers(players); setSelectedVote(null); setHasVoted(false); setVotesCount(0); setScreen("voting");
    });
    socket.on("vote_update", ({ votesCount }) => setVotesCount(votesCount));
    socket.on("results_revealed", (data) => {
      setResults(data); setPlayers(data.players); setScreen("results");
    });
    socket.on("game_ended", ({ leaderboard }) => {
      setLeaderboard(leaderboard); setScreen("end");
    });
    socket.on("error", ({ message }) => {
      setError(message); setTimeout(() => setError(""), 4000);
    });
    socket.on("rejoined", ({ roomCode, playerId, isHost, gameState, players, turnOrder, roundNumber, word, category, impostorId }) => {
      setRoomCode(roomCode);
      setPlayerId(playerId);
      setIsHost(isHost);
      setPlayers(players);
      setTurnOrder(turnOrder || []);
      setRoundNumber(roundNumber || 0);

      // Restore the right screen based on game state
      if (gameState === "lobby") setScreen("lobby");
      else if (gameState === "playing") {
        // Figure out their role
        const isImpostor = impostorId === playerId;
        setRole(isImpostor ? "impostor" : "regular");
        setWord(isImpostor ? null : word);
        setCategory(category);
        setScreen("game");
      }
      else if (gameState === "voting") setScreen("voting");
      else if (gameState === "results") setScreen("results");
    });

    socket.on("rejoin_failed", () => {
      // Room no longer exists, clear storage and go home
      sessionStorage.removeItem(STORAGE_KEY);
      setScreen("home");
    });

    return () => {
      socket.off("room_created"); socket.off("room_joined"); socket.off("players_updated");
      socket.off("game_started"); socket.off("voting_started"); socket.off("vote_update");
      socket.off("results_revealed"); socket.off("game_ended"); socket.off("error");
      socket.off("rejoined");
      socket.off("rejoin_failed");
    };
  }, []);

  function createRoom() {
    if (!playerName.trim()) { setError("Enter your name first!"); return; }
    setError(""); socket.emit("create_room", { playerName: playerName.trim() });
  }
  function joinRoom() {
    if (!playerName.trim()) { setError("Enter your name first!"); return; }
    if (!joinCode.trim()) { setError("Enter a room code!"); return; }
    setError(""); socket.emit("join_room", { roomCode: joinCode.trim().toUpperCase(), playerName: playerName.trim() });
  }
  function startGame() { socket.emit("start_game"); }
  function startVoting() { socket.emit("start_voting"); }
  function castVote(votedId) {
    if (hasVoted) return;
    setSelectedVote(votedId); setHasVoted(true);
    socket.emit("cast_vote", { votedPlayerId: votedId });
  }
  function revealResults() { socket.emit("reveal_results"); }
  function startNextRound() { socket.emit("start_game"); }
  function endGame() { socket.emit("end_game"); }
  function goHome() {
    sessionStorage.removeItem(STORAGE_KEY);
    socket.disconnect(); socket.connect();
    setScreen("home"); setPlayerName(""); setRoomCode(""); setJoinCode("");
    setPlayerId(null); setIsHost(false); setPlayers([]); setRole(null);
    setWord(null); setCategory(null); setResults(null); setLeaderboard(null);
  }

  return (
    <div>
      {screen === "home"    && <HomeScreen    {...{playerName, setPlayerName, joinCode, setJoinCode, createRoom, joinRoom, error}} />}
      {screen === "lobby"   && <LobbyScreen   {...{roomCode, players, playerId, isHost, startGame, error}} />}
      {screen === "game"    && <GameScreen    {...{role, word, category, turnOrder, playerId, players, isHost, startVoting, roundNumber}} />}
      {screen === "voting"  && <VotingScreen  {...{players, playerId, selectedVote, hasVoted, votesCount, castVote, isHost, revealResults}} />}
      {screen === "results" && <ResultsScreen {...{results, players, playerId, isHost, startNextRound, endGame}} />}
      {screen === "end"     && <EndScreen     {...{leaderboard, goHome}} />}
    </div>
  );
}

function HomeScreen({ playerName, setPlayerName, joinCode, setJoinCode, createRoom, joinRoom, error }) {
  return (
    <div className="page">
      <div className="card">
        <div className="logo-section">
          <div className="logo-icon">🕵️</div>
          <h1 className="logo-title">Word Impostor</h1>
          <p className="logo-sub">One of you is lying. Find out who.</p>
        </div>
        {error && <div className="error-msg">{error}</div>}
        <div className="input-group">
          <label>Your Name</label>
          <input className="input" placeholder="Enter your name..." value={playerName}
            onChange={e => setPlayerName(e.target.value)} maxLength={20} style={{textTransform:"none", letterSpacing:"normal"}} />
        </div>
        <button className="btn btn-primary" onClick={createRoom}>✦ Create New Room</button>
        <div className="or-divider"><span>or join existing</span></div>
        <div className="input-group">
          <label>Room Code</label>
          <input className="input" placeholder="XXXXXX" value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())} maxLength={6} />
        </div>
        <button className="btn btn-secondary" onClick={joinRoom}>→ Join Room</button>
      </div>
    </div>
  );
}

function LobbyScreen({ roomCode, players, playerId, isHost, startGame, error }) {
  return (
    <div className="page">
      <div className="card">
        <p className="section-label">Room Code</p>
        <div className="room-code">{roomCode}</div>
        <p className="hint">Share this code with your friends!</p>
        {error && <div className="error-msg">{error}</div>}
        <p className="section-label">{players.length} Player{players.length !== 1 ? "s" : ""}</p>
        <div className="player-list">
          {players.map((p, i) => (
            <div key={p.id} className="player-chip">
              <div className="avatar" style={{background: getAvatarColor(i)}}>{getInitial(p.name)}</div>
              <span className="player-name">{p.name}</span>
              {p.isHost && <span className="badge host">Host</span>}
              {p.id === playerId && <span className="badge you">You</span>}
            </div>
          ))}
        </div>
        {isHost ? (
          <button className="btn btn-primary" onClick={startGame} disabled={players.length < 3} style={{marginTop:16}}>
            {players.length < 3 ? `Need ${3 - players.length} more player(s)...` : "▶ Start Game"}
          </button>
        ) : (
          <p className="waiting">⏳ Waiting for host to start...</p>
        )}
      </div>
    </div>
  );
}

function GameScreen({ role, word, category, turnOrder, playerId, players, isHost, startVoting, roundNumber }) {
  return (
    <div className="page">
      <div className="card card-wide">
        <div className="round-header">
          <h2>Round {roundNumber}</h2>
          <span className="badge host">{players.length} players</span>
        </div>
        <div className={`role-card ${role}`}>
          {role === "regular" ? (
            <>
              <p className="role-label">🔤 Your Secret Word</p>
              <p className="role-word">{word}</p>
              <p className="role-category">Category: {category}</p>
              <p className="role-hint">Give clues without saying this word!</p>
            </>
          ) : (
            <>
              <p className="role-label" style={{color:"#ef4444"}}>🎭 You Are The Impostor</p>
              <p className="role-word" style={{color:"#ef4444"}}>???</p>
              <p className="role-category">Category hint: <strong>{category}</strong></p>
              <p className="role-hint">Blend in. Use the category to guess the word!</p>
            </>
          )}
        </div>
        <p className="section-label" style={{marginTop:20}}>Speaking Order</p>
        <div className="turn-list">
          {turnOrder.map((p, i) => (
            <div key={p.id} className={`turn-item ${p.id === playerId ? "is-you" : ""}`}>
              <div className="turn-num">{i + 1}</div>
              <span>{p.name}</span>
              {p.id === playerId && <span className="badge you">You</span>}
            </div>
          ))}
        </div>
        {isHost ? (
          <button className="btn btn-primary" onClick={startVoting} style={{marginTop:20}}>🗳️ Start Voting</button>
        ) : (
          <p className="waiting">⏳ Host will start voting when everyone has spoken.</p>
        )}
      </div>
    </div>
  );
}

function VotingScreen({ players, playerId, selectedVote, hasVoted, votesCount, castVote, isHost, revealResults }) {
  const total = players.length;
  return (
    <div className="page">
      <div className="card">
        <div style={{textAlign:"center", marginBottom:20}}>
          <h2 style={{fontSize:"1.8rem", fontWeight:800}}>🗳️ Vote!</h2>
          <p className="hint">Who do you think is the impostor?</p>
        </div>
        <div className="vote-progress-wrap">
          <span className="section-label" style={{margin:0}}>Votes Cast</span>
          <span className="vote-count">{votesCount}/{total}</span>
        </div>
        <div className="progress-bar"><div className="progress-fill" style={{width:`${(votesCount/total)*100}%`}}/></div>
        <div style={{marginTop:16}}>
          {players.filter(p => p.id !== playerId).map((p, i) => (
            <div key={p.id} className={`vote-option ${selectedVote === p.id ? "selected" : ""}`}
              onClick={() => !hasVoted && castVote(p.id)}>
              <div className="avatar" style={{background: getAvatarColor(i), width:36, height:36, fontSize:"0.85rem"}}>{getInitial(p.name)}</div>
              <span style={{fontWeight:600, flex:1}}>{p.name}</span>
              {selectedVote === p.id && <span style={{color:"#7c3aed"}}>✓</span>}
            </div>
          ))}
        </div>
        {hasVoted && <div className="voted-msg">✓ Vote cast! Waiting for others...</div>}
        {isHost && <button className="btn btn-secondary" onClick={revealResults} style={{marginTop:16}}>Reveal Results Now</button>}
      </div>
    </div>
  );
}

function ResultsScreen({ results, players, playerId, isHost, startNextRound, endGame }) {
  if (!results) return null;
  const { impostorId, impostorName, impostorPoints, correctVotes, nonImpostorCount, word, category } = results;
  return (
    <div className="page">
      <div className="card card-wide">
        <div style={{textAlign:"center", marginBottom:20}}>
          <h2 style={{fontSize:"1.8rem", fontWeight:800}}>Round Results</h2>
          <p className="hint">
            {correctVotes === 0 ? "🎭 The impostor fooled everyone!" :
             correctVotes >= nonImpostorCount / 2 ? "🔍 The group caught the impostor!" :
             "🤔 Some people were suspicious..."}
          </p>
        </div>
        <div className="impostor-reveal">
          <span style={{fontSize:"2rem"}}>🎭</span>
          <div>
            <p className="section-label" style={{margin:0}}>The Impostor Was</p>
            <p style={{fontWeight:800, fontSize:"1.2rem"}}>{impostorName}</p>
          </div>
          <div style={{marginLeft:"auto", textAlign:"right"}}>
            <p className="section-label" style={{margin:0}}>Points Earned</p>
            <p style={{fontWeight:800, fontSize:"1.5rem", color: impostorPoints > 0 ? "#f59e0b" : "#ef4444"}}>+{impostorPoints}</p>
          </div>
        </div>
        <div className="word-reveal">
          <p className="section-label">The Secret Word Was</p>
          <p style={{fontWeight:800, fontSize:"1.8rem", color:"#06b6d4"}}>{word}</p>
          <p style={{color:"#8888aa", fontSize:"0.85rem"}}>Category: {category}</p>
        </div>
        <p className="section-label">Updated Scores</p>
        <div className="player-list">
          {[...players].sort((a,b) => b.score - a.score).map((p, i) => (
            <div key={p.id} className="player-chip">
              <div className="avatar" style={{background: getAvatarColor(i)}}>{getInitial(p.name)}</div>
              <span className="player-name">{p.name}{p.id === playerId ? " (you)" : ""}</span>
              {p.id === impostorId && <span className="badge" style={{background:"rgba(239,68,68,0.2)",color:"#ef4444"}}>Impostor</span>}
              <span style={{fontFamily:"monospace", color:"#06b6d4"}}>{p.score} pts</span>
            </div>
          ))}
        </div>
        {isHost ? (
          <div style={{display:"flex", gap:12, marginTop:16}}>
            <button className="btn btn-primary" onClick={startNextRound} style={{flex:1}}>▶ Next Round</button>
            <button className="btn btn-danger" onClick={endGame} style={{flex:1}}>🏆 End Game</button>
          </div>
        ) : (
          <p className="waiting">⏳ Waiting for host...</p>
        )}
      </div>
    </div>
  );
}

function EndScreen({ leaderboard, goHome }) {
  if (!leaderboard) return null;
  const medals = ["🥇","🥈","🥉"];
  return (
    <div className="page">
      <div className="card">
        <div style={{textAlign:"center", marginBottom:28}}>
          <div style={{fontSize:"3rem"}}>🏆</div>
          <h2 style={{fontWeight:800, fontSize:"2rem"}}>Game Over!</h2>
          <p className="hint">Final Leaderboard</p>
        </div>
        {leaderboard.map((p, i) => (
          <div key={p.id} className="leaderboard-item" style={{border: i===0 ? "1px solid #f59e0b" : undefined}}>
            <span style={{fontSize:"1.5rem", width:32, textAlign:"center"}}>{medals[i] || `#${i+1}`}</span>
            <div className="avatar" style={{background: getAvatarColor(i)}}>{getInitial(p.name)}</div>
            <div style={{flex:1}}>
              <p style={{fontWeight:700}}>{p.name}</p>
              <p style={{fontSize:"0.78rem", color:"#8888aa"}}>🎭 Impostor ×{p.timesAsImpostor||0} | 👤 Regular ×{p.timesAsRegular||0}</p>
            </div>
            <span style={{fontFamily:"monospace", fontWeight:700, fontSize:"1.2rem", color: i===0?"#f59e0b":"#06b6d4"}}>{p.score}pts</span>
          </div>
        ))}
        <button className="btn btn-primary" onClick={goHome} style={{marginTop:24}}>↩ Back to Home</button>
      </div>
    </div>
  );
}
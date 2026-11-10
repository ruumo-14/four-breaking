import * as THREE from 'https://esm.sh/three';
import { OrbitControls } from 'https://esm.sh/three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

const supabaseUrl = 'https://pxcimtveipluoenjiebx.supabase.co';
const supabaseKey = 'sb_publishable_73t9gf0Rm47Kae9KAHfe6w_asA7g7mM';
const supabase = createClient(supabaseUrl, supabaseKey);

let currentRoomId = null;
let myRole = null; // 'host' (red) or 'guest' (blue)
let activeGame = null;
let roomChannel = null;
let selectedGameByMe = null;
let selectedGameByOpp = null;

const statusText = document.getElementById('status');
const uiContainer = document.getElementById('ui-container');
const panelLobby = document.getElementById('panel-lobby');
const panelSelect = document.getElementById('panel-select');
const controlsDisplay = document.getElementById('controls-display');
const staminaContainer = document.getElementById('stamina-container');
const staminaBar = document.getElementById('stamina-bar');

const gameNames = {
  oni: '🏃 モール鬼ごっこ',
  hilow: '🧠 ハイ＆ロー心理戦',
  bomb: '💥 爆弾ドッジボール',
  hockey: '⚽ 2Dエアホッケー',
  breakout: '🧱 ブロック崩し対戦',
  coin: '🪙 コインラッシュ',
  '2d': '⚔️ 2D大乱闘バッシュ',
  sumo: '🚘 3Dドタバタ相撲'
};

function showControlsHUD(game) {
  controlsDisplay.style.display = 'block';
  if (game === 'oni') controlsDisplay.innerHTML = `<strong>【モール鬼ごっこ】</strong><br>[W][A][S][D]: 移動<br>[Space]: ジャンプ, [Shift]: ダッシュ`;
  else if (game === 'hilow') controlsDisplay.innerHTML = `<strong>【ハイ＆ロー心理戦】</strong><br>相手のカードが自分より高い(HIGH)か低い(LOW)か予想せよ！`;
  else if (game === 'bomb') controlsDisplay.innerHTML = `<strong>【爆弾ドッジ】</strong><br>[W][A][S][D]: 移動<br>[Space]: 相手に接近して爆弾パス！`;
  else if (game === 'hockey') controlsDisplay.innerHTML = `<strong>【エアホッケー】</strong><br>[W][S] または [▲][▼]: マレット上下移動`;
  else if (game === 'breakout') controlsDisplay.innerHTML = `<strong>【ブロック崩し】</strong><br>[A][D] または [◀][▶]: バー移動`;
  else if (game === 'coin') controlsDisplay.innerHTML = `<strong>【コインラッシュ】</strong><br>[A][D]: 移動, [Space]: ジャンプ<br>30秒でコインを爆食い！`;
  else if (game === 'sumo') controlsDisplay.innerHTML = `<strong>【相撲】</strong><br>[W][A][S][D]: 移動, [Space]: タックル`;
  else if (game === '2d') controlsDisplay.innerHTML = `<strong>【大乱闘】</strong><br>[A][D]: 移動, [W]: ジャンプ, [Space]: 攻撃`;
}

// 入力処理
const keys = { up: false, down: false, left: false, right: false, action: false, jump: false, crouch: false, dive: false, guard: false, special: false, grab: false };
let prevKeys = { up: false, action: false, jump: false, dive: false, special: false, grab: false };

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = true;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = true;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = true;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = true;
  if(e.code === 'Space') { e.preventDefault(); keys.action = true; keys.jump = true; }
  if(e.key === 'Shift') { keys.crouch = true; keys.guard = true; }
});
window.addEventListener('keyup', (e) => {
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = false;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = false;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = false;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = false;
  if(e.code === 'Space') { keys.action = false; keys.jump = false; }
  if(e.key === 'Shift') { keys.crouch = false; keys.guard = false; }
});

['up','down','left','right','action','special','shield','grab'].forEach(k => {
  const btn = document.getElementById('btn-'+k);
  if(btn) {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); keys[k] = true; if(k==='up') keys.jump=true; });
    btn.addEventListener('pointerup', (e) => { e.preventDefault(); keys[k] = false; if(k==='up') keys.jump=false; });
    btn.addEventListener('pointerleave', (e) => { e.preventDefault(); keys[k] = false; });
  }
});
function removeFocus() { document.activeElement.blur(); }

// --- ロビー＆ルーム制御 ---
const lobbyChannel = supabase.channel('lobby');
let isLobbyReady = false;

lobbyChannel.on('presence', { event: 'sync' }, () => {
  const state = lobbyChannel.presenceState();
  const availableRooms = [];
  for (const key in state) state[key].forEach(u => { if (u.status === 'waiting') availableRooms.push(u); });

  const roomListContainer = document.getElementById('room-list-container');
  roomListContainer.innerHTML = '';
  if (availableRooms.length === 0) { roomListContainer.innerHTML = '<p style="font-size: 0.85rem; color: #aaa;">待機中の部屋はありません</p>'; return; }

  availableRooms.forEach(user => {
    const btn = document.createElement('button');
    btn.className = 'room-btn'; btn.innerText = `🏠 ${user.roomName} に入室`;
    btn.onclick = () => { removeFocus(); joinRoom(user.roomName, 'guest'); };
    roomListContainer.appendChild(btn);
  });
}).subscribe((status) => { if (status === 'SUBSCRIBED') isLobbyReady = true; });

document.getElementById('btn-create-room').onclick = async () => {
  if (!isLobbyReady) return alert('接続中...数秒待って再試行してください。');
  const rName = document.getElementById('new-room-input').value.trim();
  if (!rName) return alert('合言葉を入力してください！');
  removeFocus();
  try {
    await lobbyChannel.track({ roomName: rName, status: 'waiting' });
    joinRoom(rName, 'host');
  } catch(e) { alert("部屋の作成に失敗しました。"); }
};

function joinRoom(roomId, role) {
  currentRoomId = roomId; myRole = role;
  panelLobby.style.display = 'none';
  panelSelect.style.display = 'block';
  document.getElementById('room-title').innerText = `🏠 部屋：${roomId}`;

  roomChannel = supabase.channel(`room-${roomId}`);
  roomChannel
    .on('broadcast', { event: 'chat' }, (p) => addChatMessage(p.payload.sender, p.payload.text, p.payload.color))
    .on('broadcast', { event: 'vote_game' }, (p) => {
      selectedGameByOpp = p.payload.game;
      addChatMessage('システム', `相手が「${gameNames[p.payload.game]}」に投票しました！`, '#f39c12');
      checkStartRoulette();
    })
    .on('broadcast', { event: 'start_roulette' }, (p) => runRouletteAnimation(p.payload.winGame))
    .on('broadcast', { event: 'joined' }, () => {
      document.getElementById('room-status-text').innerText = "🟢 相手が参加しました！投票してください";
      if (myRole === 'host') lobbyChannel.untrack();
    })
    .on('broadcast', { event: 'back_to_select' }, () => returnToSelect())
    .subscribe((s) => {
      if (s === 'SUBSCRIBED' && myRole === 'guest') roomChannel.send({ type: 'broadcast', event: 'joined' });
    });

  ['oni', 'hilow', 'bomb', 'hockey', 'breakout', 'coin', '2d', 'sumo'].forEach(g => {
    const btn = document.getElementById(`btn-select-${g}`);
    if (btn) btn.onclick = () => {
      selectedGameByMe = g;
      addChatMessage('システム', `「${gameNames[g]}」に投票しました！`, '#2ecc71');
      roomChannel.send({ type: 'broadcast', event: 'vote_game', payload: { game: g } });
      checkStartRoulette();
    };
  });
}

function checkStartRoulette() {
  if (myRole === 'host' && selectedGameByMe && selectedGameByOpp) {
    const pool = [selectedGameByMe, selectedGameByOpp];
    const winGame = pool[Math.floor(Math.random() * pool.length)];
    roomChannel.send({ type: 'broadcast', event: 'start_roulette', payload: { winGame } });
    runRouletteAnimation(winGame);
  }
}

function runRouletteAnimation(winGame) {
  const overlay = document.getElementById('roulette-overlay');
  const rouletteText = document.getElementById('roulette-text');
  overlay.style.display = 'flex';

  const games = Object.values(gameNames);
  let count = 0;
  const interval = setInterval(() => {
    rouletteText.innerText = games[Math.floor(Math.random() * games.length)];
    count++;
    if (count > 15) {
      clearInterval(interval);
      rouletteText.innerText = `✨ 【${gameNames[winGame]}】が選ばれました！ ✨`;
      setTimeout(() => {
        overlay.style.display = 'none';
        selectedGameByMe = null; selectedGameByOpp = null;
        launchGame(winGame);
      }, 2500);
    }
  }, 100);
}

function returnToSelect() {
  activeGame = null; oniIsActive = false; sumoIsActive = false; brIsActive = false; hilowIsActive = false; bombIsActive = false; hockeyIsActive = false; breakoutIsActive = false; coinIsActive = false;
  
  document.getElementById('app').style.display = 'none';
  canvas2D.style.display = 'none';
  document.getElementById('controls').style.display = 'none';
  controlsDisplay.style.display = 'none';
  staminaContainer.style.display = 'none';
  statusText.innerText = '';
  
  uiContainer.style.display = 'flex';
  panelSelect.style.display = 'block';
}

function launchGame(game) {
  uiContainer.style.display = 'none';
  if (game === 'oni') startOnigokko();
  else if (game === 'hilow') startHiLowGame();
  else if (game === 'bomb') startBombGame();
  else if (game === 'hockey') startHockeyGame();
  else if (game === 'breakout') startBreakoutGame();
  else if (game === 'coin') startCoinGame();
  else if (game === '2d') startBrawler();
  else if (game === 'sumo') startSumo();
}

function addChatMessage(sender, text, color = '#fff') {
  const div = document.createElement('div'); div.style.marginBottom = '4px';
  div.innerHTML = `<span style="color: ${color}; font-weight: bold;">${sender}:</span> ${text}`;
  const box = document.getElementById('chat-messages');
  box.appendChild(div); box.scrollTop = box.scrollHeight;
}
document.getElementById('btn-send').onclick = () => {
  const text = document.getElementById('chat-input').value.trim(); if (!text) return;
  const name = myRole === 'host' ? 'ホスト(赤)' : 'ゲスト(青)';
  addChatMessage('あなた', text, '#4caf50');
  const targetChannel = roomChannel || lobbyChannel;
  targetChannel.send({ type: 'broadcast', event: 'chat', payload: { sender: name, text, color: '#ffcc00' } });
  document.getElementById('chat-input').value = '';
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);
let currentScene = null, currentCamera = null;
const canvas2D = document.getElementById('canvas-2d'); const ctx2D = canvas2D.getContext('2d');

function switchUI(is3D, isMobileControls) {
  document.getElementById('app').style.display = is3D ? 'block' : 'none';
  canvas2D.style.display = is3D ? 'none' : 'block';
  document.getElementById('controls').style.display = isMobileControls ? '' : 'none';
  showControlsHUD(activeGame);
}


// ==========================================
// 1. 🧠 ハイ＆ロー心理戦 (Hi-Low Game)
// ==========================================
let hilowIsActive = false, hilowMyCard = 0, hilowOppCard = 0, hilowMyChoice = null, hilowScore = { me: 0, opp: 0 };
function startHiLowGame() {
  activeGame = 'hilow'; hilowIsActive = true; switchUI(false, false);
  hilowScore.me = 0; hilowScore.opp = 0;
  setupHiLowRound();
  roomChannel.on('broadcast', { event: 'hilow_choice' }, (p) => {
    if (myRole !== p.payload.role) {
      hilowOppCard = p.payload.card;
      checkHiLowResult();
    }
  });
}

function setupHiLowRound() {
  hilowMyCard = Math.floor(Math.random() * 10) + 1;
  hilowMyChoice = null; hilowOppCard = null;
  statusText.innerText = `あなたのカードは 【 ${hilowMyCard} 】！ 相手はHIGH？LOW？`;
  statusText.style.color = "#8e44ad";
}

function checkHiLowResult() {
  if (hilowMyChoice && hilowOppCard) {
    const isHigh = hilowOppCard > hilowMyCard;
    const win = (hilowMyChoice === 'HIGH' && isHigh) || (hilowMyChoice === 'LOW' && !isHigh);
    if (win) hilowScore.me++; else hilowScore.opp++;
    statusText.innerText = win ? `⭕ 正解！相手のカードは【${hilowOppCard}】` : `❌ 不正解...相手のカードは【${hilowOppCard}】`;
    setTimeout(() => {
      if (hilowScore.me >= 3 || hilowScore.opp >= 3) {
        statusText.innerText = hilowScore.me >= 3 ? "👑 勝利！3ポイント先取！" : "💀 敗北...";
        setTimeout(() => { if (myRole === 'host') roomChannel.send({ type: 'broadcast', event: 'back_to_select' }); returnToSelect(); }, 2000);
      } else setupHiLowRound();
    }, 2000);
  }
}

window.addEventListener('click', (e) => {
  if (activeGame !== 'hilow' || !hilowIsActive || hilowMyChoice) return;
  const rect = canvas2D.getBoundingClientRect();
  const clickX = (e.clientX - rect.left) * (canvas2D.width / rect.width);
  const clickY = (e.clientY - rect.top) * (canvas2D.height / rect.height);
  if (clickY > 350 && clickY < 450) {
    if (clickX > 200 && clickX < 350) hilowMyChoice = 'HIGH';
    else if (clickX > 450 && clickX < 600) hilowMyChoice = 'LOW';
    if (hilowMyChoice) {
      roomChannel.send({ type: 'broadcast', event: 'hilow_choice', payload: { role: myRole, card: hilowMyCard } });
      statusText.innerText = `判定中... 相手の出手を待っています`;
      checkHiLowResult();
    }
  }
});


// ==========================================
// 2. 💥 爆弾ドッジボール (Bomb Dodge)
// ==========================================
let bombIsActive = false, bombHolder = 'host', bombTimer = 30, bombTimerInterval = null;
const bombMyState = { x: 0, z: 0 }, bombOppState = { x: 0, z: 0 };
let bPlayerMesh, bOppMesh, bBombMesh;

function startBombGame() {
  activeGame = 'bomb'; bombIsActive = true; bombHolder = 'host'; bombTimer = 30; switchUI(true, true);
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x111111);
  currentCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(0, 20, 20); currentCamera.lookAt(0, 0, 0);

  currentScene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 30), new THREE.MeshStandardMaterial({ color: 0x444444 }));
  floor.position.y = -0.5; currentScene.add(floor);

  bPlayerMesh = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial({ color: myRole==='host'?0xe74c3c:0x3498db }));
  bOppMesh = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial({ color: myRole==='host'?0x3498db:0xe74c3c }));
  bBombMesh = new THREE.Mesh(new THREE.SphereGeometry(0.6), new THREE.MeshStandardMaterial({ color: 0xf1c40f }));
  currentScene.add(bPlayerMesh, bOppMesh, bBombMesh);

  bombMyState.x = myRole === 'host' ? -8 : 8; bombMyState.z = 0;

  if (myRole === 'host') {
    bombTimerInterval = setInterval(() => {
      bombTimer--;
      roomChannel.send({ type: 'broadcast', event: 'bomb_sync', payload: { timer: bombTimer, holder: bombHolder } });
      if (bombTimer <= 0) bombEnd();
    }, 1000);
  }

  roomChannel.on('broadcast', { event: 'bomb_sync' }, (p) => { bombTimer = p.payload.timer; bombHolder = p.payload.holder; })
    .on('broadcast', { event: 'bomb_move' }, (p) => { bombOppState.x = p.payload.x; bombOppState.z = p.payload.z; });
}

function bombEnd() {
  bombIsActive = false; clearInterval(bombTimerInterval);
  const isWin = bombHolder !== myRole;
  statusText.innerText = isWin ? "👑 爆発！あなたの勝利！" : "💥 爆発！あなたの負け！";
  setTimeout(() => { if (myRole === 'host') roomChannel.send({ type: 'broadcast', event: 'back_to_select' }); returnToSelect(); }, 2500);
}


// ==========================================
// 3. ⚽ 2Dエアホッケー (Air Hockey)
// ==========================================
let hockeyIsActive = false, hockeyP1Y = 250, hockeyP2Y = 250, hockeyBall = { x: 400, y: 300, vx: 5, vy: 3 };
let hockeyScore = { p1: 0, p2: 0 };

function startHockeyGame() {
  activeGame = 'hockey'; hockeyIsActive = true; switchUI(false, true);
  hockeyScore.p1 = 0; hockeyScore.p2 = 0; resetHockeyBall();
  roomChannel.on('broadcast', { event: 'hockey_sync' }, (p) => {
    if (myRole === 'host') hockeyP2Y = p.payload.y;
    else { hockeyP1Y = p.payload.y; hockeyBall = p.payload.ball; hockeyScore = p.payload.score; }
  });
}
function resetHockeyBall() { hockeyBall = { x: 400, y: 300, vx: (Math.random()>0.5?5:-5), vy: (Math.random()*4-2) }; }


// ==========================================
// 4. 🧱 3Dブロック崩し対戦 (Breakout Duel)
// ==========================================
let breakoutIsActive = false, breakoutMyX = 0, breakoutOppX = 0, breakoutBall = { x: 0, z: 0, vx: 0.15, vz: -0.2 };
let breakoutMyBricks = [], breakoutOppBricks = [];

function startBreakoutGame() {
  activeGame = 'breakout'; breakoutIsActive = true; switchUI(true, true);
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x2c3e50);
  currentCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(0, 25, 0); currentCamera.lookAt(0, 0, 0);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.8));

  // ステージ枠
  const border = new THREE.Mesh(new THREE.BoxGeometry(20, 1, 30), new THREE.MeshStandardMaterial({ color: 0x34495e }));
  border.position.y = -0.5; currentScene.add(border);

  statusText.innerText = "🧱 ブロックを打ち返せ！"; statusText.style.color = "#e74c3c";
}


// ==========================================
// 5. 🪙 2Dコインラッシュ (Coin Rush)
// ==========================================
let coinIsActive = false, coinMyState = { x: 100, y: 500, vx: 0, vy: 0, score: 0 }, coinOppState = { x: 700, y: 500, score: 0 };
let coins = [], coinTimer = 30, coinTimerInterval = null;

function startCoinGame() {
  activeGame = 'coin'; coinIsActive = true; switchUI(false, true);
  coinMyState.score = 0; coinOppState.score = 0; coinTimer = 30; coins = [];
  
  if (myRole === 'host') {
    coinTimerInterval = setInterval(() => {
      coinTimer--;
      if (Math.random() < 0.6) coins.push({ x: Math.random() * 700 + 50, y: 0 });
      roomChannel.send({ type: 'broadcast', event: 'coin_sync', payload: { timer: coinTimer, coins, oppScore: coinMyState.score } });
      if (coinTimer <= 0) coinEnd();
    }, 1000);
  }

  roomChannel.on('broadcast', { event: 'coin_sync' }, (p) => {
    coinTimer = p.payload.timer; coins = p.payload.coins; coinOppState.score = p.payload.oppScore;
  }).on('broadcast', { event: 'coin_move' }, (p) => { coinOppState.x = p.payload.x; coinOppState.y = p.payload.y; });
}

function coinEnd() {
  coinIsActive = false; clearInterval(coinTimerInterval);
  const isWin = coinMyState.score > coinOppState.score;
  statusText.innerText = isWin ? `👑 勝利！(${coinMyState.score}枚 vs ${coinOppState.score}枚)` : `💀 敗北...(${coinMyState.score}枚 vs ${coinOppState.score}枚)`;
  setTimeout(() => { if (myRole === 'host') roomChannel.send({ type: 'broadcast', event: 'back_to_select' }); returnToSelect(); }, 2500);
}


// ==========================================
// 🏃 鬼ごっこ / 🚘 相撲 / ⚔️ 2D大乱闘
// ==========================================
let oniIsActive = false, oniTimeLeft = 40, oniTimerInterval = null;
const oniMyState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, stamina: 100, isGrounded: true };
const oniOppState = { x: 0, y: 0, z: 0, rot: 0 };
let oniPlayerMesh, oniOppMesh, oniCamContainer;

function startOnigokko() {
  activeGame = 'oni'; oniIsActive = true; oniTimeLeft = 40; switchUI(true, true);
  staminaContainer.style.display = 'block';
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x34495e);
  oniCamContainer = new THREE.Group(); currentScene.add(oniCamContainer);
  currentCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(0, 12, 14); currentCamera.lookAt(0, 0, 0); oniCamContainer.add(currentCamera);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.7));

  const floor = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 60), new THREE.MeshStandardMaterial({ color: 0xecf0f1 })); floor.position.y = -0.5; currentScene.add(floor);
  oniPlayerMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: myRole==='host'?0xe74c3c:0x2980b9 }));
  oniOppMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: myRole==='host'?0x2980b9:0xe74c3c }));
  currentScene.add(oniPlayerMesh, oniOppMesh);
  oniMyState.x = myRole === 'host' ? -22 : 22; oniMyState.z = myRole === 'host' ? -22 : 22;

  statusText.innerText = myRole==='host' ? "👹 【あなたは鬼】 捕まえろ！" : "🏃 【あなたは逃げ手】 逃げ切れ！";
  if (myRole === 'host') {
    oniTimerInterval = setInterval(() => {
      oniTimeLeft--;
      roomChannel.send({ type: 'broadcast', event: 'oni_timer', payload: { time: oniTimeLeft } });
      if (oniTimeLeft <= 0) oniEnd('guest');
    }, 1000);
  }
  roomChannel.on('broadcast', { event: 'oni_timer' }, (p) => { oniTimeLeft = p.payload.time; })
    .on('broadcast', { event: 'sync' }, (p) => { oniOppState.x = p.payload.x; oniOppState.y = p.payload.y; oniOppState.z = p.payload.z; oniOppState.rot = p.payload.rot; })
    .on('broadcast', { event: 'oni_caught' }, () => oniEnd('host'));
}
function oniEnd(winnerRole) {
  oniIsActive = false; clearInterval(oniTimerInterval); staminaContainer.style.display = 'none';
  statusText.innerText = (myRole === winnerRole) ? "👑 WIN!!" : "💀 LOSE...";
  setTimeout(() => { if (myRole === 'host') roomChannel.send({ type: 'broadcast', event: 'back_to_select' }); returnToSelect(); }, 2500);
}

let sumoIsActive = false, p1Mesh, p2Mesh, sumoArena, sumoEdge, sumoRadius = 15;
const sumoMyState = { x: 0, z: 0, rot: 0, vx: 0, vz: 0 }; const sumoOppState = { x: 0, z: 0, rot: 0 };
function startSumo() {
  activeGame = 'sumo'; sumoIsActive = true; switchUI(true, true);
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x87CEEB);
  currentCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100); currentCamera.position.set(0, 25, 30); currentCamera.lookAt(0, 0, 0);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.8));
  sumoArena = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1, 64), new THREE.MeshStandardMaterial({ color: 0x34495e })); sumoArena.position.y = -0.5; currentScene.add(sumoArena);
  p1Mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: 0xe74c3c })); p2Mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: 0x3498db })); currentScene.add(p1Mesh, p2Mesh);
  sumoMyState.x = myRole === 'host' ? 0 : 0; sumoMyState.z = myRole === 'host' ? 8 : -8;
  roomChannel.on('broadcast', { event: 'sync' }, (p) => { sumoOppState.x = p.payload.x; sumoOppState.z = p.payload.z; sumoOppState.rot = p.payload.rot; })
    .on('broadcast', { event: 'hit' }, (p) => { sumoMyState.vx += p.payload.vx; sumoMyState.vz += p.payload.vz; })
    .on('broadcast', { event: 'gameover' }, (p) => sumoEnd(p.payload.loserRole));
}
function sumoEnd(loser) { sumoIsActive = false; statusText.innerText = myRole !== loser ? '👑 勝利！！' : '💀 落下...'; setTimeout(() => returnToSelect(), 2000); }

let brIsActive = false; const brMyState = { x: 0, y: 0, vx: 0, vy: 0, dmg: 0, dir: 1, jumps: 2 }; const brOppState = { x: 0, y: 0, dmg: 0, dir: -1 };
const brStage = [ { x: 150, y: 450, w: 500, h: 20 }, { x: 50, y: 300, w: 150, h: 10 }, { x: 600, y: 300, w: 150, h: 10 } ];
function startBrawler() {
  activeGame = '2d'; brIsActive = true; switchUI(false, true);
  brMyState.x = myRole === 'host' ? 300 : 500; brMyState.y = 200;
  roomChannel.on('broadcast', { event: 'sync' }, (p) => { brOppState.x = p.payload.x; brOppState.y = p.payload.y; brOppState.dmg = p.payload.dmg; brOppState.dir = p.payload.dir; })
    .on('broadcast', { event: 'hit' }, (p) => { brMyState.dmg += p.payload.dmg; brMyState.vx = p.payload.vx; brMyState.vy = p.payload.vy; })
    .on('broadcast', { event: 'gameover' }, (p) => brEnd(p.payload.loserRole));
}
function brEnd(loser) { brIsActive = false; statusText.innerText = myRole !== loser ? '👑 GAME SET!' : '💀 場外負け...'; setTimeout(() => returnToSelect(), 2000); }


// ==========================================
// 🧠 共通物理計算
// ==========================================
function updateGameLogic() {
  frameCount++;

  // 🏃 鬼ごっこ
  if (activeGame === 'oni' && oniIsActive) {
    let speed = (myRole === 'host') ? 0.22 : 0.18;
    if (keys.guard && oniMyState.stamina > 0) { speed *= 1.6; oniMyState.stamina = Math.max(0, oniMyState.stamina - 1.5); }
    else { oniMyState.stamina = Math.min(100, oniMyState.stamina + 0.5); }
    staminaBar.style.width = `${oniMyState.stamina}%`;

    oniMyState.vy -= 0.015;
    if (keys.jump && !prevKeys.jump && oniMyState.isGrounded) { oniMyState.vy = 0.35; oniMyState.isGrounded = false; }

    let moveX = 0, moveZ = 0;
    if (keys.left) moveX -= 1; if (keys.right) moveX += 1;
    if (keys.up) moveZ -= 1; if (keys.down) moveZ += 1;

    if (moveX !== 0 || moveZ !== 0) {
      const len = Math.hypot(moveX, moveZ);
      oniMyState.vx = (moveX / len) * speed; oniMyState.vz = (moveZ / len) * speed; oniMyState.rot = Math.atan2(moveX, moveZ);
    } else { oniMyState.vx *= 0.8; oniMyState.vz *= 0.8; }

    let nextY = oniMyState.y + oniMyState.vy;
    if (nextY <= 0) { nextY = 0; oniMyState.vy = 0; oniMyState.isGrounded = true; }

    oniMyState.x = Math.max(-28, Math.min(28, oniMyState.x + oniMyState.vx));
    oniMyState.y = nextY; oniMyState.z = Math.max(-28, Math.min(28, oniMyState.z + oniMyState.vz));

    if (myRole === 'host') {
      if (Math.hypot(oniMyState.x - oniOppState.x, oniMyState.z - oniOppState.z) < 1.6 && Math.abs(oniMyState.y - oniOppState.y) < 2.0) {
        roomChannel.send({ type: 'broadcast', event: 'oni_caught' }); oniEnd('host');
      }
    }
    if (frameCount % 2 === 0) roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: oniMyState.x, y: oniMyState.y, z: oniMyState.z, rot: oniMyState.rot } });
  }

  // 💥 爆弾ドッジ
  else if (activeGame === 'bomb' && bombIsActive) {
    let speed = 0.2; let moveX = 0, moveZ = 0;
    if (keys.left) moveX -= 1; if (keys.right) moveX += 1;
    if (keys.up) moveZ -= 1; if (keys.down) moveZ += 1;
    if (moveX !== 0 || moveZ !== 0) {
      const len = Math.hypot(moveX, moveZ);
      bombMyState.x += (moveX / len) * speed; bombMyState.z += (moveZ / len) * speed;
    }
    bombMyState.x = Math.max(-14, Math.min(14, bombMyState.x)); bombMyState.z = Math.max(-14, Math.min(14, bombMyState.z));

    if (bombHolder === myRole && keys.action && !prevKeys.action) {
      if (Math.hypot(bombMyState.x - bombOppState.x, bombMyState.z - bombOppState.z) < 3.0) {
        bombHolder = myRole === 'host' ? 'guest' : 'host';
        roomChannel.send({ type: 'broadcast', event: 'bomb_sync', payload: { timer: bombTimer, holder: bombHolder } });
      }
    }
    if (frameCount % 2 === 0) roomChannel.send({ type: 'broadcast', event: 'bomb_move', payload: { x: bombMyState.x, z: bombMyState.z } });
  }

  // ⚽ エアホッケー
  else if (activeGame === 'hockey' && hockeyIsActive) {
    let myY = myRole === 'host' ? hockeyP1Y : hockeyP2Y;
    if (keys.up) myY -= 6; if (keys.down) myY += 6;
    myY = Math.max(50, Math.min(550, myY));
    if (myRole === 'host') {
      hockeyP1Y = myY;
      hockeyBall.x += hockeyBall.vx; hockeyBall.y += hockeyBall.vy;
      if (hockeyBall.y < 20 || hockeyBall.y > 580) hockeyBall.vy *= -1;

      // パドル衝突
      if (hockeyBall.x < 50 && Math.abs(hockeyBall.y - hockeyP1Y) < 50) hockeyBall.vx = Math.abs(hockeyBall.vx);
      if (hockeyBall.x > 750 && Math.abs(hockeyBall.y - hockeyP2Y) < 50) hockeyBall.vx = -Math.abs(hockeyBall.vx);

      // ゴール判定
      if (hockeyBall.x < 0) { hockeyScore.p2++; resetHockeyBall(); }
      if (hockeyBall.x > 800) { hockeyScore.p1++; resetHockeyBall(); }

      roomChannel.send({ type: 'broadcast', event: 'hockey_sync', payload: { y: myY, ball: hockeyBall, score: hockeyScore } });
    } else {
      hockeyP2Y = myY;
      roomChannel.send({ type: 'broadcast', event: 'hockey_sync', payload: { y: myY } });
    }
  }

  // 🪙 コインラッシュ
  else if (activeGame === 'coin' && coinIsActive) {
    coinMyState.vy += 0.6;
    if (keys.left) coinMyState.vx = -5; else if (keys.right) coinMyState.vx = 5; else coinMyState.vx *= 0.8;
    if (keys.jump && coinMyState.y >= 500) coinMyState.vy = -12;
    coinMyState.x += coinMyState.vx; coinMyState.y += coinMyState.vy;
    if (coinMyState.y > 500) { coinMyState.y = 500; coinMyState.vy = 0; }

    // コイン取得
    for (let i = coins.length - 1; i >= 0; i--) {
      coins[i].y += 3;
      if (Math.hypot(coinMyState.x - coins[i].x, coinMyState.y - coins[i].y) < 30) {
        coinMyState.score++; coins.splice(i, 1);
      }
    }
    if (frameCount % 2 === 0) roomChannel.send({ type: 'broadcast', event: 'coin_move', payload: { x: coinMyState.x, y: coinMyState.y } });
  }

  // 🚘 相撲
  else if (activeGame === 'sumo' && sumoIsActive) {
    const accel = keys.action ? 0.03 : 0.01;
    if (keys.left) sumoMyState.rot += 0.05; if (keys.right) sumoMyState.rot -= 0.05;
    if (keys.up) { sumoMyState.vx -= Math.sin(sumoMyState.rot)*accel; sumoMyState.vz -= Math.cos(sumoMyState.rot)*accel; }
    sumoMyState.vx *= 0.95; sumoMyState.vz *= 0.95;
    sumoMyState.x += sumoMyState.vx; sumoMyState.z += sumoMyState.vz;
    if (Math.hypot(sumoMyState.x, sumoMyState.z) > 15.5) { roomChannel.send({ type: 'broadcast', event: 'gameover', payload: { loserRole: myRole } }); sumoEnd(myRole); }
    if (frameCount % 3 === 0) roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: sumoMyState.x, z: sumoMyState.z, rot: sumoMyState.rot } });
  }

  // ⚔️ 大乱闘
  else if (activeGame === '2d' && brIsActive) {
    brMyState.vy += 0.6;
    if (keys.left) brMyState.vx = -4; else if (keys.right) brMyState.vx = 4; else brMyState.vx *= 0.8;
    if (keys.jump && brMyState.jumps > 0 && !prevKeys.jump) { brMyState.vy = -12; brMyState.jumps--; }
    brMyState.x += brMyState.vx; brMyState.y += brMyState.vy;
    for (let s of brStage) { if (brMyState.x > s.x - 20 && brMyState.x < s.x + s.w + 20 && brMyState.y >= s.y && brMyState.y - brMyState.vy <= s.y) { brMyState.y = s.y; brMyState.vy = 0; brMyState.jumps = 2; } }
    if (brMyState.y > 800) { roomChannel.send({ type: 'broadcast', event: 'gameover', payload: { loserRole: myRole } }); brEnd(myRole); }
    if (frameCount % 2 === 0) roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: brMyState.x, y: brMyState.y, dmg: brMyState.dmg, dir: brMyState.dir } });
  }

  prevKeys.up = keys.up; prevKeys.action = keys.action; prevKeys.jump = keys.jump;
}


// ==========================================
// 🎨 メイン描画ループ
// ==========================================
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);
  if (!document.hidden) updateGameLogic();

  // 🏃 鬼ごっこ
  if (activeGame === 'oni' && oniIsActive) {
    if (oniPlayerMesh) { oniPlayerMesh.position.set(oniMyState.x, oniMyState.y, oniMyState.z); oniPlayerMesh.rotation.y = oniMyState.rot; }
    if (oniOppMesh) { oniOppMesh.position.set(oniOppState.x, oniOppState.y, oniOppState.z); oniOppMesh.rotation.y = oniOppState.rot; }
    if (oniCamContainer) oniCamContainer.position.set(oniMyState.x, oniMyState.y, oniMyState.z);
    statusText.innerText = `⏱️ 残り: ${oniTimeLeft}秒 (${myRole==='host'?'👹 鬼':'🏃 逃げ手'})`;
    if (currentScene) renderer.render(currentScene, currentCamera);
  }

  // 🧠 ハイ＆ロー
  else if (activeGame === 'hilow' && hilowIsActive) {
    ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);
    ctx2D.fillStyle = '#2c3e50'; ctx2D.fillRect(0, 0, canvas2D.width, canvas2D.height);

    ctx2D.fillStyle = 'white'; ctx2D.font = 'bold 28px Arial'; ctx2D.textAlign = 'center';
    ctx2D.fillText(`スコア: あなた ${hilowScore.me} - ${hilowScore.opp} 相手`, 400, 80);

    ctx2D.fillStyle = '#e74c3c'; ctx2D.fillRect(200, 350, 150, 100);
    ctx2D.fillStyle = '#3498db'; ctx2D.fillRect(450, 350, 150, 100);
    ctx2D.fillStyle = 'white'; ctx2D.font = 'bold 32px Arial';
    ctx2D.fillText('HIGH', 275, 410); ctx2D.fillText('LOW', 525, 410);
  }

  // 💥 爆弾
  else if (activeGame === 'bomb' && bombIsActive) {
    if (bPlayerMesh) bPlayerMesh.position.set(bombMyState.x, 1, bombMyState.z);
    if (bOppMesh) bOppMesh.position.set(bombOppState.x, 1, bombOppState.z);
    const holderPos = bombHolder === myRole ? bombMyState : bombOppState;
    if (bBombMesh) bBombMesh.position.set(holderPos.x, 2.5, holderPos.z);
    statusText.innerText = `💣 爆発まで: ${bombTimer}秒 (${bombHolder===myRole?'⚠️ あなたが爆弾持ち！':'相手が爆弾持ち'})`;
    if (currentScene) renderer.render(currentScene, currentCamera);
  }

  // ⚽ ホッケー
  else if (activeGame === 'hockey' && hockeyIsActive) {
    ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);
    ctx2D.fillStyle = '#1e272e'; ctx2D.fillRect(0, 0, canvas2D.width, canvas2D.height);

    ctx2D.fillStyle = 'white'; ctx2D.font = 'bold 28px Arial'; ctx2D.textAlign = 'center';
    ctx2D.fillText(`${hockeyScore.p1} - ${hockeyScore.p2}`, 400, 50);

    ctx2D.fillStyle = '#e74c3c'; ctx2D.fillRect(20, hockeyP1Y - 40, 15, 80);
    ctx2D.fillStyle = '#3498db'; ctx2D.fillRect(765, hockeyP2Y - 40, 15, 80);

    ctx2D.fillStyle = '#f1c40f'; ctx2D.beginPath(); ctx2D.arc(hockeyBall.x, hockeyBall.y, 12, 0, Math.PI*2); ctx2D.fill();
  }

  // 🪙 コイン
  else if (activeGame === 'coin' && coinIsActive) {
    ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);
    ctx2D.fillStyle = '#34495e'; ctx2D.fillRect(0, 0, canvas2D.width, canvas2D.height);

    ctx2D.fillStyle = '#e74c3c'; ctx2D.fillRect(coinMyState.x - 15, coinMyState.y - 30, 30, 30);
    ctx2D.fillStyle = '#3498db'; ctx2D.fillRect(coinOppState.x - 15, coinOppState.y - 30, 30, 30);

    ctx2D.fillStyle = '#f1c40f';
    coins.forEach(c => { ctx2D.beginPath(); ctx2D.arc(c.x, c.y, 10, 0, Math.PI*2); ctx2D.fill(); });

    statusText.innerText = `⏱️ 残り: ${coinTimer}秒 | あなた: ${coinMyState.score}枚 | 相手: ${coinOppState.score}枚`;
  }

  // 🚘 相撲
  else if (activeGame === 'sumo' && sumoIsActive) {
    if (p1Mesh && p2Mesh) {
      p1Mesh.position.set(myRole==='host'?sumoMyState.x:sumoOppState.x, 1, myRole==='host'?sumoMyState.z:sumoOppState.z);
      p2Mesh.position.set(myRole==='host'?sumoOppState.x:sumoMyState.x, 1, myRole==='host'?sumoOppState.z:sumoMyState.z);
    }
    if (currentScene) renderer.render(currentScene, currentCamera);
  }

  // ⚔️ 大乱闘
  else if (activeGame === '2d' && brIsActive) {
    ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height); ctx2D.fillStyle = '#7f8c8d'; for(let s of brStage) ctx2D.fillRect(s.x, s.y, s.w, s.h);
    ctx2D.fillStyle = '#e74c3c'; ctx2D.fillRect(brMyState.x - 15, brMyState.y - 30, 30, 30);
    ctx2D.fillStyle = '#3498db'; ctx2D.fillRect(brOppState.x - 15, brOppState.y - 30, 30, 30);
  }
}

animate();

window.addEventListener('resize', () => {
  if (currentCamera) { currentCamera.aspect = window.innerWidth / window.innerHeight; currentCamera.updateProjectionMatrix(); }
  renderer.setSize(window.innerWidth, window.innerHeight);
});

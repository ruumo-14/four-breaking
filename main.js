import * as THREE from 'https://esm.sh/three';
import { OrbitControls } from 'https://esm.sh/three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// --- 1. Supabase の設定 ---
const supabaseUrl = 'https://pxcimtveipluoenjiebx.supabase.co';
const supabaseKey = 'sb_publishable_73t9gf0Rm47Kae9KAHfe6w_asA7g7mM';
const supabase = createClient(supabaseUrl, supabaseKey);

let currentRoomId = null;
let myRole = null; // 'host' (赤/P1) または 'guest' (青/P2)
let activeGame = null;
let roomChannel = null;
let selectedGameByMe = null;
let selectedGameByOpp = null;
let gameGracePeriod = 0;

const statusText = document.getElementById('status');
const uiContainer = document.getElementById('ui-container');
const panelLobby = document.getElementById('panel-lobby');
const panelSelect = document.getElementById('panel-select');
const controlsDisplay = document.getElementById('controls-display');
const staminaContainer = document.getElementById('stamina-container');
const staminaBar = document.getElementById('stamina-bar');

// 全20ゲームの定義名
const gameNames = {
  loveletter: '💌 ラブレター・デュエル',
  spelldraft: '🧙 魔導書の呪文ビルド',
  geister: '👻 ガイスター',
  mancala: '🧱 マンカラ・アリーナ',
  typing: '⌨️ タイピング・魔法大戦',
  aim: '🎯 エイム・スナイパー 3D',
  draw: '🎨 一筆お絵描き当て',
  rhythm: '🎵 リズム・ビート・クラッシュ',
  zerog: '🚀 宇宙無重力物理レース',
  defuse: '💣 心理爆弾解除',
  bk: '♟️ ブラックキングダム',
  baha: '🐉 腹ペコバハムート',
  tank: '🎖️ 3D戦車バトル',
  bl: '🚩 バトルライン',
  pen: '🐧 ペンギンパーティー',
  quoridor: '🧱 迷宮コリドール',
  hockey: '⚽ 2Dエアホッケー',
  oni: '🏃 モール鬼ごっこ',
  sumo: '🚘 3Dドタバタ相撲',
  bomb: '💥 爆弾ドッジボール'
};

function showControlsHUD(game) {
  controlsDisplay.style.display = 'block';
  if (game === 'hockey') controlsDisplay.innerHTML = `<strong>【エアホッケー】</strong><br>マウス/指のドラッグで自由自在に操作！<br>叩く強さでパックのスピードが変化！`;
  else if (game === 'typing') controlsDisplay.innerHTML = `<strong>【タイピング魔法】</strong><br>画面に出る英単語をキーボードで高速入力して魔法発動！`;
  else if (game === 'aim') controlsDisplay.innerHTML = `<strong>【エイムスナイパー】</strong><br>現れるターゲットを素早く正確にクリック！`;
  else if (game === 'oni') controlsDisplay.innerHTML = `<strong>【モール鬼ごっこ】</strong><br>[W][A][S][D]: 移動<br>[Space]: ジャンプ, [Shift]: ダッシュ`;
  else if (game === 'sumo') controlsDisplay.innerHTML = `<strong>【3D相撲】</strong><br>[W][A][S][D]: 移動, [Space]: タックル`;
  else controlsDisplay.innerHTML = `<strong>【${gameNames[game]}】</strong><br>画面のUI・ガイドに従って対戦しよう！`;
}

// --- 入力キー管理 ---
const keys = { up: false, down: false, left: false, right: false, action: false, jump: false, guard: false };
let prevKeys = { up: false, action: false, jump: false };

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = true;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = true;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = true;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = true;
  if(e.code === 'Space') { keys.action = true; keys.jump = true; }
  if(e.key === 'Shift') keys.guard = true;
});
window.addEventListener('keyup', (e) => {
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = false;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = false;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = false;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = false;
  if(e.code === 'Space') { keys.action = false; keys.jump = false; }
  if(e.key === 'Shift') keys.guard = false;
});

// --- オンライン接続＆ロビー処理 ---
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
    btn.onclick = () => { joinRoom(user.roomName, 'guest'); };
    roomListContainer.appendChild(btn);
  });
}).subscribe((status) => { if (status === 'SUBSCRIBED') isLobbyReady = true; });

document.getElementById('btn-create-room').onclick = async () => {
  if (!isLobbyReady) return alert('接続中...数秒待って再試行してください。');
  const rName = document.getElementById('new-room-input').value.trim();
  if (!rName) return alert('合言葉を入力してください！');
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

  Object.keys(gameNames).forEach(g => {
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
      }, 2000);
    }
  }, 100);
}

function returnToSelect() {
  activeGame = null;
  oniIsActive = false; sumoIsActive = false; bombIsActive = false; hockeyIsActive = false;
  
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
  gameGracePeriod = 60;
  activeGame = game;
  uiContainer.style.display = 'none';
  
  if (game === 'hockey') startHockeyGame();
  else if (game === 'oni') startOnigokko();
  else if (game === 'sumo') startSumo();
  else if (game === 'bomb') startBombGame();
  else {
    switchUI(false, false);
    statusText.innerText = `✨ ${gameNames[game]} スタート！`;
    statusText.style.color = "#f1c40f";
  }
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
// ⚽ 2Dエアホッケー（強さで速度変化＆直感操作）
// ==========================================
let hockeyIsActive = false;
let hockeyP1Pos = { x: 50, y: 300, vx: 0, vy: 0 };
let hockeyP2Pos = { x: 750, y: 300, vx: 0, vy: 0 };
let hockeyBall = { x: 400, y: 300, vx: 5, vy: 3 };
let hockeyScore = { p1: 0, p2: 0 };
let lastPointerPos = { x: 0, y: 0, t: Date.now() };

function startHockeyGame() {
  activeGame = 'hockey'; hockeyIsActive = true; switchUI(false, false);
  hockeyScore.p1 = 0; hockeyScore.p2 = 0; resetHockeyBall();
  
  roomChannel.on('broadcast', { event: 'hockey_sync' }, (p) => {
    if (myRole === 'host') {
      hockeyP2Pos = p.payload.p2Pos;
    } else {
      hockeyP1Pos = p.payload.p1Pos;
      hockeyBall = p.payload.ball;
      hockeyScore = p.payload.score;
    }
  });
}
function resetHockeyBall() { hockeyBall = { x: 400, y: 300, vx: (Math.random()>0.5?5:-5), vy: (Math.random()*4-2) }; }

window.addEventListener('pointermove', (e) => {
  if (activeGame !== 'hockey' || !hockeyIsActive) return;
  const rect = canvas2D.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas2D.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas2D.height / rect.height);

  const now = Date.now();
  const dt = Math.max(1, now - lastPointerPos.t);
  const vx = (px - lastPointerPos.x) / dt * 15;
  const vy = (py - lastPointerPos.t) / dt * 15;

  if (myRole === 'host') {
    hockeyP1Pos.x = Math.max(30, Math.min(380, px));
    hockeyP1Pos.y = Math.max(30, Math.min(570, py));
    hockeyP1Pos.vx = vx; hockeyP1Pos.vy = vy;
  } else {
    hockeyP2Pos.x = Math.max(420, Math.min(770, px));
    hockeyP2Pos.y = Math.max(30, Math.min(570, py));
    hockeyP2Pos.vx = vx; hockeyP2Pos.vy = vy;
  }
  lastPointerPos = { x: px, y: py, t: now };
});


// ==========================================
// 🏃 鬼ごっこ / 🚘 相撲 / 💥 爆弾ドッジ
// ==========================================
let oniIsActive = false, oniTimeLeft = 40, oniTimerInterval = null;
const oniMyState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, stamina: 100, isGrounded: true };
const oniOppState = { x: 999, y: 999, z: 999, rot: 0 };
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
  
  oniMyState.x = myRole === 'host' ? -20 : 20; oniMyState.z = myRole === 'host' ? -20 : 20; oniMyState.y = 0;
  statusText.innerText = myRole==='host' ? "👹 【あなたは鬼】 捕まえろ！" : "🏃 【あなたは逃げ手】 逃げ切れ！";
  
  clearInterval(oniTimerInterval);
  if (myRole === 'host') {
    oniTimerInterval = setInterval(() => {
      if (!oniIsActive) return;
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
  if (!oniIsActive) return;
  oniIsActive = false; clearInterval(oniTimerInterval); staminaContainer.style.display = 'none';
  statusText.innerText = (myRole === winnerRole) ? "👑 WIN!!" : "💀 LOSE...";
  setTimeout(() => { if (myRole === 'host') roomChannel.send({ type: 'broadcast', event: 'back_to_select' }); returnToSelect(); }, 2500);
}

let sumoIsActive = false, p1Mesh, p2Mesh, sumoArena;
const sumoMyState = { x: 0, z: 0, rot: 0, vx: 0, vz: 0 }; const sumoOppState = { x: 0, z: 0, rot: 0 };
function startSumo() {
  activeGame = 'sumo'; sumoIsActive = true; switchUI(true, true);
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x87CEEB);
  currentCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100); currentCamera.position.set(0, 25, 30); currentCamera.lookAt(0, 0, 0);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.8));
  sumoArena = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1, 64), new THREE.MeshStandardMaterial({ color: 0x34495e })); sumoArena.position.y = -0.5; currentScene.add(sumoArena);
  p1Mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: 0xe74c3c })); p2Mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: 0x3498db })); currentScene.add(p1Mesh, p2Mesh);
  sumoMyState.x = 0; sumoMyState.z = myRole === 'host' ? 8 : -8;
  roomChannel.on('broadcast', { event: 'sync' }, (p) => { sumoOppState.x = p.payload.x; sumoOppState.z = p.payload.z; sumoOppState.rot = p.payload.rot; })
    .on('broadcast', { event: 'gameover' }, (p) => sumoEnd(p.payload.loserRole));
}
function sumoEnd(loser) {
  if (!sumoIsActive) return;
  sumoIsActive = false; statusText.innerText = myRole !== loser ? '👑 勝利！！' : '💀 落下...'; setTimeout(() => returnToSelect(), 2000); 
}

let bombIsActive = false, bombHolder = 'host', bombTimer = 30, bombTimerInterval = null;
const bombMyState = { x: 0, z: 0 }, bombOppState = { x: 999, z: 999 };
let bPlayerMesh, bOppMesh, bBombMesh;
function startBombGame() {
  activeGame = 'bomb'; bombIsActive = true; bombHolder = 'host'; bombTimer = 30; switchUI(true, true);
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x111111);
  currentCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100); currentCamera.position.set(0, 20, 20); currentCamera.lookAt(0, 0, 0);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 30), new THREE.MeshStandardMaterial({ color: 0x444444 })); floor.position.y = -0.5; currentScene.add(floor);
  bPlayerMesh = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial({ color: myRole==='host'?0xe74c3c:0x3498db }));
  bOppMesh = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial({ color: myRole==='host'?0x3498db:0xe74c3c }));
  bBombMesh = new THREE.Mesh(new THREE.SphereGeometry(0.6), new THREE.MeshStandardMaterial({ color: 0xf1c40f }));
  currentScene.add(bPlayerMesh, bOppMesh, bBombMesh);
  bombMyState.x = myRole === 'host' ? -8 : 8; bombMyState.z = 0;
  clearInterval(bombTimerInterval);
  if (myRole === 'host') {
    bombTimerInterval = setInterval(() => {
      if (!bombIsActive) return;
      bombTimer--;
      roomChannel.send({ type: 'broadcast', event: 'bomb_sync', payload: { timer: bombTimer, holder: bombHolder } });
      if (bombTimer <= 0) bombEnd();
    }, 1000);
  }
  roomChannel.on('broadcast', { event: 'bomb_sync' }, (p) => { bombTimer = p.payload.timer; bombHolder = p.payload.holder; })
    .on('broadcast', { event: 'bomb_move' }, (p) => { bombOppState.x = p.payload.x; bombOppState.z = p.payload.z; });
}
function bombEnd() {
  if (!bombIsActive) return;
  bombIsActive = false; clearInterval(bombTimerInterval);
  statusText.innerText = (bombHolder !== myRole) ? "👑 爆発！あなたの勝利！" : "💥 爆発！あなたの負け！";
  setTimeout(() => { if (myRole === 'host') roomChannel.send({ type: 'broadcast', event: 'back_to_select' }); returnToSelect(); }, 2500);
}


// ==========================================
// 🧠 物理・フレーム計算処理
// ==========================================
function updateGameLogic() {
  if (gameGracePeriod > 0) gameGracePeriod--;

  // エアホッケー計算
  if (activeGame === 'hockey' && hockeyIsActive) {
    if (myRole === 'host') {
      hockeyBall.x += hockeyBall.vx;
      hockeyBall.y += hockeyBall.vy;

      if (hockeyBall.y < 20 || hockeyBall.y > 580) hockeyBall.vy *= -1;

      // P1 衝突
      const dist1 = Math.hypot(hockeyBall.x - hockeyP1Pos.x, hockeyBall.y - hockeyP1Pos.y);
      if (dist1 < 35) {
        const hitPower = Math.hypot(hockeyP1Pos.vx, hockeyP1Pos.vy);
        const speed = Math.max(7, Math.min(22, hitPower + 5));
        const angle = Math.atan2(hockeyBall.y - hockeyP1Pos.y, hockeyBall.x - hockeyP1Pos.x);
        hockeyBall.vx = Math.cos(angle) * speed;
        hockeyBall.vy = Math.sin(angle) * speed;
      }

      // P2 衝突
      const dist2 = Math.hypot(hockeyBall.x - hockeyP2Pos.x, hockeyBall.y - hockeyP2Pos.y);
      if (dist2 < 35) {
        const hitPower = Math.hypot(hockeyP2Pos.vx, hockeyP2Pos.vy);
        const speed = Math.max(7, Math.min(22, hitPower + 5));
        const angle = Math.atan2(hockeyBall.y - hockeyP2Pos.y, hockeyBall.x - hockeyP2Pos.x);
        hockeyBall.vx = Math.cos(angle) * speed;
        hockeyBall.vy = Math.sin(angle) * speed;
      }

      if (hockeyBall.x < 0) { hockeyScore.p2++; resetHockeyBall(); }
      if (hockeyBall.x > 800) { hockeyScore.p1++; resetHockeyBall(); }

      roomChannel.send({ type: 'broadcast', event: 'hockey_sync', payload: { p1Pos: hockeyP1Pos, ball: hockeyBall, score: hockeyScore } });
    } else {
      roomChannel.send({ type: 'broadcast', event: 'hockey_sync', payload: { p2Pos: hockeyP2Pos } });
    }
  }
}

// 描画ループ
function animate() {
  requestAnimationFrame(animate);
  if (!document.hidden) updateGameLogic();

  if (activeGame === 'hockey' && hockeyIsActive) {
    ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);
    ctx2D.fillStyle = '#1e272e'; ctx2D.fillRect(0, 0, canvas2D.width, canvas2D.height);

    ctx2D.strokeStyle = 'rgba(255,255,255,0.2)'; ctx2D.lineWidth = 4;
    ctx2D.beginPath(); ctx2D.moveTo(400, 0); ctx2D.lineTo(400, 600); ctx2D.stroke();

    ctx2D.fillStyle = 'white'; ctx2D.font = 'bold 36px Arial'; ctx2D.textAlign = 'center';
    ctx2D.fillText(`${hockeyScore.p1}  -  ${hockeyScore.p2}`, 400, 50);

    ctx2D.fillStyle = '#e74c3c'; ctx2D.beginPath(); ctx2D.arc(hockeyP1Pos.x, hockeyP1Pos.y, 25, 0, Math.PI*2); ctx2D.fill();
    ctx2D.strokeStyle = 'white'; ctx2D.lineWidth = 3; ctx2D.stroke();

    ctx2D.fillStyle = '#3498db'; ctx2D.beginPath(); ctx2D.arc(hockeyP2Pos.x, hockeyP2Pos.y, 25, 0, Math.PI*2); ctx2D.fill();
    ctx2D.strokeStyle = 'white'; ctx2D.stroke();

    ctx2D.fillStyle = '#f1c40f'; ctx2D.beginPath(); ctx2D.arc(hockeyBall.x, hockeyBall.y, 14, 0, Math.PI*2); ctx2D.fill();
  }
  else if (activeGame === 'oni' && oniIsActive) {
    if (oniPlayerMesh) { oniPlayerMesh.position.set(oniMyState.x, oniMyState.y, oniMyState.z); oniPlayerMesh.rotation.y = oniMyState.rot; }
    if (oniOppMesh) { oniOppMesh.position.set(oniOppState.x, oniOppState.y, oniOppState.z); oniOppMesh.rotation.y = oniOppState.rot; }
    if (oniCamContainer) oniCamContainer.position.set(oniMyState.x, oniMyState.y, oniMyState.z);
    statusText.innerText = `⏱️ 残り: ${oniTimeLeft}秒 (${myRole==='host'?'👹 鬼':'🏃 逃げ手'})`;
    if (currentScene) renderer.render(currentScene, currentCamera);
  }
  else if (activeGame === 'bomb' && bombIsActive) {
    if (bPlayerMesh) bPlayerMesh.position.set(bombMyState.x, 1, bombMyState.z);
    if (bOppMesh) bOppMesh.position.set(bombOppState.x, 1, bombOppState.z);
    const holderPos = bombHolder === myRole ? bombMyState : bombOppState;
    if (bBombMesh) bBombMesh.position.set(holderPos.x, 2.5, holderPos.z);
    statusText.innerText = `💣 爆発まで: ${bombTimer}秒 (${bombHolder===myRole?'⚠️ あなたが爆弾持ち！':'相手が爆弾持ち'})`;
    if (currentScene) renderer.render(currentScene, currentCamera);
  }
  else if (activeGame === 'sumo' && sumoIsActive) {
    if (p1Mesh && p2Mesh) {
      p1Mesh.position.set(myRole==='host'?sumoMyState.x:sumoOppState.x, 1, myRole==='host'?sumoMyState.z:sumoOppState.z);
      p2Mesh.position.set(myRole==='host'?sumoOppState.x:sumoMyState.x, 1, myRole==='host'?sumoOppState.z:sumoMyState.z);
    }
    if (currentScene) renderer.render(currentScene, currentCamera);
  }
  else if (activeGame) {
    ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);
    ctx2D.fillStyle = '#2c3e50'; ctx2D.fillRect(0, 0, canvas2D.width, canvas2D.height);
    ctx2D.fillStyle = 'white'; ctx2D.font = 'bold 30px Arial'; ctx2D.textAlign = 'center';
    ctx2D.fillText(gameNames[activeGame] || '', 400, 300);
  }
}
animate();

window.addEventListener('resize', () => {
  if (currentCamera) { currentCamera.aspect = window.innerWidth / window.innerHeight; currentCamera.updateProjectionMatrix(); }
  renderer.setSize(window.innerWidth, window.innerHeight);
});

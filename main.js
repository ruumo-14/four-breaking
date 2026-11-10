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
  card: '🃏 カードバトラー',
  '2d': '⚔️ 2D大乱闘バッシュ',
  sumo: '🚘 3Dドタバタ相撲',
  c4: '🔴 立体四目並べ'
};

function showControlsHUD(game) {
  controlsDisplay.style.display = 'block';
  if (game === 'oni') controlsDisplay.innerHTML = `<strong>【モール鬼ごっこ操作】</strong><br>[W][A][S][D]: 移動<br>[Space]: ジャンプ / タッチ(鬼)<br>[Shift]: ダッシュ(スタミナ消費)`;
  else if (game === 'card') controlsDisplay.innerHTML = `<strong>【カードバトラー】</strong><br>画面のカードをクリックして出そう！<br>数字が大きい方が勝利！`;
  else if (game === 'c4') controlsDisplay.innerHTML = `<strong>【操作】</strong><br>視点: マウス/タップ, 配置: クリック`;
  else if (game === 'sumo') controlsDisplay.innerHTML = `<strong>【操作】</strong><br>[W][A][S][D]: 移動, [Space]: タックル, [Shift]: ガード`;
  else if (game === '2d') controlsDisplay.innerHTML = `<strong>【操作】</strong><br>[A][D]: 移動, [W]: ジャンプ, [Space]: 攻撃, [Shift]: シールド`;
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
  if(e.key === 'q' || e.key === 'Q') { keys.dive = true; keys.grab = true; }
  if(e.key === 'e' || e.key === 'E') keys.special = true;
});
window.addEventListener('keyup', (e) => {
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = false;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = false;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = false;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = false;
  if(e.code === 'Space') { keys.action = false; keys.jump = false; }
  if(e.key === 'Shift') { keys.crouch = false; keys.guard = false; }
  if(e.key === 'q' || e.key === 'Q') { keys.dive = false; keys.grab = false; }
  if(e.key === 'e' || e.key === 'E') keys.special = false;
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
  if (availableRooms.length === 0) { roomListContainer.innerHTML = '<p style="font-size: 0.9rem; color: #aaa;">待機中の部屋はありません</p>'; return; }

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
      if (s === 'SUBSCRIBED') {
        if (myRole === 'guest') roomChannel.send({ type: 'broadcast', event: 'joined' });
      }
    });

  ['oni', 'card', '2d', 'sumo', 'c4'].forEach(g => {
    document.getElementById(`btn-select-${g}`).onclick = () => {
      selectedGameByMe = g;
      addChatMessage('システム', `「${gameNames[g]}」に投票しました！相手の投票を待っています...`, '#2ecc71');
      roomChannel.send({ type: 'broadcast', event: 'vote_game', payload: { game: g } });
      checkStartRoulette();
    };
  });
}

// 🎲 抽選システム
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
  activeGame = null; oniIsActive = false; sumoIsActive = false; brIsActive = false; c4IsGameActive = false; cardIsActive = false;
  
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
  else if (game === 'card') startCardGame();
  else if (game === '2d') startBrawler();
  else if (game === 'sumo') startSumo();
  else if (game === 'c4') startConnect4();
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
// 🏃【新機能拡張】ショッピングモール鬼ごっこ
// ==========================================
let oniIsActive = false, oniTimeLeft = 40, oniTimerInterval = null;
const oniMyState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, stamina: 100, isGrounded: true };
const oniOppState = { x: 0, y: 0, z: 0, rot: 0 };
let oniPlayerMesh, oniOppMesh, oniCamContainer;
const mallBoxes = [];

function startOnigokko() {
  activeGame = 'oni'; oniIsActive = true; oniTimeLeft = 40; switchUI(true, true);
  staminaContainer.style.display = 'block';
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x34495e);

  oniCamContainer = new THREE.Group(); currentScene.add(oniCamContainer);
  currentCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(0, 12, 14); currentCamera.lookAt(0, 0, 0);
  oniCamContainer.add(currentCamera);

  currentScene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const light = new THREE.DirectionalLight(0xffffff, 0.8); light.position.set(10, 25, 10); currentScene.add(light);

  // モール床
  const floor = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 60), new THREE.MeshStandardMaterial({ color: 0xecf0f1 }));
  floor.position.y = -0.5; currentScene.add(floor);

  // モール構造（店舗・柱・エスカレーター風階段）
  mallBoxes.length = 0;
  const structures = [
    { x: -15, y: 2, z: -15, w: 10, h: 4, d: 10, c: 0x95a5a6 }, // 店舗A
    { x: 15, y: 2, z: -15, w: 10, h: 4, d: 10, c: 0x95a5a6 },  // 店舗B
    { x: -15, y: 2, z: 15, w: 10, h: 4, d: 10, c: 0x95a5a6 },   // 店舗C
    { x: 15, y: 2, z: 15, w: 10, h: 4, d: 10, c: 0x95a5a6 },    // 店舗D
    { x: 0, y: 1.5, z: 0, w: 6, h: 3, d: 6, c: 0x3498db },      // 中央広場モニュメント
    { x: 0, y: 1, z: -20, w: 4, h: 2, d: 8, c: 0xe67e22 }      // エスカレーター風台座
  ];

  structures.forEach(s => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), new THREE.MeshStandardMaterial({ color: s.c }));
    mesh.position.set(s.x, s.y, s.z); currentScene.add(mesh);
    mallBoxes.push(new THREE.Box3().setFromObject(mesh));
  });

  const isOni = (myRole === 'host');
  function createRunner(color) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color }));
    body.position.y = 1.2; g.add(body);
    return g;
  }
  oniPlayerMesh = createRunner(isOni ? 0xe74c3c : 0x2980b9);
  oniOppMesh = createRunner(isOni ? 0x2980b9 : 0xe74c3c);
  currentScene.add(oniPlayerMesh, oniOppMesh);

  oniMyState.x = isOni ? -22 : 22; oniMyState.z = isOni ? -22 : 22; oniMyState.y = 0; oniMyState.stamina = 100;

  // 役割明記
  statusText.innerText = isOni ? "👹 【あなたは鬼】 相手を捕まえろ！" : "🏃 【あなたは逃げ手】 40秒間逃げ切れ！";
  statusText.style.color = isOni ? "#e74c3c" : "#3498db";

  clearInterval(oniTimerInterval);
  if (myRole === 'host') {
    oniTimerInterval = setInterval(() => {
      if (!oniIsActive) return;
      oniTimeLeft--;
      roomChannel.send({ type: 'broadcast', event: 'oni_timer', payload: { time: oniTimeLeft } });
      if (oniTimeLeft <= 0) oniEnd('guest');
    }, 1000);
  }

  roomChannel
    .on('broadcast', { event: 'oni_timer' }, (p) => { oniTimeLeft = p.payload.time; })
    .on('broadcast', { event: 'sync' }, (p) => { oniOppState.x = p.payload.x; oniOppState.y = p.payload.y; oniOppState.z = p.payload.z; oniOppState.rot = p.payload.rot; })
    .on('broadcast', { event: 'oni_caught' }, () => oniEnd('host'));
}

function oniEnd(winnerRole) {
  oniIsActive = false; clearInterval(oniTimerInterval); staminaContainer.style.display = 'none';
  const isWin = (myRole === winnerRole);
  statusText.innerText = isWin ? "👑 WIN!! 勝利！" : "💀 LOSE... 敗北";
  statusText.style.color = isWin ? "#2ecc71" : "#e74c3c";
  setTimeout(() => {
    if (myRole === 'host') roomChannel.send({ type: 'broadcast', event: 'back_to_select' });
    returnToSelect();
  }, 2500);
}


// ==========================================
// 🃏【新規ゲーム】カードバトラー (Card Game)
// ==========================================
let cardIsActive = false, cardMyHand = [], cardMyPoints = 0, cardOppPoints = 0;
let cardMyChoice = null, cardOppChoice = null;

function startCardGame() {
  activeGame = 'card'; cardIsActive = true; switchUI(false, false);
  cardMyHand = [1, 2, 3, 4, 5, 6, 7];
  cardMyPoints = 0; cardOppPoints = 0;
  cardMyChoice = null; cardOppChoice = null;
  statusText.innerText = "🃏 手札から1枚選んで出そう！"; statusText.style.color = "#8e44ad";

  roomChannel
    .on('broadcast', { event: 'card_play' }, (p) => {
      cardOppChoice = p.payload.card;
      checkCardRound();
    });
}

function checkCardRound() {
  if (cardMyChoice !== null && cardOppChoice !== null) {
    let resultMsg = "";
    if (cardMyChoice > cardOppChoice) { cardMyPoints++; resultMsg = `勝ち！ (${cardMyChoice} vs ${cardOppChoice})`; }
    else if (cardMyChoice < cardOppChoice) { cardOppPoints++; resultMsg = `負け... (${cardMyChoice} vs ${cardOppChoice})`; }
    else { resultMsg = `引き分け (${cardMyChoice} vs ${cardOppChoice})`; }

    statusText.innerText = resultMsg;
    setTimeout(() => {
      cardMyChoice = null; cardOppChoice = null;
      if (cardMyHand.length === 0) {
        // 勝敗決定
        const isWin = cardMyPoints > cardOppPoints;
        statusText.innerText = isWin ? `👑 最終勝利！ (${cardMyPoints} - ${cardOppPoints})` : `💀 最終敗北... (${cardMyPoints} - ${cardOppPoints})`;
        setTimeout(() => {
          if (myRole === 'host') roomChannel.send({ type: 'broadcast', event: 'back_to_select' });
          returnToSelect();
        }, 2500);
      } else {
        statusText.innerText = "次のカードを選んでください！";
      }
    }, 1500);
  }
}

window.addEventListener('click', (e) => {
  if (activeGame !== 'card' || !cardIsActive || cardMyChoice !== null) return;
  // 2Dキャンバス上のカードクリック判定
  const rect = canvas2D.getBoundingClientRect();
  const clickX = (e.clientX - rect.left) * (canvas2D.width / rect.width);
  const clickY = (e.clientY - rect.top) * (canvas2D.height / rect.height);

  cardMyHand.forEach((val, idx) => {
    const cardX = 80 + idx * 95;
    const cardY = 430;
    if (clickX >= cardX && clickX <= cardX + 80 && clickY >= cardY && clickY <= cardY + 120) {
      cardMyChoice = val;
      cardMyHand.splice(idx, 1);
      roomChannel.send({ type: 'broadcast', event: 'card_play', payload: { card: val } });
      statusText.innerText = `相手のカードを待っています... (あなた: ${val})`;
      checkCardRound();
    }
  });
});


// ==========================================
// 🔴 四目並べ / 🚘 相撲 / ⚔️ 2D大乱闘
// ==========================================
let c4MyColor, c4CurrentTurn, c4IsGameActive = false, c4Board, c4Hitboxes, c4Ghost, c4Controls;
function startConnect4() {
  activeGame = 'c4'; c4MyColor = myRole === 'host' ? 'red' : 'yellow'; c4CurrentTurn = 'red'; c4IsGameActive = true;
  c4Board = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => []));
  switchUI(true, false); c4UpdateStatus();
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x1a1a1a);
  currentCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(8, 7, 8); c4Controls = new OrbitControls(currentCamera, renderer.domElement); c4Controls.enablePan = false;
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.5)); const dirLight = new THREE.DirectionalLight(0xffffff, 1); dirLight.position.set(10, 20, 10); currentScene.add(dirLight);
  const base = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 5), new THREE.MeshStandardMaterial({ color: 0x1155aa })); base.position.y = -0.25; currentScene.add(base);
  c4Hitboxes = [];
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 4; z++) {
      const px = x - 1.5, pz = z - 1.5;
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.5), new THREE.MeshStandardMaterial({ color: 0xaaaaaa })); peg.position.set(px, 2.25, pz); currentScene.add(peg);
      const hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5, 0.8), new THREE.MeshBasicMaterial({ visible: false })); hitbox.position.set(px, 2.5, pz); hitbox.userData = { gridX: x, gridZ: z }; currentScene.add(hitbox); c4Hitboxes.push(hitbox);
    }
  }
  c4Ghost = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })); c4Ghost.visible = false; currentScene.add(c4Ghost);
  roomChannel.on('broadcast', { event: 'place' }, (p) => c4AddPiece(p.payload.x, p.payload.z, p.payload.c, false));
}
const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();
window.addEventListener('click', (e) => {
  if (activeGame !== 'c4' || e.target.closest('#chat-container') || !c4IsGameActive || c4MyColor !== c4CurrentTurn) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1; raycaster.setFromCamera(mouse, currentCamera);
  const intersects = raycaster.intersectObjects(c4Hitboxes);
  if (intersects.length > 0) { const { gridX, gridZ } = intersects[0].object.userData; if (c4Board[gridX][gridZ].length < 4) c4AddPiece(gridX, gridZ, c4MyColor, true); }
});
function c4AddPiece(x, z, color, isLocal) {
  const y = c4Board[x][z].length; c4Board[x][z].push(color);
  const piece = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), new THREE.MeshStandardMaterial({ color: color === 'red' ? 0xff3333 : 0xffcc00 }));
  piece.position.set(x - 1.5, y + 0.4, z - 1.5); currentScene.add(piece);
  if (isLocal) { c4Ghost.visible = false; roomChannel.send({ type: 'broadcast', event: 'place', payload: { x, z, c: color } }); }
  c4CurrentTurn = c4CurrentTurn === 'red' ? 'yellow' : 'red'; c4UpdateStatus();
}
function c4UpdateStatus() { statusText.innerText = c4MyColor === c4CurrentTurn ? `あなたの番` : `相手の番...`; statusText.style.color = c4MyColor === c4CurrentTurn ? '#ffcc00' : 'white'; }

let sumoIsActive = false, p1Mesh, p2Mesh, sumoArena, sumoEdge, sumoRadius = 15;
const sumoMyState = { x: 0, z: 0, rot: 0, vx: 0, vz: 0, guard: false }; const sumoOppState = { x: 0, z: 0, rot: 0, guard: false };
function startSumo() {
  activeGame = 'sumo'; sumoIsActive = true; sumoRadius = 15; switchUI(true, true);
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x87CEEB);
  currentCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100); currentCamera.position.set(0, 25, 30); currentCamera.lookAt(0, 0, 0);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.6)); const dirLight = new THREE.DirectionalLight(0xffffff, 0.8); dirLight.position.set(10, 20, 10); currentScene.add(dirLight);
  sumoArena = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1, 64), new THREE.MeshStandardMaterial({ color: 0x34495e })); sumoArena.position.y = -0.5; currentScene.add(sumoArena);
  sumoEdge = new THREE.Mesh(new THREE.TorusGeometry(15, 0.2, 32, 64), new THREE.MeshBasicMaterial({ color: 0xe74c3c })); sumoEdge.rotation.x = Math.PI / 2; currentScene.add(sumoEdge);
  p1Mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: 0xe74c3c }));
  p2Mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: 0x3498db })); currentScene.add(p1Mesh, p2Mesh);
  sumoMyState.x = myRole === 'host' ? 0 : 0; sumoMyState.z = myRole === 'host' ? 8 : -8;
  roomChannel.on('broadcast', { event: 'sync' }, (p) => { sumoOppState.x = p.payload.x; sumoOppState.z = p.payload.z; sumoOppState.rot = p.payload.rot; sumoOppState.guard = p.payload.guard; })
    .on('broadcast', { event: 'hit' }, (p) => { sumoMyState.vx += p.payload.vx; sumoMyState.vz += p.payload.vz; })
    .on('broadcast', { event: 'gameover' }, (p) => sumoEnd(p.payload.loserRole));
}
function sumoEnd(loser) { sumoIsActive = false; statusText.innerText = myRole !== loser ? '👑 勝利！！' : '💀 落下...'; setTimeout(() => returnToSelect(), 2000); }

let brIsActive = false; const brMyState = { x: 0, y: 0, vx: 0, vy: 0, dmg: 0, dir: 1, act: 'none', actTimer: 0, jumps: 2 }; const brOppState = { x: 0, y: 0, dmg: 0, dir: -1, act: 'none', actTimer: 0 };
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
// 🧠 物理計算
// ==========================================
function updateGameLogic() {
  frameCount++;

  // 🏃 モール鬼ごっこ
  if (activeGame === 'oni' && oniIsActive) {
    const isHost = (myRole === 'host');
    
    // ダッシュ＆スタミナ
    let speed = isHost ? 0.22 : 0.18;
    if (keys.guard && oniMyState.stamina > 0) {
      speed *= 1.6; // ダッシュ速度アップ
      oniMyState.stamina = Math.max(0, oniMyState.stamina - 1.5);
    } else {
      oniMyState.stamina = Math.min(100, oniMyState.stamina + 0.5); // 自動回復
    }
    staminaBar.style.width = `${oniMyState.stamina}%`;

    // 重力＆ジャンプ
    oniMyState.vy -= 0.015;
    if (keys.jump && !prevKeys.jump && oniMyState.isGrounded) {
      oniMyState.vy = 0.35;
      oniMyState.isGrounded = false;
    }

    let moveX = 0, moveZ = 0;
    if (keys.left) moveX -= 1; if (keys.right) moveX += 1;
    if (keys.up) moveZ -= 1; if (keys.down) moveZ += 1;

    if (moveX !== 0 || moveZ !== 0) {
      const len = Math.hypot(moveX, moveZ);
      oniMyState.vx = (moveX / len) * speed;
      oniMyState.vz = (moveZ / len) * speed;
      oniMyState.rot = Math.atan2(moveX, moveZ);
    } else {
      oniMyState.vx *= 0.8; oniMyState.vz *= 0.8;
    }

    let nextX = oniMyState.x + oniMyState.vx;
    let nextY = oniMyState.y + oniMyState.vy;
    let nextZ = oniMyState.z + oniMyState.vz;

    // 床接地
    if (nextY <= 0) { nextY = 0; oniMyState.vy = 0; oniMyState.isGrounded = true; }

    oniMyState.x = Math.max(-28, Math.min(28, nextX));
    oniMyState.y = nextY;
    oniMyState.z = Math.max(-28, Math.min(28, nextZ));

    // 鬼のタッチ判定
    if (isHost) {
      const dist = Math.hypot(oniMyState.x - oniOppState.x, oniMyState.z - oniOppState.z);
      if (dist < 1.6 && Math.abs(oniMyState.y - oniOppState.y) < 2.0) {
        roomChannel.send({ type: 'broadcast', event: 'oni_caught' });
        oniEnd('host');
      }
    }

    if (frameCount % 2 === 0) {
      roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: oniMyState.x, y: oniMyState.y, z: oniMyState.z, rot: oniMyState.rot } });
    }
  }

  // 🚘 相撲
  else if (activeGame === 'sumo' && sumoIsActive) {
    sumoRadius -= 0.003; if (sumoRadius < 3) sumoRadius = 3; const scale = sumoRadius / 15;
    if (sumoArena && sumoEdge) { sumoArena.scale.set(scale, 1, scale); sumoEdge.scale.set(scale, 1, scale); }
    sumoMyState.guard = keys.guard; const turn = 0.05, accel = keys.action ? 0.03 : 0.01;
    if (keys.left) sumoMyState.rot += turn; if (keys.right) sumoMyState.rot -= turn;
    if (keys.up) { sumoMyState.vx -= Math.sin(sumoMyState.rot)*accel; sumoMyState.vz -= Math.cos(sumoMyState.rot)*accel; }
    if (sumoMyState.guard) { sumoMyState.vx *= 0.85; sumoMyState.vz *= 0.85; } else { sumoMyState.vx *= 0.95; sumoMyState.vz *= 0.95; }
    sumoMyState.x += sumoMyState.vx; sumoMyState.z += sumoMyState.vz;
    const dx = sumoMyState.x - sumoOppState.x, dz = sumoMyState.z - sumoOppState.z; const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < 2.5 && dist > 0.1) {
      const overlap = 2.5 - dist; const nx = dx / dist, nz = dz / dist; sumoMyState.x += nx * overlap * 0.5; sumoMyState.z += nz * overlap * 0.5;
      if (Math.hypot(sumoMyState.vx, sumoMyState.vz) > 0.1) {
        roomChannel.send({ type: 'broadcast', event: 'hit', payload: { vx: -nx * 1.0, vz: -nz * 1.0 } }); sumoMyState.vx *= 0.3; sumoMyState.vz *= 0.3;
      }
    }
    if (Math.hypot(sumoMyState.x, sumoMyState.z) > sumoRadius + 0.5) { roomChannel.send({ type: 'broadcast', event: 'gameover', payload: { loserRole: myRole } }); sumoEnd(myRole); }
    if (frameCount % 3 === 0) roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: sumoMyState.x, z: sumoMyState.z, rot: sumoMyState.rot, guard: sumoMyState.guard } });
  }

  // ⚔️ 2D大乱闘
  else if (activeGame === '2d' && brIsActive) {
    brMyState.vy += 0.6;
    if (keys.left) { brMyState.vx -= 0.8; brMyState.dir = -1; } if (keys.right) { brMyState.vx += 0.8; brMyState.dir = 1; } brMyState.vx *= 0.85;
    if (keys.jump && !prevKeys.jump && brMyState.jumps > 0) { brMyState.vy = -12; brMyState.jumps--; }
    brMyState.x += brMyState.vx; brMyState.y += brMyState.vy;
    if (brMyState.vy >= 0) { for (let s of brStage) { if (brMyState.x > s.x - 20 && brMyState.x < s.x + s.w + 20 && brMyState.y >= s.y && brMyState.y - brMyState.vy <= s.y) { brMyState.y = s.y; brMyState.vy = 0; brMyState.jumps = 2; } } }
    if (brMyState.y > 800 || brMyState.x < -200 || brMyState.x > 1000) { roomChannel.send({ type: 'broadcast', event: 'gameover', payload: { loserRole: myRole } }); brEnd(myRole); }
    if (frameCount % 2 === 0) roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: brMyState.x, y: brMyState.y, dmg: brMyState.dmg, dir: brMyState.dir } });
  }

  prevKeys.up = keys.up; prevKeys.action = keys.action; prevKeys.jump = keys.jump; prevKeys.dive = keys.dive; prevKeys.special = keys.special; prevKeys.grab = keys.grab;
}


// ==========================================
// 🎨 レンダリング
// ==========================================
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);

  if (!document.hidden) updateGameLogic();

  if (activeGame === 'oni' && oniIsActive) {
    if (oniPlayerMesh) { oniPlayerMesh.position.set(oniMyState.x, oniMyState.y, oniMyState.z); oniPlayerMesh.rotation.y = oniMyState.rot; }
    if (oniOppMesh) { oniOppMesh.position.set(oniOppState.x, oniOppState.y, oniOppState.z); oniOppMesh.rotation.y = oniOppState.rot; }
    if (oniCamContainer) oniCamContainer.position.set(oniMyState.x, oniMyState.y, oniMyState.z);
    statusText.innerText = `⏱️ 残り時間: ${oniTimeLeft}秒 (${myRole==='host'?'👹 鬼':'🏃 逃げ手'})`;
    if (currentScene) renderer.render(currentScene, currentCamera);
  }
  else if (activeGame === 'card' && cardIsActive) {
    ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);
    ctx2D.fillStyle = '#2c3e50'; ctx2D.fillRect(0, 0, canvas2D.width, canvas2D.height);

    // 得点表示
    ctx2D.fillStyle = 'white'; ctx2D.font = 'bold 24px Arial';
    ctx2D.fillText(`あなた: ${cardMyPoints} 勝 | 相手: ${cardOppPoints} 勝`, 400, 50);

    // 手札描画
    cardMyHand.forEach((val, idx) => {
      const x = 80 + idx * 95, y = 430;
      ctx2D.fillStyle = '#9b59b6'; ctx2D.fillRect(x, y, 80, 120);
      ctx2D.strokeStyle = 'white'; ctx2D.lineWidth = 3; ctx2D.strokeRect(x, y, 80, 120);
      ctx2D.fillStyle = 'white'; ctx2D.font = 'bold 36px Arial'; ctx2D.textAlign = 'center';
      ctx2D.fillText(val, x + 40, y + 70);
    });
  }
  else if (activeGame === 'c4' && c4Controls) { c4Controls.update(); if (currentScene) renderer.render(currentScene, currentCamera); }
  else if (activeGame === 'sumo' && sumoIsActive) {
    if (p1Mesh && p2Mesh) {
      p1Mesh.position.set(myRole==='host'?sumoMyState.x:sumoOppState.x, 1, myRole==='host'?sumoMyState.z:sumoOppState.z);
      p2Mesh.position.set(myRole==='host'?sumoOppState.x:sumoMyState.x, 1, myRole==='host'?sumoOppState.z:sumoMyState.z);
    }
    if (currentScene) renderer.render(currentScene, currentCamera);
  }
  else if (activeGame === '2d' && brIsActive) {
    ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height); ctx2D.fillStyle = '#7f8c8d'; for(let s of brStage) ctx2D.fillRect(s.x, s.y, s.w, s.h);
    function drawFighter(state, isRed) {
      ctx2D.save(); ctx2D.translate(state.x, state.y); ctx2D.fillStyle = isRed ? '#e74c3c' : '#3498db'; ctx2D.fillRect(-15, -30, 30, 30); ctx2D.restore();
    }
    drawFighter(brOppState, myRole !== 'host'); drawFighter(brMyState, myRole === 'host');
  }
}

animate();

window.addEventListener('resize', () => {
  if (currentCamera) { currentCamera.aspect = window.innerWidth / window.innerHeight; currentCamera.updateProjectionMatrix(); }
  renderer.setSize(window.innerWidth, window.innerHeight);
});

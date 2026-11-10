import * as THREE from 'https://esm.sh/three';
import { OrbitControls } from 'https://esm.sh/three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// --- 1. Supabase の設定 ---
const supabaseUrl = 'https://pxcimtveipluoenjiebx.supabase.co';
const supabaseKey = 'sb_publishable_73t9gf0Rm47Kae9KAHfe6w_asA7g7mM';
const supabase = createClient(supabaseUrl, supabaseKey);

let currentRoomId = null;
let myRole = null; // 'host' (red) or 'guest' (blue)
let activeGame = null;
let roomChannel = null;

const statusText = document.getElementById('status');
const uiContainer = document.getElementById('ui-container');
const panelLobby = document.getElementById('panel-lobby');
const panelSelect = document.getElementById('panel-select');
const controlsDisplay = document.getElementById('controls-display');

// バックグラウンドWorker
const workerScript = `
  let interval;
  self.onmessage = function(e) {
    if (e.data === 'start') interval = setInterval(() => self.postMessage('tick'), 16);
    else if (e.data === 'stop') clearInterval(interval);
  };
`;
const workerBlob = new Blob([workerScript], { type: 'application/javascript' });
const bgWorker = new Worker(URL.createObjectURL(workerBlob));
bgWorker.postMessage('start');
bgWorker.onmessage = () => {
  if (document.hidden && activeGame) updateGameLogic();
};

function showControlsHUD(game) {
  controlsDisplay.style.display = 'block';
  if (game === 'c4') controlsDisplay.innerHTML = `<strong>【操作】</strong><br>視点: マウス/タップ<br>配置: クリック`;
  else if (game === 'sumo') controlsDisplay.innerHTML = `<strong>【操作】</strong><br>[W][A][S][D]: 移動, [Space]: タックル<br>[Shift]: ガード`;
  else if (game === '2d') controlsDisplay.innerHTML = `<strong>【操作】</strong><br>[A][D]: 移動, [W]: ジャンプ<br>[Space]: 攻撃, [Shift]: シールド, [Q]: つかみ, [E]: 必殺技`;
  else if (game === 'oni') controlsDisplay.innerHTML = `<strong>【鬼ごっこ操作】</strong><br>[W][A][S][D]: 移動<br>[Space]: タッチ(鬼のみ) / ダッシュ`;
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
window.addEventListener('blur', () => { for(let k in keys) keys[k] = false; });

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

// 部屋への入室処理
function joinRoom(roomId, role) {
  currentRoomId = roomId; myRole = role;
  panelLobby.style.display = 'none';
  panelSelect.style.display = 'block';
  document.getElementById('room-title').innerText = `🏠 部屋：${roomId}`;

  roomChannel = supabase.channel(`room-${roomId}`);
  roomChannel
    .on('broadcast', { event: 'chat' }, (p) => addChatMessage(p.payload.sender, p.payload.text, p.payload.color))
    .on('broadcast', { event: 'select_game' }, (p) => launchGame(p.payload.game))
    .on('broadcast', { event: 'joined' }, () => {
      document.getElementById('room-status-text').innerText = "🟢 相手が参加しました！";
      if (myRole === 'host') lobbyChannel.untrack();
    })
    .on('broadcast', { event: 'back_to_select' }, () => returnToSelect())
    .subscribe((s) => {
      if (s === 'SUBSCRIBED') {
        if (myRole === 'guest') roomChannel.send({ type: 'broadcast', event: 'joined' });
        else addChatMessage('システム', `部屋「${roomId}」を作成しました`, '#4caf50');
      }
    });

  // セレクトボタンのイベント割り当て
  ['oni', '2d', 'sumo', 'c4'].forEach(g => {
    document.getElementById(`btn-select-${g}`).onclick = () => {
      roomChannel.send({ type: 'broadcast', event: 'select_game', payload: { game: g } });
      launchGame(g);
    };
  });
}

// ゲーム終了後にセレクト画面へ復帰
function returnToSelect() {
  activeGame = null;
  oniIsActive = false; sumoIsActive = false; brIsActive = false; c4IsGameActive = false;
  
  document.getElementById('app').style.display = 'none';
  canvas2D.style.display = 'none';
  document.getElementById('controls').style.display = 'none';
  controlsDisplay.style.display = 'none';
  statusText.innerText = '';
  
  uiContainer.style.display = 'flex';
  panelSelect.style.display = 'block';
}

function launchGame(game) {
  uiContainer.style.display = 'none';
  if (game === 'oni') startOnigokko();
  else if (game === '2d') startBrawler();
  else if (game === 'sumo') startSumo();
  else if (game === 'c4') startConnect4();
}

// チャット処理
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

// 3D環境初期化
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
// 🏃【新規追加】3D 鬼ごっこ (Onigokko)
// ==========================================
let oniIsActive = false, oniTimeLeft = 40, oniTimerInterval = null;
const oniMyState = { x: 0, z: 0, rot: 0 };
const oniOppState = { x: 0, z: 0, rot: 0 };
let oniPlayerMesh, oniOppMesh, oniCamContainer;

function startOnigokko() {
  activeGame = 'oni'; oniIsActive = true; oniTimeLeft = 40; switchUI(true, true);
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x2c3e50);

  oniCamContainer = new THREE.Group(); currentScene.add(oniCamContainer);
  currentCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(0, 15, 15); currentCamera.lookAt(0, 0, 0);
  oniCamContainer.add(currentCamera);

  currentScene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const light = new THREE.DirectionalLight(0xffffff, 0.8); light.position.set(10, 20, 10); currentScene.add(light);

  // ステージ床
  const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 40), new THREE.MeshStandardMaterial({ color: 0x27ae60 }));
  floor.position.y = -0.5; currentScene.add(floor);

  // 障害物
  [ [-8,-8], [8,8], [-8,8], [8,-8], [0,0] ].forEach(p => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), new THREE.MeshStandardMaterial({ color: 0x7f8c8d }));
    box.position.set(p[0], 1.5, p[1]); currentScene.add(box);
  });

  // プレイヤー生成（ホストが鬼＝赤、ゲストが逃げ手＝青）
  const isOni = (myRole === 'host');
  function createRunner(color) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color }));
    body.position.y = 1.2; g.add(body);
    return g;
  }
  oniPlayerMesh = createRunner(isOni ? 0xe74c3c : 0x3498db);
  oniOppMesh = createRunner(isOni ? 0x3498db : 0xe74c3c);
  currentScene.add(oniPlayerMesh, oniOppMesh);

  oniMyState.x = isOni ? -15 : 15; oniMyState.z = isOni ? -15 : 15;
  statusText.innerText = isOni ? "👹 あなたは鬼！相手にタッチしろ！" : "🏃 あなたは逃げ手！40秒逃げ切れ！";
  statusText.style.color = isOni ? "#e74c3c" : "#3498db";

  // タイマー処理
  clearInterval(oniTimerInterval);
  if (myRole === 'host') {
    oniTimerInterval = setInterval(() => {
      if (!oniIsActive) return;
      oniTimeLeft--;
      roomChannel.send({ type: 'broadcast', event: 'oni_timer', payload: { time: oniTimeLeft } });
      if (oniTimeLeft <= 0) oniEnd('guest'); // 逃げ切り成功
    }, 1000);
  }

  roomChannel
    .on('broadcast', { event: 'oni_timer' }, (p) => { oniTimeLeft = p.payload.time; })
    .on('broadcast', { event: 'sync' }, (p) => { oniOppState.x = p.payload.x; oniOppState.z = p.payload.z; oniOppState.rot = p.payload.rot; })
    .on('broadcast', { event: 'oni_caught' }, () => oniEnd('host'));
}

function oniEnd(winnerRole) {
  oniIsActive = false; clearInterval(oniTimerInterval);
  const isWin = (myRole === winnerRole);
  statusText.innerText = isWin ? "👑 WIN!! 勝利！" : "💀 LOSE... 敗北";
  statusText.style.color = isWin ? "#2ecc71" : "#e74c3c";
  setTimeout(() => {
    if (myRole === 'host') roomChannel.send({ type: 'broadcast', event: 'back_to_select' });
    returnToSelect();
  }, 2500);
}


// ==========================================
// 🔴 四目並べ
// ==========================================
let c4MyColor, c4CurrentTurn, c4IsGameActive = false, c4Board, c4Hitboxes, c4Ghost, c4Controls;
function startConnect4() {
  activeGame = 'c4'; c4MyColor = myRole === 'host' ? 'red' : 'yellow'; c4CurrentTurn = 'red'; c4IsGameActive = true;
  c4Board = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => []));
  switchUI(true, false);
  c4UpdateStatus();
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


// ==========================================
// 🚘 3Dドタバタ相撲
// ==========================================
let sumoIsActive = false, p1Mesh, p2Mesh, sumoArena, sumoEdge, sumoRadius = 15;
const sumoMyState = { x: 0, z: 0, rot: 0, vx: 0, vz: 0, guard: false }; 
const sumoOppState = { x: 0, z: 0, rot: 0, guard: false };

function startSumo() {
  activeGame = 'sumo'; sumoIsActive = true; sumoRadius = 15; switchUI(true, true);
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x87CEEB);
  currentCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100); currentCamera.position.set(0, 25, 30); currentCamera.lookAt(0, 0, 0);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.6)); const dirLight = new THREE.DirectionalLight(0xffffff, 0.8); dirLight.position.set(10, 20, 10); currentScene.add(dirLight);
  sumoArena = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1, 64), new THREE.MeshStandardMaterial({ color: 0x34495e })); sumoArena.position.y = -0.5; currentScene.add(sumoArena);
  sumoEdge = new THREE.Mesh(new THREE.TorusGeometry(15, 0.2, 32, 64), new THREE.MeshBasicMaterial({ color: 0xe74c3c })); sumoEdge.rotation.x = Math.PI / 2; currentScene.add(sumoEdge);
  
  function createCar(c) {
    const group = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: c })); body.position.y = 1;
    group.add(body); return group;
  }
  p1Mesh = createCar(0xe74c3c); p2Mesh = createCar(0x3498db); currentScene.add(p1Mesh, p2Mesh);
  sumoSetup();

  roomChannel
    .on('broadcast', { event: 'sync' }, (p) => { sumoOppState.x = p.payload.x; sumoOppState.z = p.payload.z; sumoOppState.rot = p.payload.rot; sumoOppState.guard = p.payload.guard; })
    .on('broadcast', { event: 'hit' }, (p) => { sumoMyState.vx += p.payload.vx; sumoMyState.vz += p.payload.vz; })
    .on('broadcast', { event: 'gameover' }, (p) => sumoEnd(p.payload.loserRole));
}
function sumoSetup() { 
  sumoMyState.x = 0; sumoMyState.z = myRole === 'host' ? 8 : -8; sumoMyState.rot = myRole === 'host' ? 0 : Math.PI; 
  sumoMyState.vx = 0; sumoMyState.vz = 0; statusText.innerText = `タックルで落とせ！`; statusText.style.color = "#ffcc00"; 
}
function sumoEnd(loser) { sumoIsActive = false; const isWin = myRole !== loser; statusText.innerText = isWin ? '👑 勝利！！' : '💀 落下...'; setTimeout(() => { returnToSelect(); }, 2000); }


// ==========================================
// ⚔️ 2D大乱闘バッシュ
// ==========================================
let brIsActive = false; 
const brMyState = { x: 0, y: 0, vx: 0, vy: 0, dmg: 0, dir: 1, act: 'none', actTimer: 0, jumps: 2 }; 
const brOppState = { x: 0, y: 0, dmg: 0, dir: -1, act: 'none', actTimer: 0 };
const brStage = [ { x: 150, y: 450, w: 500, h: 20 }, { x: 50, y: 300, w: 150, h: 10 }, { x: 600, y: 300, w: 150, h: 10 } ];

function startBrawler() {
  activeGame = '2d'; brIsActive = true; switchUI(false, true); brSetup();
  roomChannel
    .on('broadcast', { event: 'sync' }, (p) => { brOppState.x = p.payload.x; brOppState.y = p.payload.y; brOppState.dmg = p.payload.dmg; brOppState.dir = p.payload.dir; brOppState.act = p.payload.act; brOppState.actTimer = p.payload.actTimer; })
    .on('broadcast', { event: 'hit' }, (p) => { brMyState.dmg += p.payload.dmg; brMyState.vx = p.payload.vx; brMyState.vy = p.payload.vy; brMyState.jumps = 1; })
    .on('broadcast', { event: 'gameover' }, (p) => brEnd(p.payload.loserRole));
}
function brSetup() { 
  brMyState.x = myRole === 'host' ? 300 : 500; brMyState.y = 200; brMyState.dir = myRole === 'host' ? 1 : -1; 
  brMyState.vx = 0; brMyState.vy = 0; brMyState.dmg = 0; brMyState.jumps = 2; statusText.innerText = `吹き飛ばせ！`; statusText.style.color = "#ffcc00"; 
}
function brEnd(loser) { brIsActive = false; const isWin = myRole !== loser; statusText.innerText = isWin ? '👑 GAME SET!' : '💀 場外負け...'; setTimeout(() => { returnToSelect(); }, 2000); }


// ==========================================
// 🧠 共通物理計算
// ==========================================
function updateGameLogic() {
  frameCount++;

  // 🏃 鬼ごっこ物理
  if (activeGame === 'oni' && oniIsActive) {
    const isHost = (myRole === 'host');
    const speed = isHost ? 0.22 : 0.18; // 鬼は少し速い
    let moveX = 0, moveZ = 0;

    if (keys.left) moveX -= 1; if (keys.right) moveX += 1;
    if (keys.up) moveZ -= 1; if (keys.down) moveZ += 1;

    if (moveX !== 0 || moveZ !== 0) {
      const len = Math.hypot(moveX, moveZ);
      oniMyState.x += (moveX / len) * speed;
      oniMyState.z += (moveZ / len) * speed;
      oniMyState.rot = Math.atan2(moveX, moveZ);
    }

    // 範囲制限
    oniMyState.x = Math.max(-19, Math.min(19, oniMyState.x));
    oniMyState.z = Math.max(-19, Math.min(19, oniMyState.z));

    // タッチ判定（鬼側が判定する）
    if (isHost) {
      const dist = Math.hypot(oniMyState.x - oniOppState.x, oniMyState.z - oniOppState.z);
      if (dist < 1.5) {
        roomChannel.send({ type: 'broadcast', event: 'oni_caught' });
        oniEnd('host');
      }
    }

    if (frameCount % 2 === 0) {
      roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: oniMyState.x, z: oniMyState.z, rot: oniMyState.rot } });
    }
  }

  // 🚘 相撲物理
  else if (activeGame === 'sumo' && sumoIsActive) {
    sumoRadius -= 0.003; if (sumoRadius < 3) sumoRadius = 3; const scale = sumoRadius / 15;
    if (sumoArena && sumoEdge) { sumoArena.scale.set(scale, 1, scale); sumoEdge.scale.set(scale, 1, scale); }
    
    sumoMyState.guard = keys.guard;
    const turn = 0.05, accel = keys.action ? 0.03 : 0.01;
    if (keys.left) sumoMyState.rot += turn; if (keys.right) sumoMyState.rot -= turn;
    if (keys.up) { sumoMyState.vx -= Math.sin(sumoMyState.rot)*accel; sumoMyState.vz -= Math.cos(sumoMyState.rot)*accel; }
    if (keys.down) { sumoMyState.vx += Math.sin(sumoMyState.rot)*accel*0.5; sumoMyState.vz += Math.cos(sumoMyState.rot)*accel*0.5; }
    
    if (sumoMyState.guard) { sumoMyState.vx *= 0.85; sumoMyState.vz *= 0.85; } else { sumoMyState.vx *= 0.95; sumoMyState.vz *= 0.95; }
    sumoMyState.x += sumoMyState.vx; sumoMyState.z += sumoMyState.vz;
    
    const dx = sumoMyState.x - sumoOppState.x, dz = sumoMyState.z - sumoOppState.z; const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < 2.5 && dist > 0.1) {
      const overlap = 2.5 - dist; const nx = dx / dist, nz = dz / dist; sumoMyState.x += nx * overlap * 0.5; sumoMyState.z += nz * overlap * 0.5;
      const speed = Math.sqrt(sumoMyState.vx**2 + sumoMyState.vz**2);
      if (speed > 0.1) { 
        let knockX = -nx * (keys.action ? 1.0 : 0.4); let knockZ = -nz * (keys.action ? 1.0 : 0.4);
        if (sumoOppState.guard) { knockX *= 0.2; knockZ *= 0.2; }
        roomChannel.send({ type: 'broadcast', event: 'hit', payload: { vx: knockX, vz: knockZ } }); 
        sumoMyState.vx *= 0.3; sumoMyState.vz *= 0.3; 
      }
    }
    if (Math.sqrt(sumoMyState.x**2 + sumoMyState.z**2) > sumoRadius + 0.5) { roomChannel.send({ type: 'broadcast', event: 'gameover', payload: { loserRole: myRole } }); sumoEnd(myRole); }
    if (frameCount % 3 === 0) roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: sumoMyState.x, z: sumoMyState.z, rot: sumoMyState.rot, guard: sumoMyState.guard } });
  }

  // ⚔️ 2D大乱闘物理
  else if (activeGame === '2d' && brIsActive) {
    brMyState.vy += 0.6;
    if (brMyState.actTimer > 0) brMyState.actTimer--; else brMyState.act = 'none';
    if (keys.guard) { brMyState.act = 'guard'; brMyState.vx *= 0.5; } 
    else if (keys.grab && !prevKeys.grab && brMyState.actTimer === 0) { brMyState.act = 'grab'; brMyState.actTimer = 15; } 
    else if (keys.special && !prevKeys.special && brMyState.actTimer === 0) { brMyState.act = 'special'; brMyState.actTimer = 25; } 
    else if (keys.action && !prevKeys.action && brMyState.actTimer === 0) {
      if (keys.left || keys.right || keys.up || keys.down) brMyState.act = 'smash'; else brMyState.act = 'attack';
      brMyState.actTimer = 15;
    }

    if (keys.left && brMyState.act !== 'guard') { brMyState.vx -= 0.8; brMyState.dir = -1; } 
    if (keys.right && brMyState.act !== 'guard') { brMyState.vx += 0.8; brMyState.dir = 1; } 
    brMyState.vx *= 0.85; 
    if (keys.jump && !prevKeys.jump && brMyState.jumps > 0) { brMyState.vy = -12; brMyState.jumps--; }
    brMyState.x += brMyState.vx; brMyState.y += brMyState.vy;
    
    if (brMyState.vy >= 0) {
      for (let s of brStage) { if (brMyState.x > s.x - 20 && brMyState.x < s.x + s.w + 20) { if (brMyState.y - brMyState.vy <= s.y && brMyState.y >= s.y) { brMyState.y = s.y; brMyState.vy = 0; brMyState.jumps = 2; } } }
    }
    if (brMyState.act !== 'none' && brMyState.act !== 'guard' && brMyState.actTimer === (brMyState.act === 'special' ? 24 : 14)) {
      let hitX = brMyState.x + brMyState.dir * (brMyState.act === 'special' ? 70 : 35);
      if (Math.hypot(hitX - brOppState.x, (brMyState.y - 15) - (brOppState.y - 15)) < 40) {
        let targetDmg = brOppState.dmg;
        if (brOppState.act === 'guard' && brMyState.act !== 'grab') {
          roomChannel.send({ type: 'broadcast', event: 'hit', payload: { dmg: 2, vx: brMyState.dir * 2, vy: 0 } });
        } else {
          let dmg = 5, vx = 4, vy = -4;
          if (brMyState.act === 'smash') { dmg = 20; vx = 10 + targetDmg * 0.25; vy = -8 - targetDmg * 0.15; }
          else if (brMyState.act === 'special') { dmg = 15; vx = 7 + targetDmg * 0.1; vy = -6; }
          else if (brMyState.act === 'grab') { dmg = 10; vx = 3; vy = -15; }
          roomChannel.send({ type: 'broadcast', event: 'hit', payload: { dmg, vx: brMyState.dir * vx, vy } });
        }
      }
    }
    if (brMyState.y > 800 || brMyState.x < -200 || brMyState.x > 1000) { roomChannel.send({ type: 'broadcast', event: 'gameover', payload: { loserRole: myRole } }); brEnd(myRole); }
    if (frameCount % 2 === 0) roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: brMyState.x, y: brMyState.y, dmg: brMyState.dmg, dir: brMyState.dir, act: brMyState.act, actTimer: brMyState.actTimer } });
  }

  prevKeys.up = keys.up; prevKeys.action = keys.action; prevKeys.jump = keys.jump; prevKeys.dive = keys.dive; prevKeys.special = keys.special; prevKeys.grab = keys.grab;
}


// ==========================================
// 🎨 レンダリングループ
// ==========================================
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);

  if (!document.hidden) updateGameLogic();

  if (activeGame === 'oni' && oniIsActive) {
    if (oniPlayerMesh) { oniPlayerMesh.position.set(oniMyState.x, 0, oniMyState.z); oniPlayerMesh.rotation.y = oniMyState.rot; }
    if (oniOppMesh) { oniOppMesh.position.set(oniOppState.x, 0, oniOppState.z); oniOppMesh.rotation.y = oniOppState.rot; }
    if (oniCamContainer) oniCamContainer.position.set(oniMyState.x, 0, oniMyState.z);
    statusText.innerText = `⏱️ 残り時間: ${oniTimeLeft}秒`;
    if (currentScene) renderer.render(currentScene, currentCamera);
  }
  else if (activeGame === 'c4' && c4Controls) { 
    c4Controls.update(); 
    if (currentScene) renderer.render(currentScene, currentCamera); 
  } 
  else if (activeGame === 'sumo' && sumoIsActive) {
    if (p1Mesh && p2Mesh) {
      p1Mesh.position.set(myRole==='host'?sumoMyState.x:sumoOppState.x, 1, myRole==='host'?sumoMyState.z:sumoOppState.z);
      p2Mesh.position.set(myRole==='host'?sumoOppState.x:sumoMyState.x, 1, myRole==='host'?sumoOppState.z:sumoMyState.z);
    }
    if (currentScene) renderer.render(currentScene, currentCamera);
  }
  else if (activeGame === '2d' && brIsActive) {
    ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height); ctx2D.fillStyle = '#7f8c8d'; for(let s of brStage) ctx2D.fillRect(s.x, s.y, s.w, s.h);
    function drawFighter(state, isRed, isMe) {
      ctx2D.save(); ctx2D.translate(state.x, state.y); 
      ctx2D.fillStyle = isRed ? '#e74c3c' : '#3498db'; ctx2D.fillRect(-15, -30, 30, 30);
      ctx2D.fillStyle = 'white'; ctx2D.fillRect(state.dir === 1 ? 5 : -15, -25, 10, 10); 
      ctx2D.fillStyle = state.dmg > 100 ? '#e74c3c' : 'white'; ctx2D.font = 'bold 20px Arial'; ctx2D.textAlign = 'center'; ctx2D.fillText(`${Math.floor(state.dmg)}%`, 0, -40);
      ctx2D.restore();
    }
    drawFighter({ x: brOppState.x, y: brOppState.y, dmg: brOppState.dmg, dir: brOppState.dir }, myRole !== 'host', false); 
    drawFighter(brMyState, myRole === 'host', true);
  }
}

animate();

window.addEventListener('resize', () => {
  if (currentCamera) { currentCamera.aspect = window.innerWidth / window.innerHeight; currentCamera.updateProjectionMatrix(); }
  renderer.setSize(window.innerWidth, window.innerHeight);
});

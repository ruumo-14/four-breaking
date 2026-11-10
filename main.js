import * as THREE from 'https://esm.sh/three';
import { OrbitControls } from 'https://esm.sh/three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// --- 1. Supabase の設定 ---
const supabaseUrl = 'https://pxcimtveipluoenjiebx.supabase.co';
const supabaseKey = 'sb_publishable_73t9gf0Rm47Kae9KAHfe6w_asA7g7mM';
const supabase = createClient(supabaseUrl, supabaseKey);

let activeGame = null;
let roomChannel = null;
const statusText = document.getElementById('status');
const uiContainer = document.getElementById('ui-container');
const controlsDisplay = document.getElementById('controls-display');

// --- 🌐 バックグラウンド動作 (Web Worker) ---
// タブが裏にいってもゲームループ（通信と当たり判定）を止めないための処理
const workerScript = `
  let interval;
  self.onmessage = function(e) {
    if (e.data === 'start') interval = setInterval(() => self.postMessage('tick'), 16); // 約60FPS
    else if (e.data === 'stop') clearInterval(interval);
  };
`;
const workerBlob = new Blob([workerScript], { type: 'application/javascript' });
const bgWorker = new Worker(URL.createObjectURL(workerBlob));
bgWorker.postMessage('start');
bgWorker.onmessage = () => {
  // タブが非表示（裏画面）のときだけWorker経由でループを回す
  if (document.hidden) animate(true);
};

// 操作方法の表示関数
function showControlsHUD(game) {
  controlsDisplay.style.display = 'block';
  if (game === 'c4') controlsDisplay.innerHTML = `<strong>【操作】</strong><br>マウス/タップ: 視点移動<br>クリック: 石を落とす`;
  else if (game === 'sumo') controlsDisplay.innerHTML = `<strong>【操作】</strong><br>[W][A][S][D]: 移動<br>[Space]: タックル<br>[Shift]: ガード(吹っ飛び軽減)`;
  else if (game === '2d') controlsDisplay.innerHTML = `<strong>【操作】</strong><br>[A][D]: 移動, [W]: ジャンプ<br>[Space]: 攻撃 (移動+Spaceでスマッシュ)<br>[Shift]: シールド, [Q]: つかみ, [E]: 必殺技`;
  else if (game === 'race') controlsDisplay.innerHTML = `<strong>【操作】</strong><br>[W][A][S][D]: 移動<br>[Space]: ジャンプ<br>[Shift]: しゃがむ<br>[Q]: 飛び込み/スライディング`;
}

// --- 2. 入力処理 ---
const keys = { up: false, down: false, left: false, right: false, action: false, jump: false, crouch: false, dive: false, guard: false, special: false };
let prevKeys = { up: false, action: false, jump: false, dive: false, special: false };

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = true;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = true;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = true;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = true;
  if(e.code === 'Space') { e.preventDefault(); keys.action = true; keys.jump = true; }
  if(e.key === 'Shift') { keys.crouch = true; keys.guard = true; }
  if(e.key === 'q' || e.key === 'Q') keys.dive = true;
  if(e.key === 'e' || e.key === 'E') keys.special = true;
});
window.addEventListener('keyup', (e) => {
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = false;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = false;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = false;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = false;
  if(e.code === 'Space') { keys.action = false; keys.jump = false; }
  if(e.key === 'Shift') { keys.crouch = false; keys.guard = false; }
  if(e.key === 'q' || e.key === 'Q') keys.dive = false;
  if(e.key === 'e' || e.key === 'E') keys.special = false;
});
['up','down','left','right','action'].forEach(k => {
  const btn = document.getElementById('btn-'+k);
  if(btn) {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); keys[k] = true; if(k==='up') keys.jump=true; if(k==='action') keys.dive=true; });
    btn.addEventListener('pointerup', (e) => { e.preventDefault(); keys[k] = false; if(k==='up') keys.jump=false; if(k==='action') keys.dive=false; });
    btn.addEventListener('pointerleave', (e) => { e.preventDefault(); keys[k] = false; if(k==='up') keys.jump=false; if(k==='action') keys.dive=false; });
  }
});
function removeFocus() { document.activeElement.blur(); }

// --- 3. ロビー機能 ---
const lobbyChannel = supabase.channel('lobby');
const roomListContainer = document.getElementById('room-list-container');
let isLobbyReady = false;

lobbyChannel.on('presence', { event: 'sync' }, () => {
  const state = lobbyChannel.presenceState();
  const availableRooms = [];
  for (const key in state) state[key].forEach(u => { if (u.status === 'waiting') availableRooms.push(u); });

  roomListContainer.innerHTML = '';
  if (availableRooms.length === 0) { roomListContainer.innerHTML = '<p style="color: #aaa;">待機中の部屋はありません</p>'; return; }

  availableRooms.forEach(user => {
    const btn = document.createElement('button');
    if (user.game === 'c4') { btn.className = 'room-btn-c4'; btn.innerText = `🔴 ${user.roomName} に参加 (四目並べ)`; btn.onclick = () => { removeFocus(); startConnect4(user.roomName, 'yellow'); }; }
    else if (user.game === 'sumo') { btn.className = 'room-btn-sumo'; btn.innerText = `🚘 ${user.roomName} に参加 (相撲)`; btn.onclick = () => { removeFocus(); startSumo(user.roomName, 'blue'); }; }
    else if (user.game === '2d') { btn.className = 'room-btn-2d'; btn.innerText = `⚔️ ${user.roomName} に参加 (大乱闘)`; btn.onclick = () => { removeFocus(); startBrawler(user.roomName, 'blue'); }; }
    else if (user.game === 'race') { btn.className = 'room-btn-race'; btn.innerText = `🏃 ${user.roomName} に参加 (レース)`; btn.onclick = () => { removeFocus(); startRace(user.roomName, 'blue'); }; }
    roomListContainer.appendChild(btn);
  });
}).subscribe((status) => {
  if (status === 'SUBSCRIBED') isLobbyReady = true;
});

['c4', 'sumo', '2d', 'race'].forEach(game => {
  document.getElementById(`btn-create-${game}`).onclick = async () => {
    if (!isLobbyReady) return alert('サーバーに接続中です。数秒待ってからやり直してください。');
    const rName = document.getElementById('new-room-input').value;
    if (!rName) return alert('合言葉を入力！');
    removeFocus();
    try {
      await lobbyChannel.track({ roomName: rName, status: 'waiting', game: game });
      if(game==='c4') startConnect4(rName, 'red'); else if(game==='sumo') startSumo(rName, 'red'); else if(game==='2d') startBrawler(rName, 'red'); else startRace(rName, 'red');
    } catch(e) { alert("部屋の作成に失敗しました。リロードしてください。"); }
  };
});

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);
let currentScene = null, currentCamera = null;
const canvas2D = document.getElementById('canvas-2d'); const ctx2D = canvas2D.getContext('2d');

// 共通ヘルパー: UI切り替え
function switchUI(is3D, isMobileControls) {
  uiContainer.style.display = 'none';
  document.getElementById('app').style.display = is3D ? 'block' : 'none';
  canvas2D.style.display = is3D ? 'none' : 'block';
  document.getElementById('controls').style.display = isMobileControls ? 'flex' : 'none';
  showControlsHUD(activeGame);
}


// ==========================================
// 🏃 FallGuys風 3Dアスレチックレース
// ==========================================
let raceRole, raceIsActive = false;
const raceMyState = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, action: 'idle', isGrounded: false };
const raceOppState = { x: 0, y: 1, z: 0, action: 'idle' };
let rPlayerMesh, rOppMesh, rCameraContainer;
const rStages = [
  { x: 0, y: -0.5, z: 0, w: 10, h: 1, d: 20, type: 'floor' },
  { x: 0, y: -0.5, z: -25, w: 10, h: 1, d: 10, type: 'floor' },
  { x: 0, y: 2.0, z: -35, w: 10, h: 3, d: 2, type: 'wall' },
  { x: 0, y: -0.5, z: -45, w: 10, h: 1, d: 20, type: 'floor' },
  { x: 0, y: -0.5, z: -70, w: 10, h: 1, d: 5, type: 'floor' },
  { x: 0, y: -0.5, z: -100, w: 20, h: 1, d: 20, type: 'goal' }
];
const rStageBoxes = [];

function startRace(roomId, role) {
  activeGame = 'race'; raceRole = role; switchUI(true, true);
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x87CEEB);
  rCameraContainer = new THREE.Group(); currentScene.add(rCameraContainer);
  currentCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  currentCamera.position.set(0, 5, 10); currentCamera.lookAt(0, 0, -5);
  rCameraContainer.add(currentCamera);
  
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8); dirLight.position.set(10, 20, 10); currentScene.add(dirLight);

  rStages.forEach(s => {
    let col = s.type === 'goal' ? 0x2ecc71 : (s.type === 'wall' ? 0xe74c3c : 0xf1c40f);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), new THREE.MeshStandardMaterial({ color: col }));
    mesh.position.set(s.x, s.y, s.z); currentScene.add(mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    rStageBoxes.push(box);
  });

  function createBean(color) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 4, 8), new THREE.MeshStandardMaterial({ color: color }));
    body.position.y = 1; g.add(body);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    face.position.set(0, 1.2, -0.51); g.add(face);
    return g;
  }
  rPlayerMesh = createBean(raceRole === 'red' ? 0xff4444 : 0x3498db);
  rOppMesh = createBean(raceRole === 'red' ? 0x3498db : 0xff4444);
  currentScene.add(rPlayerMesh, rOppMesh);

  roomChannel = supabase.channel(`game-race-${roomId}`);
  roomChannel.on('broadcast', { event: 'joined' }, () => { if (!raceIsActive && raceRole === 'red') { raceSetup(); lobbyChannel.untrack(); roomChannel.send({ type: 'broadcast', event: 'start' }); } })
    .on('broadcast', { event: 'start' }, () => { raceSetup(); })
    .on('broadcast', { event: 'sync' }, (p) => { raceOppState.x = p.payload.x; raceOppState.y = p.payload.y; raceOppState.z = p.payload.z; raceOppState.action = p.payload.action; })
    .on('broadcast', { event: 'goal' }, (p) => raceEnd(p.payload.winner))
    .subscribe((s) => { if (s === 'SUBSCRIBED') { statusText.innerText = "待機中..."; roomChannel.send({ type: 'broadcast', event: 'joined' }); } });
}

function raceSetup() {
  raceMyState.x = raceRole === 'red' ? -2 : 2; raceMyState.y = 5; raceMyState.z = 5;
  raceMyState.vx = 0; raceMyState.vy = 0; raceMyState.vz = 0; raceIsActive = true;
  statusText.innerText = "GO!! 先にゴール(奥の緑の床)を目指せ！"; statusText.style.color = "#f1c40f";
}

function raceEnd(winner) {
  raceIsActive = false; const isWin = winner === raceRole;
  statusText.innerText = isWin ? '👑 GOAL! あなたの勝ち！' : '💀 相手が先にゴールしました...'; 
  statusText.style.color = isWin ? '#2ecc71' : '#e74c3c';
  setTimeout(() => { alert("リロードしてもう一度！"); }, 2000);
}


// ==========================================
// 🔴 四目並べ
// ==========================================
let c4MyColor, c4CurrentTurn, c4IsGameActive, c4OpponentJoined, c4Board, c4Hitboxes, c4Ghost, c4Controls;
function startConnect4(roomId, color) {
  activeGame = 'c4'; c4MyColor = color; c4CurrentTurn = 'red'; c4IsGameActive = true; c4OpponentJoined = (color === 'yellow');
  c4Board = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => []));
  switchUI(true, false); document.getElementById('chat-container').style.display = 'block';
  statusText.innerText = "相手を待っています..."; statusText.style.color = 'white';
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
  roomChannel = supabase.channel(`game-c4-${roomId}`);
  roomChannel.on('broadcast', { event: 'place' }, (p) => c4AddPiece(p.payload.x, p.payload.z, p.payload.c, false)).on('broadcast', { event: 'chat' }, (p) => c4AddChat('相手', p.payload.text, p.payload.color))
    .on('broadcast', { event: 'joined' }, () => { if (c4MyColor === 'red') { c4OpponentJoined = true; lobbyChannel.untrack(); c4UpdateStatus(); c4AddChat('システム', '相手が参加しました！', 'white'); } })
    .subscribe((s) => { if (s === 'SUBSCRIBED' && c4MyColor === 'yellow') roomChannel.send({ type: 'broadcast', event: 'joined', payload: {} }); });
}
const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();
window.addEventListener('click', (e) => {
  if (activeGame !== 'c4' || e.target.closest('#chat-container') || !c4IsGameActive || c4MyColor !== c4CurrentTurn || !c4OpponentJoined) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1; raycaster.setFromCamera(mouse, currentCamera);
  const intersects = raycaster.intersectObjects(c4Hitboxes);
  if (intersects.length > 0) { const { gridX, gridZ } = intersects[0].object.userData; if (c4Board[gridX][gridZ].length < 4) c4AddPiece(gridX, gridZ, c4MyColor, true); }
});
window.addEventListener('pointermove', (e) => {
  if (activeGame !== 'c4' || !c4IsGameActive || c4MyColor !== c4CurrentTurn || !c4OpponentJoined) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1; raycaster.setFromCamera(mouse, currentCamera);
  const intersects = raycaster.intersectObjects(c4Hitboxes);
  if (intersects.length > 0) {
    const { gridX, gridZ } = intersects[0].object.userData; const y = c4Board[gridX][gridZ].length;
    if (y < 4) { c4Ghost.material.color.setHex(c4MyColor === 'red' ? 0xff4444 : 0xffcc00); c4Ghost.position.set(gridX - 1.5, y + 0.4, gridZ - 1.5); c4Ghost.visible = true; } else c4Ghost.visible = false;
  } else c4Ghost.visible = false;
});
function c4AddPiece(x, z, color, isLocal) {
  const y = c4Board[x][z].length; c4Board[x][z].push(color);
  const piece = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), new THREE.MeshStandardMaterial({ color: color === 'red' ? 0xff3333 : 0xffcc00, roughness: 0.1, metalness: 0.2 }));
  piece.position.set(x - 1.5, y + 0.4, z - 1.5); currentScene.add(piece);
  if (isLocal) { c4Ghost.visible = false; roomChannel.send({ type: 'broadcast', event: 'place', payload: { x, z, c: color } }); }
  c4CurrentTurn = c4CurrentTurn === 'red' ? 'yellow' : 'red'; c4UpdateStatus();
}
function c4UpdateStatus() { if(c4OpponentJoined) { statusText.innerText = c4MyColor === c4CurrentTurn ? `あなたの番` : `相手の番...`; statusText.style.color = c4MyColor === c4CurrentTurn ? (c4MyColor === 'red' ? '#ff4444' : '#ffcc00') : 'white'; } }
function c4AddChat(sender, text, color) { const div = document.createElement('div'); div.innerHTML = `<span style="color: ${color==='red'?'#ff6666':(color==='yellow'?'#ffcc00':'#ccc')}">${sender}:</span> ${text}`; document.getElementById('chat-messages').appendChild(div); document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight; }
document.getElementById('btn-send').onclick = () => { const text = document.getElementById('chat-input').value.trim(); if (!text) return; c4AddChat('あなた', text, c4MyColor); roomChannel.send({ type: 'broadcast', event: 'chat', payload: { text, color: c4MyColor } }); document.getElementById('chat-input').value = ''; };

// ==========================================
// 🚘 3Dドタバタ相撲 (ガード追加版)
// ==========================================
let sumoRole, sumoIsActive, p1Mesh, p2Mesh, sumoArena, sumoEdge, sumoRadius = 15;
const sumoMyState = { x: 0, z: 0, rot: 0, vx: 0, vz: 0, guard: false }; 
const sumoOppState = { x: 0, z: 0, rot: 0, guard: false };

function startSumo(roomId, role) {
  activeGame = 'sumo'; sumoRole = role; sumoIsActive = false; sumoRadius = 15; switchUI(true, true);
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x87CEEB);
  currentCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100); currentCamera.position.set(0, 25, 30); currentCamera.lookAt(0, 0, 0);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.6)); const dirLight = new THREE.DirectionalLight(0xffffff, 0.8); dirLight.position.set(10, 20, 10); currentScene.add(dirLight);
  sumoArena = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1, 64), new THREE.MeshStandardMaterial({ color: 0x34495e, roughness: 0.8 })); sumoArena.position.y = -0.5; currentScene.add(sumoArena);
  sumoEdge = new THREE.Mesh(new THREE.TorusGeometry(15, 0.2, 32, 64), new THREE.MeshBasicMaterial({ color: 0xe74c3c })); sumoEdge.rotation.x = Math.PI / 2; currentScene.add(sumoEdge);
  
  function createCar(c) {
    const group = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: c, metalness: 0.3 })); body.position.y = 1;
    const eye = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const lE = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), eye); lE.position.set(0.6, 1.2, -1.26); const rE = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), eye); rE.position.set(-0.6, 1.2, -1.26);
    group.add(body, lE, rE); return group;
  }
  p1Mesh = createCar(0xe74c3c); p2Mesh = createCar(0x3498db); currentScene.add(p1Mesh, p2Mesh);
  
  roomChannel = supabase.channel(`game-sumo-${roomId}`);
  roomChannel.on('broadcast', { event: 'joined' }, () => { if (!sumoIsActive && sumoRole === 'red') { sumoSetup(); lobbyChannel.untrack(); roomChannel.send({ type: 'broadcast', event: 'start' }); } })
    .on('broadcast', { event: 'start' }, () => { sumoSetup(); })
    .on('broadcast', { event: 'sync' }, (p) => { sumoOppState.x = p.payload.x; sumoOppState.z = p.payload.z; sumoOppState.rot = p.payload.rot; sumoOppState.guard = p.payload.guard; })
    .on('broadcast', { event: 'hit' }, (p) => { sumoMyState.vx += p.payload.vx; sumoMyState.vz += p.payload.vz; })
    .on('broadcast', { event: 'gameover' }, (p) => sumoEnd(p.payload.loserRole))
    .subscribe((s) => { if (s === 'SUBSCRIBED') { statusText.innerText = "待機中..."; roomChannel.send({ type: 'broadcast', event: 'joined' }); } });
}
function sumoSetup() { 
  sumoMyState.x = 0; sumoMyState.z = sumoRole === 'red' ? 8 : -8; sumoMyState.rot = sumoRole === 'red' ? 0 : Math.PI; 
  sumoMyState.vx = 0; sumoMyState.vz = 0; sumoRadius = 15; sumoIsActive = true; 
  statusText.innerText = `タックルで落とせ！ [Shift]でガード`; statusText.style.color = sumoRole === 'red' ? '#ff6666' : '#66ccff'; 
}
function sumoEnd(loser) { sumoIsActive = false; const isWin = sumoRole !== loser; statusText.innerText = isWin ? '👑 勝利！！' : '💀 落下...'; statusText.style.color = isWin ? '#2ecc71' : '#e74c3c'; setTimeout(() => { alert("リロードしてもう一度！"); }, 1000); }


// ==========================================
// ⚔️ 2D大乱闘バッシュ (スマブラ風進化版)
// ==========================================
let brRole, brIsActive = false; 
const brMyState = { x: 0, y: 0, vx: 0, vy: 0, dmg: 0, dir: 1, act: 'none', actTimer: 0, jumps: 2 }; 
const brOppState = { x: 0, y: 0, dmg: 0, dir: -1, act: 'none', actTimer: 0 };
const brStage = [ { x: 150, y: 450, w: 500, h: 20 }, { x: 50, y: 300, w: 150, h: 10 }, { x: 600, y: 300, w: 150, h: 10 } ];

function startBrawler(roomId, role) {
  activeGame = '2d'; brRole = role; brIsActive = false; switchUI(false, true);
  roomChannel = supabase.channel(`game-2d-${roomId}`);
  roomChannel.on('broadcast', { event: 'joined' }, () => { if (!brIsActive && brRole === 'red') { brSetup(); lobbyChannel.untrack(); roomChannel.send({ type: 'broadcast', event: 'start' }); } })
    .on('broadcast', { event: 'start' }, () => { brSetup(); })
    .on('broadcast', { event: 'sync' }, (p) => { 
      brOppState.x = p.payload.x; brOppState.y = p.payload.y; brOppState.dmg = p.payload.dmg; 
      brOppState.dir = p.payload.dir; brOppState.act = p.payload.act; brOppState.actTimer = p.payload.actTimer; 
    })
    .on('broadcast', { event: 'hit' }, (p) => { 
      brMyState.dmg += p.payload.dmg; brMyState.vx = p.payload.vx; brMyState.vy = p.payload.vy; brMyState.jumps = 1; 
    })
    .on('broadcast', { event: 'gameover' }, (p) => brEnd(p.payload.loserRole))
    .subscribe((s) => { if (s === 'SUBSCRIBED') { statusText.innerText = "待機中..."; roomChannel.send({ type: 'broadcast', event: 'joined' }); } });
}
function brSetup() { 
  brMyState.x = brRole === 'red' ? 300 : 500; brMyState.y = 200; brMyState.dir = brRole === 'red' ? 1 : -1; 
  brMyState.vx = 0; brMyState.vy = 0; brMyState.dmg = 0; brMyState.jumps = 2; brMyState.act = 'none'; brMyState.actTimer = 0;
  brOppState.dmg = 0; brOppState.act = 'none'; brOppState.actTimer = 0; brIsActive = true; 
  statusText.innerText = `ダメージを溜めて吹っ飛ばせ！`; statusText.style.color = brRole === 'red' ? '#ff6666' : '#66ccff'; 
}
function brEnd(loser) { brIsActive = false; const isWin = brRole !== loser; statusText.innerText = isWin ? '👑 GAME SET! 勝利！' : '💀 場外負け...'; statusText.style.color = isWin ? '#2ecc71' : '#e74c3c'; setTimeout(() => { alert("リロードしてもう一度！"); }, 1000); }


// ==========================================
// 🔄 アニメーションループ (Worker対応版)
// ==========================================
let frameCount = 0;
function animate(isBackground = false) {
  // ブラウザ表示中のみ requestAnimationFrame でループ（裏画面ではWorkerから呼ばれる）
  if (!isBackground) {
    requestAnimationFrame(() => animate(false));
  }
  frameCount++;

  // 🔴 四目並べ
  if (activeGame === 'c4' && c4Controls) { 
    c4Controls.update(); 
    if (!isBackground && currentScene) renderer.render(currentScene, currentCamera); 
  } 
  
  // 🚘 3Dドタバタ相撲
  else if (activeGame === 'sumo' && sumoIsActive) {
    sumoRadius -= 0.003; if (sumoRadius < 3) sumoRadius = 3; const scale = sumoRadius / 15; sumoArena.scale.set(scale, 1, scale); sumoEdge.scale.set(scale, 1, scale);
    
    // ガード状態の反映
    sumoMyState.guard = keys.guard;
    const turn = 0.05, accel = keys.action ? 0.03 : 0.01;
    
    if (keys.left) sumoMyState.rot += turn; if (keys.right) sumoMyState.rot -= turn;
    if (keys.up) { sumoMyState.vx -= Math.sin(sumoMyState.rot)*accel; sumoMyState.vz -= Math.cos(sumoMyState.rot)*accel; }
    if (keys.down) { sumoMyState.vx += Math.sin(sumoMyState.rot)*accel*0.5; sumoMyState.vz += Math.cos(sumoMyState.rot)*accel*0.5; }
    
    // ガード時はブレーキがかかる
    if (sumoMyState.guard) { sumoMyState.vx *= 0.85; sumoMyState.vz *= 0.85; }
    else { sumoMyState.vx *= 0.95; sumoMyState.vz *= 0.95; }
    
    sumoMyState.x += sumoMyState.vx; sumoMyState.z += sumoMyState.vz;
    
    const dx = sumoMyState.x - sumoOppState.x, dz = sumoMyState.z - sumoOppState.z; const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < 2.5 && dist > 0.1) {
      const overlap = 2.5 - dist; const nx = dx / dist, nz = dz / dist; sumoMyState.x += nx * overlap * 0.5; sumoMyState.z += nz * overlap * 0.5;
      const speed = Math.sqrt(sumoMyState.vx**2 + sumoMyState.vz**2);
      if (speed > 0.1) { 
        // 相手がガードしている場合は吹っ飛びを大幅減少させる
        let knockX = -nx * (keys.action ? 1.8 : 1.0);
        let knockZ = -nz * (keys.action ? 1.8 : 1.0);
        if (sumoOppState.guard) { knockX *= 0.2; knockZ *= 0.2; }
        
        roomChannel.send({ type: 'broadcast', event: 'hit', payload: { vx: knockX, vz: knockZ } }); 
        sumoMyState.vx *= 0.3; sumoMyState.vz *= 0.3; 
      } 
      else { sumoMyState.vx += nx * 0.1; sumoMyState.vz += nz * 0.1; }
    }
    
    if (Math.sqrt(sumoMyState.x**2 + sumoMyState.z**2) > sumoRadius + 0.5) { roomChannel.send({ type: 'broadcast', event: 'gameover', payload: { loserRole: sumoRole } }); sumoEnd(sumoRole); }
    if (frameCount % 3 === 0) roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: sumoMyState.x, z: sumoMyState.z, rot: sumoMyState.rot, guard: sumoMyState.guard } });
    
    p1Mesh.position.set(sumoRole==='red'?sumoMyState.x:sumoOppState.x, 1, sumoRole==='red'?sumoMyState.z:sumoOppState.z); p1Mesh.rotation.y = sumoRole==='red'?sumoMyState.rot:sumoOppState.rot;
    p2Mesh.position.set(sumoRole==='red'?sumoOppState.x:sumoMyState.x, 1, sumoRole==='red'?sumoOppState.z:sumoMyState.z); p2Mesh.rotation.y = sumoRole==='red'?sumoOppState.rot:sumoMyState.rot;
    
    if (!isBackground && currentScene) renderer.render(currentScene, currentCamera);
  }

  // ⚔️ 2D大乱闘 (スマブラ風)
  else if (activeGame === '2d' && brIsActive) {
    brMyState.vy += 0.6; // 重力
    
    // アクションの判定とクールダウン
    if (brMyState.actTimer > 0) brMyState.actTimer--;
    else brMyState.act = 'none';

    // 🛡️ シールド (ガード)
    if (keys.guard) {
      brMyState.act = 'guard';
      brMyState.vx *= 0.5; // ガード中は移動が遅くなる
    } 
    // 🟣 つかみ (Q)
    else if (keys.dive && !prevKeys.dive && brMyState.actTimer === 0) {
      brMyState.act = 'grab'; brMyState.actTimer = 15;
    } 
    // 🌟 必殺技 (E)
    else if (keys.special && !prevKeys.special && brMyState.actTimer === 0) {
      brMyState.act = 'special'; brMyState.actTimer = 25;
    } 
    // ⚔️ 攻撃＆スマッシュ (Space)
    else if (keys.action && !prevKeys.action && brMyState.actTimer === 0) {
      // 移動キーが入っていたらスマッシュ攻撃
      if (keys.left || keys.right || keys.up || keys.down) brMyState.act = 'smash';
      else brMyState.act = 'attack';
      brMyState.actTimer = 15;
    }

    if (keys.left && brMyState.act !== 'guard') { brMyState.vx -= 0.8; brMyState.dir = -1; } 
    if (keys.right && brMyState.act !== 'guard') { brMyState.vx += 0.8; brMyState.dir = 1; } 
    brMyState.vx *= 0.85; 
    
    if (keys.up && !prevKeys.up && brMyState.jumps > 0) { brMyState.vy = -12; brMyState.jumps--; }
    brMyState.x += brMyState.vx; brMyState.y += brMyState.vy;
    
    // 床との当たり判定
    if (brMyState.vy >= 0) {
      for (let s of brStage) { if (brMyState.x > s.x - 20 && brMyState.x < s.x + s.w + 20) { if (brMyState.y - brMyState.vy <= s.y && brMyState.y >= s.y) { brMyState.y = s.y; brMyState.vy = 0; brMyState.jumps = 2; } } }
    }

    // 💥 攻撃の当たり判定処理 (攻撃を打った瞬間のみ)
    if (brMyState.act !== 'none' && brMyState.act !== 'guard' && brMyState.actTimer === (brMyState.act === 'special' ? 24 : 14)) {
      let hitDist = brMyState.act === 'special' ? 70 : 35; // 必殺技はリーチが長い
      let hitRange = brMyState.act === 'special' ? 50 : 40;
      let hitX = brMyState.x + brMyState.dir * hitDist, hitY = brMyState.y - 15;
      
      if (Math.hypot(hitX - brOppState.x, hitY - (brOppState.y - 15)) < hitRange) {
        let targetDmg = brOppState.dmg;
        
        // 相手がガードしている場合
        if (brOppState.act === 'guard' && brMyState.act !== 'grab') {
          // ガード成功！ダメージと吹っ飛びを極小化
          roomChannel.send({ type: 'broadcast', event: 'hit', payload: { dmg: 2, vx: brMyState.dir * 2, vy: 0 } });
        } else {
          // ガードしていない、または「つかみ」でガードを崩した場合
          let dmg = 5, vx = 4, vy = -4;
          if (brMyState.act === 'smash') { dmg = 20; vx = 10 + targetDmg * 0.25; vy = -8 - targetDmg * 0.15; } // スマッシュ
          else if (brMyState.act === 'special') { dmg = 15; vx = 7 + targetDmg * 0.1; vy = -6; } // 必殺技
          else if (brMyState.act === 'grab') { dmg = 10; vx = 3; vy = -15; } // つかみ(上に大きく投げる)

          roomChannel.send({ type: 'broadcast', event: 'hit', payload: { dmg: dmg, vx: brMyState.dir * vx, vy: vy } });
        }
        brMyState.vx *= 0.2; brMyState.vy = Math.max(brMyState.vy, 0); 
      }
    }

    if (brMyState.y > 800 || brMyState.x < -200 || brMyState.x > 1000) { roomChannel.send({ type: 'broadcast', event: 'gameover', payload: { loserRole: brRole } }); brEnd(brRole); }
    if (frameCount % 2 === 0) roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: brMyState.x, y: brMyState.y, dmg: brMyState.dmg, dir: brMyState.dir, act: brMyState.act, actTimer: brMyState.actTimer } });
    
    // --- 2D描画処理 ---
    if (!isBackground) {
      ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height); ctx2D.fillStyle = '#7f8c8d'; for(let s of brStage) ctx2D.fillRect(s.x, s.y, s.w, s.h);
      
      function drawFighter(state, isRed, isMe) {
        ctx2D.save(); ctx2D.translate(state.x, state.y); 
        ctx2D.fillStyle = isRed ? '#e74c3c' : '#3498db'; ctx2D.fillRect(-15, -30, 30, 30);
        ctx2D.fillStyle = 'white'; ctx2D.fillRect(state.dir === 1 ? 5 : -15, -25, 10, 10); 
        
        // アクションに応じたエフェクト描画
        if (state.act === 'guard') {
          // ガードエフェクト (半透明の青いバリア)
          ctx2D.fillStyle = 'rgba(52, 152, 219, 0.5)';
          ctx2D.beginPath(); ctx2D.arc(0, -15, 28, 0, Math.PI*2); ctx2D.fill();
        } else if (state.actTimer > 5) {
          if (state.act === 'attack') ctx2D.fillStyle = 'rgba(241, 196, 15, 0.8)'; // 通常攻撃 (黄)
          else if (state.act === 'smash') ctx2D.fillStyle = 'rgba(231, 76, 60, 0.9)'; // スマッシュ (赤)
          else if (state.act === 'special') ctx2D.fillStyle = 'rgba(155, 89, 182, 0.8)'; // 必殺技 (紫)
          else if (state.act === 'grab') ctx2D.fillStyle = 'rgba(46, 204, 113, 0.8)'; // つかみ (緑)

          let r = state.act === 'special' ? 40 : 25;
          let dx = state.act === 'special' ? 50 : 30;
          ctx2D.beginPath(); ctx2D.arc(state.dir * dx, -15, r, 0, Math.PI*2); ctx2D.fill();
        }
        
        ctx2D.fillStyle = state.dmg > 100 ? '#e74c3c' : 'white'; ctx2D.font = 'bold 20px Arial'; ctx2D.textAlign = 'center'; ctx2D.fillText(`${Math.floor(state.dmg)}%`, 0, -40);
        if (isMe) { ctx2D.fillStyle = '#f1c40f'; ctx2D.beginPath(); ctx2D.moveTo(-5, -65); ctx2D.lineTo(5, -65); ctx2D.lineTo(0, -55); ctx2D.fill(); } ctx2D.restore();
      }
      drawFighter({ x: brOppState.x, y: brOppState.y, dmg: brOppState.dmg, dir: brOppState.dir, act: brOppState.act, actTimer: brOppState.actTimer }, brRole !== 'red', false); 
      drawFighter(brMyState, brRole === 'red', true);
    }
  }

  // 🏃 3Dアスレチックレース
  else if (activeGame === 'race' && raceIsActive) {
    raceMyState.vy -= 0.015; // 重力
    
    raceMyState.action = 'idle';
    let speed = 0.15;
    
    if (keys.crouch) { raceMyState.action = 'crouch'; speed = 0.05; }
    
    if (keys.dive && !prevKeys.dive) {
      if (raceMyState.isGrounded) { raceMyState.action = 'slide'; raceMyState.vz -= 0.6; } 
      else { raceMyState.action = 'dive'; raceMyState.vz -= 0.5; raceMyState.vy += 0.15; }
    }

    if (keys.left) raceMyState.vx -= speed * 0.1;
    if (keys.right) raceMyState.vx += speed * 0.1;
    if (keys.up) { raceMyState.vz -= speed * 0.1; if(raceMyState.action==='idle') raceMyState.action = 'run'; }
    if (keys.down) { raceMyState.vz += speed * 0.1; if(raceMyState.action==='idle') raceMyState.action = 'run'; }

    if (keys.jump && !prevKeys.jump && raceMyState.isGrounded) { raceMyState.vy = 0.35; raceMyState.isGrounded = false; }

    raceMyState.vx *= 0.85; raceMyState.vz *= 0.9;
    
    let nextX = raceMyState.x + raceMyState.vx, nextY = raceMyState.y + raceMyState.vy, nextZ = raceMyState.z + raceMyState.vz;
    raceMyState.isGrounded = false;
    
    const pHeight = (keys.crouch || keys.dive) ? 1.0 : 2.0; 
    const pBox = new THREE.Box3(new THREE.Vector3(nextX - 0.5, nextY, nextZ - 0.5), new THREE.Vector3(nextX + 0.5, nextY + pHeight, nextZ + 0.5));

    for (let box of rStageBoxes) {
      if (box.intersectsBox(pBox)) {
        if (raceMyState.vy < 0 && raceMyState.y >= box.max.y - 0.2) { nextY = box.max.y; raceMyState.vy = 0; raceMyState.isGrounded = true; } 
        else { nextX = raceMyState.x; nextZ = raceMyState.z; raceMyState.vx = 0; raceMyState.vz = 0; }
      }
    }

    raceMyState.x = nextX; raceMyState.y = nextY; raceMyState.z = nextZ;

    if (raceMyState.y < -10) { raceMyState.x = 0; raceMyState.y = 5; raceMyState.z = 5; raceMyState.vx = 0; raceMyState.vy = 0; raceMyState.vz = 0; }
    if (raceMyState.z < -100) { roomChannel.send({ type: 'broadcast', event: 'goal', payload: { winner: raceRole } }); raceEnd(raceRole); }
    if (frameCount % 3 === 0) { roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: raceMyState.x, y: raceMyState.y, z: raceMyState.z, action: raceMyState.action } }); }

    function updateBeanPose(mesh, state) {
      mesh.position.set(state.x, state.y, state.z);
      if (state.action === 'crouch') { mesh.scale.set(1, 0.5, 1); mesh.rotation.x = 0; mesh.position.y += 0.5; }
      else if (state.action === 'dive' || state.action === 'slide') { mesh.scale.set(1, 1, 1); mesh.rotation.x = -Math.PI / 2; mesh.position.y += 0.5;}
      else { mesh.scale.set(1, 1, 1); mesh.rotation.x = 0; }
    }
    
    updateBeanPose(rPlayerMesh, raceMyState); updateBeanPose(rOppMesh, raceOppState);
    rCameraContainer.position.set(raceMyState.x, 0, raceMyState.z + 5);

    if (!isBackground && currentScene) renderer.render(currentScene, currentCamera);
  }

  prevKeys.up = keys.up; prevKeys.action = keys.action; prevKeys.jump = keys.jump; prevKeys.dive = keys.dive; prevKeys.special = keys.special;
}

// 最初の起動用
animate();

window.addEventListener('resize', () => {
  if (currentCamera) { currentCamera.aspect = window.innerWidth / window.innerHeight; currentCamera.updateProjectionMatrix(); }
  renderer.setSize(window.innerWidth, window.innerHeight);
});

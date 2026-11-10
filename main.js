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

// --- 2. 入力処理 ---
const keys = { up: false, down: false, left: false, right: false, action: false };
let prevKeys = { up: false, action: false }; // ボタンを押した瞬間を検知するため

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = true;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = true;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = true;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = true;
  if(e.code === 'Space') { e.preventDefault(); keys.action = true; }
});
window.addEventListener('keyup', (e) => {
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = false;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = false;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = false;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = false;
  if(e.code === 'Space') keys.action = false;
});
['up','down','left','right','action'].forEach(k => {
  const btn = document.getElementById('btn-'+k);
  if(btn) {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); keys[k] = true; });
    btn.addEventListener('pointerup', (e) => { e.preventDefault(); keys[k] = false; });
    btn.addEventListener('pointerleave', (e) => { e.preventDefault(); keys[k] = false; });
  }
});
function removeFocus() { document.activeElement.blur(); }

// --- 3. ロビー機能 ---
const lobbyChannel = supabase.channel('lobby');
const roomListContainer = document.getElementById('room-list-container');

lobbyChannel.on('presence', { event: 'sync' }, () => {
  const state = lobbyChannel.presenceState();
  const availableRooms = [];
  for (const key in state) state[key].forEach(u => { if (u.status === 'waiting') availableRooms.push(u); });

  roomListContainer.innerHTML = '';
  if (availableRooms.length === 0) { roomListContainer.innerHTML = '<p style="color: #aaa;">待機中の部屋はありません</p>'; return; }

  availableRooms.forEach(user => {
    const btn = document.createElement('button');
    if (user.game === 'c4') {
      btn.className = 'room-btn-c4'; btn.innerText = `🔴 ${user.roomName} に参加 (四目並べ)`;
      btn.onclick = () => { removeFocus(); startConnect4(user.roomName, 'yellow'); };
    } else if (user.game === 'sumo') {
      btn.className = 'room-btn-sumo'; btn.innerText = `🚘 ${user.roomName} に参加 (相撲)`;
      btn.onclick = () => { removeFocus(); startSumo(user.roomName, 'blue'); };
    } else if (user.game === '2d') {
      btn.className = 'room-btn-2d'; btn.innerText = `⚔️ ${user.roomName} に参加 (大乱闘)`;
      btn.onclick = () => { removeFocus(); startBrawler(user.roomName, 'blue'); };
    }
    roomListContainer.appendChild(btn);
  });
}).subscribe();

['c4', 'sumo', '2d'].forEach(game => {
  document.getElementById(`btn-create-${game}`).onclick = async () => {
    const rName = document.getElementById('new-room-input').value;
    if (!rName) return alert('合言葉を入力！');
    removeFocus();
    await lobbyChannel.track({ roomName: rName, status: 'waiting', game: game });
    if(game==='c4') startConnect4(rName, 'red'); else if(game==='sumo') startSumo(rName, 'red'); else startBrawler(rName, 'red');
  };
});

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);
let currentScene = null, currentCamera = null;
const canvas2D = document.getElementById('canvas-2d'); const ctx2D = canvas2D.getContext('2d');

// ==========================================
// 🔴 四目並べ (省略なし)
// ==========================================
let c4MyColor, c4CurrentTurn, c4IsGameActive, c4OpponentJoined, c4Board, c4Hitboxes, c4Ghost, c4Controls;
function startConnect4(roomId, color) {
  activeGame = 'c4'; c4MyColor = color; c4CurrentTurn = 'red'; c4IsGameActive = true; c4OpponentJoined = (color === 'yellow');
  c4Board = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => []));
  uiContainer.style.display = 'none'; document.getElementById('chat-container').style.display = 'block';
  document.getElementById('app').style.display = 'block'; canvas2D.style.display = 'none';
  statusText.innerText = "相手を待っています..."; statusText.style.color = 'white';

  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x1a1a1a);
  currentCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(8, 7, 8);
  c4Controls = new OrbitControls(currentCamera, renderer.domElement); c4Controls.enablePan = false;
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1); dirLight.position.set(10, 20, 10); currentScene.add(dirLight);

  const base = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 5), new THREE.MeshStandardMaterial({ color: 0x1155aa, roughness: 0.8 }));
  base.position.y = -0.25; currentScene.add(base);

  c4Hitboxes = [];
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 4; z++) {
      const px = x - 1.5, pz = z - 1.5;
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.5), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.5 }));
      peg.position.set(px, 2.25, pz); currentScene.add(peg);
      const hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
      hitbox.position.set(px, 2.5, pz); hitbox.userData = { gridX: x, gridZ: z }; currentScene.add(hitbox); c4Hitboxes.push(hitbox);
    }
  }
  c4Ghost = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
  c4Ghost.visible = false; currentScene.add(c4Ghost);

  roomChannel = supabase.channel(`game-c4-${roomId}`);
  roomChannel
    .on('broadcast', { event: 'place' }, (p) => c4AddPiece(p.payload.x, p.payload.z, p.payload.c, false))
    .on('broadcast', { event: 'chat' }, (p) => c4AddChat('相手', p.payload.text, p.payload.color))
    .on('broadcast', { event: 'joined' }, () => {
      if (c4MyColor === 'red') { c4OpponentJoined = true; lobbyChannel.untrack(); c4UpdateStatus(); c4AddChat('システム', '相手が参加しました！', 'white'); }
    })
    .subscribe((s) => { if (s === 'SUBSCRIBED' && c4MyColor === 'yellow') roomChannel.send({ type: 'broadcast', event: 'joined', payload: {} }); });
}
const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();
window.addEventListener('pointermove', (e) => {
  if (activeGame !== 'c4' || !c4IsGameActive || c4MyColor !== c4CurrentTurn || !c4OpponentJoined) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, currentCamera); const intersects = raycaster.intersectObjects(c4Hitboxes);
  if (intersects.length > 0) {
    const { gridX, gridZ } = intersects[0].object.userData; const y = c4Board[gridX][gridZ].length;
    if (y < 4) { c4Ghost.material.color.setHex(c4MyColor === 'red' ? 0xff4444 : 0xffcc00); c4Ghost.position.set(gridX - 1.5, y + 0.4, gridZ - 1.5); c4Ghost.visible = true; } 
    else c4Ghost.visible = false;
  } else c4Ghost.visible = false;
});
window.addEventListener('click', (e) => {
  if (activeGame !== 'c4' || event.target.closest('#chat-container') || !c4IsGameActive || c4MyColor !== c4CurrentTurn || !c4OpponentJoined) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, currentCamera); const intersects = raycaster.intersectObjects(c4Hitboxes);
  if (intersects.length > 0) {
    const { gridX, gridZ } = intersects[0].object.userData; if (c4Board[gridX][gridZ].length < 4) c4AddPiece(gridX, gridZ, c4MyColor, true);
  }
});
function c4AddPiece(x, z, color, isLocal) {
  const y = c4Board[x][z].length; c4Board[x][z].push(color);
  const piece = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), new THREE.MeshStandardMaterial({ color: color === 'red' ? 0xff3333 : 0xffcc00, roughness: 0.1, metalness: 0.2 }));
  piece.position.set(x - 1.5, y + 0.4, z - 1.5); currentScene.add(piece);
  if (isLocal) { c4Ghost.visible = false; roomChannel.send({ type: 'broadcast', event: 'place', payload: { x, z, c: color } }); }
  c4CurrentTurn = c4CurrentTurn === 'red' ? 'yellow' : 'red'; c4UpdateStatus();
}
function c4UpdateStatus() {
  if (!c4OpponentJoined) return;
  statusText.innerText = c4MyColor === c4CurrentTurn ? `あなたの番 (${c4MyColor === 'red' ? '赤' : '黄'})` : `相手の番...`;
  statusText.style.color = (c4MyColor === c4CurrentTurn) ? (c4MyColor === 'red' ? '#ff4444' : '#ffcc00') : 'white';
}
function c4AddChat(sender, text, color) {
  const div = document.createElement('div'); div.style.marginBottom = '5px';
  div.innerHTML = `<span style="color: ${color==='red'?'#ff6666':(color==='yellow'?'#ffcc00':'#ccc')}; font-weight: bold;">${sender}:</span> ${text}`;
  document.getElementById('chat-messages').appendChild(div); document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
}
document.getElementById('btn-send').onclick = () => {
  const text = document.getElementById('chat-input').value.trim(); if (!text) return;
  c4AddChat('あなた', text, c4MyColor); roomChannel.send({ type: 'broadcast', event: 'chat', payload: { text, color: c4MyColor } }); document.getElementById('chat-input').value = '';
};

// ==========================================
// 🚘 3Dドタバタ相撲 (衝突で相手が吹っ飛ぶ！)
// ==========================================
let sumoRole, sumoIsActive, p1Mesh, p2Mesh, sumoArena, sumoEdge, sumoRadius = 15;
const sumoMyState = { x: 0, z: 0, rot: 0, vx: 0, vz: 0 };
const sumoOppState = { x: 0, z: 0, rot: 0 };

function startSumo(roomId, role) {
  activeGame = 'sumo'; sumoRole = role; sumoIsActive = false; sumoRadius = 15;
  uiContainer.style.display = 'none'; document.getElementById('controls').style.display = 'flex'; document.getElementById('pc-hint').style.display = 'block';
  document.getElementById('app').style.display = 'block'; canvas2D.style.display = 'none';

  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x87CEEB);
  currentCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(0, 25, 30); currentCamera.lookAt(0, 0, 0);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8); dirLight.position.set(10, 20, 10); currentScene.add(dirLight);

  sumoArena = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1, 64), new THREE.MeshStandardMaterial({ color: 0x34495e, roughness: 0.8 }));
  sumoArena.position.y = -0.5; currentScene.add(sumoArena);
  sumoEdge = new THREE.Mesh(new THREE.TorusGeometry(15, 0.2, 32, 64), new THREE.MeshBasicMaterial({ color: 0xe74c3c }));
  sumoEdge.rotation.x = Math.PI / 2; currentScene.add(sumoEdge);

  function createCar(c) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: c, metalness: 0.3 })); body.position.y = 1;
    const eye = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const lE = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), eye); lE.position.set(0.6, 1.2, -1.26);
    const rE = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), eye); rE.position.set(-0.6, 1.2, -1.26);
    group.add(body, lE, rE); return group;
  }
  p1Mesh = createCar(0xe74c3c); p2Mesh = createCar(0x3498db); currentScene.add(p1Mesh, p2Mesh);

  roomChannel = supabase.channel(`game-sumo-${roomId}`);
  roomChannel
    .on('broadcast', { event: 'joined' }, () => { if (!sumoIsActive && sumoRole === 'red') { sumoSetup(); lobbyChannel.untrack(); roomChannel.send({ type: 'broadcast', event: 'start' }); } })
    .on('broadcast', { event: 'start' }, () => { sumoSetup(); })
    .on('broadcast', { event: 'sync' }, (p) => { sumoOppState.x = p.payload.x; sumoOppState.z = p.payload.z; sumoOppState.rot = p.payload.rot; })
    // 💥 相手からのタックル（衝撃）を受信して自分が吹っ飛ぶ！
    .on('broadcast', { event: 'hit' }, (p) => { sumoMyState.vx += p.payload.vx; sumoMyState.vz += p.payload.vz; })
    .on('broadcast', { event: 'gameover' }, (p) => sumoEnd(p.payload.loserRole))
    .subscribe((s) => { if (s === 'SUBSCRIBED') { statusText.innerText = "待機中..."; roomChannel.send({ type: 'broadcast', event: 'joined' }); } });
}

function sumoSetup() {
  sumoMyState.x = 0; sumoMyState.z = sumoRole === 'red' ? 8 : -8; sumoMyState.rot = sumoRole === 'red' ? 0 : Math.PI;
  sumoMyState.vx = 0; sumoMyState.vz = 0; sumoRadius = 15; sumoIsActive = true;
  statusText.innerText = `あなたは ${sumoRole === 'red' ? '赤🚘' : '青🚘'}！ タックルで落とせ！`; statusText.style.color = sumoRole === 'red' ? '#ff6666' : '#66ccff';
}
function sumoEnd(loser) {
  sumoIsActive = false; const isWin = sumoRole !== loser;
  statusText.innerText = isWin ? '👑 勝利！！' : '💀 落下...'; statusText.style.color = isWin ? '#2ecc71' : '#e74c3c';
  setTimeout(() => { alert("リロードしてもう一度！"); }, 1000);
}

// ==========================================
// ⚔️ 2D大乱闘バッシュ (スマブラ風)
// ==========================================
let brRole, brIsActive = false;
const brMyState = { x: 0, y: 0, vx: 0, vy: 0, dmg: 0, dir: 1, attack: 0, jumps: 2 };
const brOppState = { x: 0, y: 0, dmg: 0, dir: -1, attack: 0 };
// メイン足場と左右の空中の足場
const brStage = [ { x: 150, y: 450, w: 500, h: 20 }, { x: 50, y: 300, w: 150, h: 10 }, { x: 600, y: 300, w: 150, h: 10 } ];

function startBrawler(roomId, role) {
  activeGame = '2d'; brRole = role; brIsActive = false;
  uiContainer.style.display = 'none'; document.getElementById('controls').style.display = 'flex'; document.getElementById('pc-hint').style.display = 'block';
  document.getElementById('app').style.display = 'none'; canvas2D.style.display = 'block';

  roomChannel = supabase.channel(`game-2d-${roomId}`);
  roomChannel
    .on('broadcast', { event: 'joined' }, () => { if (!brIsActive && brRole === 'red') { brSetup(); lobbyChannel.untrack(); roomChannel.send({ type: 'broadcast', event: 'start' }); } })
    .on('broadcast', { event: 'start' }, () => { brSetup(); })
    .on('broadcast', { event: 'sync' }, (p) => { 
      brOppState.x = p.payload.x; brOppState.y = p.payload.y; 
      brOppState.dmg = p.payload.dmg; brOppState.dir = p.payload.dir; brOppState.attack = p.payload.attack; 
    })
    // 💥 相手の攻撃を食らって吹っ飛ぶ！
    .on('broadcast', { event: 'hit' }, (p) => { 
      brMyState.dmg += p.payload.dmg; // ダメージ蓄積
      brMyState.vx = p.payload.vx; 
      brMyState.vy = p.payload.vy; 
      brMyState.jumps = 1; // 吹っ飛んだ後は空中ジャンプで復帰できる
    })
    .on('broadcast', { event: 'gameover' }, (p) => brEnd(p.payload.loserRole))
    .subscribe((s) => { if (s === 'SUBSCRIBED') { statusText.innerText = "待機中..."; roomChannel.send({ type: 'broadcast', event: 'joined' }); } });
}

function brSetup() {
  brMyState.x = brRole === 'red' ? 300 : 500; brMyState.y = 200; brMyState.dir = brRole === 'red' ? 1 : -1;
  brMyState.vx = 0

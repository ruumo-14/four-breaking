import * as THREE from 'https://esm.sh/three';
import { OrbitControls } from 'https://esm.sh/three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// --- 1. Supabase の設定 ---
const supabaseUrl = 'https://pxcimtveipluoenjiebx.supabase.co';
const supabaseKey = 'sb_publishable_73t9gf0Rm47Kae9KAHfe6w_asA7g7mM';
const supabase = createClient(supabaseUrl, supabaseKey);

let activeGame = null; // 'c4' or 'sumo' or '2d'
let roomChannel = null;
const statusText = document.getElementById('status');
const uiContainer = document.getElementById('ui-container');

// --- 2. 共通のキーボード＆ボタン入力処理 ---
const keys = { up: false, down: false, left: false, right: false, action: false };

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return; // チャット入力中は無視
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = true;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = true;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = true;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = true;
  
  // 💡 スペースキー修正：ブラウザのスクロールを防ぐ
  if(e.code === 'Space') {
    e.preventDefault(); 
    keys.action = true;
  }
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

function removeFocus() { document.activeElement.blur(); } // スペースキーバグ対策

// --- 3. ロビー機能 ---
const lobbyChannel = supabase.channel('lobby');
const roomListContainer = document.getElementById('room-list-container');

lobbyChannel.on('presence', { event: 'sync' }, () => {
  const state = lobbyChannel.presenceState();
  const availableRooms = [];
  for (const key in state) {
    state[key].forEach(user => { if (user.status === 'waiting') availableRooms.push(user); });
  }

  roomListContainer.innerHTML = '';
  if (availableRooms.length === 0) {
    roomListContainer.innerHTML = '<p style="font-size: 0.9rem; color: #aaa;">待機中の部屋はありません</p>';
    return;
  }

  availableRooms.forEach(user => {
    const btn = document.createElement('button');
    if (user.game === 'c4') {
      btn.className = 'room-btn-c4'; btn.innerText = `🔴 ${user.roomName} に参加 (四目並べ)`;
      btn.onclick = () => { removeFocus(); startConnect4(user.roomName, 'yellow'); };
    } else if (user.game === 'sumo') {
      btn.className = 'room-btn-sumo'; btn.innerText = `🚘 ${user.roomName} に参加 (相撲)`;
      btn.onclick = () => { removeFocus(); startSumo(user.roomName, 'blue'); };
    } else if (user.game === '2d') {
      btn.className = 'room-btn-2d'; btn.innerText = `⚔️ ${user.roomName} に参加 (魔法バトル)`;
      btn.onclick = () => { removeFocus(); start2DAction(user.roomName, 'blue'); };
    }
    roomListContainer.appendChild(btn);
  });
}).subscribe();

document.getElementById('btn-create-c4').onclick = async () => {
  const roomName = document.getElementById('new-room-input').value;
  if (!roomName) return alert('合言葉を入力！');
  removeFocus();
  await lobbyChannel.track({ roomName: roomName, status: 'waiting', game: 'c4' });
  startConnect4(roomName, 'red');
};
document.getElementById('btn-create-sumo').onclick = async () => {
  const roomName = document.getElementById('new-room-input').value;
  if (!roomName) return alert('合言葉を入力！');
  removeFocus();
  await lobbyChannel.track({ roomName: roomName, status: 'waiting', game: 'sumo' });
  startSumo(roomName, 'red');
};
document.getElementById('btn-create-2d').onclick = async () => {
  const roomName = document.getElementById('new-room-input').value;
  if (!roomName) return alert('合言葉を入力！');
  removeFocus();
  await lobbyChannel.track({ roomName: roomName, status: 'waiting', game: '2d' });
  start2DAction(roomName, 'red');
};


// --- 4. 描画エリアの準備 ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);
let currentScene = null, currentCamera = null;
const canvas2D = document.getElementById('canvas-2d');
const ctx2D = canvas2D.getContext('2d');


// ==========================================
// 🔴 四目並べ (Connect 4)
// ==========================================
let c4MyColor, c4CurrentTurn, c4IsGameActive, c4OpponentJoined, c4Board, c4Hitboxes, c4Ghost, c4Controls;

function startConnect4(roomId, color) {
  activeGame = 'c4'; c4MyColor = color; c4CurrentTurn = 'red'; c4IsGameActive = true; c4OpponentJoined = (color === 'yellow');
  c4Board = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => []));
  uiContainer.style.display = 'none'; document.getElementById('chat-container').style.display = 'block';
  document.getElementById('app').style.display = 'block'; canvas2D.style.display = 'none';
  c4UpdateStatus();

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
      hitbox.position.set(px, 2.5, pz); hitbox.userData = { gridX: x, gridZ: z };
      currentScene.add(hitbox); c4Hitboxes.push(hitbox);
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
  raycaster.setFromCamera(mouse, currentCamera);
  const intersects = raycaster.intersectObjects(c4Hitboxes);
  if (intersects.length > 0) {
    const { gridX, gridZ } = intersects[0].object.userData; const y = c4Board[gridX][gridZ].length;
    if (y < 4) { c4Ghost.material.color.setHex(c4MyColor === 'red' ? 0xff4444 : 0xffcc00); c4Ghost.position.set(gridX - 1.5, y + 0.4, gridZ - 1.5); c4Ghost.visible = true; } 
    else c4Ghost.visible = false;
  } else c4Ghost.visible = false;
});
window.addEventListener('click', (e) => {
  if (activeGame !== 'c4' || event.target.closest('#chat-container') || !c4IsGameActive || c4MyColor !== c4CurrentTurn || !c4OpponentJoined) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, currentCamera);
  const intersects = raycaster.intersectObjects(c4Hitboxes);
  if (intersects.length > 0) {
    const { gridX, gridZ } = intersects[0].object.userData;
    if (c4Board[gridX][gridZ].length < 4) c4AddPiece(gridX, gridZ, c4MyColor, true);
  }
});
function c4AddPiece(x, z, color, isLocal) {
  const y = c4Board[x][z].length; c4Board[x][z].push(color);
  const piece = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), new THREE.MeshStandardMaterial({ color: color === 'red' ? 0xff3333 : 0xffcc00, roughness: 0.1, metalness: 0.2 }));
  piece.position.set(x - 1.5, y + 0.4, z - 1.5); currentScene.add(piece);
  if (isLocal && roomChannel) { c4Ghost.visible = false; roomChannel.send({ type: 'broadcast', event: 'place', payload: { x, z, c: color } }); }
  c4CurrentTurn = c4CurrentTurn === 'red' ? 'yellow' : 'red'; c4UpdateStatus();
}
function c4UpdateStatus() {
  if (!c4OpponentJoined) { statusText.innerText = `相手の参加を待っています...`; statusText.style.color = 'white'; return; }
  statusText.innerText = c4MyColor === c4CurrentTurn ? `あなたの番 (${c4MyColor === 'red' ? '赤' : '黄'})` : `相手の番...`;
  statusText.style.color = (c4MyColor === c4CurrentTurn) ? (c4MyColor === 'red' ? '#ff4444' : '#ffcc00') : 'white';
}
function c4AddChat(sender, text, color) {
  const div = document.createElement('div'); div.style.marginBottom = '5px';
  div.innerHTML = `<span style="color: ${color==='red'?'#ff6666':(color==='yellow'?'#ffcc00':'#ccc')}; font-weight: bold;">${sender}:</span> ${text}`;
  document.getElementById('chat-messages').appendChild(div); document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
}
document.getElementById('btn-send').onclick = () => {
  const text = document.getElementById('chat-input').value.trim(); if (!text || !roomChannel) return;
  c4AddChat('あなた', text, c4MyColor); roomChannel.send({ type: 'broadcast', event: 'chat', payload: { text, color: c4MyColor } }); document.getElementById('chat-input').value = '';
};

// ==========================================
// 🚘 3Dドタバタ相撲 (Sumo) - 縮むステージ
// ==========================================
let sumoRole, sumoIsActive, p1Mesh, p2Mesh, sumoArena, sumoEdge;
let sumoRadius = 15; // 💡 これが時間経過で小さくなる半径
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

  function createCar(colorHex) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.3 })); body.position.y = 1;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const lEye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), eyeMat); lEye.position.set(0.6, 1.2, -1.26);
    const rEye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), eyeMat); rEye.position.set(-0.6, 1.2, -1.26);
    group.add(body, lEye, rEye); return group;
  }
  p1Mesh = createCar(0xe74c3c); p2Mesh = createCar(0x3498db); currentScene.add(p1Mesh, p2Mesh);

  roomChannel = supabase.channel(`game-sumo-${roomId}`);
  roomChannel
    .on('broadcast', { event: 'joined' }, () => { if (!sumoIsActive && sumoRole === 'red') { sumoSetupPos(); lobbyChannel.untrack(); roomChannel.send({ type: 'broadcast', event: 'start' }); } })
    .on('broadcast', { event: 'start' }, () => { sumoSetupPos(); })
    .on('broadcast', { event: 'sync' }, (p) => { sumoOppState.x = p.payload.x; sumoOppState.z = p.payload.z; sumoOppState.rot = p.payload.rot; })
    .on('broadcast', { event: 'gameover' }, (p) => sumoEndGame(p.payload.loserRole))
    .subscribe((s) => { if (s === 'SUBSCRIBED') { statusText.innerText = "相手を待っています..."; roomChannel.send({ type: 'broadcast', event: 'joined' }); } });
}

function sumoSetupPos() {
  if (sumoRole === 'red') { sumoMyState.x = 0; sumoMyState.z = 8; sumoMyState.rot = 0; }
  else { sumoMyState.x = 0; sumoMyState.z = -8; sumoMyState.rot = Math.PI; }
  sumoMyState.vx = 0; sumoMyState.vz = 0; sumoRadius = 15; sumoIsActive = true;
  statusText.innerText = `あなたは ${sumoRole === 'red' ? '赤🚘' : '青🚘'} ！`;
  statusText.style.color = sumoRole === 'red' ? '#ff6666' : '#66ccff';
}

function sumoEndGame(loserRole) {
  sumoIsActive = false; const isMyWin = sumoRole !== loserRole;
  statusText.innerText = isMyWin ? '👑 あなたの勝利！！' : '💀 落下しました...';
  statusText.style.color = isMyWin ? '#2ecc71' : '#e74c3c';
  setTimeout(() => { alert("画面をリロードしてもう一度遊べます！"); }, 1000);
}


// ==========================================
// ⚔️ 2D魔法シューティングバトル
// ==========================================
let actRole, actIsActive = false, actBullets = [];
const actMyState = { x: 0, y: 0, hp: 100, dirX: 0, dirY: -1, cooldown: 0 };
const actOppState = { x: 0, y: 0, hp: 100, dirX: 0, dirY: 1 };

function start2DAction(roomId, role) {
  activeGame = '2d'; actRole = role; actIsActive = false; actBullets = [];
  uiContainer.style.display = 'none'; document.getElementById('controls').style.display = 'flex'; document.getElementById('pc-hint').style.display = 'block';
  document.getElementById('app').style.display = 'none'; canvas2D.style.display = 'block'; // 3Dを隠して2Dを表示

  roomChannel = supabase.channel(`game-2d-${roomId}`);
  roomChannel
    .on('broadcast', { event: 'joined' }, () => { if (!actIsActive && actRole === 'red') { actSetupPos(); lobbyChannel.untrack(); roomChannel.send({ type: 'broadcast', event: 'start' }); } })
    .on('broadcast', { event: 'start' }, () => { actSetupPos(); })
    .on('broadcast', { event: 'sync' }, (p) => { actOppState.x = p.payload.x; actOppState.y = p.payload.y; actOppState.hp = p.payload.hp; actOppState.dirX = p.payload.dx; actOppState.dirY = p.payload.dy; })
    .on('broadcast', { event: 'shoot' }, (p) => { actBullets.push(p.payload); }) // 相手の弾を追加
    .on('broadcast', { event: 'gameover' }, (p) => actEndGame(p.payload.loserRole))
    .subscribe((s) => { if (s === 'SUBSCRIBED') { statusText.innerText = "相手を待っています..."; roomChannel.send({ type: 'broadcast', event: 'joined' }); } });
}

function actSetupPos() {
  if (actRole === 'red') { actMyState.x = 400; actMyState.y = 500; actMyState.dirX = 0; actMyState.dirY = -1; }
  else { actMyState.x = 400; actMyState.y = 100; actMyState.dirX = 0; actMyState.dirY = 1; }
  actMyState.hp = 100; actMyState.cooldown = 0; actOppState.hp = 100; actBullets = [];
  actIsActive = true;
  statusText.innerText = `あなたは ${actRole === 'red' ? '赤魔法使い' : '青魔法使い'}！ 撃ちまくれ！`;
  statusText.style.color = actRole === 'red' ? '#ff6666' : '#66ccff';
}

function actEndGame(loserRole) {
  actIsActive = false; const isMyWin = actRole !== loserRole;
  statusText.innerText = isMyWin ? '👑 相手を倒した！！' : '💀 やられた...';
  statusText.style.color = isMyWin ? '#2ecc71' : '#e74c3c';
  setTimeout(() => { alert("画面をリロードしてもう一度遊べます！"); }, 1000);
}


// ==========================================
// 🔄 共通のアニメーションループ (毎フレーム実行)
// ==========================================
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);
  frameCount++;

  // --- 1. 四目並べの更新 ---
  if (activeGame === 'c4' && c4Controls) {
    c4Controls.update();
    if (currentScene && currentCamera) renderer.render(currentScene, currentCamera);
  } 
  
  // --- 2. 3D相撲の更新 ---
  else if (activeGame === 'sumo' && sumoIsActive) {
    // 💡 ステージが徐々に小さくなる処理（1フレームごとに少しずつ縮む）
    sumoRadius -= 0.003; 
    if (sumoRadius < 3) sumoRadius = 3; // 最小サイズ
    const scale = sumoRadius / 15;
    sumoArena.scale.set(scale, 1, scale);
    sumoEdge.scale.set(scale, 1, scale);

    const turn = 0.05, accel = keys.action ? 0.03 : 0.01; // スペースでタックル（加速）
    if (keys.left) sumoMyState.rot += turn;
    if (keys.right) sumoMyState.rot -= turn;
    if (keys.up) { sumoMyState.vx -= Math.sin(sumoMyState.rot)*accel; sumoMyState.vz -= Math.cos(sumoMyState.rot)*accel; }
    if (keys.down) { sumoMyState.vx += Math.sin(sumoMyState.rot)*accel*0.5; sumoMyState.vz += Math.cos(sumoMyState.rot)*accel*0.5; }

    sumoMyState.vx *= 0.95; sumoMyState.vz *= 0.95; // 摩擦
    sumoMyState.x += sumoMyState.vx; sumoMyState.z += sumoMyState.vz;

    // 当たり判定
    const dx = sumoMyState.x - sumoOppState.x, dz = sumoMyState.z - sumoOppState.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < 2.5) {
      const push = (2.5 - dist) * 0.2;
      sumoMyState.vx += (dx/dist) * push; sumoMyState.vz += (dz/dist) * push;
    }

    // リングアウト判定（縮んだ半径と比較）
    if (Math.sqrt(sumoMyState.x**2 + sumoMyState.z**2) > sumoRadius + 0.5) {
      roomChannel.send({ type: 'broadcast', event: 'gameover', payload: { loserRole: sumoRole } });
      sumoEndGame(sumoRole);
    }

    if (frameCount % 3 === 0) roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: sumoMyState.x, z: sumoMyState.z, rot: sumoMyState.rot } });

    if (sumoRole === 'red') {
      p1Mesh.position.set(sumoMyState.x, 1, sumoMyState.z); p1Mesh.rotation.y = sumoMyState.rot;
      p2Mesh.position.set(sumoOppState.x, 1, sumoOppState.z); p2Mesh.rotation.y = sumoOppState.rot;
    } else {
      p2Mesh.position.set(sumoMyState.x, 1, sumoMyState.z); p2Mesh.rotation.y = sumoMyState.rot;
      p1Mesh.position.set(sumoOppState.x, 1, sumoOppState.z); p1Mesh.rotation.y = sumoOppState.rot;
    }
    if (currentScene && currentCamera) renderer.render(currentScene, currentCamera);
  }

  // --- 3. 2Dアクションの更新と描画 ---
  else if (activeGame === '2d' && actIsActive) {
    // 自分を動かす
    const speed = 4;
    let moved = false;
    if (keys.up && actMyState.y > 20) { actMyState.y -= speed; actMyState.dirX = 0; actMyState.dirY = -1; moved = true;}
    if (keys.down && actMyState.y < 580) { actMyState.y += speed; actMyState.dirX = 0; actMyState.dirY = 1; moved = true;}
    if (keys.left && actMyState.x > 20) { actMyState.x -= speed; actMyState.dirX = -1; actMyState.dirY = 0; moved = true;}
    if (keys.right && actMyState.x < 780) { actMyState.x += speed; actMyState.dirX = 1; actMyState.dirY = 0; moved = true;}

    // 魔法（弾）を撃つ
    if (actMyState.cooldown > 0) actMyState.cooldown--;
    if (keys.action && actMyState.cooldown <= 0) {
      actMyState.cooldown = 20; // 連射制限
      const bullet = { x: actMyState.x, y: actMyState.y, vx: actMyState.dirX * 10, vy: actMyState.dirY * 10, color: actRole };
      actBullets.push(bullet);
      roomChannel.send({ type: 'broadcast', event: 'shoot', payload: bullet });
    }

    if (frameCount % 4 === 0 && moved) {
      roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: actMyState.x, y: actMyState.y, hp: actMyState.hp, dx: actMyState.dirX, dy: actMyState.dirY } });
    }

    // キャンバスをクリア
    ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);

    // 弾の移動と当たり判定（自分が当たった時だけ計算）
    for (let i = actBullets.length - 1; i >= 0; i--) {
      const b = actBullets[i];
      b.x += b.vx; b.y += b.vy;
      
      // 画面外に出たら消す
      if (b.x < 0 || b.x > 800 || b.y < 0 || b.y > 600) { actBullets.splice(i, 1); continue; }
      
      // 弾を描画
      ctx2D.beginPath(); ctx2D.arc(b.x, b.y, 8, 0, Math.PI * 2);
      ctx2D.fillStyle = b.color === 'red' ? '#ff7979' : '#7ed6df';
      ctx2D.fill();

      // 相手の弾が自分に当たったかチェック
      if (b.color !== actRole) {
        const dist = Math.hypot(b.x - actMyState.x, b.y - actMyState.y);
        if (dist < 20) { // ヒット！
          actMyState.hp -= 15;
          actBullets.splice(i, 1); // 弾を消す
          roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: actMyState.x, y: actMyState.y, hp: actMyState.hp, dx: actMyState.dirX, dy: actMyState.dirY } });
          if (actMyState.hp <= 0) {
            roomChannel.send({ type: 'broadcast', event: 'gameover', payload: { loserRole: actRole } });
            actEndGame(actRole);
          }
        }
      }
    }

    // プレイヤーを描画する関数
    function drawPlayer(x, y, hp, dirX, dirY, isRed) {
      ctx2D.beginPath(); ctx2D.arc(x, y, 20, 0, Math.PI * 2);
      ctx2D.fillStyle = isRed ? '#eb4d4b' : '#3498db'; ctx2D.fill();
      // 向いている方向（目）
      ctx2D.beginPath(); ctx2D.arc(x + dirX * 10, y + dirY * 10, 5, 0, Math.PI * 2);
      ctx2D.fillStyle = 'white'; ctx2D.fill();
      // HPバー
      ctx2D.fillStyle = '#c0392b'; ctx2D.fillRect(x - 20, y - 35, 40, 6);
      ctx2D.fillStyle = '#2ecc71'; ctx2D.fillRect(x - 20, y - 35, 40 * (hp / 100), 6);
    }

    // 自分と相手を描画
    drawPlayer(actMyState.x, actMyState.y, actMyState.hp, actMyState.dirX, actMyState.dirY, actRole === 'red');
    drawPlayer(actOppState.x, actOppState.y, actOppState.hp, actOppState.dirX, actOppState.dirY, actRole !== 'red');
  }
}
animate();

window.addEventListener('resize', () => {
  if (currentCamera) { currentCamera.aspect = window.innerWidth / window.innerHeight; currentCamera.updateProjectionMatrix(); }
  renderer.setSize(window.innerWidth, window.innerHeight);
});

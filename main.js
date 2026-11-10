import * as THREE from 'https://esm.sh/three';
import { OrbitControls } from 'https://esm.sh/three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// --- 1. Supabase の設定 ---
const supabaseUrl = 'https://pxcimtveipluoenjiebx.supabase.co';
const supabaseKey = 'sb_publishable_73t9gf0Rm47Kae9KAHfe6w_asA7g7mM';
const supabase = createClient(supabaseUrl, supabaseKey);

// --- 2. 共通の変数 ---
let activeGame = null; // 'c4' or 'sumo'
let roomChannel = null;
const statusText = document.getElementById('status');

// --- 3. ロビー機能 ---
const lobbyChannel = supabase.channel('lobby');
const roomListContainer = document.getElementById('room-list-container');

lobbyChannel.on('presence', { event: 'sync' }, () => {
  const state = lobbyChannel.presenceState();
  const availableRooms = [];
  for (const key in state) {
    state[key].forEach(user => {
      if (user.status === 'waiting') availableRooms.push(user);
    });
  }

  roomListContainer.innerHTML = '';
  if (availableRooms.length === 0) {
    roomListContainer.innerHTML = '<p style="font-size: 0.9rem; color: #aaa;">待機中の部屋はありません</p>';
    return;
  }

  availableRooms.forEach(user => {
    const btn = document.createElement('button');
    if (user.game === 'c4') {
      btn.className = 'room-btn-c4';
      btn.innerText = `🔴 ${user.roomName} に参加 (四目並べ)`;
      btn.onclick = () => startConnect4(user.roomName, 'yellow');
    } else {
      btn.className = 'room-btn-sumo';
      btn.innerText = `🚘 ${user.roomName} に参加 (相撲)`;
      btn.onclick = () => startSumo(user.roomName, 'blue');
    }
    roomListContainer.appendChild(btn);
  });
}).subscribe();

document.getElementById('btn-create-c4').onclick = async () => {
  const roomName = document.getElementById('new-room-input').value;
  if (!roomName) return alert('合言葉を入力してください！');
  await lobbyChannel.track({ roomName: roomName, status: 'waiting', game: 'c4' });
  startConnect4(roomName, 'red');
};

document.getElementById('btn-create-sumo').onclick = async () => {
  const roomName = document.getElementById('new-room-input').value;
  if (!roomName) return alert('合言葉を入力してください！');
  await lobbyChannel.track({ roomName: roomName, status: 'waiting', game: 'sumo' });
  startSumo(roomName, 'red'); // ホストは赤
};

// --- 4. 3D描画の共通セットアップ ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

let currentScene = null;
let currentCamera = null;

// ==========================================
// 🔴 四目並べ (Connect 4) の処理
// ==========================================
let c4MyColor, c4CurrentTurn, c4IsGameActive, c4OpponentJoined, c4Board, c4Hitboxes, c4Ghost, c4Controls;

function startConnect4(roomId, color) {
  activeGame = 'c4';
  c4MyColor = color;
  c4CurrentTurn = 'red';
  c4IsGameActive = true;
  c4OpponentJoined = (color === 'yellow');
  c4Board = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => []));

  document.getElementById('ui-container').style.display = 'none';
  document.getElementById('chat-container').style.display = 'block';
  
  c4UpdateStatus();

  // シーン構築
  currentScene = new THREE.Scene();
  currentScene.background = new THREE.Color(0x1a1a1a);
  currentCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(8, 7, 8);
  c4Controls = new OrbitControls(currentCamera, renderer.domElement);
  c4Controls.enablePan = false;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(10, 20, 10);
  currentScene.add(ambientLight, dirLight);

  const base = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 5), new THREE.MeshStandardMaterial({ color: 0x1155aa, roughness: 0.8 }));
  base.position.y = -0.25;
  currentScene.add(base);

  c4Hitboxes = [];
  const gridOffset = 1.5;
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 4; z++) {
      const px = x - gridOffset, pz = z - gridOffset;
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.5), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.5 }));
      peg.position.set(px, 2.25, pz);
      currentScene.add(peg);
      
      const hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
      hitbox.position.set(px, 2.5, pz);
      hitbox.userData = { gridX: x, gridZ: z };
      currentScene.add(hitbox);
      c4Hitboxes.push(hitbox);
    }
  }

  c4Ghost = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
  c4Ghost.visible = false;
  currentScene.add(c4Ghost);

  // 通信
  roomChannel = supabase.channel(`game-c4-${roomId}`);
  roomChannel
    .on('broadcast', { event: 'place' }, (p) => c4AddPiece(p.payload.x, p.payload.z, p.payload.c, false))
    .on('broadcast', { event: 'chat' }, (p) => c4AddChat('相手', p.payload.text, p.payload.color))
    .on('broadcast', { event: 'joined' }, () => {
      if (c4MyColor === 'red') { c4OpponentJoined = true; lobbyChannel.untrack(); c4UpdateStatus(); c4AddChat('システム', '相手が参加しました！', 'white'); }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && c4MyColor === 'yellow') { roomChannel.send({ type: 'broadcast', event: 'joined', payload: {} }); }
    });
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('pointermove', (e) => {
  if (activeGame !== 'c4' || !c4IsGameActive || c4MyColor !== c4CurrentTurn || !c4OpponentJoined) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, currentCamera);
  const intersects = raycaster.intersectObjects(c4Hitboxes);
  if (intersects.length > 0) {
    const { gridX, gridZ } = intersects[0].object.userData;
    const y = c4Board[gridX][gridZ].length;
    if (y < 4) {
      c4Ghost.material.color.setHex(c4MyColor === 'red' ? 0xff4444 : 0xffcc00);
      c4Ghost.position.set(gridX - 1.5, y + 0.4, gridZ - 1.5);
      c4Ghost.visible = true;
    } else c4Ghost.visible = false;
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
  const y = c4Board[x][z].length;
  c4Board[x][z].push(color);
  const piece = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), new THREE.MeshStandardMaterial({ color: color === 'red' ? 0xff3333 : 0xffcc00, roughness: 0.1, metalness: 0.2 }));
  piece.position.set(x - 1.5, y + 0.4, z - 1.5);
  currentScene.add(piece);
  if (isLocal && roomChannel) {
    c4Ghost.visible = false;
    roomChannel.send({ type: 'broadcast', event: 'place', payload: { x, z, c: color } });
  }
  if (c4CheckWin(x, y, z, color)) {
    statusText.innerText = `${color === 'red' ? '赤' : '黄'} の勝利！`;
    c4AddChat('システム', `${color === 'red' ? '赤' : '黄'} が勝利しました！`, 'white');
    c4IsGameActive = false; c4Ghost.visible = false; return;
  }
  c4CurrentTurn = c4CurrentTurn === 'red' ? 'yellow' : 'red';
  c4UpdateStatus();
}

function c4CheckWin(cx, cy, cz, c) {
  const dirs = [[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,-1,0],[0,1,1],[0,1,-1],[1,0,1],[1,0,-1],[1,1,1],[1,1,-1],[1,-1,1],[-1,1,1]];
  for (const [dx, dy, dz] of dirs) {
    let count = 1;
    for (let i=1; i<4; i++) { const nx=cx+dx*i, ny=cy+dy*i, nz=cz+dz*i; if(nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&c4Board[nx][nz][ny]===c) count++; else break; }
    for (let i=1; i<4; i++) { const nx=cx-dx*i, ny=cy-dy*i, nz=cz-dz*i; if(nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&c4Board[nx][nz][ny]===c) count++; else break; }
    if (count >= 4) return true;
  }
  return false;
}

function c4UpdateStatus() {
  if (!c4OpponentJoined) { statusText.innerText = `相手の参加を待っています...`; statusText.style.color = 'white'; return; }
  statusText.innerText = c4MyColor === c4CurrentTurn ? `あなたの番です (${c4MyColor === 'red' ? '赤' : '黄'})` : `相手の番を待っています...`;
  statusText.style.color = (c4MyColor === c4CurrentTurn) ? (c4MyColor === 'red' ? '#ff4444' : '#ffcc00') : 'white';
}

function c4AddChat(sender, text, color) {
  const div = document.createElement('div');
  div.style.marginBottom = '5px';
  div.innerHTML = `<span style="color: ${color==='red'?'#ff6666':(color==='yellow'?'#ffcc00':'#ccc')}; font-weight: bold;">${sender}:</span> ${text}`;
  document.getElementById('chat-messages').appendChild(div);
  document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
}

document.getElementById('btn-send').onclick = () => {
  const text = document.getElementById('chat-input').value.trim();
  if (!text || !roomChannel) return;
  c4AddChat('あなた', text, c4MyColor);
  roomChannel.send({ type: 'broadcast', event: 'chat', payload: { text, color: c4MyColor } });
  document.getElementById('chat-input').value = '';
};


// ==========================================
// 🚘 3Dドタバタ相撲 (Sumo) の処理
// ==========================================
let sumoRole, sumoIsActive, p1Mesh, p2Mesh;
const sumoMyState = { x: 0, z: 0, rot: 0, vx: 0, vz: 0 };
const sumoOppState = { x: 0, z: 0, rot: 0 };
const keys = { up: false, down: false, left: false, right: false, dash: false };

function startSumo(roomId, role) {
  activeGame = 'sumo';
  sumoRole = role;
  sumoIsActive = false;

  document.getElementById('ui-container').style.display = 'none';
  document.getElementById('controls').style.display = 'flex';
  document.getElementById('pc-hint').style.display = 'block';

  currentScene = new THREE.Scene();
  currentScene.background = new THREE.Color(0x87CEEB);
  currentCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(0, 25, 30);
  currentCamera.lookAt(0, 0, 0);

  currentScene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  currentScene.add(dirLight);

  const arena = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1, 64), new THREE.MeshStandardMaterial({ color: 0x34495e, roughness: 0.8 }));
  arena.position.y = -0.5;
  currentScene.add(arena);

  const edge = new THREE.Mesh(new THREE.TorusGeometry(15, 0.2, 16, 64), new THREE.MeshBasicMaterial({ color: 0xe74c3c }));
  edge.rotation.x = Math.PI / 2;
  currentScene.add(edge);

  function createCar(colorHex) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.3 }));
    body.position.y = 1;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const lEye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), eyeMat); lEye.position.set(0.6, 1.2, -1.26);
    const rEye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), eyeMat); rEye.position.set(-0.6, 1.2, -1.26);
    group.add(body, lEye, rEye);
    return group;
  }
  p1Mesh = createCar(0xe74c3c); // 赤
  p2Mesh = createCar(0x3498db); // 青
  currentScene.add(p1Mesh, p2Mesh);

  roomChannel = supabase.channel(`game-sumo-${roomId}`);
  roomChannel
    .on('broadcast', { event: 'joined' }, () => {
      if (!sumoIsActive && sumoRole === 'red') {
        sumoSetupPos();
        lobbyChannel.untrack();
        roomChannel.send({ type: 'broadcast', event: 'start', payload: {} });
      }
    })
    .on('broadcast', { event: 'start' }, () => { sumoSetupPos(); })
    .on('broadcast', { event: 'sync' }, (p) => { sumoOppState.x = p.payload.x; sumoOppState.z = p.payload.z; sumoOppState.rot = p.payload.rot; })
    .on('broadcast', { event: 'gameover' }, (p) => sumoEndGame(p.payload.loserRole))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        statusText.innerText = "相手を待っています...";
        roomChannel.send({ type: 'broadcast', event: 'joined', payload: {} });
      }
    });
}

function sumoSetupPos() {
  if (sumoRole === 'red') { sumoMyState.x = 0; sumoMyState.z = 8; sumoMyState.rot = 0; }
  else { sumoMyState.x = 0; sumoMyState.z = -8; sumoMyState.rot = Math.PI; }
  sumoMyState.vx = 0; sumoMyState.vz = 0;
  sumoIsActive = true;
  statusText.innerText = `あなたは ${sumoRole === 'red' ? '赤色🚘' : '青色🚘'} ！ 相手を落とせ！`;
  statusText.style.color = sumoRole === 'red' ? '#ff6666' : '#66ccff';
}

function sumoEndGame(loserRole) {
  sumoIsActive = false;
  const isMyWin = sumoRole !== loserRole;
  statusText.innerText = isMyWin ? '👑 あなたの勝利！！' : '💀 落下しました...';
  statusText.style.color = isMyWin ? '#2ecc71' : '#e74c3c';
  setTimeout(() => { alert("画面をリロードしてもう一度遊べます！"); }, 1000);
}

// 相撲の操作イベント
window.addEventListener('keydown', (e) => {
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = true;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = true;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = true;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = true;
  if(e.key === ' ' || e.key === 'Shift') keys.dash = true;
});
window.addEventListener('keyup', (e) => {
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = false;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = false;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = false;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = false;
  if(e.key === ' ' || e.key === 'Shift') keys.dash = false;
});
['up','down','left','right','dash'].forEach(k => {
  const btn = document.getElementById('btn-'+k);
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); keys[k] = true; });
  btn.addEventListener('pointerup', (e) => { e.preventDefault(); keys[k] = false; });
  btn.addEventListener('pointerleave', (e) => { e.preventDefault(); keys[k] = false; });
});


// ==========================================
// 🔄 共通のアニメーションループ
// ==========================================
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);

  if (activeGame === 'c4' && c4Controls) {
    c4Controls.update();
  } 
  else if (activeGame === 'sumo' && sumoIsActive) {
    const turn = 0.05, accel = keys.dash ? 0.025 : 0.01;
    if (keys.left) sumoMyState.rot += turn;
    if (keys.right) sumoMyState.rot -= turn;
    if (keys.up) { sumoMyState.vx -= Math.sin(sumoMyState.rot)*accel; sumoMyState.vz -= Math.cos(sumoMyState.rot)*accel; }
    if (keys.down) { sumoMyState.vx += Math.sin(sumoMyState.rot)*accel*0.5; sumoMyState.vz += Math.cos(sumoMyState.rot)*accel*0.5; }

    sumoMyState.vx *= 0.95; sumoMyState.vz *= 0.95;
    sumoMyState.x += sumoMyState.vx; sumoMyState.z += sumoMyState.vz;

    const dx = sumoMyState.x - sumoOppState.x, dz = sumoMyState.z - sumoOppState.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < 2.5) {
      const push = (2.5 - dist) * 0.2;
      sumoMyState.vx += (dx/dist) * push; sumoMyState.vz += (dz/dist) * push;
    }

    if (Math.sqrt(sumoMyState.x**2 + sumoMyState.z**2) > 15.5) {
      roomChannel.send({ type: 'broadcast', event: 'gameover', payload: { loserRole: sumoRole } });
      sumoEndGame(sumoRole);
    }

    frameCount++;
    if (frameCount % 3 === 0) roomChannel.send({ type: 'broadcast', event: 'sync', payload: { x: sumoMyState.x, z: sumoMyState.z, rot: sumoMyState.rot } });

    if (sumoRole === 'red') {
      p1Mesh.position.set(sumoMyState.x, 1, sumoMyState.z); p1Mesh.rotation.y = sumoMyState.rot;
      p2Mesh.position.set(sumoOppState.x, 1, sumoOppState.z); p2Mesh.rotation.y = sumoOppState.rot;
    } else {
      p2Mesh.position.set(sumoMyState.x, 1, sumoMyState.z); p2Mesh.rotation.y = sumoMyState.rot;
      p1Mesh.position.set(sumoOppState.x, 1, sumoOppState.z); p1Mesh.rotation.y = sumoOppState.rot;
    }
  }

  if (currentScene && currentCamera) renderer.render(currentScene, currentCamera);
}
animate();

window.addEventListener('resize', () => {
  if (currentCamera) {
    currentCamera.aspect = window.innerWidth / window.innerHeight;
    currentCamera.updateProjectionMatrix();
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
});

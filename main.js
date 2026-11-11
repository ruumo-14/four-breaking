import * as THREE from 'https://esm.sh/three';
import { OrbitControls } from 'https://esm.sh/three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

const supabaseUrl = 'https://pxcimtveipluoenjiebx.supabase.co';
const supabaseKey = 'sb_publishable_73t9gf0Rm47Kae9KAHfe6w_asA7g7mM';
const supabase = createClient(supabaseUrl, supabaseKey);

let currentRoomId = null;
let myRole = null; // 'host' (red) or 'guest' (yellow)
let myColor = null;
let currentTurn = 'red';
let isGameActive = false;
let roomChannel = null;

let board = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => []));
let hitboxes = [];

const statusText = document.getElementById('status');
const uiContainer = document.getElementById('ui-container');
const panelLobby = document.getElementById('panel-lobby');

// --- 3D シーン初期設定 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(8, 8, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.maxDistance = 20;
controls.minDistance = 5;

// ライティング
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// 土台とポールの作成
function setupBoard() {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(5, 0.5, 5),
    new THREE.MeshStandardMaterial({ color: 0x1155aa })
  );
  base.position.y = -0.25;
  scene.add(base);

  hitboxes = [];
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 4; z++) {
      const px = x - 1.5;
      const pz = z - 1.5;

      // ポール
      const peg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 4.5),
        new THREE.MeshStandardMaterial({ color: 0xaaaaaa })
      );
      peg.position.set(px, 2.25, pz);
      scene.add(peg);

      // 当たり判定用コライダー
      const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 5, 0.8),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hitbox.position.set(px, 2.5, pz);
      hitbox.userData = { gridX: x, gridZ: z };
      scene.add(hitbox);
      hitboxes.push(hitbox);
    }
  }
}
setupBoard();

// --- ネットワーク & 部屋管理 ---
const lobbyChannel = supabase.channel('lobby');
let isLobbyReady = false;

lobbyChannel.on('presence', { event: 'sync' }, () => {
  const state = lobbyChannel.presenceState();
  const availableRooms = [];
  for (const key in state) state[key].forEach(u => { if (u.status === 'waiting') availableRooms.push(u); });

  const roomListContainer = document.getElementById('room-list-container');
  roomListContainer.innerHTML = '';
  if (availableRooms.length === 0) {
    roomListContainer.innerHTML = '<p style="font-size: 0.9rem; color: #aaa;">待機中の部屋はありません</p>';
    return;
  }

  availableRooms.forEach(user => {
    const btn = document.createElement('button');
    btn.className = 'room-btn';
    btn.innerText = `🏠 ${user.roomName} に入室`;
    btn.onclick = () => joinRoom(user.roomName, 'guest');
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
  currentRoomId = roomId;
  myRole = role;
  myColor = role === 'host' ? 'red' : 'yellow';
  
  uiContainer.style.display = 'none';

  roomChannel = supabase.channel(`room-${roomId}`);
  roomChannel
    .on('broadcast', { event: 'chat' }, (p) => addChatMessage(p.payload.sender, p.payload.text, p.payload.color))
    .on('broadcast', { event: 'joined' }, () => {
      if (myRole === 'host') {
        lobbyChannel.untrack();
        isGameActive = true;
        updateStatus();
      }
    })
    .on('broadcast', { event: 'place' }, (p) => addPiece(p.payload.x, p.payload.z, p.payload.c, false))
    .subscribe((s) => {
      if (s === 'SUBSCRIBED') {
        if (myRole === 'guest') {
          roomChannel.send({ type: 'broadcast', event: 'joined' });
          isGameActive = true;
          updateStatus();
        } else {
          statusText.innerText = "🟢 相手の入室を待っています...";
        }
      }
    });
}

// チャット
function addChatMessage(sender, text, color = '#fff') {
  const div = document.createElement('div');
  div.style.marginBottom = '4px';
  div.innerHTML = `<span style="color: ${color}; font-weight: bold;">${sender}:</span> ${text}`;
  const box = document.getElementById('chat-messages');
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

document.getElementById('btn-send').onclick = () => {
  const text = document.getElementById('chat-input').value.trim();
  if (!text) return;
  const name = myRole === 'host' ? 'ホスト(赤)' : 'ゲスト(黄)';
  addChatMessage('あなた', text, '#4caf50');
  const targetChannel = roomChannel || lobbyChannel;
  targetChannel.send({ type: 'broadcast', event: 'chat', payload: { sender: name, text, color: '#ffcc00' } });
  document.getElementById('chat-input').value = '';
};

// --- 四目並べゲームロジック ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('click', (e) => {
  if (e.target.closest('#chat-container') || e.target.closest('#ui-container') || !isGameActive || myColor !== currentTurn) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(hitboxes);
  if (intersects.length > 0) {
    const { gridX, gridZ } = intersects[0].object.userData;
    if (board[gridX][gridZ].length < 4) {
      addPiece(gridX, gridZ, myColor, true);
    }
  }
});

function addPiece(x, z, color, isLocal) {
  const y = board[x][z].length;
  board[x][z].push(color);

  const piece = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 32, 32),
    new THREE.MeshStandardMaterial({ color: color === 'red' ? 0xff3333 : 0xffcc00 })
  );
  piece.position.set(x - 1.5, y + 0.4, z - 1.5);
  scene.add(piece);

  if (isLocal) {
    roomChannel.send({ type: 'broadcast', event: 'place', payload: { x, z, c: color } });
  }

  if (checkWin(x, y, z, color)) {
    isGameActive = false;
    statusText.innerText = color === myColor ? "👑 あなたの勝利！" : "💀 相手の勝利...";
    statusText.style.color = color === myColor ? "#2ecc71" : "#e74c3c";
    return;
  }

  currentTurn = currentTurn === 'red' ? 'yellow' : 'red';
  updateStatus();
}

function updateStatus() {
  const isMyTurn = myColor === currentTurn;
  statusText.innerText = isMyTurn ? `【あなたの番】 (${myColor === 'red' ? '赤' : '黄'})` : `【相手の番...】 (${currentTurn === 'red' ? '赤' : '黄'})`;
  statusText.style.color = isMyTurn ? '#ffcc00' : '#ffffff';
}

// 勝利判定（縦・横・高さ・斜め全方位）
function checkWin(x, y, z, color) {
  const directions = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1],
    [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1],
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1]
  ];

  for (const [dx, dy, dz] of directions) {
    let count = 1;
    for (let step = 1; step < 4; step++) {
      const nx = x + dx * step, ny = y + dy * step, nz = z + dz * step;
      if (getPiece(nx, ny, nz) === color) count++; else break;
    }
    for (let step = 1; step < 4; step++) {
      const nx = x - dx * step, ny = y - dy * step, nz = z - dz * step;
      if (getPiece(nx, ny, nz) === color) count++; else break;
    }
    if (count >= 4) return true;
  }
  return false;
}

function getPiece(x, y, z) {
  if (x < 0 || x >= 4 || z < 0 || z >= 4 || y < 0 || y >= 4) return null;
  return board[x][z][y] || null;
}

// レンダリングループ
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

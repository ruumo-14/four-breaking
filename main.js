import * as THREE from 'https://esm.sh/three';
import { OrbitControls } from 'https://esm.sh/three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// --- 1. Supabase の設定 ---
// ⚠️ ここに自分のURLとキーを直接書きます
const supabaseUrl = 'https://pxcimtveipluoenjiebx.supabase.co';
const supabaseKey = 'sb_publishable_73t9gf0Rm47Kae9KAHfe6w_asA7g7mM';
const supabase = createClient(supabaseUrl, supabaseKey);

// --- 2. ゲームの状態管理 ---
let myColor = null;
let currentTurn = 'red';
let isGameActive = false;
let roomChannel = null;
const board = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => []));

const uiContainer = document.getElementById('ui-container');
const statusText = document.getElementById('status');
const roomListContainer = document.getElementById('room-list-container');
const chatContainer = document.getElementById('chat-container');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const btnSend = document.getElementById('btn-send');

// --- 3. ロビー（部屋一覧）の管理 ---
const lobbyChannel = supabase.channel('lobby');

lobbyChannel.on('presence', { event: 'sync' }, () => {
  const state = lobbyChannel.presenceState();
  updateRoomList(state);
}).subscribe();

document.getElementById('btn-create').onclick = async () => {
  const roomName = document.getElementById('new-room-input').value;
  if (!roomName) return alert('部屋の名前を入力してください！');
  await lobbyChannel.track({ roomName: roomName, status: 'waiting' });
  startGame(roomName, 'red');
};

function updateRoomList(state) {
  const availableRooms = new Set();
  for (const key in state) {
    state[key].forEach(user => {
      if (user.status === 'waiting') availableRooms.add(user.roomName);
    });
  }

  roomListContainer.innerHTML = '';
  if (availableRooms.size === 0) {
    roomListContainer.innerHTML = '<p style="font-size: 0.9rem; color: #aaa;">待機中の部屋はありません</p>';
    return;
  }

  availableRooms.forEach(roomName => {
    const btn = document.createElement('button');
    btn.className = 'room-btn';
    btn.innerText = `${roomName} に参加 (後手/黄)`;
    btn.onclick = () => startGame(roomName, 'yellow');
    roomListContainer.appendChild(btn);
  });
}

// --- 4. ゲームスタートとチャット ---
function startGame(roomId, color) {
  myColor = color;
  uiContainer.style.display = 'none';
  chatContainer.style.display = 'block'; // チャットを表示
  isGameActive = true;
  
  if (myColor === 'red') {
    statusText.innerText = "相手の参加を待っています...";
    statusText.style.color = 'white';
  } else {
    updateStatusText();
  }

  roomChannel = supabase.channel(`game-${roomId}`);
  roomChannel
    .on('broadcast', { event: 'place_piece' }, (payload) => {
      const { x, z, c } = payload.payload;
      addPieceToBoard(x, z, c, false);
    })
    .on('broadcast', { event: 'chat' }, (payload) => {
      // 相手からのチャットを受信
      addChatMessage('相手', payload.payload.text, payload.payload.color);
    })
    .on('broadcast', { event: 'player_joined' }, () => {
      if (myColor === 'red') {
        lobbyChannel.untrack();
        updateStatusText();
        addChatMessage('システム', '相手が参加しました！', 'white');
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && myColor === 'yellow') {
        roomChannel.send({ type: 'broadcast', event: 'player_joined', payload: {} });
        addChatMessage('システム', '部屋に参加しました！', 'white');
      }
    });
}

// チャット送信機能（送信ボタンかEnterキー）
function sendChat() {
  const text = chatInput.value.trim();
  if (!text || !roomChannel) return;
  addChatMessage('あなた', text, myColor);
  roomChannel.send({ type: 'broadcast', event: 'chat', payload: { text, color: myColor } });
  chatInput.value = '';
}
btnSend.onclick = sendChat;
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });

function addChatMessage(sender, text, color) {
  const div = document.createElement('div');
  const cCode = color === 'red' ? '#ff6666' : (color === 'yellow' ? '#ffcc00' : '#cccccc');
  div.style.marginBottom = '5px';
  div.innerHTML = `<span style="color: ${cCode}; font-weight: bold;">${sender}:</span> ${text}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight; // 一番下にスクロール
}

function updateStatusText() {
  if (myColor === currentTurn) {
    statusText.innerText = `あなたの番です (${myColor === 'red' ? '赤' : '黄'})`;
    statusText.style.color = myColor === 'red' ? '#ff4444' : '#ffcc00';
  } else {
    statusText.innerText = `相手の番を待っています...`;
    statusText.style.color = 'white';
  }
}

// --- 5. Three.js 3D描画セットアップ ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(8, 7, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;

// ツヤを出すためにライトを強化
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);
const pointLight = new THREE.PointLight(0xffffff, 0.5);
pointLight.position.set(-5, 5, -5);
scene.add(pointLight);

const baseGeo = new THREE.BoxGeometry(5, 0.5, 5);
const baseMat = new THREE.MeshStandardMaterial({ color: 0x1155aa, roughness: 0.8 });
const base = new THREE.Mesh(baseGeo, baseMat);
base.position.y = -0.25;
scene.add(base);

const hitboxes = [];
const gridOffset = 1.5;

for (let x = 0; x < 4; x++) {
  for (let z = 0; x < 4 && z < 4; z++) {
    const posX = x - gridOffset;
    const posZ = z - gridOffset;

    const pegGeo = new THREE.CylinderGeometry(0.05, 0.05, 4.5);
    const pegMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.5 });
    const peg = new THREE.Mesh(pegGeo, pegMat);
    peg.position.set(posX, 2.25, posZ);
    scene.add(peg);

    const hitGeo = new THREE.BoxGeometry(0.8, 5, 0.8);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitbox = new THREE.Mesh(hitGeo, hitMat);
    hitbox.position.set(posX, 2.5, posZ);
    hitbox.userData = { gridX: x, gridZ: z };
    scene.add(hitbox);
    hitboxes.push(hitbox);
  }
}

// 👑 ホバー用の「半透明の玉（ゴースト）」を作成
const ghostGeo = new THREE.SphereGeometry(0.4, 32, 32);
const ghostMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.5, // 半透明
  roughness: 0.2,
  metalness: 0.3
});
const ghostPiece = new THREE.Mesh(ghostGeo, ghostMat);
ghostPiece.visible = false; // 最初は隠しておく
scene.add(ghostPiece);


// --- 6. マウス操作（ホバーとクリック） ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// マウスが動いた時（ホバー処理）
window.addEventListener('pointermove', (event) => {
  if (!isGameActive || myColor !== currentTurn) {
    ghostPiece.visible = false;
    return;
  }
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(hitboxes);
  if (intersects.length > 0) {
    const { gridX, gridZ } = intersects[0].object.userData;
    const y = board[gridX][gridZ].length;
    
    if (y < 4) { // まだ置ける場所なら半透明の玉を表示
      const c = myColor === 'red' ? 0xff4444 : 0xffcc00;
      ghostPiece.material.color.setHex(c);
      ghostPiece.position.set(gridX - gridOffset, y + 0.4, gridZ - gridOffset);
      ghostPiece.visible = true;
    } else {
      ghostPiece.visible = false; // 満杯なら隠す
    }
  } else {
    ghostPiece.visible = false; // 棒から外れたら隠す
  }
});

// マウスをクリックした時
window.addEventListener('click', (event) => {
  // チャット画面をクリックした時はコマを置かないようにする
  if (event.target.closest('#chat-container')) return;
  if (!isGameActive || myColor !== currentTurn) return;

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(hitboxes);
  if (intersects.length > 0) {
    const { gridX, gridZ } = intersects[0].object.userData;
    if (board[gridX][gridZ].length < 4) {
      addPieceToBoard(gridX, gridZ, myColor, true);
    }
  }
});

// --- 7. コマを置く処理と勝利判定 ---
function addPieceToBoard(x, z, color, isLocal) {
  const y = board[x][z].length;
  board[x][z].push(color);

  // コマの生成（ツヤのある美しい玉）
  const pieceGeo = new THREE.SphereGeometry(0.4, 32, 32);
  const pieceMat = new THREE.MeshStandardMaterial({
    color: color === 'red' ? 0xff3333 : 0xffcc00,
    roughness: 0.1, // ツヤツヤにする
    metalness: 0.2  // 少し反射させる
  });
  const piece = new THREE.Mesh(pieceGeo, pieceMat);
  piece.position.set(x - gridOffset, y + 0.4, z - gridOffset);
  scene.add(piece);

  if (isLocal && roomChannel) {
    ghostPiece.visible = false; // 自分が置いたらゴーストを消す
    roomChannel.send({
      type: 'broadcast',
      event: 'place_piece',
      payload: { x, z, c: color }
    });
  }

  if (checkWin(x, y, z, color)) {
    statusText.innerText = `${color === 'red' ? '赤' : '黄'} の勝利！`;
    addChatMessage('システム', `${color === 'red' ? '赤' : '黄'} が勝利しました！`, 'white');
    isGameActive = false;
    ghostPiece.visible = false;
    return;
  }

  currentTurn = currentTurn === 'red' ? 'yellow' : 'red';
  updateStatusText();
}

function checkWin(cx, cy, cz, color) {
  const directions = [
    [1,0,0], [0,1,0], [0,0,1],
    [1,1,0], [1,-1,0], [0,1,1], [0,1,-1], [1,0,1], [1,0,-1],
    [1,1,1], [1,1,-1], [1,-1,1], [-1,1,1]
  ];

  for (const [dx, dy, dz] of directions) {
    let count = 1;
    for (let i = 1; i < 4; i++) {
      const nx = cx + dx * i, ny = cy + dy * i, nz = cz + dz * i;
      if (nx>=0 && nx<4 && ny>=0 && ny<4 && nz>=0 && nz<4 && board[nx][nz][ny] === color) count++; else break;
    }
    for (let i = 1; i < 4; i++) {
      const nx = cx - dx * i, ny = cy - dy * i, nz = cz - dz * i;
      if (nx>=0 && nx<4 && ny>=0 && ny<4 && nz>=0 && nz<4 && board[nx][nz][ny] === color) count++; else break;
    }
    if (count >= 4) return true;
  }
  return false;
}

// --- 8. アニメーションループ ---
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

import * as THREE from 'https://esm.sh/three';
import { OrbitControls } from 'https://esm.sh/three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// --- 1. Supabase の設定 ---
// ⚠️ ここに自分のURLとキーを直接書きます
const supabaseUrl = 'https://pxcimtveipluoenjiebx.supabase.co/rest/v1/';
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

// --- 3. ロビー（部屋一覧）の管理 ---
const lobbyChannel = supabase.channel('lobby');

// 誰かが部屋を作ったり消したりした時にリストを更新する
lobbyChannel.on('presence', { event: 'sync' }, () => {
  const state = lobbyChannel.presenceState();
  updateRoomList(state);
}).subscribe();

// 「部屋を作って待つ」ボタンの処理
document.getElementById('btn-create').onclick = async () => {
  const roomName = document.getElementById('new-room-input').value;
  if (!roomName) return alert('部屋の名前を入力してください！');
  
  // ロビーに「この部屋で待ってるよ」と登録する
  await lobbyChannel.track({ roomName: roomName, status: 'waiting' });
  startGame(roomName, 'red'); // 作った人は赤色
};

// 部屋一覧のボタンを画面に作る処理
function updateRoomList(state) {
  const availableRooms = new Set();
  
  // 待機中の部屋を探す
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

  // 見つかった部屋の数だけ参加ボタンを作る
  availableRooms.forEach(roomName => {
    const btn = document.createElement('button');
    btn.className = 'room-btn';
    btn.innerText = `${roomName} に参加 (後手/黄)`;
    btn.onclick = () => {
      startGame(roomName, 'yellow'); // 参加する人は黄色
    };
    roomListContainer.appendChild(btn);
  });
}

// --- 4. ゲームスタートの処理 ---
function startGame(roomId, color) {
  myColor = color;
  uiContainer.style.display = 'none';
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
      // 相手がコマを置いた時
      const { x, z, c } = payload.payload;
      addPieceToBoard(x, z, c, false);
    })
    .on('broadcast', { event: 'player_joined' }, () => {
      // (赤側のみ) 相手が参加してきたらロビーの部屋一覧から自分を消す
      if (myColor === 'red') {
        lobbyChannel.untrack();
        updateStatusText();
      }
    })
    .subscribe((status) => {
      // (黄側のみ) 部屋に入れたら「入ったよ！」と赤に知らせる
      if (status === 'SUBSCRIBED' && myColor === 'yellow') {
        roomChannel.send({ type: 'broadcast', event: 'player_joined', payload: {} });
      }
    });
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
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(8, 6, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

const baseGeo = new THREE.BoxGeometry(5, 0.5, 5);
const baseMat = new THREE.MeshStandardMaterial({ color: 0x1155aa });
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
    const pegMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
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

// --- 6. クリック操作 ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('click', (event) => {
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

  const pieceGeo = new THREE.SphereGeometry(0.4, 32, 32);
  const pieceMat = new THREE.MeshStandardMaterial({
    color: color === 'red' ? 0xff4444 : 0xffcc00,
    roughness: 0.3,
    metalness: 0.1
  });
  const piece = new THREE.Mesh(pieceGeo, pieceMat);
  
  piece.position.set(x - gridOffset, y + 0.4, z - gridOffset);
  scene.add(piece);

  if (isLocal && roomChannel) {
    roomChannel.send({
      type: 'broadcast',
      event: 'place_piece',
      payload: { x, z, c: color } // colorをcとして送信
    });
  }

  if (checkWin(x, y, z, color)) {
    statusText.innerText = `${color === 'red' ? '赤' : '黄'} の勝利！`;
    isGameActive = false;
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

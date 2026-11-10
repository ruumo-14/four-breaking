// ネット上から必要なプログラムを直接読み込む（ターミナル不要になる魔法）
import * as THREE from 'https://esm.sh/three';
import { OrbitControls } from 'https://esm.sh/three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// --- 1. Supabase の設定 ---
// ⚠️ ここに自分のURLとキーを直接書きます
const supabaseUrl = 'https://pxcimtveipluoenjiebx.supabase.co/rest/v1/';
const supabaseKey = 'sb_publishable_73t9gf0Rm47Kae9KAHfe6w_asA7g7mM';
const supabase = createClient(supabaseUrl, supabaseKey);
let roomChannel = null;

// --- 2. ゲームの状態管理 ---
let myColor = null;
let currentTurn = 'red';
let isGameActive = false;
const board = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => []));

// --- 3. UIの制御 ---
const uiContainer = document.getElementById('ui-container');
const statusText = document.getElementById('status');

document.getElementById('btn-red').onclick = () => startGame('red');
document.getElementById('btn-yellow').onclick = () => startGame('yellow');

function startGame(color) {
  const roomId = document.getElementById('room-input').value;
  myColor = color;
  uiContainer.style.display = 'none';
  updateStatusText();
  isGameActive = true;

  // Supabaseのルームに参加（友達とつながる）
  roomChannel = supabase.channel(`game-${roomId}`);
  roomChannel
    .on('broadcast', { event: 'place_piece' }, (payload) => {
      const { x, z, color } = payload.payload;
      addPieceToBoard(x, z, color, false);
    })
    .subscribe();
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

// --- 4. Three.js 3D描画セットアップ ---
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

// --- 5. クリック操作 ---
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

// --- 6. コマを置く処理と勝利判定 ---
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

  // 自分が置いた場合は相手に送信
  if (isLocal && roomChannel) {
    roomChannel.send({
      type: 'broadcast',
      event: 'place_piece',
      payload: { x, z, color }
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

// --- 7. アニメーションループ ---
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

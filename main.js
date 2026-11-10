import * as THREE from 'https://esm.sh/three';
import { OrbitControls } from 'https://esm.sh/three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

const supabaseUrl = 'https://pxcimtveipluoenjiebx.supabase.co';
const supabaseKey = 'sb_publishable_73t9gf0Rm47Kae9KAHfe6w_asA7g7mM';
const supabase = createClient(supabaseUrl, supabaseKey);

let currentRoomId = null;
let myRole = null; 
let activeGame = null;
let roomChannel = null;
let selectedGameByMe = null;
let selectedGameByOpp = null;
let gameGracePeriod = 0;

const statusText = document.getElementById('status');
const uiContainer = document.getElementById('ui-container');
const panelLobby = document.getElementById('panel-lobby');
const panelSelect = document.getElementById('panel-select');
const controlsDisplay = document.getElementById('controls-display');
const staminaContainer = document.getElementById('stamina-container');
const staminaBar = document.getElementById('stamina-bar');

const gameNames = {
  loveletter: '💌 ラブレター・デュエル',
  spelldraft: '🧙 魔導書の呪文ビルド',
  geister: '👻 ガイスター',
  mancala: '🧱 マンカラ・アリーナ',
  typing: '⌨️ タイピング・魔法大戦',
  aim: '🎯 エイム・スナイパー 3D',
  draw: '🎨 一筆お絵描き当て',
  rhythm: '🎵 リズム・ビート・クラッシュ',
  zerog: '🚀 宇宙無重力物理レース',
  defuse: '💣 心理爆弾解除',
  bk: '♟️ ブラックキングダム',
  baha: '🐉 腹ペコバハムート',
  tank: '🎖️ 3D戦車バトル',
  bl: '🚩 バトルライン',
  pen: '🐧 ペンギンパーティー',
  quoridor: '🧱 迷宮コリドール',
  hockey: '⚽ 2Dエアホッケー',
  oni: '🏃 モール鬼ごっこ',
  sumo: '🚘 3Dドタバタ相撲',
  bomb: '💥 爆弾ドッジボール'
};

function showControlsHUD(game) {
  controlsDisplay.style.display = 'block';
  if (game === 'hockey') controlsDisplay.innerHTML = `<strong>【エアホッケー】</strong><br>マウス/指ドラッグ操作！強さで速さ変化！`;
  else if (game === 'typing') controlsDisplay.innerHTML = `<strong>【タイピング】</strong><br>英単語をタイピングして攻撃！`;
  else if (game === 'aim') controlsDisplay.innerHTML = `<strong>【エイムスナイパー】</strong><br>出現するターゲットをクリック！`;
  else if (game === 'oni') controlsDisplay.innerHTML = `<strong>【鬼ごっこ】</strong><br>[W][A][S][D]: 移動, [Space]: ジャンプ, [Shift]: ダッシュ`;
  else if (game === 'tank') controlsDisplay.innerHTML = `<strong>【3D戦車】</strong><br>[W][A][S][D]: 移動, [Space]: 砲撃`;
  else if (game === 'zerog') controlsDisplay.innerHTML = `<strong>【無重力レース】</strong><br>[W]: 推進, [A][D]: 回転, [Space]: ブレーキ`;
  else if (game === 'rhythm') controlsDisplay.innerHTML = `<strong>【リズム】</strong><br>[Space]または画面タップでタイミング良くヒット！`;
  else controlsDisplay.innerHTML = `<strong>【${gameNames[game]}】</strong><br>画面内のボタンや盤面をタップ/クリック！`;
}

const keys = { up: false, down: false, left: false, right: false, action: false, jump: false, guard: false };
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = true;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = true;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = true;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = true;
  if(e.code === 'Space') { keys.action = true; keys.jump = true; handleRhythmInput(); }
  if(e.key === 'Shift') keys.guard = true;
  handleTypingKey(e.key);
});
window.addEventListener('keyup', (e) => {
  if(e.key === 'w' || e.key === 'ArrowUp') keys.up = false;
  if(e.key === 's' || e.key === 'ArrowDown') keys.down = false;
  if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = false;
  if(e.key === 'd' || e.key === 'ArrowRight') keys.right = false;
  if(e.code === 'Space') { keys.action = false; keys.jump = false; }
  if(e.key === 'Shift') keys.guard = false;
});

const lobbyChannel = supabase.channel('lobby');
let isLobbyReady = false;

lobbyChannel.on('presence', { event: 'sync' }, () => {
  const state = lobbyChannel.presenceState();
  const availableRooms = [];
  for (const key in state) state[key].forEach(u => { if (u.status === 'waiting') availableRooms.push(u); });

  const roomListContainer = document.getElementById('room-list-container');
  roomListContainer.innerHTML = '';
  if (availableRooms.length === 0) { roomListContainer.innerHTML = '<p style="font-size: 0.85rem; color: #aaa;">待機中の部屋はありません</p>'; return; }

  availableRooms.forEach(user => {
    const btn = document.createElement('button');
    btn.className = 'room-btn'; btn.innerText = `🏠 ${user.roomName} に入室`;
    btn.onclick = () => { joinRoom(user.roomName, 'guest'); };
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
    .on('broadcast', { event: 'game_signal' }, (p) => handleGameSignal(p.payload))
    .subscribe((s) => {
      if (s === 'SUBSCRIBED' && myRole === 'guest') roomChannel.send({ type: 'broadcast', event: 'joined' });
    });

  Object.keys(gameNames).forEach(g => {
    const btn = document.getElementById(`btn-select-${g}`);
    if (btn) btn.onclick = () => {
      selectedGameByMe = g;
      addChatMessage('システム', `「${gameNames[g]}」に投票しました！`, '#2ecc71');
      roomChannel.send({ type: 'broadcast', event: 'vote_game', payload: { game: g } });
      checkStartRoulette();
    };
  });
}

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
    if (count > 12) {
      clearInterval(interval);
      rouletteText.innerText = `✨ 【${gameNames[winGame]}】が選ばれました！ ✨`;
      setTimeout(() => {
        overlay.style.display = 'none';
        selectedGameByMe = null; selectedGameByOpp = null;
        launchGame(winGame);
      }, 1500);
    }
  }, 100);
}

function returnToSelect() {
  activeGame = null;
  oniIsActive = false; sumoIsActive = false; bombIsActive = false; hockeyIsActive = false;
  
  document.getElementById('app').style.display = 'none';
  canvas2D.style.display = 'none';
  document.getElementById('controls').style.display = 'none';
  controlsDisplay.style.display = 'none';
  staminaContainer.style.display = 'none';
  statusText.innerText = '';
  
  uiContainer.style.display = 'flex';
  panelSelect.style.display = 'block';
}

function sendSignal(type, data = {}) {
  if (roomChannel) roomChannel.send({ type: 'broadcast', event: 'game_signal', payload: { type, role: myRole, data } });
}

function launchGame(game) {
  gameGracePeriod = 60;
  activeGame = game;
  uiContainer.style.display = 'none';
  initGameLogic(game);
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
// ゲームエンジン・各ゲームの状態定義
// ==========================================
let gameState = {};
let aimTargetMesh, zerogShipMesh;

function initGameLogic(game) {
  switchUI(['oni','sumo','bomb','tank','zerog','aim'].includes(game), ['oni','sumo','bomb','tank','zerog'].includes(game));
  statusText.innerText = `✨ ${gameNames[game]} スタート！`;
  statusText.style.color = "#f1c40f";

  if (game === 'loveletter') {
    gameState = { myCard: Math.floor(Math.random()*8)+1, oppCard: null, turn: 'host', winScore: 0 };
  } else if (game === 'spelldraft') {
    gameState = { myHp: 30, oppHp: 30, myMana: 3, cards: [1, 2, 3, 4, 5] };
  } else if (game === 'geister') {
    gameState = { board: Array(6).fill(0).map(() => Array(6).fill(null)), selected: null };
    gameState.board[0][1] = {color: 'red'}; gameState.board[0][2] = {color: 'blue'};
    gameState.board[5][1] = {color: 'blue'}; gameState.board[5][2] = {color: 'red'};
  } else if (game === 'mancala') {
    gameState = { pits: [4,4,4,4,4,4, 0, 4,4,4,4,4,4, 0], turn: 'host' };
  } else if (game === 'typing') {
    gameState = { words: ['APPLE','CYPRUS','CANVAS','FUTURE','ROBOT'], index: 0, typed: '', myScore: 0, oppScore: 0 };
  } else if (game === 'aim') {
    init3DAim();
  } else if (game === 'draw') {
    gameState = { paths: [], currentPath: [] };
  } else if (game === 'rhythm') {
    gameState = { notes: [100, 200, 300, 400, 500], score: 0 };
  } else if (game === 'zerog') {
    init3DZeroG();
  } else if (game === 'defuse') {
    gameState = { code: [Math.floor(Math.random()*9)+1, Math.floor(Math.random()*9)+1, Math.floor(Math.random()*9)+1], input: [] };
  } else if (game === 'bk') {
    gameState = { board: Array(5).fill(0).map(() => Array(5).fill(0)), p1: {x:2, y:4}, p2: {x:2, y:0} };
    gameState.board[4][2] = 1; gameState.board[0][2] = 2;
  } else if (game === 'baha') {
    gameState = { myHp: 10, oppHp: 10, food: 3 };
  } else if (game === 'tank') {
    init3DTank();
  } else if (game === 'bl') {
    gameState = { flags: [0, 0, 0], myPower: [0, 0, 0], oppPower: [0, 0, 0] };
  } else if (game === 'pen') {
    gameState = { level: 1, penguins: [1, 2, 3, 4] };
  } else if (game === 'quoridor') {
    gameState = { p1: {x:4, y:0}, p2: {x:4, y:8} };
  } else if (game === 'hockey') {
    startHockeyGame();
  } else if (game === 'oni') {
    startOnigokko();
  } else if (game === 'sumo') {
    startSumo();
  } else if (game === 'bomb') {
    startBombGame();
  }
}

function handleGameSignal(payload) {
  const { type, role, data } = payload;
  if (role === myRole) return;
  if (type === 'type_score') gameState.oppScore = data.score;
  if (type === 'draw_path') gameState.paths.push(data.path);
  if (type === 'll_play') {
    gameState.oppCard = data.card;
    if (gameState.myCard > gameState.oppCard) {
      statusText.innerText = "👑 あなたの勝ち！";
    } else {
      statusText.innerText = "💀 相手の勝ち！";
    }
  }
}

function handleTypingKey(key) {
  if (activeGame !== 'typing') return;
  const target = gameState.words[gameState.index];
  if (!target) return;
  if (key.toUpperCase() === target[gameState.typed.length]) {
    gameState.typed += key.toUpperCase();
    if (gameState.typed === target) {
      gameState.myScore += 10;
      gameState.index++;
      gameState.typed = '';
      sendSignal('type_score', { score: gameState.myScore });
      if (gameState.index >= gameState.words.length) {
        statusText.innerText = "👑 タイピングマスター！勝利！";
      }
    }
  }
}

function handleRhythmInput() {
  if (activeGame !== 'rhythm') return;
  if (gameState.notes.length > 0) {
    const front = gameState.notes[0];
    if (Math.abs(front - 450) < 50) {
      gameState.score += 100;
      gameState.notes.shift();
      statusText.innerText = `PERFECT!! スコア: ${gameState.score}`;
    }
  }
}

// 2D キャンバスクリックイベントによる操作・ゲーム機能実装
window.addEventListener('pointerdown', (e) => {
  if (!activeGame || ['oni','sumo','bomb','tank','zerog','hockey'].includes(activeGame)) return;
  const rect = canvas2D.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas2D.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas2D.height / rect.height);

  if (activeGame === 'loveletter') {
    if (py > 300) {
      sendSignal('ll_play', { card: gameState.myCard });
      statusText.innerText = "相手のカードと勝負中...";
    }
  } else if (activeGame === 'spelldraft') {
    if (py > 350) {
      gameState.oppHp -= 5;
      statusText.innerText = `呪文攻撃！ 相手HP: ${gameState.oppHp}`;
      if (gameState.oppHp <= 0) statusText.innerText = "👑 勝者！魔法対戦勝利！";
    }
  } else if (activeGame === 'mancala') {
    const pitIdx = Math.floor((px - 100) / 80);
    if (pitIdx >= 0 && pitIdx < 6 && gameState.pits[pitIdx] > 0) {
      const stones = gameState.pits[pitIdx];
      gameState.pits[pitIdx] = 0;
      gameState.pits[pitIdx + 1] += stones;
      statusText.innerText = "石を移動しました！";
    }
  } else if (activeGame === 'defuse') {
    const num = Math.floor(px / 260) + 1;
    gameState.input.push(num);
    if (gameState.input.length === gameState.code.length) {
      if (gameState.input.join('') === gameState.code.join('')) {
        statusText.innerText = "👑 爆弾解除成功！！";
      } else {
        statusText.innerText = "💥 解除失敗！爆発！";
        gameState.input = [];
      }
    }
  } else if (activeGame === 'baha') {
    if (px < 400) {
      gameState.myHp += 2; statusText.innerText = "りんごを食べた！HP回復！";
    } else {
      gameState.oppHp -= 3; statusText.innerText = "バハムート攻撃！";
    }
  } else if (activeGame === 'bl') {
    const flagIdx = Math.floor((px - 150) / 180);
    if (flagIdx >= 0 && flagIdx < 3) {
      gameState.myPower[flagIdx] += Math.floor(Math.random()*10)+1;
      statusText.innerText = `拠点 ${flagIdx+1} に戦力を追加！`;
    }
  } else if (activeGame === 'quoridor') {
    const gx = Math.floor((px - 180) / 48);
    const gy = Math.floor((py - 80) / 48);
    if (gx >= 0 && gx < 9 && gy >= 0 && gy < 9) {
      gameState.p1 = { x: gx, y: gy };
      if (gy === 8) statusText.innerText = "👑 ゴール！勝利！";
    }
  }
});

// 3D 構築
function init3DTank() {
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x34495e);
  currentCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(0, 20, 20); currentCamera.lookAt(0, 0, 0);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 30), new THREE.MeshStandardMaterial({ color: 0x7f8c8d }));
  floor.position.y = -0.5; currentScene.add(floor);
}

function init3DZeroG() {
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x050510);
  currentCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(0, 15, 25); currentCamera.lookAt(0, 0, 0);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.9));
  zerogShipMesh = new THREE.Mesh(new THREE.ConeGeometry(1, 3, 4), new THREE.MeshStandardMaterial({ color: 0x00ffcc }));
  zerogShipMesh.rotation.x = Math.PI / 2; currentScene.add(zerogShipMesh);
}

function init3DAim() {
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x111122);
  currentCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(0, 0, 10);
  const light = new THREE.PointLight(0xffffff, 1, 100); light.position.set(0, 0, 10); currentScene.add(light);
  
  aimTargetMesh = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial({ color: 0xe74c3c }));
  aimTargetMesh.position.set((Math.random()-0.5)*8, (Math.random()-0.5)*6, 0);
  currentScene.add(aimTargetMesh);
}

window.addEventListener('pointerdown', (e) => {
  if (activeGame === 'aim' && aimTargetMesh) {
    aimTargetMesh.position.set((Math.random()-0.5)*8, (Math.random()-0.5)*6, 0);
    statusText.innerText = "🎯 ターゲット命中のため再配置！";
  }
});

// エアホッケー＆鬼ごっこ等
let hockeyIsActive = false, hockeyP1Pos = { x: 50, y: 300, vx: 0, vy: 0 }, hockeyP2Pos = { x: 750, y: 300, vx: 0, vy: 0 }, hockeyBall = { x: 400, y: 300, vx: 5, vy: 3 }, hockeyScore = { p1: 0, p2: 0 }, lastPointerPos = { x: 0, y: 0, t: Date.now() };

function startHockeyGame() { hockeyIsActive = true; switchUI(false, false); resetHockeyBall(); }
function resetHockeyBall() { hockeyBall = { x: 400, y: 300, vx: (Math.random()>0.5?5:-5), vy: (Math.random()*4-2) }; }

window.addEventListener('pointermove', (e) => {
  if (activeGame === 'draw' && e.buttons === 1) {
    const rect = canvas2D.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas2D.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas2D.height / rect.height);
    gameState.currentPath.push({x: px, y: py});
  }
  if (activeGame !== 'hockey' || !hockeyIsActive) return;
  const rect = canvas2D.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas2D.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas2D.height / rect.height);

  const now = Date.now();
  const dt = Math.max(1, now - lastPointerPos.t);
  const vx = (px - lastPointerPos.x) / dt * 15;
  const vy = (py - lastPointerPos.t) / dt * 15;

  if (myRole === 'host') {
    hockeyP1Pos.x = Math.max(30, Math.min(380, px)); hockeyP1Pos.y = Math.max(30, Math.min(570, py));
    hockeyP1Pos.vx = vx; hockeyP1Pos.vy = vy;
  } else {
    hockeyP2Pos.x = Math.max(420, Math.min(770, px)); hockeyP2Pos.y = Math.max(30, Math.min(570, py));
    hockeyP2Pos.vx = vx; hockeyP2Pos.vy = vy;
  }
  lastPointerPos = { x: px, y: py, t: now };
});

window.addEventListener('pointerup', () => {
  if (activeGame === 'draw' && gameState.currentPath.length > 0) {
    gameState.paths.push(gameState.currentPath);
    sendSignal('draw_path', { path: gameState.currentPath });
    gameState.currentPath = [];
  }
});

let oniIsActive = false, oniTimeLeft = 40, oniTimerInterval = null, oniMyState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, stamina: 100, isGrounded: true }, oniOppState = { x: 999, y: 999, z: 999, rot: 0 }, oniPlayerMesh, oniOppMesh, oniCamContainer;
function startOnigokko() {
  activeGame = 'oni'; oniIsActive = true; oniTimeLeft = 40; switchUI(true, true);
  staminaContainer.style.display = 'block';
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x34495e);
  oniCamContainer = new THREE.Group(); currentScene.add(oniCamContainer);
  currentCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  currentCamera.position.set(0, 12, 14); currentCamera.lookAt(0, 0, 0); oniCamContainer.add(currentCamera);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 60), new THREE.MeshStandardMaterial({ color: 0xecf0f1 })); floor.position.y = -0.5; currentScene.add(floor);
  oniPlayerMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: myRole==='host'?0xe74c3c:0x2980b9 }));
  oniOppMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: myRole==='host'?0x2980b9:0xe74c3c }));
  currentScene.add(oniPlayerMesh, oniOppMesh);
  oniMyState.x = myRole === 'host' ? -20 : 20; oniMyState.z = myRole === 'host' ? -20 : 20; oniMyState.y = 0;
}

let sumoIsActive = false, p1Mesh, p2Mesh, sumoArena, sumoMyState = { x: 0, z: 0, rot: 0, vx: 0, vz: 0 }, sumoOppState = { x: 0, z: 0, rot: 0 };
function startSumo() {
  activeGame = 'sumo'; sumoIsActive = true; switchUI(true, true);
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x87CEEB);
  currentCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100); currentCamera.position.set(0, 25, 30); currentCamera.lookAt(0, 0, 0);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.8));
  sumoArena = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1, 64), new THREE.MeshStandardMaterial({ color: 0x34495e })); sumoArena.position.y = -0.5; currentScene.add(sumoArena);
  p1Mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: 0xe74c3c })); p2Mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.5), new THREE.MeshStandardMaterial({ color: 0x3498db })); currentScene.add(p1Mesh, p2Mesh);
  sumoMyState.x = 0; sumoMyState.z = myRole === 'host' ? 8 : -8;
}

let bombIsActive = false, bombHolder = 'host', bombTimer = 30, bombMyState = { x: 0, z: 0 }, bombOppState = { x: 999, z: 999 }, bPlayerMesh, bOppMesh, bBombMesh;
function startBombGame() {
  activeGame = 'bomb'; bombIsActive = true; bombHolder = 'host'; bombTimer = 30; switchUI(true, true);
  currentScene = new THREE.Scene(); currentScene.background = new THREE.Color(0x111111);
  currentCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100); currentCamera.position.set(0, 20, 20); currentCamera.lookAt(0, 0, 0);
  currentScene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 30), new THREE.MeshStandardMaterial({ color: 0x444444 })); floor.position.y = -0.5; currentScene.add(floor);
  bPlayerMesh = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial({ color: myRole==='host'?0xe74c3c:0x3498db }));
  bOppMesh = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshStandardMaterial({ color: myRole==='host'?0x3498db:0xe74c3c }));
  bBombMesh = new THREE.Mesh(new THREE.SphereGeometry(0.6), new THREE.MeshStandardMaterial({ color: 0xf1c40f }));
  currentScene.add(bPlayerMesh, bOppMesh, bBombMesh);
  bombMyState.x = myRole === 'host' ? -8 : 8; bombMyState.z = 0;
}

// 2D 共通描画＆ゲームレンダラー
function renderCustom2DGame() {
  ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);
  ctx2D.fillStyle = '#2c3e50'; ctx2D.fillRect(0, 0, canvas2D.width, canvas2D.height);

  if (activeGame === 'loveletter') {
    ctx2D.fillStyle = '#e74c3c'; ctx2D.fillRect(300, 200, 200, 280);
    ctx2D.fillStyle = 'white'; ctx2D.font = 'bold 36px Arial'; ctx2D.textAlign = 'center';
    ctx2D.fillText(`Card: ${gameState.myCard}`, 400, 340);
    ctx2D.font = '20px Arial'; ctx2D.fillText('カードをタップして提出！', 400, 520);
  } else if (activeGame === 'spelldraft') {
    ctx2D.fillStyle = '#8e44ad'; ctx2D.font = 'bold 24px Arial'; ctx2D.textAlign = 'center';
    ctx2D.fillText(`あなた HP: ${gameState.myHp} VS 相手 HP: ${gameState.oppHp}`, 400, 80);
    gameState.cards.forEach((c, i) => {
      ctx2D.fillStyle = '#3498db'; ctx2D.fillRect(100 + i * 120, 380, 100, 140);
      ctx2D.fillStyle = 'white'; ctx2D.font = 'bold 18px Arial'; ctx2D.fillText(`呪文 ${c}`, 150 + i * 120, 450);
    });
  } else if (activeGame === 'geister') {
    for (let r=0; r<6; r++) {
      for (let c=0; c<6; c++) {
        ctx2D.strokeStyle = 'white'; ctx2D.strokeRect(200 + c*65, 80 + r*65, 65, 65);
        const cell = gameState.board[r][c];
        if (cell) {
          ctx2D.fillStyle = cell.color; ctx2D.beginPath(); ctx2D.arc(232 + c*65, 112 + r*65, 20, 0, Math.PI*2); ctx2D.fill();
        }
      }
    }
  } else if (activeGame === 'mancala') {
    ctx2D.fillStyle = '#d35400'; ctx2D.fillRect(80, 150, 640, 280);
    gameState.pits.slice(0, 14).forEach((p, i) => {
      const px = 140 + (i % 7) * 80, py = i < 7 ? 330 : 230;
      ctx2D.fillStyle = '#f39c12'; ctx2D.beginPath(); ctx2D.arc(px, py, 30, 0, Math.PI*2); ctx2D.fill();
      ctx2D.fillStyle = 'black'; ctx2D.font = 'bold 22px Arial'; ctx2D.textAlign = 'center'; ctx2D.fillText(p, px, py+7);
    });
  } else if (activeGame === 'typing') {
    ctx2D.fillStyle = '#f1c40f'; ctx2D.font = 'bold 45px Arial'; ctx2D.textAlign = 'center';
    ctx2D.fillText(gameState.words[gameState.index] || 'CLEAR!', 400, 230);
    ctx2D.fillStyle = '#2ecc71'; ctx2D.fillText(gameState.typed, 400, 330);
    ctx2D.fillStyle = 'white'; ctx2D.font = '22px Arial';
    ctx2D.fillText(`Score: ${gameState.myScore} | Opponent: ${gameState.oppScore || 0}`, 400, 100);
  } else if (activeGame === 'draw') {
    ctx2D.strokeStyle = '#e74c3c'; ctx2D.lineWidth = 4;
    [...gameState.paths, gameState.currentPath].forEach(path => {
      if (!path || path.length < 2) return;
      ctx2D.beginPath(); ctx2D.moveTo(path[0].x, path[0].y);
      for(let i=1; i<path.length; i++) ctx2D.lineTo(path[i].x, path[i].y);
      ctx2D.stroke();
    });
  } else if (activeGame === 'rhythm') {
    ctx2D.strokeStyle = 'white'; ctx2D.lineWidth = 3; ctx2D.strokeRect(300, 430, 200, 40);
    if (Math.random() < 0.03) gameState.notes.push(50);
    gameState.notes.forEach((n, idx) => {
      gameState.notes[idx] += 3;
      ctx2D.fillStyle = '#e74c3c'; ctx2D.fillRect(380, n, 40, 15);
    });
  } else if (activeGame === 'defuse') {
    ctx2D.fillStyle = '#e74c3c'; ctx2D.font = 'bold 50px Arial'; ctx2D.textAlign = 'center';
    ctx2D.fillText(`CODE: ${gameState.code.join(' ')}`, 400, 220);
    ctx2D.fillStyle = '#f1c40f'; ctx2D.fillText(`INPUT: ${gameState.input.join(' ')}`, 400, 320);
  } else if (activeGame === 'bk') {
    for (let r=0; r<5; r++) {
      for (let c=0; c<5; c++) {
        ctx2D.strokeStyle = 'white'; ctx2D.strokeRect(220 + c*70, 100 + r*70, 70, 70);
      }
    }
    ctx2D.fillStyle = '#e74c3c'; ctx2D.beginPath(); ctx2D.arc(255 + gameState.p1.x*70, 135 + gameState.p1.y*70, 25, 0, Math.PI*2); ctx2D.fill();
    ctx2D.fillStyle = '#3498db'; ctx2D.beginPath(); ctx2D.arc(255 + gameState.p2.x*70, 135 + gameState.p2.y*70, 25, 0, Math.PI*2); ctx2D.fill();
  } else if (activeGame === 'baha') {
    ctx2D.fillStyle = '#e74c3c'; ctx2D.font = 'bold 30px Arial'; ctx2D.textAlign = 'center';
    ctx2D.fillText(`あなた HP: ${gameState.myHp} VS 相手 HP: ${gameState.oppHp}`, 400, 150);
    ctx2D.fillStyle = '#2ecc71'; ctx2D.fillRect(150, 320, 200, 100); ctx2D.fillStyle = 'white'; ctx2D.fillText('🍎 回復', 250, 380);
    ctx2D.fillStyle = '#e67e22'; ctx2D.fillRect(450, 320, 200, 100); ctx2D.fillStyle = 'white'; ctx2D.fillText('🔥 攻撃', 550, 380);
  } else if (activeGame === 'bl') {
    for(let i=0; i<3; i++) {
      ctx2D.fillStyle = '#f1c40f'; ctx2D.fillRect(150 + i*200, 220, 120, 120);
      ctx2D.fillStyle = 'black'; ctx2D.font = 'bold 20px Arial'; ctx2D.textAlign = 'center';
      ctx2D.fillText(`拠点 ${i+1}`, 210 + i*200, 270);
      ctx2D.fillText(`P1: ${gameState.myPower[i]}`, 210 + i*200, 310);
    }
  } else if (activeGame === 'quoridor') {
    for (let r=0; r<9; r++) {
      for (let c=0; c<9; c++) {
        ctx2D.strokeStyle = '#7f8c8d'; ctx2D.strokeRect(180 + c*48, 60 + r*48, 44, 44);
      }
    }
    ctx2D.fillStyle = '#e74c3c'; ctx2D.beginPath(); ctx2D.arc(202 + gameState.p1.x*48, 82 + gameState.p1.y*48, 16, 0, Math.PI*2); ctx2D.fill();
    ctx2D.fillStyle = '#3498db'; ctx2D.beginPath(); ctx2D.arc(202 + gameState.p2.x*48, 82 + gameState.p2.y*48, 16, 0, Math.PI*2); ctx2D.fill();
  }
}

function updateGameLogic() {
  if (gameGracePeriod > 0) gameGracePeriod--;

  if (activeGame === 'hockey' && hockeyIsActive) {
    if (myRole === 'host') {
      hockeyBall.x += hockeyBall.vx; hockeyBall.y += hockeyBall.vy;
      if (hockeyBall.y < 20 || hockeyBall.y > 580) hockeyBall.vy *= -1;

      const dist1 = Math.hypot(hockeyBall.x - hockeyP1Pos.x, hockeyBall.y - hockeyP1Pos.y);
      if (dist1 < 35) {
        const hitPower = Math.hypot(hockeyP1Pos.vx, hockeyP1Pos.vy);
        const speed = Math.max(7, Math.min(22, hitPower + 5));
        const angle = Math.atan2(hockeyBall.y - hockeyP1Pos.y, hockeyBall.x - hockeyP1Pos.x);
        hockeyBall.vx = Math.cos(angle) * speed; hockeyBall.vy = Math.sin(angle) * speed;
      }

      const dist2 = Math.hypot(hockeyBall.x - hockeyP2Pos.x, hockeyBall.y - hockeyP2Pos.y);
      if (dist2 < 35) {
        const hitPower = Math.hypot(hockeyP2Pos.vx, hockeyP2Pos.vy);
        const speed = Math.max(7, Math.min(22, hitPower + 5));
        const angle = Math.atan2(hockeyBall.y - hockeyP2Pos.y, hockeyBall.x - hockeyP2Pos.x);
        hockeyBall.vx = Math.cos(angle) * speed; hockeyBall.vy = Math.sin(angle) * speed;
      }

      if (hockeyBall.x < 0) { hockeyScore.p2++; resetHockeyBall(); }
      if (hockeyBall.x > 800) { hockeyScore.p1++; resetHockeyBall(); }
      roomChannel.send({ type: 'broadcast', event: 'hockey_sync', payload: { p1Pos: hockeyP1Pos, ball: hockeyBall, score: hockeyScore } });
    } else {
      roomChannel.send({ type: 'broadcast', event: 'hockey_sync', payload: { p2Pos: hockeyP2Pos } });
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (!document.hidden) updateGameLogic();

  if (activeGame === 'hockey' && hockeyIsActive) {
    ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);
    ctx2D.fillStyle = '#1e272e'; ctx2D.fillRect(0, 0, canvas2D.width, canvas2D.height);
    ctx2D.strokeStyle = 'rgba(255,255,255,0.2)'; ctx2D.lineWidth = 4;
    ctx2D.beginPath(); ctx2D.moveTo(400, 0); ctx2D.lineTo(400, 600); ctx2D.stroke();
    ctx2D.fillStyle = 'white'; ctx2D.font = 'bold 36px Arial'; ctx2D.textAlign = 'center';
    ctx2D.fillText(`${hockeyScore.p1} - ${hockeyScore.p2}`, 400, 50);
    ctx2D.fillStyle = '#e74c3c'; ctx2D.beginPath(); ctx2D.arc(hockeyP1Pos.x, hockeyP1Pos.y, 25, 0, Math.PI*2); ctx2D.fill();
    ctx2D.fillStyle = '#3498db'; ctx2D.beginPath(); ctx2D.arc(hockeyP2Pos.x, hockeyP2Pos.y, 25, 0, Math.PI*2); ctx2D.fill();
    ctx2D.fillStyle = '#f1c40f'; ctx2D.beginPath(); ctx2D.arc(hockeyBall.x, hockeyBall.y, 14, 0, Math.PI*2); ctx2D.fill();
  } else if (['oni','sumo','bomb','tank','zerog','aim'].includes(activeGame)) {
    if (currentScene) renderer.render(currentScene, currentCamera);
  } else if (activeGame) {
    renderCustom2DGame();
  }
}

animate();

window.addEventListener('resize', () => {
  if (currentCamera) { currentCamera.aspect = window.innerWidth / window.innerHeight; currentCamera.updateProjectionMatrix(); }
  renderer.setSize(window.innerWidth, window.innerHeight);
});

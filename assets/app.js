let db, ref, get, onValue, runTransaction;
let firebaseReady = false;
let connected = false;
let busy = false;
let movePending = false;
let aiTimer = null;
let tutorialStep = -1;
let currentBattleState = null;

function connectionStatus(message){
  document.getElementById("connectionStatus").textContent = message;
}
function reportError(error){
  const code = String(error.code || error.message || "unknown");
  const message = /permission|denied/i.test(code) ? "Database Rules에서 GCrown 접근이 거부되었습니다." :
    /api-key/i.test(code) ? "Firebase API Key를 확인해주세요." :
    /auth/i.test(code) ? "Firebase 인증 설정을 확인해주세요." :
    `연결 오류: ${code}`;
  connectionStatus(message);
  toast(message);
}
function requireOnline(){
  if(!firebaseReady || !connected){ toast("Battle 연결이 준비되지 않았습니다. 위 연결 상태를 확인해주세요."); return false; }
  return true;
}
async function initFirebase(){
  try {
    const [appSdk, sdk] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js")
    ]);
    ({ref, get, onValue, runTransaction} = sdk);
    db = sdk.getDatabase(appSdk.initializeApp(firebaseConfig));
    firebaseReady = true;
    onValue(ref(db, ".info/connected"), snap=>{
      connected = snap.val() === true;
      connectionStatus(connected ? "🟢 Firebase 연결됨" : "🔄 Firebase 재연결 중… · Solo는 계속 사용할 수 있습니다.");
    }, reportError);
    let session;
    try { session = JSON.parse(sessionStorage.getItem("gcrownSession") || "null"); } catch {}
    if(session && /^\d{4}$/.test(session.code) && session.playerId){
      const snap = await readRoom(ref(db, `gcrown/rooms/${session.code}`));
      const room = snap.val();
      if(room?.players?.[session.playerId] && !room.players[session.playerId].left){
        mode = "battle"; roomCode = session.code; localPlayerId = session.playerId;
        isHost = room.host === localPlayerId; listenRoom();
      }else{ sessionStorage.removeItem("gcrownSession"); }
    }
  } catch(error){ reportError(error); }
}
function readRoom(roomRef){
  return new Promise((resolve,reject)=>onValue(roomRef,resolve,reject,{onlyOnce:true}));
}
function saveSession(){
  try { sessionStorage.setItem("gcrownSession", JSON.stringify({code:roomCode,playerId:localPlayerId})); } catch {}
}

/* =========================
   FIREBASE
========================= */

const firebaseConfig = {
  apiKey: "AIzaSyBreTSe1m0-xlbF4aupnU5isRZCihR25IE",
  authDomain: "formwheel.firebaseapp.com",
  databaseURL: "https://formwheel-default-rtdb.firebaseio.com",
  projectId: "formwheel",
  storageBucket: "formwheel.firebasestorage.app",
  messagingSenderId: "431583088241",
  appId: "1:431583088241:web:74e0e34ea1e3e1170c55d0",
  measurementId: "G-T372YXDF8D"
};




/* =========================
   CONSTANTS
========================= */

const DEFAULT_SETTINGS = {boardSize:5,maxActions:30,bonus:true,trap:true,teleport:true,defense:true,aiDifficulty:"normal"};
const SIZE = 5;
const MAX_ACTIONS_PER_PLAYER = 30;

const COLORS = [
  "🔵",
  "🔴",
  "🟢",
  "🟣"
];

const TILE_TYPES = {
  normal:"normal",
  bonus:"bonus",
  defense:"defense",
  teleport:"teleport",
  trap:"trap"
};


/* =========================
   STATE
========================= */

let mode = null;
let roomCode = null;
let roomListener = null;

let localPlayerId = null;
let isHost = false;

let soloState = null;
let soloGameMode = "score";
let battleGameMode = "score";
let lastCrownSnapshot = null;

function normalizeSettings(settings={}){
  return {
    boardSize:Math.min(7,Math.max(5,Number(settings.boardSize)||5)),
    maxActions:Math.min(100,Math.max(10,Number(settings.maxActions)||30)),
    bonus:settings.bonus!==false,
    trap:settings.trap!==false,
    teleport:settings.teleport!==false,
    defense:settings.defense!==false,
    aiDifficulty:["easy","normal","hard"].includes(settings.aiDifficulty)?settings.aiDifficulty:"normal"
  };
}
function getSettings(state){ return normalizeSettings(state && state.settings); }



/* =========================
   SCREEN
========================= */

function showScreen(id){

  document.querySelectorAll(".screen")
    .forEach(el => el.classList.remove("active"));

  document.getElementById(id)
    .classList.add("active");
}

window.showSoloSetup = () => {
  showScreen("soloSetupScreen");
};

window.showBattleSetup = () => {
  showScreen("battleSetupScreen");
};

window.backMenu = () => {
  if(mode === "battle"){ window.leaveRoom(); return; }
  cleanupRoom();
  soloState = null;
  showScreen("menuScreen");
};

function cleanupRoom(){
  clearTimeout(aiTimer);
  tutorialStep = -1;
  document.getElementById("tutorialBar").hidden=true;
  document.querySelectorAll(".tutorialTarget").forEach(el=>el.classList.remove("tutorialTarget"));
  mode = null;
  currentBattleState = null;
  try { sessionStorage.removeItem("gcrownSession"); } catch {}

  if(roomListener){
    roomListener();
    roomListener = null;
  }

  roomCode = null;
  localPlayerId = null;
  lastCrownSnapshot = null;
  isHost = false;
}


/* =========================
   TOAST
========================= */

function toast(message){

  const el = document.getElementById("toast");

  el.textContent = message;
  el.classList.add("show");

  setTimeout(()=>{
    el.classList.remove("show");
  },1800);
}


/* =========================
   BOARD
========================= */

function specialTilesFor(size){
  const c=size-1, m=Math.floor(c/2);
  const map={};
  map[`${m},0`]='bonus'; map[`0,${m}`]='defense';
  map[`${m},${c}`]='bonus'; map[`1,${Math.max(1,m-1)}`]='trap';
  map[`${Math.max(1,c-1)},${Math.min(c-1,m+1)}`]='trap';
  map[`0,${c}`]='teleport'; map[`${c},0`]='teleport';
  map[`0,${Math.min(c,Math.max(1,m+1))}`]='defense';
  return map;
}
function getTile(x,y,settings){
  const cfg=normalizeSettings(settings);
  const type=specialTilesFor(cfg.boardSize)[`${x},${y}`] || "normal";
  if(type==='bonus' && !cfg.bonus) return 'normal';
  if(type==='trap' && !cfg.trap) return 'normal';
  if(type==='teleport' && !cfg.teleport) return 'normal';
  if(type==='defense' && !cfg.defense) return 'normal';
  return type;
}
function tileEmoji(type){
  if(type==="bonus") return "💰";
  if(type==="defense") return "🛡️";
  if(type==="teleport") return "🌀";
  if(type==="trap") return "🕳️";
  return "";
}


/* =========================
   RANDOM POSITIONS
========================= */

function startingPositions(count,size=5){
  const c=Number(size)-1;
  return [{x:0,y:0},{x:c,y:c},{x:c,y:0},{x:0,y:c}].slice(0,count);
}


/* =========================
   SOLO
========================= */

window.selectSoloMode = (modeValue) => {
  soloGameMode = modeValue === "steal" ? "steal" : "score";
  document.getElementById("soloScoreMode").classList.toggle("selected", soloGameMode === "score");
  document.getElementById("soloStealMode").classList.toggle("selected", soloGameMode === "steal");
};

window.selectBattleMode = (modeValue) => {
  battleGameMode = modeValue === "steal" ? "steal" : "score";
  document.getElementById("battleScoreMode").classList.toggle("selected", battleGameMode === "score");
  document.getElementById("battleStealMode").classList.toggle("selected", battleGameMode === "steal");
};

function readSoloSettings(){return normalizeSettings({boardSize:document.getElementById("soloBoardSize").value,maxActions:document.getElementById("soloMaxActions").value,bonus:document.getElementById("soloBonus").checked,trap:document.getElementById("soloTrap").checked,teleport:document.getElementById("soloTeleport").checked,defense:document.getElementById("soloDefense").checked,aiDifficulty:document.getElementById("soloAiDifficulty").value});}
function readBattleSettings(){return normalizeSettings({boardSize:document.getElementById("battleBoardSize").value,maxActions:document.getElementById("battleMaxActions").value,bonus:document.getElementById("battleBonus").checked,trap:document.getElementById("battleTrap").checked,teleport:document.getElementById("battleTeleport").checked,defense:document.getElementById("battleDefense").checked,aiDifficulty:"normal"});}

window.startSolo = () => {

  let name =
    document.getElementById("soloName").value.trim();

  if(!name){
    name = "Player";
  }

  cleanupRoom();
  mode = "solo";
  lastCrownSnapshot = null;

  const settings = readSoloSettings();
  const positions = startingPositions(4,settings.boardSize);

  soloState = {

    started:true,

    turn:0,

    maxActions:settings.maxActions,
    settings,
    gameMode:soloGameMode,

    currentPlayer:0,

    crownHolder:null,

    crownX:Math.floor((settings.boardSize-1)/2),
    crownY:Math.floor((settings.boardSize-1)/2),

    players:[

      {
        id:"p0",
        name:name,
        x:positions[0].x,
        y:positions[0].y,
        score:0,
        actions:0,
        shield:false,
        alive:true
      },

      {
        id:"p1",
        name:"AI Red",
        x:positions[1].x,
        y:positions[1].y,
        score:0,
        actions:0,
        shield:false,
        alive:true
      },

      {
        id:"p2",
        name:"AI Green",
        x:positions[2].x,
        y:positions[2].y,
        score:0,
        actions:0,
        shield:false,
        alive:true
      },

      {
        id:"p3",
        name:"AI Purple",
        x:positions[3].x,
        y:positions[3].y,
        score:0,
        actions:0,
        shield:false,
        alive:true
      }

    ]

  };

  showScreen("gameScreen");
  renderGame(soloState);
};


/* =========================
   SOLO MOVE
========================= */

window.movePlayer = async (dx,dy) => {

  if(mode==="solo"){
    soloMove(dx,dy);
    return;
  }

  if(mode==="battle"){
    return battleMove(dx,dy);
  }

};


/* =========================
   SOLO TURN
========================= */

function soloMove(dx,dy){

  const state = soloState;
  if(!state || isGameFinished(state)) return;
  const player = state.players[0];

  if(state.currentPlayer!==0){
    toast("AI의 턴입니다.");
    return;
  }

  if(!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx)+Math.abs(dy)!==1){
    toast("한 칸을 선택하세요.");
    return;
  }

  const nx = player.x + dx;
  const ny = player.y + dy;

  if(!inside(nx,ny,state.settings.boardSize)){
    toast("이동할 수 없습니다.");
    return;
  }

  if(isOccupiedByOther(state.players,0,nx,ny)){
    toast("다른 플레이어가 있습니다.");
    return;
  }

  player.x = nx;
  player.y = ny;

  applyTileEffect(state,player);

  checkCrown(state,player);

  finishTurn(state);

  if(tutorialStep >= 0){ state.currentPlayer=0; renderGame(state); showTutorialHint(true); return; }
  renderGame(state);

  if(!isGameFinished(state)){

    aiTimer = setTimeout(aiTurn,450);

  }else{

    finishGame(state);

  }

}


/* =========================
   AI
========================= */

function legalMoves(state,index){
  const p=state.players[index];
  return [[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>
    inside(p.x+dx,p.y+dy,getSettings(state).boardSize) &&
    !isOccupiedByOther(state.players,index,p.x+dx,p.y+dy));
}
function chooseAiMove(state,index){
  const ai=state.players[index], options=legalMoves(state,index);
  if(!options.length) return null;
  const difficulty=getSettings(state).aiDifficulty;
  if(difficulty === "easy") return options[Math.floor(Math.random()*options.length)];
  const holder=state.crownHolder==null ? null : state.players[state.crownHolder];
  const target=holder || {x:state.crownX,y:state.crownY};
  function value([dx,dy]){
    let x=ai.x+dx,y=ai.y+dy;
    const tile=getTile(x,y,state.settings);
    const c=getSettings(state).boardSize-1;
    if(tile === "teleport"){
      const tx=x===0 ? c : 0, ty=y===0 ? c : 0;
      if(!isOccupiedByOther(state.players,index,tx,ty)){ x=tx; y=ty; }
    }
    const dist=Math.abs(x-target.x)+Math.abs(y-target.y);
    if(difficulty === "normal") return holder===ai ? 0 : -dist;
    let score = holder===ai ? Math.min(...state.players.filter((_,i)=>i!==index).map(p=>Math.abs(x-p.x)+Math.abs(y-p.y)))*3 : -dist*4;
    if(holder && holder!==ai && dist===1) score+=holder.shield?10:50;
    if(!holder && dist===0) score+=60;
    if(tile==='defense' && !ai.shield) score+=8;
    if(state.gameMode==='score'){ if(tile==='bonus') score+=5; if(tile==='trap') score-=5; }
    return score;
  }
  const ranked=options.map(move=>({move,value:value(move)}));
  const best=Math.max(...ranked.map(p=>p.value));
  const choices=ranked.filter(p=>p.value===best);
  return choices[Math.floor(Math.random()*choices.length)].move;
}
function aiTurn(){
  const state=soloState;
  if(mode!=="solo" || !state || isGameFinished(state) || tutorialStep>=0) return;
  const index=state.currentPlayer;
  if(index===0) return;
  const ai=state.players[index], chosen=chooseAiMove(state,index);
  if(chosen){ ai.x+=chosen[0]; ai.y+=chosen[1]; applyTileEffect(state,ai); checkCrown(state,ai); }
  finishTurn(state); renderGame(state);
  if(isGameFinished(state)){ finishGame(state); return; }
  if(state.currentPlayer===0) toast("당신의 턴!");
  else aiTimer=setTimeout(aiTurn,450);
}
const tutorialLessons=[
  ["왕관 획득", "파란 말 오른쪽의 👑 칸을 누르거나 → 버튼을 눌러 한 칸 이동하세요. 왕관을 얻고 턴을 마치면 점수 모드에서 +1점이에요.", "#board [data-x='2'][data-y='2']"],
  ["왕관 탈취", "빨간 말이 왕관을 가지고 있어요. 오른쪽 빈 칸으로 이동해 빨간 말의 바로 왼쪽에 붙어보세요. 같은 칸에 들어가는 것이 아니라 상하좌우로 붙으면 탈취해요.", "#board [data-x='2'][data-y='2']"],
  ["상대 방어막", "빨간 말의 🛡️는 탈취를 한 번 막아요. 오른쪽으로 붙어 방어막을 소모시킨 뒤 왼쪽으로 나왔다가 다시 오른쪽으로 붙어보세요.", "#board [data-x='2'][data-y='2']"],
  ["방어 타일", "파란 말 왼쪽의 🛡️ 타일을 눌러 방어막을 얻어보세요. 방어막을 가진 왕관 보유자는 다음 탈취를 한 번 막아요.", "#board [data-x='0'][data-y='2']"],
  ["보너스와 함정", "파란 말 오른쪽의 💰 타일로 이동해 +2점을 받아보세요. 🕳️는 −1점(최소 0점), 🌀는 반대 포털의 빈 칸으로 이동시켜요.", "#board [data-x='2'][data-y='0']"],
  ["실전 준비", "이제 판에서 자유롭게 움직여보세요. 실전에서는 이동 후 다음 사람의 차례가 됩니다. 점수 모드는 최종 점수, 탈취 모드는 마지막 왕관 보유자로 승패를 정해요. 연습을 마치면 완료를 누르세요.", "#statusInfo"]
];
window.startTutorial = ()=>{
  if(mode && tutorialStep<0){toast("진행 중인 게임에서 나간 뒤 튜토리얼을 열어주세요.");return;}
  cleanupRoom();mode="solo";tutorialStep=0;loadTutorialStep();
  document.getElementById('tutorialBar').scrollIntoView({block:'start',behavior:'smooth'});
};
function loadTutorialStep(){
  clearTimeout(aiTimer);lastCrownSnapshot=null;
  const settings=normalizeSettings({boardSize:5,bonus:tutorialStep>=3,trap:tutorialStep>=3,teleport:tutorialStep>=3,defense:tutorialStep>=3});
  soloState={started:true,turn:0,maxActions:30,settings,gameMode:'score',currentPlayer:0,crownHolder:null,crownX:2,crownY:2,
    players:[{id:'p0',name:'나 · 연습',x:1,y:2},{id:'p1',name:'상대 · 연습',x:4,y:4},{id:'p2',name:'초록 말',x:4,y:0},{id:'p3',name:'보라 말',x:0,y:4}].map(p=>({...p,score:0,actions:0,shield:false,alive:true}))};
  if(tutorialStep===1||tutorialStep===2){soloState.crownHolder=1;soloState.players[1].x=3;soloState.players[1].y=2;soloState.players[1].shield=tutorialStep===2;}
  if(tutorialStep===4){soloState.players[0].x=1;soloState.players[0].y=0;}
  if(tutorialStep===5){soloState.players[0].x=0;soloState.players[0].y=0;}
  showScreen('gameScreen');renderGame(soloState);showTutorialHint();
}
function showTutorialHint(moved=false){
  if(tutorialStep<0)return;
  const lesson=tutorialLessons[tutorialStep],p=soloState.players[0];
  document.getElementById('tutorialBar').hidden=false;
  document.getElementById('tutorialTitle').textContent=(tutorialStep+1)+' / '+tutorialLessons.length+' · '+lesson[0];
  document.getElementById('tutorialText').textContent=lesson[1];
  document.getElementById('tutorialBack').disabled=tutorialStep===0;
  document.getElementById('tutorialNext').textContent=tutorialStep===tutorialLessons.length-1?'완료':'다음';
  let outcome='';
  if(moved){
    outcome='한 칸 이동했어요. 판과 점수를 확인한 뒤 다음을 눌러주세요.';
    if(tutorialStep<=1&&soloState.crownHolder===0)outcome='👑 왕관을 얻었어요! 점수 '+p.score+'점 · 결과를 보고 다음으로 넘어가세요.';
    if(tutorialStep===2)outcome=soloState.crownHolder===0?'⚔️ 방어막이 사라진 뒤 왕관을 탈취했어요!':!soloState.players[1].shield?'🛡️ 방어막이 탈취를 막고 사라졌어요. 왼쪽으로 나왔다가 다시 붙어보세요.':'오른쪽으로 이동해 상대에게 붙어보세요.';
    if(tutorialStep===3&&p.shield)outcome='🛡️ 내 방어막을 얻었어요! 현재 상태와 점수 목록에서 확인하세요.';
    if(tutorialStep===4&&p.score>=2)outcome='💰 보너스 +2점! 점수 목록에 반영됐어요.';
  }
  document.getElementById('tutorialStatus').textContent=outcome;
  document.querySelectorAll('.tutorialTarget').forEach(el=>el.classList.remove('tutorialTarget'));
  document.querySelector(lesson[2])?.classList.add('tutorialTarget');
}
window.endTutorial=()=>{cleanupRoom();soloState=null;showScreen('menuScreen');};
document.getElementById('tutorialBack').onclick=()=>{if(tutorialStep>0){tutorialStep--;loadTutorialStep();}};
document.getElementById('tutorialNext').onclick=()=>{if(tutorialStep===tutorialLessons.length-1)window.endTutorial();else if(tutorialStep>=0){tutorialStep++;loadTutorialStep();}};
document.getElementById('tutorialEnd').onclick=window.endTutorial;
document.addEventListener('keydown',event=>{if(tutorialStep>=0&&event.key==='Escape')window.endTutorial();});

/* =========================
   FINISH TURN
========================= */

function finishTurn(state){

  const previous = state.currentPlayer;
  const player = state.players[previous];

  if(!player || Number(player.actions||0)>=state.maxActions) return;

  /*
    왕관을 가진 플레이어가
    자신의 턴을 끝냈을 때 +1
  */
  if(state.gameMode === "score" && state.crownHolder===previous){
    player.score += 1;
  }

  /* 모든 플레이어는 정확히 30번의 행동 기회를 가짐 */
  player.actions = Math.min(
    state.maxActions,
    Number(player.actions || 0) + 1
  );

  state.turn++;

  /* 아직 30회를 채우지 않은 다음 플레이어에게 턴 전달 */
  let next = (previous + 1) % state.players.length;
  let checked = 0;

  while(
    checked < state.players.length &&
    Number(state.players[next].actions || 0) >= state.maxActions
  ){
    next = (next + 1) % state.players.length;
    checked++;
  }

  state.currentPlayer = next;
}

function isGameFinished(state){
  return state.players.length > 0 &&
    state.players.every(
      p => Number(p.actions || 0) >= state.maxActions
    );
}


/* =========================
   CROWN
========================= */

function checkCrown(state,player){

  const index = state.players.indexOf(player);
  if(index < 0) return;

  /* 중앙의 왕관 획득 */
  if(
    player.x===state.crownX &&
    player.y===state.crownY &&
    (state.crownHolder===null || state.crownHolder===index)
  ){
    if(state.crownHolder !== index){
      state.crownHolder = index;
      toast("👑 왕관을 획득했습니다!");
    }
    return;
  }

  /* 왕관 보유자와 상하좌우로 바로 붙으면 탈취 */
  if(
    state.crownHolder!==null &&
    state.crownHolder!==index
  ){
    const holder = state.players[state.crownHolder];
    if(!holder) return;

    const distance =
      Math.abs(player.x-holder.x) +
      Math.abs(player.y-holder.y);

    if(distance===1){
      if(holder.shield){
        holder.shield=false;
        toast(`🛡️ ${holder.name}의 방어막이 탈취를 막았습니다!`);
        return;
      }
      state.crownHolder=index;
      toast(`⚔️ ${player.name}이(가) 왕관을 탈취!`);
    }
  }

}


/* =========================
   TILE EFFECT
========================= */

function applyTileEffect(state,player){

  const type =
    getTile(player.x,player.y,state.settings);

  if(type==="bonus"){

    player.score += 2;

    toast("💰 보너스 +2");

  }

  if(type==="trap"){

    player.score =
      Math.max(0,player.score-1);

    toast("🕳️ 함정! -1");

  }

  if(type==="defense"){

    player.shield = true;
    toast("🛡️ 방어막 획득! 다음 왕관 탈취를 1회 방어합니다.");

  }

  if(type==="teleport"){

    const c=Number(getSettings(state).boardSize)-1;
    const portals=[{x:0,y:c},{x:c,y:0}];

    const target =
      portals.find(p =>
        !(p.x===player.x &&
          p.y===player.y)
      );

    if(target && !isOccupiedByOther(state.players,state.players.indexOf(player),target.x,target.y)){

      player.x=target.x;
      player.y=target.y;

      toast("🌀 순간이동!");

    }

  }

}


/* =========================
   HELPERS
========================= */

function inside(x,y,size=SIZE){
  return x>=0 && x<size && y>=0 && y<size;
}

function isOccupiedByOther(players,index,x,y){

  return players.some((p,i)=>
    i!==index && !p.left &&
    p.x===x &&
    p.y===y
  );

}


/* =========================
   RENDER
========================= */

function renderGame(state){

  const previous = lastCrownSnapshot;

  renderBoard(state);
  renderScores(state);

  const current =
    state.players[state.currentPlayer];

  if(current){
    document.getElementById("turnLabel")
      .textContent =
      `${COLORS[state.currentPlayer]} ${current.name}의 턴`;
  }

  const totalActions = state.players.length * Number(state.maxActions || MAX_ACTIONS_PER_PLAYER);
  document.getElementById("turnNumber")
    .textContent =
    `TURN ${Math.min(state.turn+1,totalActions)} / ${totalActions} · ACTION ${current ? Number(current.actions || 0) : 0} / ${Number(state.maxActions || MAX_ACTIONS_PER_PLAYER)}`;

  const modeLabel = state.gameMode === "steal" ? "👑 탈취 모드" : "🏆 점수 모드";
  const holder = state.crownHolder!==null ? state.players[state.crownHolder] : null;
  const meIndex = mode === "solo" ? 0 : localPlayerIndex(state);
  const me = state.players[meIndex];
  document.getElementById("statusInfo").innerHTML =
    `<b>${modeLabel}</b><br>` +
    (holder ? `👑 왕관: <b>${escapeHtml(holder.name)}</b><br>` : `👑 왕관: 중앙<br>`) +
    (me && me.shield ? `🛡️ 내 방어막: 활성<br>` : "") +
    `⚙️ ${getSettings(state).boardSize}×${getSettings(state).boardSize} · ${getSettings(state).maxActions}회/인<br>` +
    (state.gameMode === "score" ? `왕관 보유자는 턴 종료 시 +1점<br>` : `마지막 왕관 보유자가 승리<br>`) +
    `각자 ${Number(state.maxActions || MAX_ACTIONS_PER_PLAYER)}회 행동`;

  /* 왕관 보유자가 바뀌었을 때만 탈취 연출 */
  if(
    previous &&
    previous.holder !== null &&
    state.crownHolder !== null &&
    previous.holder !== state.crownHolder
  ){
    const from = previous.players[previous.holder];
    const to = state.players[state.crownHolder];
    if(from && to){
      requestAnimationFrame(()=>{
        playCrownStealAnimation(from, to);
      });
    }
  }

  lastCrownSnapshot = {
    holder: state.crownHolder,
    players: state.players.map(p=>({x:p.x,y:p.y}))
  };

}


function renderBoard(state){

  const board =
    document.getElementById("board");

  board.innerHTML="";

  const boardSize=Number(getSettings(state).boardSize);
  board.style.gridTemplateColumns=`repeat(${boardSize},1fr)`;

  for(let y=0;y<boardSize;y++){

    for(let x=0;x<boardSize;x++){

      const cell =
        document.createElement("button");

      cell.className="cell";
      cell.dataset.x = x;
      cell.dataset.y = y;

      const type=getTile(x,y,state.settings);

      if(type!=="normal"){
        cell.classList.add(type);
      }

      if(
        x===state.crownX &&
        y===state.crownY
      ){
        cell.classList.add("crown-cell");
      }

      const tile =
        document.createElement("div");

      tile.className="tile-name";
      tile.textContent=tileEmoji(type);

      cell.appendChild(tile);

      if(
        state.crownHolder===null &&
        x===state.crownX &&
        y===state.crownY
      ){

        const crown =
          document.createElement("div");

        crown.className="crown";
        crown.textContent="👑";

        cell.appendChild(crown);

      }

      state.players.forEach((p,i)=>{

        if(!p.left && p.x===x && p.y===y){

          const piece =
            document.createElement("div");

          piece.className=`piece p${i}`;

          piece.textContent =
            COLORS[i]+(p.shield?"🛡️":"");
          piece.title=p.name+(p.shield?" · 방어막":"");

          cell.appendChild(piece);

          if(state.crownHolder===i){

            const crown =
              document.createElement("div");

            crown.className="crown";
            crown.textContent="👑";

            cell.appendChild(crown);

          }

        }

      });

      cell.onclick=()=>{

        const meIndex =
          mode==="solo"
          ? 0
          : localPlayerIndex(state);

        const me=state.players[meIndex];

        if(state.currentPlayer!==meIndex){

          toast("아직 내 턴이 아닙니다.");
          return;

        }

        const dx=x-me.x;
        const dy=y-me.y;

        if(Math.abs(dx)+Math.abs(dy)!==1){

          toast("한 칸만 이동할 수 있습니다.");
          return;

        }

        movePlayer(dx,dy);

      };

      board.appendChild(cell);

    }

  }

}


function renderScores(state){

  const list =
    document.getElementById("scoreList");

  list.innerHTML="";

  state.players.forEach((p,i)=>{

    const row =
      document.createElement("div");

    row.className="score-row";

    if(i===state.currentPlayer){
      row.classList.add("current");
    }

    const name =
      document.createElement("div");

    name.className="score-name";

    name.innerHTML =
      `<span>${COLORS[i]}</span>${escapeHtml(p.name)}`;

    const score =
      document.createElement("div");

    score.className="score";

    score.textContent =
      `${p.score}점 · ${Number(p.actions || 0)}/${state.maxActions}`;

    if(state.crownHolder===i){ score.textContent += " 👑"; }
    if(p.shield){ score.textContent += " 🛡️"; }

    row.appendChild(name);
    row.appendChild(score);

    list.appendChild(row);

  });

}


/* =========================
   CROWN STEAL ANIMATION
========================= */

function getCellCenter(x,y){
  const cell = document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  if(!cell) return null;
  const rect = cell.getBoundingClientRect();
  return {
    x: rect.left + rect.width/2,
    y: rect.top + rect.height/2
  };
}

function playCrownStealAnimation(fromPlayer,toPlayer){
  const start = getCellCenter(fromPlayer.x,fromPlayer.y);
  const end = getCellCenter(toPlayer.x,toPlayer.y);
  if(!start || !end) return;

  const layer = document.getElementById("crownFlyLayer");
  const banner = document.getElementById("crownStealBanner");
  if(!layer || !banner) return;

  layer.innerHTML="";

  const burst = document.createElement("div");
  burst.className="crown-burst";
  burst.style.left = `${start.x}px`;
  burst.style.top = `${start.y}px`;
  layer.appendChild(burst);

  const crown = document.createElement("div");
  crown.className="flying-crown";
  crown.textContent="👑";
  crown.style.left = `${start.x}px`;
  crown.style.top = `${start.y}px`;
  layer.appendChild(crown);

  /* 왕관이 기존 보유자에게서 새 보유자에게 날아감 */
  requestAnimationFrame(()=>{
    crown.style.left = `${end.x}px`;
    crown.style.top = `${end.y}px`;
    crown.style.transform = "translate(-50%,-50%) scale(1.25) rotate(360deg)";
  });

  banner.classList.remove("show");
  void banner.offsetWidth;
  banner.classList.add("show");

  setTimeout(()=>{
    crown.remove();
    burst.remove();
  },700);

  setTimeout(()=>{
    banner.classList.remove("show");
  },1300);
}


/* =========================
   RESULT
========================= */

function finishGame(state){

  if(document.getElementById("resultScreen").classList.contains("active")) return;

  showScreen("resultScreen");

  const sorted = state.players.filter(p=>!p.left).sort((a,b)=>b.score-a.score);
  let winner = null;
  if(state.gameMode === "steal"){
    winner = state.crownHolder !== null ? state.players[state.crownHolder] : null;
    if(winner?.left)winner=null;
    document.getElementById("winnerText").textContent = winner ? `👑 ${winner.name} 승리! 마지막 왕관 보유자입니다.` : `🤝 왕관 보유자가 없어 무승부입니다.`;
  }else{
    if(!sorted.length){document.getElementById("winnerText").textContent="🤝 참가자가 없어 무승부입니다.";return}
    const winners=sorted.filter(p=>p.score===sorted[0]?.score);
    document.getElementById("winnerText").textContent = `🏆 ${winners.map(p=>p.name).join(", ")} ${winners.length>1 ? "공동 승리" : "승리"}!`;
  }

  const list =
    document.getElementById("finalList");

  list.innerHTML="";

  sorted.forEach((p,i)=>{

    const row =
      document.createElement("div");

    row.className="final-row";

    const crownMark = state.crownHolder === state.players.indexOf(p) ? " 👑" : "";
    const shieldMark = p.shield ? " 🛡️" : "";
    row.innerHTML = `<span>${i+1}. ${COLORS[state.players.indexOf(p)]} ${escapeHtml(p.name)}${crownMark}${shieldMark}</span><b>${p.score}점 · ${Number(p.actions || 0)}/${Number(state.maxActions || MAX_ACTIONS_PER_PLAYER)}회</b>`;

    list.appendChild(row);

  });

}


/* =========================
   BATTLE ROOM
========================= */

function randomCode(){

  return String(
    Math.floor(1000+Math.random()*9000)
  );

}

function playerId(){

  return "p_"+Math.random()
    .toString(36)
    .slice(2,10);

}


async function roomAction(action){
  if(busy || !requireOnline()) return;
  busy=true;
  try { await action(); } catch(error){reportError(error);} finally {busy=false;}
}
window.createRoom = ()=>roomAction(async()=>{
  const name=document.getElementById("battleName").value.trim().slice(0,12)||"Player";
  const id=playerId(), settings=readBattleSettings();
  const pos=startingPositions(4,settings.boardSize)[0];
  const room={host:id,started:false,gameMode:battleGameMode,settings,maxActions:settings.maxActions,
    turn:0,currentPlayer:0,crownHolder:null,crownX:Math.floor((settings.boardSize-1)/2),crownY:Math.floor((settings.boardSize-1)/2),
    players:{[id]:{id,name,index:0,...pos,score:0,actions:0,shield:false}}};
  for(let attempt=0;attempt<20;attempt++){
    const code=randomCode();
    const result=await runTransaction(ref(db,`gcrown/rooms/${code}`),value=>value ? undefined : room,{applyLocally:false});
    if(!result.committed) continue;
    cleanupRoom();mode="battle";roomCode=code;localPlayerId=id;isHost=true;
    saveSession();showLobby();listenRoom();return;
  }
  toast("방 코드를 생성하지 못했습니다. 다시 시도해주세요.");
});
window.joinRoom = ()=>roomAction(async()=>{
  const code=document.getElementById("joinCode").value.trim();
  if(!/^\d{4}$/.test(code)){toast("4자리 방 코드를 입력하세요.");return;}
  const name=document.getElementById("battleName").value.trim().slice(0,12)||"Player", id=playerId();
  const initial=await readRoom(ref(db,`gcrown/rooms/${code}`));
  if(!initial.exists()){toast("방을 찾을 수 없습니다.");return;}
  let reason="방을 찾을 수 없습니다.";
  const result=await runTransaction(ref(db,`gcrown/rooms/${code}`),room=>{
    // A transaction may start with an empty local cache even after a one-time read.
    // Returning null lets Firebase compare with the server and retry with fresh data.
    if(!room) return null;
    if(room.started){reason="이미 시작된 게임입니다.";return;}
    const players=Object.values(room.players||{});
    if(players.length>=4){reason="방이 가득 찼습니다.";return;}
    const index=players.length,pos=startingPositions(4,normalizeSettings(room.settings).boardSize)[index];
    room.players[id]={id,name,index,...pos,score:0,actions:0,shield:false};return room;
  },{applyLocally:false});
  if(!result.committed || !result.snapshot.val()?.players?.[id]){toast(reason);return;}
  cleanupRoom();mode="battle";roomCode=code;localPlayerId=id;isHost=false;
  saveSession();showLobby();listenRoom();
});

/* =========================
   LOBBY
========================= */

function showLobby(){

  showScreen("lobbyScreen");

  document.getElementById("roomCodeDisplay")
    .textContent=roomCode;

  updateLobbyButtons();

}


function listenRoom(){

  if(roomListener){
    roomListener();
  }

  roomListener =
    onValue(
      ref(db,`gcrown/rooms/${roomCode}`),
      snap=>{

        if(!snap.exists()){

          toast("방이 종료되었습니다.");
          backMenu();
          return;

        }

        const room=snap.val();
        if(!room.players?.[localPlayerId] || room.players[localPlayerId].left){
          cleanupRoom();showScreen("menuScreen");return;
        }
        isHost=room.host===localPlayerId;
        connectionStatus("🟢 방 동기화 정상");
        if(!room.started){

          renderLobby(room);
          showScreen("lobbyScreen");

        }else{

          showScreen("gameScreen");

          const state =
            normalizeBattleState(room);

          currentBattleState=state;
          renderGame(state);

          if(isGameFinished(state)){
            finishGame(state);
          }

        }

      },
      reportError
    );

}


function normalizeBattleState(room){

  const players =
    Object.values(room.players || {})
      .sort((a,b)=>a.index-b.index)
      .map(p=>({
        ...p,
        actions:Number(p.actions || 0),
        shield:Boolean(p.shield)
      }));

  return {
    ...room,
    crownHolder:room.crownHolder ?? null,
    gameMode:room.gameMode || "score",
    settings:normalizeSettings(room.settings),
    maxActions:Number(room.maxActions || normalizeSettings(room.settings).maxActions),
    players
  };

}


function renderLobby(room){

  const players =
    Object.values(room.players || {})
      .sort((a,b)=>a.index-b.index);

  const list =
    document.getElementById("playersList");

  list.innerHTML="";

  for(let i=0;i<4;i++){

    const slot =
      document.createElement("div");

    slot.className="player-slot";

    const p=players[i];

    if(p){

      slot.classList.add("filled");

      slot.textContent =
        `${COLORS[p.index]} ${p.name}` +
        (p.id===room.host ? " 👑" : "");

    }else{

      slot.textContent="빈 자리";

    }

    list.appendChild(slot);

  }

  document.getElementById("roomCodeDisplay")
    .textContent=roomCode;
  document.getElementById("lobbyMode").textContent =
    room.gameMode === "steal" ? "👑 탈취 모드" : "🏆 점수 모드";
  const rs=normalizeSettings(room.settings);
  document.getElementById("lobbyMode").textContent += ` · ${rs.boardSize}×${rs.boardSize} · ${rs.maxActions}회`;

  updateLobbyButtons();

}


function updateLobbyButtons(){

  document
    .getElementById("startBattleBtn")
    .classList.toggle("hidden",!isHost);

}


window.startBattle = ()=>roomAction(async()=>{
  const result=await runTransaction(ref(db,`gcrown/rooms/${roomCode}`),room=>{
    if(!room || room.host!==localPlayerId || room.started) return;
    const players=Object.values(room.players||{}).sort((a,b)=>a.index-b.index);
    if(players.length<2) return;
    const cfg=normalizeSettings(room.settings),positions=startingPositions(players.length,cfg.boardSize);
    players.forEach((p,i)=>{Object.assign(p,positions[i],{index:i,score:0,actions:0,shield:false,left:false});room.players[p.id]=p;});
    Object.assign(room,{started:true,turn:0,currentPlayer:0,crownHolder:null,finished:false,
      crownX:Math.floor((cfg.boardSize-1)/2),crownY:Math.floor((cfg.boardSize-1)/2)});
    return room;
  },{applyLocally:false});
  if(!result.committed) toast("방장만 시작할 수 있으며 최소 2명이 필요합니다.");
});

window.copyRoomCode = async () => {

  if(!roomCode) return;

  try{

    await navigator.clipboard.writeText(roomCode);
    toast("방 코드가 복사되었습니다.");

  }catch{

    toast(`방 코드: ${roomCode}`);

  }

};


/* =========================
   BATTLE MOVE
========================= */

async function battleMove(dx,dy,pass=false){
  if(movePending || !roomCode || !requireOnline()) return;
  movePending=true;
  const expectedTurn=currentBattleState?.turn;
  try {

  const roomRef =
    ref(db,`gcrown/rooms/${roomCode}`);

  await runTransaction(
    roomRef,
    room=>{

      if(!room || !room.started || room.finished || room.turn!==expectedTurn) return;
      room.crownHolder=room.crownHolder ?? null;
      room.gameMode=room.gameMode || "score";

      const players =
        Object.values(room.players || {})
          .sort((a,b)=>a.index-b.index);

      const me =
        players.find(
          p=>p.id===localPlayerId
        );

      if(!me) return;

      if(me.index!==room.currentPlayer){
        return;
      }

      const settings=normalizeSettings(room.settings);
      const maxActions=settings.maxActions;

      if(Number(me.actions || 0) >= maxActions){
        return;
      }

      if(pass){
        if(legalMoves(normalizeBattleState(room),me.index).length) return;
      }else if(!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx)+Math.abs(dy)!==1){ return; }

      const nx=me.x+dx;
      const ny=me.y+dy;

      if(!inside(nx,ny,settings.boardSize)){
        return;
      }

      const occupied =
        players.some(p=>
          p.id!==me.id && !p.left &&
          p.x===nx &&
          p.y===ny
        );

      if(occupied){
        return;
      }

      me.x=nx;
      me.y=ny;

      const type=pass ? "normal" : getTile(nx,ny,settings);

      if(type==="bonus"){
        me.score+=2;
      }

      if(type==="trap"){
        me.score=Math.max(0,me.score-1);
      }

      if(type==="defense"){
        me.shield = true;
      }

      if(type==="teleport" && !players.some(p=>p.id!==me.id && !p.left && p.x===settings.boardSize-1-nx && p.y===settings.boardSize-1-ny)){

        const c=settings.boardSize-1;
        if(nx===0 && ny===c){
          me.x=c; me.y=0;
        }else{
          me.x=0; me.y=c;

        }

      }

      /*
        왕관 획득
      */

      if(!pass &&
        me.x===room.crownX &&
        me.y===room.crownY &&
        (
          room.crownHolder===null ||
          room.crownHolder===me.index
        )
      ){

        room.crownHolder=me.index;

      }

      /*
        왕관 보유자 인접 시 탈취
      */

      if(!pass &&
        room.crownHolder!==null &&
        room.crownHolder!==me.index
      ){

        const holder =
          players.find(
            p=>p.index===room.crownHolder
          );

        if(holder){

          const distance =
            Math.abs(me.x-holder.x)+
            Math.abs(me.y-holder.y);

          if(distance===1){
            if(holder.shield){
              holder.shield=false;
            }else{
              room.crownHolder=me.index;
            }
          }

        }

      }

      /* 점수 모드에서만 왕관 보유자 턴 종료 +1점 */
      if(room.gameMode === "score" && room.crownHolder===me.index){
        me.score+=1;
      }

      /* 이 플레이어의 행동 횟수 +1 */
      me.actions = Math.min(
        maxActions,
        Number(me.actions || 0) + 1
      );

      room.turn++;

      /* 30회를 끝낸 플레이어는 건너뜀 */
      let next = (me.index + 1) % players.length;
      let checked = 0;
      while(
        checked < players.length &&
        Number(players.find(p=>p.index===next)?.actions || 0) >= maxActions
      ){
        next = (next + 1) % players.length;
        checked++;
      }
      room.currentPlayer = next;

      /*
        객체 다시 저장
      */

      players.forEach(p=>{
        room.players[p.id]=p;
      });

      const finished = players.every(
        p=>Number(p.actions || 0) >= maxActions
      );

      if(finished){
        room.finished=true;
      }

      return room;

    },
    {applyLocally:false}
  );
  } catch(error){reportError(error);} finally {movePending=false;}
}


/* =========================
   LOCAL PLAYER INDEX
========================= */

function localPlayerIndex(state){

  const p =
    state.players.find(
      p=>p.id===localPlayerId
    );

  return p ? p.index : -1;

}


/* =========================
   LEAVE
========================= */

window.leaveRoom = async ()=>{
  if(busy) return;
  if(roomCode && localPlayerId){
    if(!requireOnline()) return;
    busy=true;
    try {
      const id=localPlayerId;
      await runTransaction(ref(db,`gcrown/rooms/${roomCode}`),room=>{
        if(!room?.players?.[id]) return;
        if(!room.started){
          delete room.players[id];
          const players=Object.values(room.players).sort((a,b)=>a.index-b.index);
          if(!players.length) return null;
          players.forEach((p,i)=>p.index=i);
          if(room.host===id) room.host=players[0].id;
        }else{
          const p=room.players[id];p.left=true;p.actions=room.maxActions;
          if(room.crownHolder===p.index){room.crownHolder=null;room.crownX=p.x;room.crownY=p.y;}
          if(room.currentPlayer===p.index){
            const next=Object.values(room.players).filter(p=>!p.left && p.actions<room.maxActions).sort((a,b)=>a.index-b.index);
            room.currentPlayer=(next.find(p=>p.index>room.currentPlayer)||next[0])?.index ?? 0;
          }
          room.finished=Object.values(room.players).every(p=>p.actions>=room.maxActions);
        }
        return room;
      },{applyLocally:false});
    } catch(error){ reportError(error);return; } finally {busy=false;}
  }
  cleanupRoom();soloState=null;showScreen("menuScreen");
};

window.exitGame = () => {

  if(mode==="battle"){

    leaveRoom();

  }else{

    cleanupRoom();
    soloState=null;
    showScreen("menuScreen");

  }

};


/* =========================
   ESCAPE HTML
========================= */

function escapeHtml(text){

  return String(text)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");

}

window.passTurn = ()=>{
  const state=mode==='solo'?soloState:currentBattleState;
  const index=mode==='solo'?0:state?localPlayerIndex(state):-1;
  if(!state || index<0 || state.currentPlayer!==index || isGameFinished(state)) return;
  if(legalMoves(state,index).length){toast('이동할 수 있는 칸이 있습니다.');return;}
  if(mode==='battle'){battleMove(0,0,true);return;}
  finishTurn(state);renderGame(state);
  if(isGameFinished(state)) finishGame(state);else aiTimer=setTimeout(aiTurn,450);
};
initFirebase();


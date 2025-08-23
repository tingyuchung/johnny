const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const ASSET_PATH = 'assets/';

const SPRITES = {};
// Visual-only vertical offset to draw sprites slightly lower without changing physics
const PLAYER_DRAW_Y_OFFSET = 17; // was 12; +5 makes ground y look like 333 instead of 328
const COCO_DRAW_Y_OFFSET = 12;   // keep consistent baseline with player
// Floating block spawn controls (reduce density and overlap)
const FLOATING_SPAWN_INTERVAL_MS = 6500;
const MAX_FLOATING_BLOCKS = 4;
const MIN_FLOATING_SPAWN_GAP_X = 260; // minimum world X gap between consecutive spawns
const FLOATING_Y_MIN = 300;
const FLOATING_Y_MAX = 360;
const FLOATING_MIN_Y_SEPARATION = 24;
// Time to keep a fallen boy visible before respawn (ms)
const FALL_RESPAWN_MS = 800;
const assets = [
  // Johnny (player)
  'johnny_stand.png','johnny_right.png','johnny_right2.png','johnny_left.png','johnny_left2.png',
  // Coco
  'coco_stand.png','coco_right.png','coco_right2.png','coco_left.png','coco_left2.png',
  // World
  'tile.png','question.png','bubble.png',
  // Coco chat variants (use whichever exists)
  'coco_chat_left.png','coco chat left.png',
  // Bubble boy frames removed
  // preload several possible background names to survive asset swaps
  'bg_riverside2.jpg','bg_riverside2.png','bg_riverside.jpg','bg_riverside.png',
  // Enemies (mushrooms removed)
  'boy_run_left.png','boy_run_left2.png','boy_fall_left.png',
  // (optional: right-facing variants if needed later)
  'boy_run_right.png','boy_run_right2.png','boy_fall_right.png',
  // UI & SFX (removed balloon & cake)
  'heart.png','banner.png',
  // Decoratives
  'dog1.png','dog 2.png','dog 3.png','dog4.png',
  // Ending sequences (optional; load if present)
  'angry01.png','angry02.png','angry03.png',
  'kiss01.png','kiss02.png','kiss03.png',
  'cake01.png','cake02.png','cake03.png',
  // Ending backgrounds
  'ending1.png','ending2.png','ending3.png',
  // Start screen background
  'start_bg.png',
  'angry.jpg','angry2.jpg',
  // Ending cinematic assets
  'airplane.png','paris.png',
  'jump.wav','hit.wav','correct.wav'
];
let loaded = 0;
let initStarted = false;
const maybeStart = () => { if(!initStarted && loaded===assets.length){ initStarted = true; init(); } };
assets.forEach((a)=>{
  if(a.endsWith('.wav')){ SPRITES[a]=a; loaded++; maybeStart(); return; }
  const img = new Image();
  img.src = ASSET_PATH + a;
  img.onload = ()=>{ loaded++; maybeStart(); };
  img.onerror = ()=>{ loaded++; console.warn('Failed to load asset:', a); maybeStart(); };
  SPRITES[a]=img;
});
// safety: start even if some assets never fire events (shouldn't happen but helps debugging)
setTimeout(()=>{ if(!initStarted){ console.warn('Starting despite incomplete asset load. loaded=', loaded,'of',assets.length); initStarted=true; init(); } }, 4000);

const keys = {};
window.addEventListener('keydown', e=> keys[e.key]=true);
window.addEventListener('keyup', e=> keys[e.key]=false);

const state = {
  mode:'intro', // intro -> play -> end
  player: {x:40,y:300,w:40,h:56, vx:0, vy:0, onGround:false, facing:1, frame:0, animTick:0},
  coco: {x:800,y:328,w:40,h:56, facing: 1, vx: 0, frame: 0, animTick: 0},
  dog: {x:3063, y:360, w:64, h:40, animIdx:0, animTick:0, triggered:false, finished:false, parallax:false},
  tiles: [],
  questions: [],
  mushrooms: [],
  boys: [],
  floatingBlocks: [],
  floatingSpawnAccMs: 0,
  // bubbleBoy removed
  floatingLastSpawnX: -Infinity,
  cameraX:0,
  bgX: 0,
  bgKey: 'bg_riverside2.jpg',
  bgLazyAttempted: false,
  showDebugBG: false,
  hearts:3,
  showCelebration:false,
  introTick:0,
  paused:false,
  cocoIdle: true,
  cocoGreeted: false,
  cocoHasTurnedLeft: false,
  boysEnabled: false,
  cocoGreetedComplete: false,
  postGreetForwardMs: 0,
  inDialog: false,
  // intro approach: both move toward each other until close then start dialog
  approachActive: true,
  isCocoDialog: false,
  cocoWalkTriggered: false,
  dialogSeqActive: false,
  // Deferred question trigger after bubble pop
  pendingQuestionIdx: null,
  pendingQuestionWaitMs: 0,
  // timer (ms)
  timeLimitMs: 60000,
  timeLeftMs: 60000,
  timeUp: false,
  showAngry: false,
  angryFrame: 0,
  angryTick: 0
};

// Ending configuration based on final hearts
const ENDINGS = [
  { minHearts: 0, maxHearts: 0, title: 'GAME OVER', body: 'You ran out of hearts. Press ENTER to restart.' },
  { minHearts: 1, maxHearts: 2, title: 'THE END', body: 'Not bad! Try again for a happier ending. Press ENTER to restart.' },
  { minHearts: 3, maxHearts: 4, title: 'GOOD END', body: 'You did well! Press ENTER to restart.' },
  { minHearts: 5, maxHearts: 5, title: 'GREAT END', body: 'So close to perfect! Press ENTER to restart.' },
  { minHearts: 6, maxHearts: 6, title: 'PERFECT END', body: 'Love conquers all! Press ENTER to restart.' }
];

// Scale for ending images relative to their original size (e.g., 0.5 = 50%)
const ENDING_IMAGE_SCALE = 0.2;
// World position for ending image (top-left anchor)
const ENDING_IMAGE_WORLD_X = 3100;
const ENDING_IMAGE_WORLD_Y = 320;

let ending = { active:false, fade:0, key:'', title:'', body:'', hearts:0, flashFrames:0, frameTick:0, frameIdx:0, cinematic:null, phase:null, charAlpha:1, seqAlpha:0, dimmer:0, postOk:false, titleAlpha:0, finalTitle:'', scoreShown:false, seqTimerMs:0, gameOverMode:false, gameOverTimer:0, menuAlpha:0, selectedOption:0, menuOptions:['再挑戰一次'], typewriterText:'', typewriterIndex:0, typewriterTimer:0, isTimeUp:false, keyPressed:false, creditsMode:false, creditsScrollY:0, creditsTimer:0, isAngryEnding:false, angryEndingMode:false, angryAnimationTimer:0 };

function pickEnding(){
  const h = Math.max(0, Math.min(6, state.hearts));
  for(const e of ENDINGS){ if(h>=e.minHearts && h<=e.maxHearts) return e; }
  return ENDINGS[0];
}

function triggerEnding(reason){
  // reason: 'timeup' | 'hearts'

  state.mode = 'end';
  state.paused = true;
  ending.active = true;
  ending.fade = 0;
  ending.hearts = Math.max(0, Math.min(12, state.hearts));
  ending.flashFrames = 3; // 2~3 frames; will decrement each render
  ending.frameTick = 0;
  ending.frameIdx = 0;
  // Check if this is a Game Over (0 hearts or time up)
  if(ending.hearts === 0 || reason === 'timeup'){
    ending.gameOverMode = true;
    ending.gameOverTimer = 0;
    ending.menuAlpha = 0;
    ending.selectedOption = 0;
    ending.typewriterText = '';
    ending.typewriterIndex = 0;
    ending.typewriterTimer = 0;
    ending.keyPressed = false;
    ending.menuOptions = ['再挑戰一次']; // 只保留再挑戰選項
    ending.phase = 'gameOver';
    ending.isTimeUp = (reason === 'timeup'); // 標記是否為時間結束
  } else if(ending.hearts <= 3) {
    // 生氣結局：先播放正常動畫，然後顯示重新挑戰選項
    ending.gameOverMode = false;
    ending.angryEndingMode = true;
    ending.menuAlpha = 0;
    ending.selectedOption = 0;
    ending.typewriterText = '';
    ending.typewriterIndex = 0;
    ending.typewriterTimer = 0;
    ending.keyPressed = false;
    ending.menuOptions = ['再挑戰一次'];
    ending.phase = 'showScore'; // 先正常播放動畫
    ending.isAngryEnding = true;
    ending.angryAnimationTimer = 0; // 追蹤動畫播放時間
  } else {
    ending.gameOverMode = false;
    // new flow: show score first, then play animation
    ending.cinematic = null;
    ending.phase = 'showScore'; // start with showing score
    ending.charAlpha = 1;
    ending.seqAlpha = 0;
    ending.dimmer = 0;
    ending.scoreShown = false;
    ending.seqTimerMs = 0;
    ending.titleClickArea = null; // initialize click area
    ending.titleAlpha = 0; // initialize title alpha
    ending.postOk = false; // initialize postOk
    // Initialize credits mode - start immediately for high scores
    if(ending.hearts >= 4){
      ending.creditsMode = true;
      ending.creditsScrollY = 0;
      ending.creditsTimer = 0;
      ending.creditsFinished = false;
    } else {
      ending.creditsMode = false;
      ending.creditsScrollY = 0;
      ending.creditsTimer = 0;
      ending.creditsFinished = false;
    }
    // Only show birthday message for high scores (>=4 hearts)
    ending.birthdayMessage = (ending.hearts >= 4) ? 'Happy Birthday Johnny!' : '';
    // Allow returning to start menu only for non-low scores
    ending.allowReturn = (ending.hearts >= 4);
    // choose ending background based on hearts
    if(ending.hearts <= 3){ state.bgKey = 'ending3.png'; }
    else if(ending.hearts <= 8){ state.bgKey = 'ending2.png'; }
    else { state.bgKey = 'ending1.png'; }
    
    // prepare final title per heart tier
    // set final title based on score
    if(ending.hearts < 4){
      ending.finalTitle = 'TRY AGAIN';
    } else {
      ending.finalTitle = 'LOVE YOU';
    }
    const e = pickEnding();
    ending.title = e.title;
    ending.body = e.body;
  }
  // No system modal and no key-to-restart; we stay on end screen until manual refresh
  const overlay = document.getElementById('ending-overlay');
  if(overlay){ overlay.classList.add('hidden'); }
}

function updateEnding(dt){
  ending.fade = Math.min(1, ending.fade + dt/800);
  
  // Handle Game Over mode
  if(ending.gameOverMode && ending.phase === 'gameOver'){
    ending.gameOverTimer += dt;
    
    // After 2 seconds, start showing menu
    if(ending.gameOverTimer >= 2000){
      ending.menuAlpha = Math.min(1, ending.menuAlpha + dt/500);
      
      // Typewriter effect for menu options
      if(ending.typewriterTimer <= 0){
        ending.typewriterTimer = 50; // 50ms per character
        if(ending.typewriterIndex < ending.menuOptions[0].length){
          ending.typewriterText += ending.menuOptions[0][ending.typewriterIndex];
          ending.typewriterIndex++;
        }
      } else {
        ending.typewriterTimer -= dt;
      }
    }
    
    // Handle keyboard input for Game Over menu
    if(ending.menuAlpha > 0.5){
      if(keys['Enter'] && !ending.keyPressed){
        ending.keyPressed = true;
        // Handle menu selection - only restart option
        restartGame();
      }
      
      // Reset key press flag when no keys are pressed
      if(!keys['Enter']){
        ending.keyPressed = false;
      }
    }
    
    return; // Skip normal ending logic for Game Over
  }
  
  // Handle Angry Ending mode (play animation first, then show menu)
  if(ending.angryEndingMode){
    ending.angryAnimationTimer += dt;
    
    // After 5 seconds of animation, switch to menu mode
    if(ending.angryAnimationTimer >= 5000 && ending.phase !== 'angryMenu'){
      ending.phase = 'angryMenu';
      ending.menuAlpha = 0;
      ending.typewriterText = '';
      ending.typewriterIndex = 0;
      ending.typewriterTimer = 0;
    }
    
    // Handle menu display after animation
    if(ending.phase === 'angryMenu'){
      // Start showing menu immediately
      ending.menuAlpha = Math.min(1, ending.menuAlpha + dt/500);
      
      // Typewriter effect for menu options
      if(ending.typewriterTimer <= 0){
        ending.typewriterTimer = 50; // 50ms per character
        if(ending.typewriterIndex < ending.menuOptions[0].length){
          ending.typewriterText += ending.menuOptions[0][ending.typewriterIndex];
          ending.typewriterIndex++;
        }
      } else {
        ending.typewriterTimer -= dt;
      }
      
      // Handle keyboard input for Angry Ending menu
      if(ending.menuAlpha > 0.5){
        if(keys['Enter'] && !ending.keyPressed){
          ending.keyPressed = true;
          // Handle menu selection - only restart option
          restartGame();
        }
        
        // Reset key press flag when no keys are pressed
        if(!keys['Enter']){
          ending.keyPressed = false;
        }
      }
    }
  }
  
  // ending phases: show score first, then fade out characters, then fade in ending sequence
  if(ending.phase === 'showScore'){
    // show score dialog immediately
    if(!ending.scoreShown){
      ending.scoreShown = true;
      const scoreMsg = `你得了 ${ending.hearts} 分！`;
      showDialog(scoreMsg, { pause: true });
      const ok = document.getElementById('dialog-ok');
      if(ok){ 
        ok.innerText = 'OK';
        ok.onclick = ()=>{
          // hide the dialog immediately
          const dialog = document.getElementById('dialog');
          if(dialog) dialog.classList.add('hidden');
          // Don't set postOk yet - wait until animation is complete
          ending.phase = 'charFade'; // move to next phase after OK
        };
      }
    }
  } else if(ending.phase === 'charFade'){
    // fade out characters
    ending.charAlpha = Math.max(0, ending.charAlpha - dt/600);
    if(ending.charAlpha === 0){ 
      ending.phase = 'seqFadeIn'; 
    }
  } else if(ending.phase === 'seqFadeIn'){
    // fade in ending sequence and dimmer
    ending.seqAlpha = Math.min(1, ending.seqAlpha + dt/600);
    ending.dimmer = Math.min(0.5, ending.dimmer + dt/1200);
    
    // Start animation frames only after sequence is mostly visible
    if(ending.seqAlpha >= 0.05){
      ending.frameTick += dt;
      if(ending.frameTick >= 80){ 
        ending.frameTick = 0; 
        ending.frameIdx = (ending.frameIdx + 1) % 3;
      }
    }
    
    // For low scores (<=3), just play animation without setting postOk
    // This keeps the animation playing without advancing to next phase
    
    // Debug: log ending state to see what's happening
    if(ending.frameTick % 100 === 0){ // log every 100ms
      console.log('Ending debug:', {
        phase: ending.phase,
        seqAlpha: ending.seqAlpha,
        frameIdx: ending.frameIdx,
        postOk: ending.postOk,
        mode: state.mode
      });
    }
  }
  
  // after OK: drive title/dimmer animation with dt (no RAF dependency)
  if(ending.postOk && ending.phase !== 'showScore'){
    ending.dimmer = Math.min(0.75, ending.dimmer + dt/900);
    ending.titleAlpha = Math.min(1, ending.titleAlpha + dt/800);
  }
  
  // For low scores, don't show birthday message
  // if(ending.hearts < 3 && ending.phase === 'seqFadeIn' && ending.seqAlpha >= 0.8){
  //   ending.titleAlpha = Math.min(1, ending.titleAlpha + dt/600);
  // }
  
  // For high scores, show birthday message after animation plays for a while
  if(ending.hearts >= 4 && ending.phase === 'seqFadeIn' && ending.seqAlpha >= 0.8){
    ending.titleAlpha = Math.min(1, ending.titleAlpha + dt/600);
  }
  
  // Credits are already initialized in triggerEnding for high scores
  // Handle credits scrolling - start immediately when credits mode is active
  if(ending.creditsMode){
    ending.creditsTimer += dt;
    // Start scrolling immediately to appear 30 seconds earlier
    ending.creditsScrollY += dt * 0.02; // Faster speed to appear earlier
    
    // Check if credits have finished scrolling
    const totalCreditsHeight = 35 * 40; // 40 lines * 35px spacing
    if(ending.creditsScrollY > totalCreditsHeight + canvas.height){
      ending.creditsFinished = true;
    }
  }
}

// World bounds (px) — extend wide enough so the camera can show the right side
const WORLD = { width: 4000, height: 1024 };
// Invisible walls
const LEFT_WALL_X = 400;
const RIGHT_WALL_X = 3900;

// Dynamically resolve and load background image by key or common fallbacks
function resolveBackgroundImage(){
  const desired = state.bgKey;
  const hasDims = (img)=> img && (img.naturalWidth||img.width);
  let img = SPRITES[desired];
  if(hasDims(img)) return img;
  // Build candidate list: exact, base + common extensions, and known riverside variants
  const base = desired && desired.split('.')[0] ? desired.split('.')[0] : 'bg_riverside';
  const candidates = [];
  // if desired already has extension, try it first
  if(desired && /\.(png|jpe?g)$/i.test(desired)) candidates.push(desired);
  candidates.push(base + '.png', base + '.jpg', base + '.jpeg');
  candidates.push('bg_riverside2.jpg','bg_riverside2.png','bg_riverside.jpg','bg_riverside.png');
  // Try to use any already-loaded candidate
  for(const k of candidates){
    const cand = SPRITES[k];
    if(hasDims(cand)){ state.bgKey = k; return cand; }
  }
  // Trigger lazy load for the first candidate that isn't present, with cache-busting
  for(const k of candidates){
    if(!SPRITES[k]){
      const lazy = new Image();
      lazy.src = ASSET_PATH + k + `?v=${Date.now()}`;
      SPRITES[k] = lazy;
      // no sync return; will be available in a subsequent frame
      break;
    }
  }
  return null;
}

// Question pool: random, non-repeating per session with different responses for each option
const QUESTIONS = [
  { 
    id: 1, 
    question: "你的寶貝最喜歡的甜點是？", 
    answer: "A", 
    options: [
      { key: "A", text: "冰淇淋", response: "答對~你的寶貝對冰淇淋一點抵抗力也沒有！", correct: true },
      { key: "B", text: "布丁", response: "布丁也不錯啦～但不是最喜歡的！", correct: false },
      { key: "C", text: "檸檬塔", response: "酸酸的甜點還好~", correct: false }
    ] 
  },
  { 
    id: 2, 
    question: "以下選項，你的寶貝最想去的是？", 
    answer: "A", 
    options: [
      { key: "A", text: "冰島", response: "答對！夢想就是去那看極光！", correct: true },
      { key: "B", text: "泰國", response: "也不錯！但還有更想去的~", correct: false },
      { key: "C", text: "日本", response: "也想跟寶貝去泡溫泉還有看煙火~但最想去的另有其他選項", correct: false }
    ] 
  },
  { 
    id: 3, 
    question: "你的寶貝最常對你撒嬌的方式是？", 
    answer: "A", 
    options: [
      { key: "A", text: "黏著要親親", response: "因為寶貝好可愛看到就想親親", correct: true },
      { key: "B", text: "問你愛我嗎", response: "因為說的不算數，要用做的！", correct: false },
      { key: "C", text: "坐在你身上", response: "寶貝!!!亂選!!!", correct: false }
    ] 
  },
  { 
    id: 4, 
    question: "如果你的寶貝跟你的手機掉進水裡，你要先救誰？", 
    answer: "C", 
    options: [
      { key: "A", text: "學妹", response: "哈哈", correct: false },
      { key: "B", text: "手機", response: "手機>女朋友", correct: false },
      { key: "C", text: "無論如何都是寶貝", response: "100分!!!", correct: true }
    ] 
  },
  { 
    id: 5, 
    question: "你的寶貝最喜歡你做的哪件事？", 
    answer: "C", 
    options: [
      { key: "A", text: "在快出來的時候把她推開", response: "這個很壞！", correct: false },
      { key: "B", text: "做她愛的早餐給她吃", response: "還沒吃到過QQ", correct: false },
      { key: "C", text: "計畫要養她", response: "是最幸福的事！", correct: true }
    ] 
  },
  { 
    id: 6, 
    question: "你的寶貝最喜歡的人是？", 
    answer: "B", 
    options: [
      { key: "A", text: "Chris Hemsworth", response: "NONO~", correct: false },
      { key: "B", text: "Johnny Chen", response: "答對了～全世界最愛的就是你！", correct: true },
      { key: "C", text: "Robert Pattinson", response: "錯~", correct: false }
    ] 
  },
  { 
    id: 7, 
    question: "猜猜你的寶貝現在最想要甚麼？", 
    answer: "C", 
    options: [
      { key: "A", text: "Hermès", response: "NONO~", correct: false },
      { key: "B", text: "iPhone 17", response: "不是哦~", correct: false },
      { key: "C", text: "Insta360", response: "好厲害答對了！", correct: true }
    ] 
  },
  { 
    id: 8, 
    question: "你的寶貝最想陪你一起去做的事是？", 
    answer: "A", 
    options: [
      { key: "A", text: "一起去旅行", response: "沒錯～世界那麼大，我想和你一起去看！", correct: true },
      { key: "B", text: "一起打電動", response: "打電動也開心，但我更想和你去冒險！", correct: false },
      { key: "C", text: "一起追劇", response: "追劇也甜蜜，不過旅行更浪漫呀！", correct: false }
    ] 
  },
  { 
    id: 9, 
    question: "想要變成「超級男友力 MAX」，最需要加強的是？", 
    answer: "B", 
    options: [
      { key: "A", text: "吃滿滿生蠔補鋅", response: "答錯囉~", correct: false },
      { key: "B", text: "動起來，練出好體力", response: "對！有體力才能陪寶貝一輩子！", correct: true },
      { key: "C", text: "一覺到天亮，睡飽人就好", response: "寶貝睡覺時間很棒了！最需要加強的另有其他選項", correct: false }
    ] 
  },
  { 
    id: 10, 
    question: "我們的LINE對話紀錄，出現最多次的是什麼？", 
    answer: "A", 
    options: [
      { key: "A", text: "寶貝", response: "答對！已經超過500＋", correct: true },
      { key: "B", text: "愛你", response: "'愛你'也很多～260次左右　但不是最多的！", correct: false },
      { key: "C", text: "可愛", response: "'可愛'也出現過120次左右！但不是最多得～", correct: false }
    ] 
  },
  { 
    id: 11, 
    question: "以後最想一起完成的目標是？", 
    answer: "C", 
    options: [
      { key: "A", text: "一起養很多隻動物變動物園園長", response: "雖然超愛動物，但這不是最想要的啦！", correct: false },
      { key: "B", text: "一起開亞洲餐廳", response: "這要討論一下，還是開珍珠奶茶店？", correct: false },
      { key: "C", text: "一起出國生活/旅行", response: "對！最想要的就是和你一起去探索世界！", correct: true }
    ] 
  },
  { 
    id: 12, 
    question: "如果寶貝不開心，你會怎麼做？", 
    answer: "A", 
    options: [
      { key: "A", text: "先找到不開心的原因，再好好努力解決", response: "寶貝愛你～你最懂得怎麼照顧人了！", correct: true },
      { key: "B", text: "假裝沒看到，心裡想：希望她自己會好起來", response: "只會更生氣啦！", correct: false },
      { key: "C", text: "直接壓到床上說：「來，我有特效藥」", response: "還沒經歷過，不知道呢", correct: false }
    ] 
  },
  { 
    id: 13, 
    question: "你猜猜你的寶貝對你的第一印象是什麼？", 
    answer: "A", 
    options: [
      { key: "A", text: "語氣平穩、沒有太多起伏", response: "第一眼就覺得你很沉穩有安全感！", correct: true },
      { key: "B", text: "好可愛，好想馬上帶回家", response: "雖然後來真的覺得你很可愛，但第一印象不是這個！", correct: false },
      { key: "C", text: "感覺是會去音樂祭披著毛巾的人", response: "長髮男！腦海有閃過一下", correct: false }
    ] 
  },
  { 
    id: 14, 
    question: "你的寶貝最喜歡你哪一點？", 
    answer: "A", 
    options: [
      { key: "A", text: "個性", response: "沒錯！好喜歡你的個性！", correct: true },
      { key: "B", text: "身體", response: "我有這麼膚淺嘛！", correct: false },
      { key: "C", text: "頭髮", response: "捲捲的也很可愛 不過最喜歡的不是這個~", correct: false }
    ] 
  },
  { 
    id: 15, 
    question: "第一次說『我喜歡你』是怎麼說的？", 
    answer: "A", 
    options: [
      { key: "A", text: "當面說", response: "沒錯～而且還是在床上 (///ω///)", correct: true },
      { key: "B", text: "傳訊息", response: "你記成誰了！(怒)", correct: false },
      { key: "C", text: "打電話", response: "你記成誰了！(怒)", correct: false }
    ] 
  },
  { 
    id: 16, 
    question: "我們第一次約會去哪裡？", 
    answer: "A", 
    options: [
      { key: "A", text: "電影院", response: "答對 還記得是看哪部電影嗎", correct: true },
      { key: "B", text: "咖啡廳", response: "跟誰去的 !?", correct: false },
      { key: "C", text: "公園", response: "後來有去但不是第一個地點~", correct: false }
    ] 
  }
];

// Track used questions to avoid repeats
const usedQuestions = {};
function getRandomUnusedQuestionIndex(){
  const candidates = [];
  for(let i=0;i<QUESTIONS.length;i++){ if(!usedQuestions[i]) candidates.push(i); }
  if(candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random()*candidates.length)];
  usedQuestions[pick] = true;
  return pick;
}

function init(){
  // tiles (align to camera scroll look): still stored in world coords; draw uses cameraX so they scroll with player
  for(let x=0; x < WORLD.width; x += 64){ state.tiles.push({x:x, y:384, w:64, h:32}); }
  // question blocks removed per updated design (use floating blocks/dialogs instead)
  // boys (running from right to left like Google Dino obstacles)
  // defer boys: place them far right so they are off-screen until enabled
  spawnBoy(RIGHT_WALL_X + 800);
  spawnBoy(RIGHT_WALL_X + 1200);
  // floating blocks drifting up-left (lower start so player can reach) — attach random questions non-repeating
  spawnFloatingBlock(900, 320, getRandomUnusedQuestionIndex());
  spawnFloatingBlock(1300, 320, getRandomUnusedQuestionIndex());
  spawnFloatingBlock(1700, 320, getRandomUnusedQuestionIndex());
  requestAnimationFrame(loop);
}

function spawnBoy(x){
  // align running boy at requested lower height (y = 355)
  state.boys.push({x, y:355, w:40, h:48, vx:-4, frame:0, animTick:0, fallen:false, fallTick:0, passed:false, entered:false});
}

function spawnFloatingBlock(x, y, qIndex){
  // Per-block slight randomization to avoid stacking
  const vx = -(0.24 + Math.random() * 0.12); // -0.24 .. -0.36
  const vy = -(0.05 + Math.random() * 0.06); // -0.05 .. -0.11
  state.floatingBlocks.push({ x, y, w:48, h:48, vx, vy, alive:true, animTick:0, qIndex, hit:false });
}

let lastTs = 0;
function loop(ts){
  const dt = lastTs ? Math.min(50, ts - lastTs) : 16; // clamp to avoid spikes
  lastTs = ts;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function update(dt){
  // handle ending animation updates
  if(state.mode==='end'){
    updateEnding(dt);
    return;
  }
  if(state.paused || state.mode==='intro') return;
  // countdown timer
  if(!state.timeUp){
    state.timeLeftMs = Math.max(0, state.timeLeftMs - dt);
    if(state.timeLeftMs === 0){
      // time up should trigger Game Over
      state.timeUp = true;
      triggerEnding('timeup');
    }
  }

  // player controls
  const p = state.player;
  // check collision with dog to trigger ending sequence
  if(!state.paused && state.mode==='play' && !state.dog.triggered){
    const pr = {x:p.x, y:p.y, w:p.w, h:p.h};
    const dr = {x:state.dog.x, y:state.dog.y, w:state.dog.w, h:state.dog.h};
    if(rectIntersect(pr, dr)){
      state.dog.triggered = true;
      state.dog.animIdx = 0;
      state.dog.animTick = 0;
    }
  }
  if(state.inDialog){
    // freeze player during dialog
    p.vx = 0;
    p.vy = 0;
  } else {
    p.vx = 0;
    if(keys["ArrowLeft"]||keys["a"]) { p.vx = -3; p.facing = -1; }
    if(keys["ArrowRight"]||keys["d"]) { p.vx = 3; p.facing = 1; }
    // hard stop at invisible walls: prevent movement into walls
    if(p.vx < 0 && (p.x <= LEFT_WALL_X)) p.vx = 0;
    if(p.vx > 0 && (p.x + p.w >= RIGHT_WALL_X)) p.vx = 0;
    if((keys["ArrowUp"]||keys["w"]) && p.onGround){ p.vy = -10; p.onGround=false; playSound('jump.wav'); }
    p.vy += 0.6; // gravity
    p.x += p.vx;
    p.y += p.vy;
  }
  // floor collision
  p.onGround=false;
  for(const t of state.tiles){
    if(rectIntersect(p,t)){
      if(p.vy>0 && (p.y + p.h) - t.y < 20){
        p.y = t.y - p.h;
        p.vy = 0;
        p.onGround = true;
      }
    }
  }
  // mushrooms removed
  // dog animation and ending trigger after sequence
  if(state.dog.triggered && !state.dog.finished){
    state.dog.animTick += dt;
    if(state.dog.animTick >= 180){
      state.dog.animTick = 0;
      state.dog.animIdx++;
      if(state.dog.animIdx >= 3){
        // hold last frame dog4.png
        state.dog.animIdx = 3;
        state.dog.finished = true;
        // trigger ending immediately (use hearts to pick sequence already)
        triggerEnding('dog');
      }
    }
  }
  // gating boy activation: only start running after greeting complete and 3s of forward walking
  if(state.cocoGreetedComplete && !state.boysEnabled && !state.paused){
    if(state.player.vx > 0){
      state.postGreetForwardMs = (state.postGreetForwardMs || 0) + dt;
      if(state.postGreetForwardMs >= 3000){
        state.boysEnabled = true;
        // On enabling, push boys to the right side so they appear later
        const minGapFromPlayer = 520;
        for(const b of state.boys){
          b.x = Math.max(
            RIGHT_WALL_X + 400,
            state.cameraX + canvas.width + 200,
            state.player.x + minGapFromPlayer
          );
          b.passed = false;
          b.fallen = false;
        }
      }
    }
  }
  // update boys (obstacles)
  if(!state.isCocoDialog && !state.inDialog){
  for(const b of state.boys){
    if(b.fallen){
      b.fallTick += dt;
      // keep fallen frame visible for a short duration before respawn
      if(b.fallTick >= FALL_RESPAWN_MS){
        const minGapFromPlayer = 520;
        const desiredSpawnX = Math.max(
          RIGHT_WALL_X + 400,
          state.cameraX + canvas.width + 200,
          state.player.x + minGapFromPlayer
        );
        b.x = desiredSpawnX;
        b.vx = -4;
        b.passed = false;
        b.fallen = false;
        b.fallTick = 0;
      }
      continue;
    }
    // always update position so they can fully enter screen before enabled
    b.x += b.vx;
    // loop boys only after fully leaving the viewport on the left to avoid mid-run despawn
    if(b.x + b.w < state.cameraX - 200){
      const minGapFromPlayer = 520; // ensure enough runway so player can time the jump
      const desiredSpawnX = Math.max(
        RIGHT_WALL_X + 400,
        state.cameraX + canvas.width + 200,
        state.player.x + minGapFromPlayer
      );
      b.x = desiredSpawnX;
      b.passed = false;
      b.fallen = false;
    }
    // collision with player: success if player feet are sufficiently above boy top with a tolerance
    const horizontallyOverlapping = (state.player.x + state.player.w > b.x) && (state.player.x < b.x + b.w);
    const footY = state.player.y + state.player.h;
    const boyTop = b.y;
    const jumpClearance = 6; // tolerance in px to make jumping easier
    const playerAbove = footY <= (boyTop - jumpClearance);
    // collision triggers regardless of rising; only exempt when clearly above (playerAbove)
    if(horizontallyOverlapping && !playerAbove && !b.fallen){
      b.fallen = true; b.vx = 0; b.fallTick = 0; playSound('hit.wav');
      // lose a heart when bumping into a running boy
      state.hearts = Math.max(0, state.hearts - 1);
      // hearts reaching 0 does NOT end the game; ending only via dog collision
    }
    // if player jumps over successfully (player right edge passes boy right edge), just mark passed
    if(!b.passed && (state.player.x + state.player.w > b.x + b.w)){
      b.passed = true;
    }
  }
  }
  // update floating blocks (drift up-left and disappear when hit) — skip during Coco dialog or question dialog
  if(!state.isCocoDialog && !state.inDialog){
  for(const fb of state.floatingBlocks){
    if(!fb.alive) continue;
    fb.x += fb.vx;
    fb.y += fb.vy;
    fb.animTick++;
    // collision: on any contact, collect/remove (not limited to upward motion)
    if(rectIntersect({x: state.player.x, y: state.player.y, w: state.player.w, h: state.player.h}, fb)){
      fb.alive = false;
      // defer question until player lands (no additional time delay)
      let qIdx = (typeof fb.qIndex === 'number') ? fb.qIndex : getRandomUnusedQuestionIndex();
      if(typeof qIdx === 'number' && QUESTIONS[qIdx]){
        state.pendingQuestionIdx = qIdx;
        state.pendingQuestionWaitMs = 0;
      } else {
      // fallback: award a heart if no question is available
      state.hearts = Math.min(12, state.hearts + 1);
      playSound('correct.wav');
      }
    }
    // cull if far out of bounds
    if(fb.x + fb.w < LEFT_WALL_X - 400 || fb.y + fb.h < -200){
      fb.alive = false;
    }
  }
  }
  // remove dead floating blocks
  state.floatingBlocks = state.floatingBlocks.filter(b=>b.alive);
  // trigger pending question only after player lands, and after wait ms
  if(state.pendingQuestionIdx !== null){
    if(state.player.onGround && !state.inDialog){
      openQuestion({ qIndex: state.pendingQuestionIdx });
      state.pendingQuestionIdx = null;
      state.pendingQuestionWaitMs = 0;
    }
  }
  // periodic spawn of floating blocks so they don't run out (with spacing controls)
  if(!state.paused && !state.isCocoDialog && !state.inDialog){
    state.floatingSpawnAccMs += dt;
    if(state.floatingSpawnAccMs >= FLOATING_SPAWN_INTERVAL_MS){
      state.floatingSpawnAccMs = 0;
      // if bubble boy exists, spawn near him so看起來是從他那裡吹出來
      const spawnX = state.cameraX + canvas.width + 100;
      if(spawnX - state.floatingLastSpawnX >= MIN_FLOATING_SPAWN_GAP_X){
        let spawnY = FLOATING_Y_MIN + Math.random() * (FLOATING_Y_MAX - FLOATING_Y_MIN);
        const alive = state.floatingBlocks.filter(b=>b.alive);
        for(let attempt=0; attempt<3; attempt++){
          let tooClose = false;
          for(const b of alive){ if(Math.abs(b.y - spawnY) < FLOATING_MIN_Y_SEPARATION){ tooClose = true; break; } }
          if(!tooClose) break;
          spawnY = FLOATING_Y_MIN + Math.random() * (FLOATING_Y_MAX - FLOATING_Y_MIN);
        }
        const qIdx = getRandomUnusedQuestionIndex();
        spawnFloatingBlock(spawnX, spawnY, qIdx);
        state.floatingLastSpawnX = spawnX;
      }
      // cap alive blocks
      const aliveNow = state.floatingBlocks.filter(b=>b.alive);
      if(aliveNow.length > MAX_FLOATING_BLOCKS){
        const toDisable = aliveNow.slice(0, aliveNow.length - MAX_FLOATING_BLOCKS);
        for(const b of toDisable){ b.alive = false; }
        state.floatingBlocks = state.floatingBlocks.filter(b=>b.alive);
      }
    }
  }
  // spawn logic (original fast-boy version: use fixed spawns only)
  // coco 主動朝 Johnny 走近，直到距離達到閾值再觸發對話
  const coco = state.coco;
  if(state.cocoIdle){
    // 依據相對位置朝 Johnny 移動
    const dx = (state.player.x + state.player.w/2) - (coco.x + coco.w/2);
    const absDx = Math.abs(dx);
    const desiredGap = 60;
    const speed = 1.6;
    if(absDx > desiredGap){
      coco.vx = dx > 0 ? speed : -speed;
      coco.x += coco.vx;
      coco.facing = dx > 0 ? 1 : -1; // 用 coco_left/coco_left2 展示走向 Johnny 的動畫
    } else {
      coco.vx = 0;
      // 距離達成，觸發對話
      if(!state.cocoGreeted){
        state.cocoGreeted = true;
        const playerRightOfCoco = dx >= 0;
        coco.facing = playerRightOfCoco ? 1 : -1;
        state.player.facing = playerRightOfCoco ? -1 : 1;
        state.isCocoDialog = true;
        startCocoDialogSequence();
      }
    }
  } else {
    // 非 idle 狀態保留原本動畫更新；這裡不再使用固定目標點走路
    coco.vx = 0;
    state.cocoIdle = true;
  }
  // animate coco: choose walking frames when moving, else face-only idle
  coco.animTick++;
  if(coco.animTick > 10){ coco.frame = (coco.frame + 1) % 2; coco.animTick = 0; }
  // (static question blocks removed)
  // clamp player inside invisible walls; prevent going off-screen on the right
  p.x = Math.max(LEFT_WALL_X, Math.min(p.x, RIGHT_WALL_X - p.w));
  p.y = Math.max(0, Math.min(p.y, WORLD.height - p.h));
  // also clamp coco so it doesn't wander off beyond walls (use right edge against right wall)
  coco.x = Math.max(LEFT_WALL_X, Math.min(coco.x, RIGHT_WALL_X - coco.w));
  coco.y = Math.max(0, Math.min(coco.y, WORLD.height - coco.h));
  // camera: center on player; clamp so right wall remains visible until player's right edge hits it
  const minCameraX = 0;
  const maxCameraX = Math.max(0, (RIGHT_WALL_X) - canvas.width);
  const desiredCam = (p.x + p.w/2) - (canvas.width/2);
  state.cameraX = Math.max(minCameraX, Math.min(desiredCam, maxCameraX));
  // parallax follows camera, not instantaneous player velocity
  state.bgX = state.cameraX * 0.5;
  // During any dialog, ensure both characters face each other based on Johnny's side
    if(state.inDialog){
    const playerRightOfCoco = (state.player.x + state.player.w/2) >= (state.coco.x + state.coco.w/2);
      if(state.isCocoDialog){
        // Only force facing during Coco dialog
        state.coco.facing = playerRightOfCoco ? 1 : -1; // Coco faces toward Johnny
        state.player.facing = playerRightOfCoco ? -1 : 1; // Johnny faces toward Coco
      }
  }
  // hearts cap and end condition
  // Check if hearts reached 0 and trigger game over immediately
  if(state.hearts <= 0 && !state.dog.triggered){
    state.dog.triggered = true;
    state.dog.animIdx = 0;
    state.dog.animTick = 0;
  }
  // collecting 6 hearts no longer auto-ends; must touch the dog to end
  // update animation frame (2-frame walk cycle)
  p.animTick++;
  if(p.animTick > 8){ p.frame = (p.frame+1)%2; p.animTick=0; }
}

function rectIntersect(a,b){
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // ensure crisp pixel art for all sprites (avoid looking like background blur)
  if(ctx.imageSmoothingEnabled !== false){ ctx.imageSmoothingEnabled = false; }
  
  // Handle intro mode - only show start background, no game elements
  if(state.mode === 'intro'){
    // In intro mode, we don't render anything on canvas
    // The background is handled by CSS on the start-overlay
    // This ensures the same visual size as the game
    return; // exit early, don't render any game elements
  }
  
  // scrolling background using bg_riverside
  let bg = resolveBackgroundImage();
  if(!bg){
    // final fallback to known keys if dynamic resolver hasn't loaded yet
    const candidates = ['bg_riverside2.jpg','bg_riverside2.png','bg_riverside.jpg','bg_riverside.png','bg_riverside.png'];
    for(const k of candidates){ if(SPRITES[k]){ state.bgKey = k; bg = SPRITES[k]; break; } }
  }

  // simple background selection (original behavior)
  if(!bg && !state.bgLazyAttempted){
    state.bgLazyAttempted = true;
    const candidates = ['bg_riverside2.jpg','bg_riverside2.png','bg_riverside.jpg','bg_riverside.png'];
    for(const k of candidates){ if(SPRITES[k]){ state.bgKey = k; bg = SPRITES[k]; break; } }
  }
  if(bg){
    const isEndingBG = (state.mode==='end') && /ending[123]\.(png|jpe?g)$/i.test(state.bgKey||'');
    if(isEndingBG){
      // Draw ending backgrounds to fully cover the canvas (no tiling, no parallax seams)
      ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
    } else {
      const tileW = bg.width || bg.naturalWidth || 1;
      const scroll = ((state.bgX % tileW) + tileW) % tileW; // handle negative
      // draw enough repeats to cover entire canvas plus one extra on the right
      for(let x = -scroll; x <= canvas.width; x += tileW){
        ctx.drawImage(bg, x, 0, tileW, canvas.height);
      }
    }

  } else {
    ctx.fillStyle = '#a7eaff'; ctx.fillRect(0,0,canvas.width,canvas.height);

  }
  // tiles — extend drawing to cover camera view even if tile sprites are narrower than canvas
  for(const t of state.tiles){
    const sx = t.x - state.cameraX;
    if(sx > canvas.width || sx + t.w < -64) continue;
    ctx.drawImage(SPRITES['tile.png'], sx, t.y, t.w, t.h);
  }
  // dog (decorative). Parallax with background to feel stationary relative to backdrop
  {
    const seq = ['dog1.png','dog 2.png','dog 3.png','dog4.png'];
    const key = seq[Math.min(state.dog.animIdx, seq.length-1)];
    const dogImg = SPRITES[key];
    const bgParallax = 0.5; // match background scroll factor
    const dx = state.dog.parallax ? (state.dog.x - state.cameraX * bgParallax) : (state.dog.x - state.cameraX);
    const w = state.dog.w || 64;
    const h = state.dog.h || 40;
    if(dogImg && !(dx > canvas.width || dx + w < -64)){
      if(state.mode==='end'){
        ctx.globalAlpha = Math.max(0, Math.min(1, ending.charAlpha));
      }
      ctx.drawImage(dogImg, dx, state.dog.y, w, h);
      if(state.mode==='end'){ ctx.globalAlpha = 1.0; }
    }
  }
  // (static question blocks removed)
  // floating blocks
  for(const fb of state.floatingBlocks){
    if(!fb.alive) continue;
    const sx = fb.x - state.cameraX;
    const bubbleKey = SPRITES['bubble.png'] ? 'bubble.png' : 'question.png';
    ctx.drawImage(SPRITES[bubbleKey], sx, fb.y, fb.w, fb.h);
  }
  // mushrooms removed
  // coco (moving + directional frames)
  {
    const coco = state.coco;
    const cx = coco.x - state.cameraX;
    let cocoFrame;
    if(Math.abs(coco.vx) < 0.1){
      // idle: default use stand (正面)。但若正在對話，保持面向彼此的側身，不回正面
      if(state.inDialog){
        if(state.isCocoDialog && coco.facing < 0){
          const chatKey = SPRITES['coco_chat_left.png'] ? 'coco_chat_left.png' : (SPRITES['coco chat left.png'] ? 'coco chat left.png' : null);
          cocoFrame = chatKey || 'coco_left.png';
        } else {
          cocoFrame = (coco.facing >= 0) ? 'coco_right.png' : 'coco_left.png';
        }
      } else {
        cocoFrame = (state.cocoIdle && coco.facing >= 0) ? 'coco_stand.png' : ((coco.facing >= 0) ? 'coco_right.png' : 'coco_left.png');
      }
    } else if(coco.vx > 0){
      cocoFrame = (coco.frame % 2 === 0) ? 'coco_right.png' : 'coco_right2.png';
    } else {
      cocoFrame = (coco.frame % 2 === 0) ? 'coco_left.png' : 'coco_left2.png';
    }
    if(state.mode==='end'){
      ctx.globalAlpha = Math.max(0, Math.min(1, ending.charAlpha));
    }
    ctx.drawImage(SPRITES[cocoFrame], cx, coco.y + COCO_DRAW_Y_OFFSET, coco.w, coco.h);
    if(state.mode==='end'){ ctx.globalAlpha = 1.0; }

  }
  // player sprite selection
  const p = state.player;
  let frameName;
  if(Math.abs(p.vx) < 0.1){
    // idle：預設正面站立；若正在對話，保持面向彼此的側身，不回正面
    if(state.inDialog){
      frameName = (p.facing >= 0) ? 'johnny_right.png' : 'johnny_left.png';
    } else {
      frameName = 'johnny_stand.png';
    }
  } else if(p.vx > 0){
    frameName = (p.frame % 2 === 0) ? 'johnny_right.png' : 'johnny_right2.png';
  } else {
    frameName = (p.frame % 2 === 0) ? 'johnny_left.png' : 'johnny_left2.png';
  }
  const px = p.x - state.cameraX;
  if(state.mode==='end'){
    ctx.globalAlpha = Math.max(0, Math.min(1, ending.charAlpha));
  }
  ctx.drawImage(SPRITES[frameName], px, p.y + PLAYER_DRAW_Y_OFFSET, p.w, p.h);
  if(state.mode==='end'){ ctx.globalAlpha = 1.0; }
  
  // draw boys (obstacles)
  for(const b of state.boys){
    const sx = b.x - state.cameraX;
    let boyFrameKey;
    // map possible filenames to loaded keys
    const f1 = SPRITES['boy_run_left.png'] ? 'boy_run_left.png' : (SPRITES['BOY RUN LEFT.png'] ? 'BOY RUN LEFT.png' : null);
    const f2 = SPRITES['boy_run_left2.png'] ? 'boy_run_left2.png' : (SPRITES['BOY RUN LEFT2.png'] ? 'BOY RUN LEFT2.png' : null);
    const ff = SPRITES['boy_fall_left.png'] ? 'boy_fall_left.png' : (SPRITES['BOY FALL LEFT.png'] ? 'BOY FALL LEFT.png' : null);
    if(b.fallen && ff){
      boyFrameKey = ff;
    } else if(Math.abs(b.vx) < 0.1){
      boyFrameKey = f1 || f2 || ff; // idle fallback
    } else {
      const seq = (b.frame % 2 === 0) ? (f1 || f2) : (f2 || f1);
      boyFrameKey = seq || f1 || f2 || ff;
    }
    if(boyFrameKey){
      if(state.mode==='end'){
        ctx.globalAlpha = Math.max(0, Math.min(1, ending.charAlpha));
      }
      ctx.drawImage(SPRITES[boyFrameKey], sx, b.y, b.w, b.h);
      if(state.mode==='end'){ ctx.globalAlpha = 1.0; }
    }
    // animate
    b.animTick++;
    if(b.animTick > 8){ b.frame = (b.frame+1)%2; b.animTick=0; }
  }

  // Draw in-game UI: hearts and timer at the top
  if(state.mode === 'play'){
    // Draw hearts at top-left
    const heartSize = 26;
    const heartSpacing = 6;
    const heartsStartX = 20;
    const heartsY = 20;
    
    for(let i = 0; i < state.hearts; i++){
      const heartImg = SPRITES['heart.png'];
      if(heartImg){
        const heartX = heartsStartX + i * (heartSize + heartSpacing);
        ctx.drawImage(heartImg, heartX, heartsY, heartSize, heartSize);
      }
    }
    
    // Draw timer at top-right
    const timerText = `TIME ${Math.ceil(state.timeLeftMs/1000)}s`;
    ctx.font = '16px "Zpix","UnifontLocal","Unifont","Press Start 2P",monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    
    // Timer background for better visibility
    const timerWidth = ctx.measureText(timerText).width;
    const timerX = canvas.width - 20;
    const timerY = 20;
    
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(timerX - timerWidth - 10, timerY - 5, timerWidth + 20, 26);
    
    ctx.fillStyle = '#fff';
    ctx.fillText(timerText, timerX, timerY);
    
    // Reset text alignment
    ctx.textAlign = 'left';
  }
  // celebration overlay if end
  if(state.showCelebration){
    ctx.fillStyle='rgba(0,0,0,0.05)'; ctx.fillRect(0,0,canvas.width,canvas.height);
    if(SPRITES['banner.png']) ctx.drawImage(SPRITES['banner.png'], 300, 8, 400, 64);
  }
  // draw ending content (fade characters out, then fade in ending frames over dimmed scene)
  if(state.mode==='end' && ending.active){
    
    // Handle Game Over mode
    if(ending.gameOverMode && ending.phase === 'gameOver'){
      // Complete black screen
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // GAME OVER or TIME UP text with breathing effect
      const breathingAlpha = 0.7 + 0.3 * Math.sin(ending.gameOverTimer / 1000 * Math.PI);
      ctx.globalAlpha = breathingAlpha;
      ctx.font = '72px "Unifont","UnifontLocal","Zpix","Press Start 2P",monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      let gameOverText;
      if(ending.isTimeUp) {
        gameOverText = 'TIME UP';
      } else if(ending.isAngryEnding) {
        gameOverText = 'TRY AGAIN';
      } else {
        gameOverText = 'GAME OVER';
      }
      const textWidth = ctx.measureText(gameOverText).width;
      const x = canvas.width / 2;
      const y = canvas.height / 2;
      
      // White text with black outline
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#000';
      ctx.strokeText(gameOverText, x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(gameOverText, x, y);
      
      // Menu options (appear after 2 seconds)
      if(ending.menuAlpha > 0){
        ctx.globalAlpha = ending.menuAlpha;
        ctx.font = '32px "Unifont","UnifontLocal","Zpix","Press Start 2P",monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const menuY = y + 120;
        const optionSpacing = 50;
        
        // Only one option - no need for selection logic
        const option = ending.menuOptions[0];
        const optionY = menuY;
        const displayText = `> ${option} <`;
        
        // Add cursor effect (simple scale like dialog options)
        const scale = 1.1; // Same scale as .question-option.selected
        
        ctx.save();
        ctx.translate(x, optionY);
        ctx.scale(scale, scale);
        ctx.translate(-x, -optionY);
        
        // Typewriter effect - need to account for the added > < symbols
        const baseText = option; // Just the text without > <
        const typewriterText = `> ${baseText.substring(0, ending.typewriterIndex)} <`;
        
        // Add symbolBlink effect for > < symbols (100% to 40% transparency)
        const blinkAlpha = 0.4 + 0.6 * Math.sin(ending.gameOverTimer / 1500 * Math.PI * 2);
        
        // Draw the text with blinking effect
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#000';
        ctx.strokeText(typewriterText, x, optionY);
        
        // Apply blinking effect to the text (white with varying transparency)
        ctx.globalAlpha = blinkAlpha;
        ctx.fillStyle = '#fff';
        ctx.fillText(typewriterText, x, optionY);
        ctx.globalAlpha = 1.0; // Reset alpha
        
        ctx.restore();
      }
      
      ctx.globalAlpha = 1.0;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      return;
    }
    
    // Handle Angry Ending mode (keep background, show menu)
    if(ending.angryEndingMode && ending.phase === 'angryEnding'){
      // Draw the background animation normally (don't return early)
      // The menu will be drawn after the background animation
    }

    ctx.save();
    // dim the scene gradually
    if(ending.dimmer > 0){
      ctx.globalAlpha = Math.max(0, Math.min(1, ending.dimmer));
      ctx.fillStyle = '#000';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.globalAlpha = 1.0;
    }
    // pick ending sequence by hearts (angry/cake/kiss)
    let seqKeys;
    if(ending.hearts <= 3){ seqKeys = ['angry01.png','angry02.png','angry03.png']; }
    else if(ending.hearts <= 8){ seqKeys = ['cake01.png','cake02.png','cake03.png']; }
    else { seqKeys = ['kiss01.png','kiss02.png','kiss03.png']; }
    
    // Only draw animation when seqAlpha > 0
    if(ending.seqAlpha > 0.01){
      const frameKey = seqKeys[ending.frameIdx] || seqKeys[0];
      const base = SPRITES[frameKey];

      if(base){
        ctx.globalAlpha = Math.max(0, Math.min(1, ending.seqAlpha));
        // draw centered
        const size = Math.min(512, Math.floor(canvas.height * 0.8));
        const dx = Math.round(canvas.width/2 - size/2);
        const dy = Math.round(canvas.height/2 - size/2);
        ctx.drawImage(base, dx, dy, size, size);
        ctx.globalAlpha = 1.0;
      }
    }
    // after OK pressed, fade in final big title
    if(ending.postOk && ending.titleAlpha > 0){
      const alpha = Math.max(0, Math.min(1, ending.titleAlpha));
      ctx.globalAlpha = alpha;
      const title = ending.finalTitle || '';
      // big readable font with outline to avoid blending into dark background
      ctx.font = '40px "Unifont","UnifontLocal","Zpix","Press Start 2P",monospace';
      const tw = Math.max(1, ctx.measureText(title).width);
      const tx = Math.round(canvas.width/2 - tw/2);
      const ty = Math.round(canvas.height/2 + 120);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(title, tx, ty);
      ctx.fillStyle = '#fff';
      ctx.fillText(title, tx, ty);
      
      // Store click area for TRY AGAIN interaction
      if(ending.finalTitle === 'TRY AGAIN'){
        ending.titleClickArea = {
          x: tx - 20, // add some padding
          y: ty - 40,
          w: tw + 40,
          h: 80
        };
      }
      
      ctx.globalAlpha = 1.0;
    }
    
    // Birthday message removed - now shown in credits instead
    // if(ending.titleAlpha > 0 && ending.birthdayMessage){
    //   // ... birthday message rendering code removed
    // }
    
    // Show credits with ending animation (only when ending is active)
    if(ending.active && ending.creditsMode && !ending.creditsFinished){
      // Don't cover background - let animation show through
      // ctx.fillStyle = '#000';
      // ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Credits content
      const credits = [
        { text: "【Happy Birthday Johnny 🎉】", size: 36, color: '#FFD700' },
        { text: "A Special Game Just for You", size: 24, color: '#FFFFFF' },
        { text: "", size: 16, color: '#FFFFFF' }, // Empty line
        { text: "製作人：你的寶貝 💕", size: 20, color: '#FFFFFF' },
        { text: "劇本：Our Story", size: 20, color: '#FFFFFF' },
        { text: "場景：淡水河畔", size: 20, color: '#FFFFFF' },
        { text: "主演：Johnny ✦ Coco", size: 20, color: '#FFFFFF' },
        { text: "", size: 16, color: '#FFFFFF' }, // Empty line
        { text: "─────────────────────────", size: 16, color: '#FFFFFF' },
        { text: "", size: 16, color: '#FFFFFF' }, // Empty line
        { text: "Special Thanks to", size: 24, color: '#FFD700' },
        { text: "- 你的體貼入微", size: 18, color: '#FFFFFF' },
        { text: "- 你的可靠穩重", size: 18, color: '#FFFFFF' },
        { text: "- 你的上進努力", size: 18, color: '#FFFFFF' },
        { text: "- 你的聰明腦袋", size: 18, color: '#FFFFFF' },
        { text: "", size: 16, color: '#FFFFFF' }, // Empty line
        { text: "─────────────────────────", size: 16, color: '#FFFFFF' },
        { text: "", size: 16, color: '#FFFFFF' }, // Empty lin
        { text: "生日快樂～～～寶貝 🎂", size: 20, color: '#FFFFFF' },
        { text: "謝謝你出現在我的生活裡", size: 18, color: '#FFFFFF' },
        { text: "讓我每一天都有個甜蜜的陪伴", size: 18, color: '#FFFFFF' },
        { text: "", size: 16, color: '#FFFFFF' }, // Empty line
        { text: "未來我們會一起去更多地方旅行", size: 18, color: '#FFFFFF' },
        { text: "一起看更多場日出與日落", size: 18, color: '#FFFFFF' },
        { text: "一起養一隻狗狗（還有可能更多）", size: 18, color: '#FFFFFF' },
        { text: "一起完成我們寫下的每個夢想", size: 18, color: '#FFFFFF' },
        { text: "", size: 16, color: '#FFFFFF' }, // Empty line
        { text: "有你在，一切美好都感覺會實現 ❤️", size: 18, color: '#FFFFFF' },
        { text: "", size: 16, color: '#FFFFFF' }, // Empty line
        { text: "─────────────────────────", size: 16, color: '#FFFFFF' },
        { text: "", size: 16, color: '#FFFFFF' }, // Empty line
        { text: "The End?", size: 24, color: '#FFD700' },
        { text: "No. Just The Beginning ♥", size: 24, color: '#FFFFFF' },
        { text: "", size: 16, color: '#FFFFFF' }, // Empty line
        { text: "© 2025 Love Studio. All Rights Reserved.", size: 16, color: '#FFFFFF' }
      ];
      
      // Render credits with scrolling effect
      credits.forEach((credit, index) => {
        if(credit.text === "") return; // Skip empty lines
        
        const y = canvas.height + 50 - ending.creditsScrollY + (index * 35);
        
        // Only render if visible on screen
        if(y > -50 && y < canvas.height + 50){
          ctx.font = `${credit.size}px "Unifont","UnifontLocal","Zpix","Press Start 2P",monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // Enhanced text shadow for better readability on animation background
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.strokeText(credit.text, canvas.width / 2, y);
          
          // Add glow effect for better visibility
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.strokeText(credit.text, canvas.width / 2, y);
          
          ctx.fillStyle = credit.color;
          ctx.fillText(credit.text, canvas.width / 2, y);
        }
      });
      
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
    
    // Return to main menu when credits are finished (only when ending is active)
    if(ending.active && ending.creditsMode && ending.creditsFinished){
      // Automatically return to start screen after credits finish
      returnToStartScreen();
    }
    
    // black flash on very top for first ~2-3 frames
    if(ending.flashFrames > 0){
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = '#000';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ending.flashFrames--;
    }
    
    // Draw Angry Ending menu over the background animation
    if(ending.angryEndingMode && ending.phase === 'angryMenu' && ending.menuAlpha > 0){
      ctx.globalAlpha = ending.menuAlpha;
      
      // Semi-transparent overlay for better text readability
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // TRY AGAIN text
      ctx.font = '72px "Unifont","UnifontLocal","Zpix","Press Start 2P",monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      const x = canvas.width / 2;
      const y = canvas.height / 2 - 50;
      
      // White text with black outline
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#000';
      ctx.strokeText('TRY AGAIN', x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText('TRY AGAIN', x, y);
      
      // Menu options
      ctx.font = '32px "Unifont","UnifontLocal","Zpix","Press Start 2P",monospace';
      const menuY = y + 120;
      
      // Only one option - no need for selection logic
      const option = ending.menuOptions[0];
      const optionY = menuY;
      
      // Typewriter effect with cursor effects
      const baseText = option;
      const typewriterText = `> ${baseText.substring(0, ending.typewriterIndex)} <`;
      
      // Add cursor effect (simple scale like dialog options)
      const scale = 1.1; // Same scale as .question-option.selected
      
      ctx.save();
      ctx.translate(x, optionY);
      ctx.scale(scale, scale);
      ctx.translate(-x, -optionY);
      
      // Add symbolBlink effect for > < symbols (100% to 40% transparency)
      const blinkAlpha = 0.4 + 0.6 * Math.sin(ending.angryAnimationTimer / 1500 * Math.PI * 2);
      
      // Draw the text with blinking effect
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      ctx.strokeText(typewriterText, x, optionY);
      
      // Apply blinking effect to the text (white with varying transparency)
      ctx.globalAlpha = blinkAlpha;
      ctx.fillStyle = '#fff';
      ctx.fillText(typewriterText, x, optionY);
      ctx.globalAlpha = 1.0; // Reset alpha
      
      ctx.restore();
      
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
    
    ctx.restore();
  }
  // time-up angry slideshow overlay
  if(state.showAngry){
    state.angryTick++;
    if(state.angryTick > 20){ state.angryFrame = (state.angryFrame+1)%2; state.angryTick=0; }
    const key = state.angryFrame===0 ? 'angry.jpg' : 'angry2.jpg';
    const img = SPRITES[key];
    if(img){
      ctx.globalAlpha = 1.0;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
  }
}

function openQuestion(qb){
  // Don't pause the game during questions - let time continue counting
  // state.paused = true; // 移除這行，讓時間繼續倒數
  state.inDialog = true;
  const q = QUESTIONS[qb.qIndex];
  const modal = document.getElementById('question-modal');
  modal.classList.remove('hidden');
  
  // Apply coco-dialog styling to match the dialogue design
  modal.classList.add('coco-dialog');
  
  const qTitle = document.getElementById('q-title');
  qTitle.innerText = q.question;
  qTitle.classList.add('pixel-title');
  
  const opts = document.getElementById('q-options');
  let selected = 0;
  let optionButtons = [];
  
  function renderOptions(){
    opts.innerHTML = '';
    optionButtons = [];
    
    q.options.forEach((opt, idx)=>{
      if (idx === selected) {
        const selectedOption = document.createElement('div');
        selectedOption.innerHTML = `<span class="option-selected"><span class="symbol-left">></span> ${opt.text} <span class="symbol-right"><</span></span>`;
        selectedOption.className = 'question-option selected';
        selectedOption.onclick = ()=> handlePick(idx);
        optionButtons.push(selectedOption);
        opts.appendChild(selectedOption);
      } else {
        const option = document.createElement('div');
        option.innerText = opt.text;
        option.className = 'question-option';
        option.onclick = ()=> handlePick(idx);
        optionButtons.push(option);
        opts.appendChild(option);
      }
    });
  }
  
  const handlePick = (idx)=>{
    const selectedOption = q.options[idx];
    const isCorrect = selectedOption.correct;
    
    if(isCorrect){
      // Correct answer: add heart
      const newHearts = Math.min(12, state.hearts + 1);
      state.hearts = newHearts;
      playSound('correct.wav');
      
      // Close question UI and show response
      modal.classList.add('hidden');
      window.removeEventListener('keydown', onKey);
      state.inDialog = false;
      state.paused = false;
      
      // Show the specific response for this option
      showDialog(selectedOption.response);
    } else {
      // Wrong answer: deduct heart
      playSound('hit.wav');
      state.hearts = Math.max(0, state.hearts - 1);
      
      // Close question modal and resume game
      modal.classList.add('hidden');
      window.removeEventListener('keydown', onKey);
      state.paused = false;
      state.inDialog = false;
      
      // Show the specific response for this option
      showDialog(selectedOption.response);
    }
  };
  
  const onKey = (e)=>{
    if(e.key==='ArrowUp'){ 
      selected = (selected - 1 + q.options.length) % q.options.length; 
      renderOptions(); 
    }
    else if(e.key==='ArrowDown'){ 
      selected = (selected + 1) % q.options.length; 
      renderOptions(); 
    }
    else if(e.key==='Enter'){
      if(optionButtons[selected]){ 
        optionButtons[selected].click(); 
      } else { 
        handlePick(selected); 
      }
    }
  };
  
  window.addEventListener('keydown', onKey);
  const observer = new MutationObserver(()=>{ 
    if(modal.classList.contains('hidden')){
      window.removeEventListener('keydown', onKey); 
      observer.disconnect(); 
    } 
  });
  observer.observe(modal, { attributes:true, attributeFilter:['class'] });
  
  renderOptions();
}

function showDialog(text, opts){
  const d = document.getElementById('dialog');
  const dText = document.getElementById('dialog-text');
  dText.innerText = text;
  dText.classList.add('pixel-text');
  d.classList.remove('hidden');
  const ok = document.getElementById('dialog-ok');
  ok.classList.add('pixel-btn');
  state.inDialog = true;
  const shouldPause = opts && opts.pause === true;
  if(shouldPause){ state.paused = true; }
  
  // Special handling for Controls dialog with back button
  if(text.includes('Controls')){
    d.classList.add('controls-dialog');
    // Format the Controls text with HTML for styling
    const lines = text.split('\n');
    const title = lines[0]; // "Controls"
    const content = lines.slice(2).join('\n'); // Skip empty line after title
    dText.innerHTML = `<span class="controls-title">${title}</span>\n\n${content}`;
    
    ok.innerHTML = '> BACK <';
    // Hide the start menu and title when showing Controls dialog
    const startMenu = document.getElementById('start-menu');
    const startTitle = document.querySelector('#start-overlay .start-title');
    if(startMenu) startMenu.style.display = 'none';
    if(startTitle) startTitle.style.display = 'none';
    
    ok.onclick = ()=> {
      d.classList.add('hidden');
      d.classList.remove('controls-dialog');
      state.inDialog = false;
      if(shouldPause){ state.paused = false; }
      window.removeEventListener('keydown', onKey);
      // Show the start menu and title again when returning
      if(startMenu) startMenu.style.display = 'block';
      if(startTitle) startTitle.style.display = 'block';
      // Don't return to start screen, just close dialog
    };
  } else {
    ok.innerText = 'OK';
    ok.onclick = ()=> {
      d.classList.add('hidden');
      state.inDialog = false;
      if(shouldPause){ state.paused = false; }
      window.removeEventListener('keydown', onKey);
    };
  }
  
  const onKey = (e)=>{ if(e.key === 'Enter'){ ok.click(); } };
  window.addEventListener('keydown', onKey);
}

function startCocoDialogSequence(){
  const dialogData = {
    phase: 'intro', // intro -> options -> responses -> mainline -> end
    introLines: [
      'COCO：嘿～你終於來啦！今天是你的 28 歲生日冒險之日！',
      'COCO：我做了一個小小的挑戰送給你，準備好開始了嗎？'
    ],
    options: [
      '哇！妳還特地準備了遊戲給我？',
      '冒險？該不會有陷阱吧……',
      '當然！我超期待的！'
    ],
    responses: {
      // 選項1：哇！妳還特地準備了遊戲給我？
      0: {
        coco: [
          'COCO：嘿嘿，不然你以為我平常偷偷在忙什麼？有沒有感受到滿滿的用心 ❤',
          'COCO：哼哼，你女朋友很專業吧！',
          'COCO：就算準備到半夜，我也覺得值得 ❤'
        ],
        johnny: [
          'JOHNNY：哈哈～真的好幸福，有妳在最棒了！',
          'JOHNNY：哇，我好像找到全世界最好的女朋友！',
          'JOHNNY：寶貝太強了！這麼用心 ❤'
        ]
      },
      // 選項2：冒險？該不會有陷阱吧……
      1: {
        coco: [
          'COCO：被你發現了？不過就算有陷阱，我也會陪你 ❤'
        ],
        johnny: [
          'JOHNNY：哈哈～那我就放心了！'
        ]
      },
      // 選項3：當然！我超期待的！
      2: {
        coco: [
          'COCO：就知道你會這麼說～果然是我的寶貝！'
        ],
        johnny: [
          'JOHNNY：那就開始吧，我準備大顯身手！'
        ]
      }
    },
    mainline: [
      'COCO：開始之前提醒你～小心別被小男孩撞到啦～',
      'COCO：碰到泡泡回答問題，答對就能得到一顆愛心 ❤',
      'COCO：最後看看你會解鎖什麼樣的生日結局吧！'
    ]
  };
  
  const d = document.getElementById('dialog');
  const dText = document.getElementById('dialog-text');
  const ok = document.getElementById('dialog-ok');
  
  let currentPhase = 'intro';
  let lineIdx = 0;
  let selectedOption = 0;
  
  state.inDialog = true;
  state.dialogSeqActive = true;
  d.classList.remove('hidden');
  dText.classList.add('pixel-text');
  
  function showIntro(){
    // Add coco-intro class for consistent styling
    d.classList.add('coco-intro');
    
    if(lineIdx < dialogData.introLines.length){
      dText.innerText = dialogData.introLines[lineIdx];
      ok.innerText = '▼';
      ok.onclick = advanceIntro;
    } else {
      showOptions();
    }
  }
  
  function advanceIntro(){
    lineIdx++;
    if(lineIdx < dialogData.introLines.length){
      dText.innerText = dialogData.introLines[lineIdx];
    } else {
      showOptions();
    }
  }
  
  function showOptions(){
    currentPhase = 'options';
    lineIdx = 0;
    selectedOption = 0;
    
    // Remove intro class and add options class for styling
    d.classList.remove('coco-intro');
    d.classList.add('coco-dialog');
    
    const optionsHtml = dialogData.options.map((option, idx) => {
      const selected = idx === selectedOption;
      if (selected) {
        return `<span class="option-selected"><span class="symbol-left">></span> ${option} <span class="symbol-right"><</span></span>`;
      } else {
        return `  ${option}  `;
      }
    }).join('\n');
    
    dText.innerHTML = optionsHtml.replace(/\n/g, '<br>');
    ok.innerText = '▼';
    ok.onclick = selectOption;
    
    // Add keyboard navigation for options
    const onKeyOptions = (e) => {
      if(e.key === 'ArrowUp'){
        selectedOption = (selectedOption - 1 + dialogData.options.length) % dialogData.options.length;
        renderOptions();
      } else if(e.key === 'ArrowDown'){
        selectedOption = (selectedOption + 1) % dialogData.options.length;
        renderOptions();
      } else if(e.key === 'Enter'){
        selectOption();
      }
    };
    
    window.addEventListener('keydown', onKeyOptions);
    
    function renderOptions(){
      const optionsHtml = dialogData.options.map((option, idx) => {
        const selected = idx === selectedOption;
        if (selected) {
          return `<span class="option-selected"><span class="symbol-left">></span> ${option} <span class="symbol-right"><</span></span>`;
        } else {
          return `  ${option}  `;
        }
      }).join('\n');
      
      dText.innerHTML = optionsHtml.replace(/\n/g, '<br>');
    }
    
    function selectOption(){
      window.removeEventListener('keydown', onKeyOptions);
      showResponse();
    }
  }
  
  function showResponse(){
    currentPhase = 'response';
    // Randomly select COCO's response from available options
    const cocoResponses = dialogData.responses[selectedOption].coco;
    const randomCocoIndex = Math.floor(Math.random() * cocoResponses.length);
    const selectedCocoResponse = cocoResponses[randomCocoIndex];
    
    dText.innerText = selectedCocoResponse;
    ok.innerText = '▼';
    ok.onclick = showJohnnyResponse;
  }
  
  function showJohnnyResponse(){
    currentPhase = 'johnnyResponse';
    // Randomly select JOHNNY's response from available options
    const johnnyResponses = dialogData.responses[selectedOption].johnny;
    const randomJohnnyIndex = Math.floor(Math.random() * johnnyResponses.length);
    const selectedJohnnyResponse = johnnyResponses[randomJohnnyIndex];
    
    dText.innerText = selectedJohnnyResponse;
    ok.innerText = '▼';
    ok.onclick = showMainline;
  }
  
  function showMainline(){
    currentPhase = 'mainline';
    lineIdx = 0;
    dText.innerText = dialogData.mainline[lineIdx];
    ok.innerText = '▼';
    ok.onclick = advanceMainline;
  }
  
  function advanceMainline(){
    lineIdx++;
    if(lineIdx < dialogData.mainline.length){
      dText.innerText = dialogData.mainline[lineIdx];
      ok.innerText = '▼';
    } else {
      endDialog();
    }
  }
  
  function endDialog(){
    d.classList.add('hidden');
    d.classList.remove('coco-dialog'); // Remove coco-dialog class
    d.classList.remove('coco-intro'); // Remove coco-intro class
    state.inDialog = false;
    state.dialogSeqActive = false;
    state.isCocoDialog = false;
    state.cocoGreetedComplete = true;
    ok.innerText = 'OK';
    window.removeEventListener('keydown', onKey);
    ok.onclick = null;
  }
  
  // Start with intro
  showIntro();
  
  // Handle Enter key for all phases
  function onKey(e){ 
    if(e.key === 'Enter'){
      if(currentPhase === 'intro'){
        advanceIntro();
      } else if(currentPhase === 'response'){
        showJohnnyResponse();
      } else if(currentPhase === 'johnnyResponse'){
        showMainline();
      } else if(currentPhase === 'mainline'){
        advanceMainline();
      }
    }
  }
  window.addEventListener('keydown', onKey);
}

function showRetryDialog(){
  const modal = document.getElementById('retry-modal');
  const yes = document.getElementById('retry-yes');
  const no = document.getElementById('retry-no');
  modal.classList.remove('hidden');
  yes.onclick = ()=>{
    modal.classList.add('hidden');
    restartGame();
  };
  no.onclick = ()=>{
    modal.classList.add('hidden');
    state.paused = false;
  };
}

function returnToStartScreen(){
  // Reset to initial start screen state
  state.mode = 'intro';
  state.paused = true;
  state.bgKey = 'start_bg.png';
  
  // Reset all game state
  state.player.x = LEFT_WALL_X + 20;
  state.player.y = 300;
  state.player.vx = 0;
  state.player.vy = 0;
  state.player.onGround = false;
  state.player.frame = 0;
  state.player.animTick = 0;
  state.coco.x = 800;
  state.coco.y = 328;
  state.coco.facing = 1;
  state.cocoIdle = true;
  state.cocoHasTurnedLeft = false;
  state.cocoGreeted = false;
  state.cocoGreetedComplete = false;
  state.postGreetForwardMs = 0;
  state.boysEnabled = false;
  state.coco.vx = 0;
  state.coco.frame = 0;
  state.coco.animTick = 0;
  state.cameraX = Math.max(LEFT_WALL_X, state.player.x - 240);
  state.bgX = 0;
  state.hearts = 3;
  state.timeLeftMs = state.timeLimitMs;
  state.timeUp = false;
  state.showAngry = false;
  state.angryTick = 0;
  state.angryFrame = 0;
  state.showCelebration = false;
  state.boys = [];
  state.boySpawnAccMs = 0;
  state.floatingBlocks = [];
  state.tiles = [];
  
  // Reset dog state
  state.dog.triggered = false;
  state.dog.finished = false;
  state.dog.animIdx = 0;
  state.dog.animTick = 0;
  
  // Reset question usage
  try{ for(const k in usedQuestions){ delete usedQuestions[k]; } }catch(_e){}
  
  // Reset ending state
  ending.active = false;
  ending.phase = 'showScore';
  ending.charAlpha = 1;
  ending.seqAlpha = 0;
  ending.dimmer = 0;
  ending.scoreShown = false;
  ending.seqTimerMs = 0;
  ending.titleClickArea = null;
  ending.postOk = false;
  ending.titleAlpha = 0;
  ending.birthdayMessage = ''; // Reset birthday message
  ending.allowReturn = false;
  ending.gameOverMode = false;
  ending.gameOverTimer = 0;
  ending.menuAlpha = 0;
  ending.selectedOption = 0;
  ending.typewriterText = '';
  ending.typewriterIndex = 0;
  ending.typewriterTimer = 0;
  ending.keyPressed = false;
  ending.isTimeUp = false;
  ending.isAngryEnding = false;
  ending.angryEndingMode = false;
  ending.angryAnimationTimer = 0;
  ending.creditsMode = false;
  ending.creditsScrollY = 0;
  ending.creditsTimer = 0;
  ending.creditsFinished = false;
  
  // Show start overlay
  const overlay = document.getElementById('start-overlay');
  if(overlay){ 
    overlay.classList.remove('hidden'); 
    overlay.style.display = 'block';
  }
  
  // Re-enable start screen event listeners
  enableStartScreenEvents();
}

function enableStartScreenEvents(){
  // Re-enable start screen menu and controls
  const overlay = document.getElementById('start-overlay');
  const menuPre = document.getElementById('start-menu');
  
  if(menuPre){
    const items = ['How to Play','Start'];
    let idx = 1; // default focus on Start
    const renderMenu = ()=>{
      const lines = items.map((t, i)=>{
        const selected = (i===idx);
        if (selected) {
          return `<span class="option-selected"><span class="symbol-left">></span> ${t} <span class="symbol-right"><</span></span>`;
        } else {
          return `  ${t}  `;
        }
      });
      menuPre.innerHTML = lines.join('\n');
    };
    renderMenu();
    
    // mouse click choose support
    menuPre.onclick = (e)=>{
      const lineHeight = 24;
      const rect = menuPre.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const line = Math.max(0, Math.min(items.length-1, Math.floor(y / lineHeight)));
      idx = line; renderMenu();
      choose();
    };
    
    function choose(){
      if(items[idx]==='How to Play'){
        const msg = ['Controls','','↑ Up: Jump','← → Left/Right: Move','Avoid obstacles on the ground','Jump to touch floating bubbles and trigger quiz dialogues','Press Enter to select an answer or proceed to the next step'].join('\n');
        showDialog(msg, { pause: true });
      } else {
        if(overlay){ overlay.classList.add('hidden'); overlay.style.display = 'none'; }
        state.bgKey = 'bg_riverside2.jpg';
        state.mode = 'play';
        state.paused = false;
        restartGame();
      }
    }
    
    const onKeyMenu = (e)=>{
      if(e.key==='ArrowUp'){ idx = (idx - 1 + items.length) % items.length; renderMenu(); }
      else if(e.key==='ArrowDown'){ idx = (idx + 1) % items.length; renderMenu(); }
      else if(e.key==='Enter' || e.key==='z' || e.key==='Z'){ choose(); }
    };
    window.addEventListener('keydown', onKeyMenu);
  }
}

function restartGame(){
  // reset core state to initial values
  state.mode = 'play';
  state.player.x = LEFT_WALL_X + 20;
  state.player.y = 300;
  state.player.vx = 0;
  state.player.vy = 0;
  state.player.onGround = false;
  state.player.frame = 0;
  state.player.animTick = 0;
  state.coco.x = 800;
  state.coco.y = 328;
  state.coco.facing = 1;
  state.cocoIdle = true;
  state.cocoHasTurnedLeft = false;
  state.cocoGreeted = false;
  state.cocoGreetedComplete = false;
  state.postGreetForwardMs = 0;
  state.boysEnabled = false;
  state.coco.vx = 0;
  state.coco.frame = 0;
  state.coco.animTick = 0;
  state.bgX = 0;
  state.hearts = 3;
  // reset timer and flags
  state.timeLeftMs = state.timeLimitMs;
  state.timeUp = false;
  state.showAngry = false;
  state.angryTick = 0;
  state.angryFrame = 0;
  state.showCelebration = false;
  state.paused = false;
  
  // Reset dialog states
  state.inDialog = false;
  state.dialogSeqActive = false;
  state.isCocoDialog = false;
  state.pendingQuestionIdx = null; // Reset pending question
  state.pendingQuestionWaitMs = 0; // Reset pending question timer
  state.approachActive = true; // Reset approach state
  state.cocoWalkTriggered = false; // Reset coco walk state
  state.introTick = 0; // Reset intro timer
  state.showDebugBG = false; // Reset debug background flag
  state.bgLazyAttempted = false; // Reset background lazy loading flag
  
  // Reset ending state
  ending.gameOverMode = false;
  ending.gameOverTimer = 0;
  ending.menuAlpha = 0;
  ending.selectedOption = 0;
  ending.typewriterText = '';
  ending.typewriterIndex = 0;
  ending.typewriterTimer = 0;
  ending.keyPressed = false;
  ending.isTimeUp = false;
  ending.isAngryEnding = false;
  ending.angryEndingMode = false;
  ending.angryAnimationTimer = 0;
  
  // Reset game objects
  state.boys = [];
  state.boySpawnAccMs = 0;
  state.floatingBlocks = [];
  state.floatingSpawnAccMs = 0; // Reset floating spawn timer
  state.floatingLastSpawnX = -Infinity; // Reset floating spawn position
  state.tiles = [];
  state.questions = []; // Initialize questions array
  state.mushrooms = []; // Reset mushrooms array
  
  // Reset dog state
  state.dog.triggered = false;
  state.dog.finished = false;
  state.dog.animIdx = 0;
  state.dog.animTick = 0;
  
  // Set camera position BEFORE initializing game objects
  state.cameraX = Math.max(LEFT_WALL_X, state.player.x - 240);
  
  // Reinitialize game objects
  for(let x=0; x < WORLD.width; x += 64){ 
    state.tiles.push({x:x, y:384, w:64, h:32}); 
  }
  spawnBoy(state.cameraX + canvas.width + 200);
  spawnFloatingBlock(900, 320, getRandomUnusedQuestionIndex());
  spawnFloatingBlock(1300, 320, getRandomUnusedQuestionIndex());
  spawnFloatingBlock(1700, 320, getRandomUnusedQuestionIndex());
  
  // reset question usage
  try{ for(const k in usedQuestions){ delete usedQuestions[k]; } }catch(_e){}
  
  // Reset animation frame timing to prevent speed issues
  lastTs = 0;
  
  // Reset all key states to prevent stuck keys
  for(const key in keys) {
    keys[key] = false;
  }
}

function playSound(name){
  // placeholder: if assets are real audio files, we can play them
  try{
    const url = ASSET_PATH + name;
    const a = new Audio(url);
    a.play().catch(()=>{});
  }catch(e){}
}

// allow down key to interact with nearby blocks
window.addEventListener('keydown',(e)=>{
  if(e.key==='ArrowDown'){
    const p = state.player;
    for(const qb of state.questions){
      if(Math.abs((qb.x+qb.w/2) - (p.x+p.w/2)) < 48){ if(!qb.hit) openQuestion(qb); qb.hit=true; }
    }
  }
});

window.addEventListener('load',()=>{
  // show start overlay and pause everything until click
  state.mode = 'intro';
  state.paused = true;
  // use start background
  state.bgKey = 'start_bg.png';
  const overlay = document.getElementById('start-overlay');
  const btn = document.getElementById('start-btn');
  const howto = document.getElementById('howto-btn');
  const menuPre = document.getElementById('start-menu');

  if(overlay){ overlay.classList.remove('hidden'); }
  // apply full-screen start background
  try{ overlay.style.backgroundImage = 'url(' + ASSET_PATH + 'start_bg.png)'; }catch(_e){}
  // allow Enter to start the game as well
  const onStartKey = (e)=>{
    if(state.mode==='intro' && e.key==='Enter'){
      if(btn){ btn.click(); }
    }
  };
  window.addEventListener('keydown', onStartKey);
  // Build retro RPG menu with cursor and keyboard control
  if(menuPre){
    const items = ['How to Play','Start'];
    let idx = 1; // default focus on Start
    const renderMenu = ()=>{
      const lines = items.map((t, i)=>{
        const selected = (i===idx);
        if (selected) {
          return `<span class="option-selected"><span class="symbol-left">></span> ${t} <span class="symbol-right"><</span></span>`;
        } else {
          return `  ${t}  `;
        }
      });
      menuPre.innerHTML = lines.join('\n');
    };
    renderMenu();
    // mouse click choose support
    menuPre.onclick = (e)=>{
      const lineHeight = 24;
      const rect = menuPre.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const line = Math.max(0, Math.min(items.length-1, Math.floor(y / lineHeight)));
      idx = line; renderMenu();
      choose();
    };
    function choose(){
      if(items[idx]==='How to Play'){
        const msg = ['Controls','','↑ Up: Jump','← → Left/Right: Move','Avoid obstacles on the ground','Jump to touch floating bubbles and trigger quiz dialogues','Press Enter to select an answer or proceed to the next step'].join('\n');
        // ensure overlay keeps visible behind dialog
        showDialog(msg, { pause: true });
              } else {
          if(overlay){ overlay.classList.add('hidden'); overlay.style.display = 'none'; }
          // restore default game background before start
          state.bgKey = 'bg_riverside2.jpg';
          state.mode = 'play';
          state.paused = false;
          restartGame();
          window.removeEventListener('keydown', onStartKey);
          window.removeEventListener('keydown', onKeyMenu);
          menuPre.onclick = null;
        }
    }
    const onKeyMenu = (e)=>{
      if(e.key==='ArrowUp'){ idx = (idx - 1 + items.length) % items.length; renderMenu(); }
      else if(e.key==='ArrowDown'){ idx = (idx + 1) % items.length; renderMenu(); }
      else if(e.key==='Enter' || e.key==='z' || e.key==='Z'){ choose(); }
    };
    window.addEventListener('keydown', onKeyMenu);
  }
  
  // Add canvas click event for TRY AGAIN interaction - only if allowed
  canvas.addEventListener('click', (e) => {
    if(state.mode === 'end' && ending.active && ending.titleClickArea){
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // Check if click is within TRY AGAIN text area
      if(x >= ending.titleClickArea.x && x <= ending.titleClickArea.x + ending.titleClickArea.w &&
         y >= ending.titleClickArea.y && y <= ending.titleClickArea.y + ending.titleClickArea.h){
        if(ending.finalTitle === 'TRY AGAIN' && ending.allowReturn){
          // Return to initial start screen instead of restarting game
          returnToStartScreen();
        }
      }
    }
  });
  
  // Add keyboard event for TRY AGAIN (Enter key) - only if allowed
  window.addEventListener('keydown', (e) => {
    if(state.mode === 'end' && ending.active && ending.finalTitle === 'TRY AGAIN' && e.key === 'Enter'){
      if(ending.allowReturn){
        returnToStartScreen();
      }
    }
  });
}); // Close window.addEventListener('load')

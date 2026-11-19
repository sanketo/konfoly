const playbackStoreKey='mentalist-progress-v1';
function readPlaybackMemory(storeKey=playbackStoreKey){
 try{
  const data=JSON.parse(localStorage.getItem(storeKey));if(!data||typeof data!=='object')return {last:null};
  let last=data.last;
  if(last&&!Number.isFinite(last.time)&&data.entries){const entry=data.entries[last.season+':'+last.episode];if(entry)last={...last,...entry}}
  return {last:last&&Number.isFinite(last.time)?last:null};
 }catch{return {last:null}}
}
function playbackTime(value){const n=Math.max(0,Math.floor(Number(value)||0));return (n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n/60)%60).padStart(n>=3600?2:1,'0')+':'+String(n%60).padStart(2,'0')}
function bindPlaybackMemory(video,context,onStatus=()=>{},options={}){
 let ready=false,lastSave=0,hasPlayed=!video.paused,completed=false;
 function save(force=false){
  if(!ready||!hasPlayed||!Number.isFinite(video.duration)||video.duration<=0||!Number.isFinite(video.currentTime))return;
  const credits=Math.min(60,video.duration*.05);
  const watchedAt=Math.min(options.completionTime ?? (context.combined?4800:2400),video.duration-credits);
  const justCompleted=!completed&&(video.ended||video.currentTime>=watchedAt);
  if(justCompleted)completed=true;
  const now=Date.now();if(!force&&!justCompleted&&now-lastSave<4000)return;lastSave=now;
  const last={season:context.season,episode:context.episode,voice:context.voice||null,source:context.source||'native',time:completed?0:video.currentTime,duration:video.duration,completed,updatedAt:now};
  try{localStorage.setItem(options.storeKey||playbackStoreKey,JSON.stringify({last}));options.onSave?.(last)}catch{onStatus('Не удалось сохранить позицию в этом браузере.')}
 }
 function loaded(){
  ready=true;const time=Number(options.resumeTime)||0;
  if(time>0){video.currentTime=Math.min(time,Math.max(0,video.duration-1));onStatus('Продолжено с '+playbackTime(video.currentTime))}
  else onStatus('Последний просмотр сохраняется автоматически');
 }
 function played(){hasPlayed=true}
 function tick(){if(!video.paused)hasPlayed=true;save()}
 function flush(){save(true)}
 function visibility(){if(document.visibilityState==='hidden')flush()}
 video.addEventListener('loadedmetadata',loaded);video.addEventListener('timeupdate',tick);video.addEventListener('play',played);
 for(const event of ['pause','seeked','ended'])video.addEventListener(event,flush);
 window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',visibility);
 return ()=>{flush();video.removeEventListener('loadedmetadata',loaded);video.removeEventListener('timeupdate',tick);video.removeEventListener('play',played);for(const event of ['pause','seeked','ended'])video.removeEventListener(event,flush);window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',visibility)};
}
function bindPointerBoost(video,surface,onBoost=()=>{}) {
 let press=null,boosted=false,timer=null,previousRate=1,suppressClick=false,clickTimer=null;
 function restore(resume=false){
  clearTimeout(timer);
  if(boosted)video.playbackRate=previousRate;
  const keepPlaying=resume&&boosted&&!video.ended;
  press=null;
  boosted=false;
  onBoost(false);
  if(keepPlaying&&video.paused)video.play().catch(()=>{});
 }
 function down(event){
  if(event.button!==0||event.isPrimary===false||press||video.ended)return;
  const touch=event.pointerType==='touch';
  if(touch){
   const bounds=surface.getBoundingClientRect();
   const x=(event.clientX-bounds.left)/bounds.width;
   if(!Number.isFinite(x)||(x>.22&&x<.78))return;
  }else if(event.pointerType&&event.pointerType!=='mouse')return;
  suppressClick=false;
  clearTimeout(clickTimer);
  press={id:event.pointerId,touch,x:event.clientX,y:event.clientY};
  previousRate=video.playbackRate;
  try{surface.setPointerCapture(event.pointerId)}catch{}
  timer=setTimeout(()=>{
   if(!press)return;
   boosted=true;
   video.playbackRate=2;
   onBoost(true);
   if(video.paused)video.play().catch(()=>{});
  },touch?280:220);
 }
 function move(event){
  if(!press?.touch||boosted||event.pointerId!==press.id)return;
  if(Math.hypot(event.clientX-press.x,event.clientY-press.y)>12)restore();
 }
 function up(event){
  if(!press||event.pointerId!==press.id)return;
  if(boosted){
   suppressClick=true;
   event.preventDefault();
   clearTimeout(clickTimer);
   clickTimer=setTimeout(()=>{suppressClick=false},press.touch?450:0);
  }
  restore(true);
 }
 function cancel(event){
  if(press&&(event.pointerId===undefined||event.pointerId===press.id))restore();
 }
 function contextMenu(event){if(press?.touch)event.preventDefault()}
 const listeners={pointerdown:down,pointermove:move,pointerup:up,pointercancel:cancel,contextmenu:contextMenu};
 for(const [type,handler] of Object.entries(listeners))surface.addEventListener(type,handler);
 window.addEventListener('blur',cancel);
 return {
  consumeClick(){const skip=suppressClick;suppressClick=false;return skip},
  destroy(){
   restore();
   clearTimeout(clickTimer);
   for(const [type,handler] of Object.entries(listeners))surface.removeEventListener(type,handler);
   window.removeEventListener('blur',cancel);
  }
 };
}

function watchPlaybackHealth(video,onFailure,{delay=14000}={}) {
 let timer=null, lastPosition=0, disposed=false;
 function cancel(){
  if(timer!==null)clearTimeout(timer);
  timer=null;
 }
 function active(){return !video.paused&&!video.ended&&document.visibilityState!=='hidden'}
 function wait(){
  if(disposed||timer!==null||!active())return;
  lastPosition=video.currentTime;
  timer=setTimeout(()=>{
   timer=null;
   if(!active())return;
   if(video.currentTime>lastPosition+.15){wait();return}
   onFailure('stall');
  },delay);
 }
 function advanced(){
  if(timer!==null&&video.currentTime>lastPosition+.15)cancel();
 }
 function play(){if(video.readyState<3)wait()}
 function visibility(){
  if(document.visibilityState==='hidden')cancel();
  else play();
 }
 function error(){
  cancel();
  onFailure('error',video.error?.code);
 }
 const listeners={waiting:wait,stalled:wait,seeking:wait,play,playing:cancel,pause:cancel,ended:cancel,timeupdate:advanced,error};
 for(const [event,handler] of Object.entries(listeners))video.addEventListener(event,handler);
 document.addEventListener('visibilitychange',visibility);
 return ()=>{
  disposed=true;
  cancel();
  for(const [event,handler] of Object.entries(listeners))video.removeEventListener(event,handler);
  document.removeEventListener('visibilitychange',visibility);
 };
}

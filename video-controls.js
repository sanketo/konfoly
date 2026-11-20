function bindVideoKeys(video, target=document, onBoost=()=>{}) {
 let pressed=false,boosted=false,timer=null,previousRate=1;
 function block(e){e.preventDefault();e.stopImmediatePropagation()}
 function restore(resume=false){
  clearTimeout(timer);const shouldResume=resume&&boosted&&!video.ended;
  if(boosted)video.playbackRate=previousRate;
  pressed=false;boosted=false;onBoost(false);
  if(shouldResume&&video.paused)video.play().catch(()=>{});
 }
 function down(e){
  if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
  if(['ArrowLeft','ArrowRight'].includes(e.code)){
   if(e.target?.closest?.('input,textarea,select,button,a,[contenteditable]:not([contenteditable=false]),dialog'))return;
   if(!Number.isFinite(video.duration)||video.duration<=0)return;
   block(e);
   const offset=e.code==='ArrowLeft'?-10:10;
   video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+offset));
   return;
  }
  if(e.code!=='Space')return;
  if(e.target?.closest?.('input,textarea,select,[contenteditable="true"],dialog'))return;
  if(e.target?.closest?.('button,a')&&!e.target.closest('.cinema-player'))return;
  block(e);if(pressed||e.repeat)return;
  pressed=true;previousRate=video.playbackRate;
  timer=setTimeout(()=>{if(!pressed)return;boosted=true;video.playbackRate=2;onBoost(true);if(video.paused)video.play().catch(()=>{})},220);
 }
 function up(e){if(e.code!=='Space'||!pressed)return;block(e);const held=boosted;restore(true);if(!held){if(video.paused)video.play().catch(()=>{});else video.pause()}}
 function keypress(e){if(e.code==='Space'&&pressed)block(e)}
 function blur(){restore()}
 target.addEventListener('keydown',down,{capture:true});target.addEventListener('keyup',up,{capture:true});target.addEventListener('keypress',keypress,{capture:true});window.addEventListener('blur',blur);
 return ()=>{restore();target.removeEventListener('keydown',down,{capture:true});target.removeEventListener('keyup',up,{capture:true});target.removeEventListener('keypress',keypress,{capture:true});window.removeEventListener('blur',blur)};
}

function isMobileCinema() {
  return matchMedia('(pointer: coarse) and (max-width: 1024px)').matches;
}
async function requestCinemaFullscreen(element) {
  if (!element.requestFullscreen) return false;
  try {
    await element.requestFullscreen();
  } catch {
    return false;
  }
  const orientation = window.screen?.orientation;
  if (isMobileCinema() && orientation?.lock && document.fullscreenElement === element) {
    const unlock = () => {
      if (document.fullscreenElement === element) return;
      document.removeEventListener('fullscreenchange',unlock);
      orientation.unlock?.();
    };
    document.addEventListener('fullscreenchange',unlock);
    try { await orientation.lock('landscape'); } catch { /* Rotation availability is browser-dependent. */ }
  }
  return true;
}

const playbackRates = [.75,1,1.1,1.25,1.5,1.75,2];

function seekTimeAtPointer(duration,offset,width) {
  const thumbRadius = 6;
  const trackWidth = width - 2 * thumbRadius;
  if (!Number.isFinite(duration) || duration <= 0 || trackWidth <= 0) return null;
  const fraction = (offset - thumbRadius) / trackWidth;
  return Math.max(0,Math.min(1,fraction)) * duration;
}

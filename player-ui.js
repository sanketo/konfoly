function createCinemaPlayer(video,options={}){
 const icons={
  play:'<path d="M8 5L20 12L8 19Z" fill="currentColor" stroke="none"/>',
  pause:'<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  back:'<path d="M4 8v-5m0 5h5M4 8a9 9 0 1 1-1 8"/><text x="12" y="16" text-anchor="middle" stroke="none" fill="currentColor" font-size="9" font-family="system-ui">10</text>',
  forward:'<path d="M20 8v-5m0 5h-5M20 8a9 9 0 1 0 1 8"/><text x="12" y="16" text-anchor="middle" stroke="none" fill="currentColor" font-size="9" font-family="system-ui">10</text>',
  volume:'<path d="m11 5-6 5H2v4h3l6 5zM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16"/>',
  muted:'<path d="m11 5-6 5H2v4h3l6 5zM16 9l6 6m0-6-6 6"/>',
  full:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>'
 };
 function icon(name){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+icons[name]+'</svg>'}
 const shell=document.createElement('div');shell.className='cinema-player paused';shell.tabIndex=0;shell.setAttribute('aria-label','Видеоплеер: пробел — пауза, удержание — 2×');
 const originalParent=video.parentElement;video.controls=false;video.tabIndex=-1;originalParent.append(shell);shell.append(video);
 const overlay=document.createElement('div');overlay.className='cinema-overlay';
 overlay.innerHTML='<div class="cinema-top"><span class="cinema-title"></span><span class="cinema-resolution">Загрузка видео</span></div><div class="cinema-boost" aria-live="polite">2× <span>УСКОРЕНИЕ</span></div><div class="cinema-spinner" aria-hidden="true"></div><button type="button" class="cinema-center" aria-label="Продолжить просмотр">'+icon('play')+'</button><div class="cinema-controls"><div class="cinema-timeline"><span class="cinema-clock">0:00 <span>/ 0:00</span></span><input class="cinema-seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Позиция просмотра"></div><div class="cinema-bottom"><div class="cinema-left"><button type="button" class="cinema-toggle" aria-label="Воспроизвести">'+icon('play')+'</button><button type="button" class="cinema-back" aria-label="Назад на 10 секунд">'+icon('back')+'</button><button type="button" class="cinema-forward" aria-label="Вперёд на 10 секунд">'+icon('forward')+'</button></div><div class="cinema-right"><div class="cinema-volume"><button type="button" class="cinema-mute" aria-label="Выключить звук">'+icon('volume')+'</button><input type="range" min="0" max="1" step="0.05" class="cinema-volume-range" aria-label="Громкость"></div><button type="button" class="cinema-quick" aria-label="Включить скорость 2×" aria-pressed="false" title="Переключить 2×">2×</button><select class="cinema-speed" aria-label="Скорость воспроизведения"><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="1.75">1.75×</option><option value="2">2×</option></select><button type="button" class="cinema-full" aria-label="Полный экран">'+icon('full')+'</button></div></div></div>';
 shell.append(overlay);const stopAmbient=bindVideoAmbient(video,originalParent.parentElement?.querySelector('.video-ambient'));const q=s=>overlay.querySelector(s),seek=q('.cinema-seek'),clock=q('.cinema-clock'),speed=q('.cinema-speed');
 q('.cinema-title').textContent=options.title||'Менталист';
 let hideTimer=null,seeking=false,normalRate=options.rate===2?1:(options.rate||1);const listeners=[];const pointerBoost=bindPointerBoost(video,video,active=>{shell.classList.toggle('boosting',active);show()});
 function on(el,event,handler){el.addEventListener(event,handler);listeners.push(()=>el.removeEventListener(event,handler))}
 function show(){shell.classList.remove('idle');clearTimeout(hideTimer);if(!video.paused)hideTimer=setTimeout(()=>{if(!shell.querySelector('.cinema-controls')?.contains(document.activeElement))shell.classList.add('idle')},2500)}
 function focusStage(){shell.focus({preventScroll:true});show()}
 function toggle(){if(video.paused)video.play().catch(()=>{});else video.pause();focusStage()}
 function updateState(){shell.classList.toggle('paused',video.paused);q('.cinema-toggle').innerHTML=icon(video.paused?'play':'pause');q('.cinema-toggle').setAttribute('aria-label',video.paused?'Воспроизвести':'Пауза');if(!video.paused)shell.classList.remove('waiting');show()}
 function updateTime(){
  const duration=Number.isFinite(video.duration)?video.duration:0,time=video.currentTime||0;
  if(!seeking){seek.max=String(duration||100);seek.value=String(time)}
  const played=duration?100*time/duration:0;let buffered=0;
  try{for(let i=0;i<video.buffered.length;i++)if(video.buffered.start(i)<=time)buffered=Math.max(buffered,100*video.buffered.end(i)/duration)}catch{}
  seek.style.setProperty('--played',played+'%');seek.style.setProperty('--buffered',Math.min(100,Math.max(played,buffered))+'%');
  seek.setAttribute('aria-valuetext',playbackTime(time)+' из '+playbackTime(duration));clock.innerHTML=playbackTime(time)+' <span>/ '+playbackTime(duration)+'</span>';
 }
 function updateVolume(){q('.cinema-mute').innerHTML=icon(video.muted||video.volume===0?'muted':'volume');q('.cinema-mute').setAttribute('aria-label',video.muted?'Включить звук':'Выключить звук');q('.cinema-volume-range').value=video.muted?'0':String(video.volume)}
 on(q('.cinema-toggle'),'click',toggle);on(q('.cinema-center'),'click',toggle);on(video,'click',()=>{if(pointerBoost.consumeClick())return;if(shell.classList.contains('idle')){focusStage();return}toggle()});
 on(video,'dblclick',()=>q('.cinema-full').click());
 on(q('.cinema-back'),'click',()=>{video.currentTime=Math.max(0,video.currentTime-10);focusStage()});
 on(q('.cinema-forward'),'click',()=>{video.currentTime=Math.min(video.duration||0,video.currentTime+10);focusStage()});
 on(seek,'input',()=>{seeking=true;video.currentTime=Number(seek.value);updateTime();show()});
 on(seek,'change',()=>{seeking=false;updateTime();focusStage()});
 on(speed,'change',()=>{video.playbackRate=Number(speed.value);if(video.playbackRate!==2)normalRate=video.playbackRate;options.onRate?.(video.playbackRate);focusStage()});
 on(q('.cinema-quick'),'click',()=>{if(video.playbackRate===2)video.playbackRate=normalRate;else{normalRate=video.playbackRate;video.playbackRate=2}options.onRate?.(video.playbackRate);focusStage()});
 on(q('.cinema-mute'),'click',()=>{video.muted=!video.muted;focusStage()});
 on(q('.cinema-volume-range'),'input',e=>{video.volume=Number(e.target.value);video.muted=false;options.onVolume?.(video.volume)});
 on(q('.cinema-full'),'click',async()=>{
  if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});
  else if(shell.requestFullscreen) {
   if(!await requestCinemaFullscreen(shell)) {
    try{video.webkitEnterFullscreen?.()}catch{}
   }
  } else {
   try{video.webkitEnterFullscreen?.()}catch{}
  }
  focusStage();
 });
 on(video,'play',updateState);on(video,'pause',updateState);on(video,'ended',updateState);
 on(video,'timeupdate',updateTime);on(video,'progress',updateTime);
 on(video,'loadedmetadata',()=>{q('.cinema-resolution').textContent=video.videoWidth&&video.videoHeight?video.videoWidth+' × '+video.videoHeight:'Размер недоступен';updateTime()});
 on(video,'volumechange',updateVolume);on(video,'ratechange',()=>{if(!shell.classList.contains('boosting'))speed.value=String(video.playbackRate);q('.cinema-quick').setAttribute('aria-pressed',video.playbackRate===2);q('.cinema-quick').classList.toggle('active',video.playbackRate===2)});
 on(video,'waiting',()=>shell.classList.add('waiting'));on(video,'playing',()=>shell.classList.remove('waiting'));on(video,'canplay',()=>shell.classList.remove('waiting'));
 on(shell,'pointermove',show);on(shell,'pointerdown',show);on(shell,'focusin',show);
 video.volume=options.volume??1;speed.value=String(options.rate||1);updateVolume();updateState();updateTime();
 return {setBoost(active){shell.classList.toggle('boosting',active);show()},destroy(){stopAmbient();pointerBoost.destroy();clearTimeout(hideTimer);listeners.forEach(remove=>remove())}};
}

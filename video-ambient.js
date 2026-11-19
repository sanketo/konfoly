function bindVideoAmbient(video,canvas) {
  const context = canvas?.getContext('2d',{alpha:false});
  if (!context) return () => {};
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let timer = null;
  let visible = true;
  let lastFrame = null;
  let settleUntil = 0;

  function stop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function draw() {
    if (!visible || document.visibilityState === 'hidden' || video.readyState < 2) {
      stop();
      return;
    }
    const now = performance.now();
    const elapsed = lastFrame === null ? 0 : Math.min(now - lastFrame,180);
    try {
      context.globalAlpha = lastFrame === null || reducedMotion.matches ? 1 : 1 - Math.exp(-elapsed / 520);
      context.drawImage(video,0,0,canvas.width,canvas.height);
      lastFrame = now;
      canvas.classList.add('has-frame');
    } catch {
      stop();
      canvas.classList.remove('has-frame');
      lastFrame = null;
      return;
    } finally {
      context.globalAlpha = 1;
    }
    const inMotion = !video.paused && !video.ended;
    if (!reducedMotion.matches && (inMotion || now < settleUntil)) {
      if (timer === null) timer = setTimeout(() => {timer = null;draw()},150);
    } else stop();
  }
  function refreshFrame() {
    settleUntil = performance.now() + 1500;
    draw();
  }

  const events = ['loadeddata','playing','pause','seeked','ended'];
  for (const event of events) video.addEventListener(event,refreshFrame);
  document.addEventListener('visibilitychange',draw);
  reducedMotion.addEventListener?.('change',draw);
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    draw();
  }) : null;
  observer?.observe(video);
  draw();
  return () => {
    stop();
    observer?.disconnect();
    for (const event of events) video.removeEventListener(event,refreshFrame);
    document.removeEventListener('visibilitychange',draw);
    reducedMotion.removeEventListener?.('change',draw);
    canvas.classList.remove('has-frame');
    // Reset the canvas without reading pixels, including for cross-origin video.
    canvas.width = canvas.width;
  };
}

export {bindVideoAmbient};

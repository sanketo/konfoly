(() => {
  const fields = new Map();
  let serial = 0;
  function enhance(select) {
    if (select.hidden) return;
    if (!select.id) select.id = 'select-field-' + ++serial;
    const field = select.parentElement;
    const label = field.querySelector('label');
    const control = document.createElement('details');
    control.className = 'select-control';
    const summary = document.createElement('summary');
    const value = document.createElement('span');
    value.id = select.id + '-display';
    label.id = select.id + '-label';
    summary.setAttribute('aria-labelledby', label.id + ' ' + value.id);
    const arrow = document.createElementNS('http://www.w3.org/2000/svg','svg');
    arrow.setAttribute('viewBox','0 0 24 24');
    arrow.setAttribute('aria-hidden','true');
    const path = document.createElementNS(arrow.namespaceURI,'path');
    path.setAttribute('d','m6 9 6 6 6-6');
    arrow.append(path);
    summary.append(value,arrow);

    const panel = document.createElement('div');
    panel.className = 'select-options';
    panel.setAttribute('role','group');
    panel.setAttribute('aria-labelledby',label.id);
    let options = [];
    let signature;
    function refresh() {
      const entries = Array.from(select.options);
      const next = JSON.stringify(entries.map(option => [option.value,option.textContent,option.disabled]));
      if (next !== signature) {
        signature = next;
        options = entries.map((option,index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = option.textContent;
          button.disabled = option.disabled;
          button.addEventListener('click',() => {
            control.open = false;
            if (select.selectedIndex !== index) {
              select.selectedIndex = index;
              select.dispatchEvent(new Event('change',{bubbles:true}));
            }
            if ((!field.closest('dialog') || field.closest('dialog').open) && summary.isConnected) summary.focus();
          });
          return button;
        });
        panel.replaceChildren(...options);
      }
      value.textContent = select.selectedOptions[0]?.textContent || '';
      options.forEach((button,index) => button.setAttribute('aria-pressed',index === select.selectedIndex));
    }
    function toggleOptions(event) {
      if (event.key !== 'Escape') refresh();
      const enabled = options.filter(button => !button.disabled);
      const index = enabled.indexOf(document.activeElement);
      if (event.key === 'Escape' && control.open) {
        event.preventDefault();
        event.stopPropagation();
        control.open = false;
        summary.focus();
      } else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault();
        control.open = true;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 :
          index < 0 ? enabled.indexOf(options[select.selectedIndex]) :
          (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
        (enabled[next] || enabled[0])?.focus();
      }
    }
    control.addEventListener('keydown',toggleOptions);
    control.addEventListener('toggle', () => { if (control.open) refresh(); });
    select.addEventListener('change',refresh);
    label.addEventListener('click',event => {
      event.preventDefault();
      summary.focus();
    });
    label.removeAttribute('for');
    field.closest('dialog')?.addEventListener('close',() => { control.open = false; });
    control.append(summary,panel);
    field.append(control);
    select.hidden = true;
    if (!select.closest('.watch-track-field')) fields.set(select.id,refresh);
    refresh();
  }
  for (const field of document.querySelectorAll('.select-field select')) enhance(field);
  document.addEventListener('pointerdown',event => {
    for (const control of document.querySelectorAll('.select-control[open]')) {
      if (!control.contains(event.target)) control.open = false;
    }
  });
  window.enhanceKinosalSelect = enhance;
  window.refreshKinosalSelect = id => fields.get(id)?.();
})();

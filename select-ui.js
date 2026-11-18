(() => {
  const fields = new Map();
  for (const select of document.querySelectorAll('.select-field select')) {
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
    const options = Array.from(select.options, (option,index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.textContent;
      button.disabled = option.disabled;
      button.addEventListener('click',() => {
        if (select.selectedIndex !== index) {
          select.selectedIndex = index;
          select.dispatchEvent(new Event('change',{bubbles:true}));
        }
        control.open = false;
        if (!field.closest('dialog') || field.closest('dialog').open) summary.focus();
      });
      panel.append(button);
      return button;
    });
    function refresh() {
      value.textContent = select.selectedOptions[0]?.textContent || '';
      options.forEach((button,index) => button.setAttribute('aria-pressed',index === select.selectedIndex));
    }
    function toggleOptions(event) {
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
    fields.set(select.id,{control,refresh});
    refresh();
  }
  document.addEventListener('pointerdown',event => {
    for (const {control} of fields.values()) {
      if (!control.contains(event.target)) control.open = false;
    }
  });
  window.refreshKinosalSelect = id => fields.get(id)?.refresh();
})();

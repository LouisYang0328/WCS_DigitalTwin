/* Shared disclosure navigation. Scene and PLC state remain with their pages. */
(() => {
  'use strict';

  const navigation = document.querySelector('nav.module-nav');
  if (!navigation || window.WcsModuleNavigation) return;

  const modules = [...navigation.querySelectorAll('details.nav-module')];
  const floorTabs = document.getElementById('floorTabs');
  const viewButtons = document.getElementById('viewBtns');
  const displaySummary = document.getElementById('displayModuleSummary');
  const displayLabel = displaySummary?.querySelector('[data-display-label]');
  let syncQueued = false;

  function summaryFor(module) {
    return [...module.children].find(child => child.tagName === 'SUMMARY');
  }

  function syncExpanded(module) {
    summaryFor(module)?.setAttribute('aria-expanded', String(module.open));
  }

  function closeModule(module, restoreFocus = false) {
    if (!module.open) return;
    module.open = false;
    syncExpanded(module);
    if (restoreFocus) summaryFor(module)?.focus({ preventScroll: true });
  }

  function closeAll() {
    modules.forEach(module => closeModule(module));
  }

  function syncDisplay() {
    for (const group of [floorTabs, viewButtons]) {
      if (!group) continue;
      for (const button of group.querySelectorAll('button')) {
        button.setAttribute('aria-pressed', String(button.classList.contains('on')));
      }
    }
    if (!displayLabel) return;
    const floor = floorTabs?.querySelector('button.on[data-mode]');
    const view = viewButtons?.querySelector('button.on[data-view]');
    const floorLabel = floor ? ({ 1: '一层', 2: '二层', 3: '双层' })[floor.dataset.mode] || floor.textContent.trim() : '';
    const viewLabel = view?.textContent.trim() || '';
    const caption = [floorLabel, viewLabel].filter(Boolean).join(' · ');
    if (caption && displayLabel.textContent !== caption) displayLabel.textContent = caption;
  }

  function queueDisplaySync() {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => { syncQueued = false; syncDisplay(); });
  }

  // Native summary activation continues to handle pointer, Enter and Space.
  // Toggle events also cover details opened programmatically by a page.
  for (const module of modules) {
    summaryFor(module)?.addEventListener('click', () => {
      if (!module.open) for (const other of modules) if (other !== module) closeModule(other);
    });
    module.addEventListener('toggle', () => {
      if (module.open) for (const other of modules) if (other !== module) closeModule(other);
      syncExpanded(module);
    });
    syncExpanded(module);
  }
  const initiallyOpen = modules.find(module => module.open);
  if (initiallyOpen) for (const module of modules) if (module !== initiallyOpen) closeModule(module);

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const target = event.target;
    const module = target.closest('details.nav-module');
    if (!module || !modules.includes(module)) {
      closeAll();
      return;
    }
    if (target.closest('[data-close-module], a[href]')) {
      // Keep keyboard focus on a visible control after its panel is hidden.
      closeModule(module, true);
      queueDisplaySync();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const module = modules.find(item => item.open);
    if (!module) return;
    event.preventDefault();
    event.stopPropagation();
    closeModule(module, true);
  }, true);

  // Watch only the scene's existing control groups. No scene state, polling,
  // document-wide mutation observation or PLC requests are needed here.
  const observer = new MutationObserver(queueDisplaySync);
  for (const group of [floorTabs, viewButtons]) {
    if (group) observer.observe(group, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  syncDisplay();

  window.WcsModuleNavigation = Object.freeze({ syncDisplay, closeAll });
})();

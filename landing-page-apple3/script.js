(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const header = $('.site-header');
  const menuBtn = $('#menuBtn');
  const mobileMenu = $('#mobileMenu');
  const themeToggle = $('#themeToggle');

  const toast = $('#toast');
  const toastTitle = $('#toastTitle');
  const toastMsg = $('#toastMsg');
  const toastClose = $('#toastClose');

  const form = $('#configForm');
  const modelSel = $('#model');
  const totalPriceEl = $('#totalPrice');
  const summaryLineEl = $('#summaryLine');

  const tradeIn = $('#tradeIn');

  const PRICES = {
    'ARC Mini': { base: 699, storage: { '128': 0, '256': 100, '512': 250 } },
    'ARC One':  { base: 799, storage: { '128': 0, '256': 120, '512': 280 } },
    'ARC Pro':  { base: 999, storage: { '128': 0, '256': 150, '512': 320 } }
  };

  const TRADE_IN_CREDIT = 120;

  function formatUSD(n){
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  }

  function getConfig(){
    const fd = new FormData(form);
    const model = String(fd.get('model') || 'ARC One');
    const finish = String(fd.get('finish') || 'Obsidian');
    const storage = String(fd.get('storage') || '128');
    const trade = fd.get('tradeIn') === 'on';
    return { model, finish, storage, trade };
  }

  function computeTotal(cfg){
    const p = PRICES[cfg.model] || PRICES['ARC One'];
    const storageAdd = (p.storage[cfg.storage] ?? 0);
    const subtotal = p.base + storageAdd;
    const total = Math.max(0, subtotal - (cfg.trade ? TRADE_IN_CREDIT : 0));
    return { subtotal, total };
  }

  function updateUI(){
    if(!form) return;

    const cfg = getConfig();
    const { total } = computeTotal(cfg);

    totalPriceEl.textContent = formatUSD(total);
    summaryLineEl.textContent = `${cfg.model} • ${cfg.finish} • ${cfg.storage}GB${cfg.trade ? ' • Trade‑in' : ''}`;

    // highlight comparison table based on focus
    const focus = ($('input[name="compareFocus"]:checked')?.value) || 'balanced';
    const rows = $$('.trow[data-row]');
    rows.forEach(r => r.removeAttribute('data-highlight'));

    if (focus === 'camera') {
      const pro = rows.find(r => r.getAttribute('data-row') === 'ARC Pro');
      if (pro) pro.setAttribute('data-highlight', 'true');
    } else if (focus === 'battery') {
      const pro = rows.find(r => r.getAttribute('data-row') === 'ARC Pro');
      if (pro) pro.setAttribute('data-highlight', 'true');
    } else {
      const one = rows.find(r => r.getAttribute('data-row') === 'ARC One');
      if (one) one.setAttribute('data-highlight', 'true');
    }
  }

  function openToast(title, msg){
    if(!toast) return;
    toastTitle.textContent = title;
    toastMsg.textContent = msg;
    toast.hidden = false;

    window.clearTimeout(openToast._t);
    openToast._t = window.setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function setTheme(theme){
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('arcTheme', theme); } catch {}
    if (themeToggle) themeToggle.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
  }

  function initTheme(){
    const saved = (() => {
      try { return localStorage.getItem('arcTheme'); } catch { return null; }
    })();
    if (saved === 'light' || saved === 'dark') return setTheme(saved);

    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    setTheme(prefersLight ? 'light' : 'dark');
  }

  function toggleMobileMenu(force){
    if(!mobileMenu || !menuBtn) return;
    const isOpen = !mobileMenu.hidden;
    const next = (typeof force === 'boolean') ? force : !isOpen;
    mobileMenu.hidden = !next;
    menuBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
    menuBtn.setAttribute('aria-label', next ? 'Close menu' : 'Open menu');
  }

  function closeMobileMenuOnNav(){
    if(!mobileMenu) return;
    mobileMenu.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.matches && t.matches('a[href^="#"]')) toggleMobileMenu(false);
    });
  }

  function initHeaderElevation(){
    const onScroll = () => {
      if(!header) return;
      header.dataset.elevate = (window.scrollY > 6) ? 'true' : 'false';
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function wireBuyButtons(){
    $$('[data-buy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const model = btn.getAttribute('data-buy');
        if(modelSel && model){
          modelSel.value = model;
          updateUI();
        }
      });
    });
  }

  function saveConfig(){
    const cfg = getConfig();
    try { localStorage.setItem('arcConfig', JSON.stringify(cfg)); } catch {}
    openToast('Saved', 'Configuration saved on this device.');
  }

  function restoreConfig(){
    let raw = null;
    try { raw = localStorage.getItem('arcConfig'); } catch {}
    if(!raw) return;
    try{
      const cfg = JSON.parse(raw);
      if(cfg.model && modelSel) modelSel.value = cfg.model;

      if(cfg.finish){
        const fin = $(`input[name="finish"][value="${CSS.escape(cfg.finish)}"]`);
        if(fin) fin.checked = true;
      }
      if(cfg.storage){
        const st = $(`input[name="storage"][value="${CSS.escape(String(cfg.storage))}"]`);
        if(st) st.checked = true;
      }
      if(typeof cfg.trade === 'boolean' && tradeIn) tradeIn.checked = cfg.trade;

      updateUI();
      openToast('Restored', 'Saved configuration restored.');
    }catch{}
  }

  function initSmoothAnchors(){
    $$('a[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        if(!href || href === '#') return;
        const target = document.getElementById(href.slice(1));
        if(!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.pushState(null, '', href);
      });
    });
  }

  function initConfigurator(){
    if(!form) return;

    form.addEventListener('input', updateUI);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const cfg = getConfig();
      const { total } = computeTotal(cfg);
      openToast('Order placed (demo)', `${cfg.model} • ${cfg.finish} • ${cfg.storage}GB — ${formatUSD(total)}`);
    });

    $('#saveConfig')?.addEventListener('click', saveConfig);
    toastClose?.addEventListener('click', () => toast.hidden = true);

    // Compare focus radios
    $$('input[name="compareFocus"]').forEach(r => r.addEventListener('change', updateUI));

    updateUI();
    restoreConfig();
  }

  function initThemeToggle(){
    if(!themeToggle) return;
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      setTheme(current === 'dark' ? 'light' : 'dark');
      openToast('Theme', `Switched to ${current === 'dark' ? 'light' : 'dark'} mode.`);
    });
  }

  function initMobileMenu(){
    if(!menuBtn) return;
    menuBtn.addEventListener('click', () => toggleMobileMenu());
    closeMobileMenuOnNav();

    // Close on resize to desktop
    window.addEventListener('resize', () => {
      if(window.innerWidth > 860) toggleMobileMenu(false);
    }, { passive: true });
  }

  // Subtle parallax on hero phones (pointer-only, respects reduced motion)
  function initHeroMotion(){
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduce) return;

    const stack = $('.phone-stack');
    if(!stack) return;

    let raf = null;
    let targetX = 0, targetY = 0;
    let curX = 0, curY = 0;

    const onMove = (e) => {
      const rect = stack.getBoundingClientRect();
      const x = (e.clientX - (rect.left + rect.width/2)) / rect.width;
      const y = (e.clientY - (rect.top + rect.height/2)) / rect.height;
      targetX = Math.max(-.6, Math.min(.6, x));
      targetY = Math.max(-.6, Math.min(.6, y));
      if(!raf) raf = requestAnimationFrame(tick);
    };

    const tick = () => {
      raf = null;
      curX += (targetX - curX) * 0.08;
      curY += (targetY - curY) * 0.08;
      stack.style.transform = `rotateX(${(-curY * 8).toFixed(2)}deg) rotateY(${(curX * 10).toFixed(2)}deg)`;
      if(Math.abs(targetX-curX) > 0.001 || Math.abs(targetY-curY) > 0.001){
        raf = requestAnimationFrame(tick);
      }
    };

    stack.addEventListener('pointermove', onMove);
    stack.addEventListener('pointerleave', () => {
      targetX = 0; targetY = 0;
      if(!raf) raf = requestAnimationFrame(tick);
    });
  }

  // Init
  initTheme();
  initHeaderElevation();
  initThemeToggle();
  initMobileMenu();
  initSmoothAnchors();
  initConfigurator();
  wireBuyButtons();
  initHeroMotion();

  // harmless build tag
  const buildTag = document.getElementById('buildTag');
  if(buildTag){
    const d = new Date();
    buildTag.title = `Rendered locally • ${d.toISOString()}`;
  }
})();

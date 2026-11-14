// Page logic that works with or without the 3D layer: scroll position, panels, menu, case studies.
// In 3D mode (html.gl) the sections are fixed overlays and the page scroll drives everything;
// scene.js reads window.__site each frame to move the cameras.
(function () {
  'use strict';
  var H = document.documentElement;
  var isGL = function () { return H.classList.contains('gl'); };
  var scenes = [].slice.call(document.querySelectorAll('.scene'));
  var space = document.getElementById('space');
  var rail = document.querySelector('.rail i');
  var site = window.__site = { u: 0, us: 0, total: 1, cum: [0], idx: 0, t: 0, names: [], kick: 0 };
  var maxY = 1;

  scenes.forEach(function (s) {
    s.panels = [].slice.call(s.querySelectorAll('.panel')).map(function (p) {
      var r = (p.dataset.at || '0,1').split(',').map(Number);
      return { el: p, a: r[0], b: r[1], on: null };
    });
    site.names.push(s.dataset.scene);
  });

  function measure() {
    var total = 0;
    site.cum = scenes.map(function (s) { var c = total; total += +s.dataset.len; return c; });
    site.cum.push(total);
    site.total = total;
    space.style.height = isGL() ? Math.round(total * window.innerHeight) + 'px' : '0px';
    maxY = Math.max(1, H.scrollHeight - window.innerHeight);
    readScroll();
  }

  function readScroll() {
    site.u = isGL() ? Math.min(1, window.scrollY / maxY) * site.total : 0;
  }

  // ---- scroll text scramble on the big headings ----
  var GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&/<>=';
  function scramble(el) {
    var text = el.dataset.text || el.textContent, start = performance.now(), dur = 700 + text.length * 18;
    el._run = start;
    (function step(now) {
      if (el._run !== start) return;
      var k = Math.min(1, (now - start) / dur), out = '';
      for (var i = 0; i < text.length; i++) {
        var c = text[i];
        out += (c === ' ' || i / text.length < k * 1.15 - 0.15) ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (k < 1) requestAnimationFrame(step); else el.textContent = text;
    })(start);
  }

  // ---- per-frame: smooth the scroll position, show the right section and panels ----
  var last = performance.now(), curIdx = -1;
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (isGL()) {
      var d = site.u - site.us;
      site.us = Math.abs(d) < 1e-4 ? site.u : site.us + d * (1 - Math.exp(-dt * 5.5));
      site.kick = Math.max(0, site.kick - dt * 2.2);
      var us = site.us, i = 0;
      while (i < scenes.length - 1 && us >= site.cum[i + 1]) i++;
      var len = site.cum[i + 1] - site.cum[i];
      site.idx = i;
      site.t = Math.min(1, Math.max(0, (us - site.cum[i]) / len));
      if (i !== curIdx) {
        scenes.forEach(function (s, k) {
          s.classList.toggle('on', k === i);
          // panels of the section we left start hidden again, so they replay on return
          if (k !== i) s.panels.forEach(function (p) { if (p.on !== false) { p.el.classList.remove('on'); p.el.setAttribute('inert', ''); p.on = false; } });
        });
        [].forEach.call(scenes[i].querySelectorAll('.scr'), scramble);
        document.body.dataset.scene = site.names[i];
        curIdx = i;
      }
      scenes[i].panels.forEach(function (p) {
        var on = site.t >= p.a && site.t <= p.b;
        if (on !== p.on) {
          p.el.classList.toggle('on', on);
          if (on) p.el.removeAttribute('inert'); else p.el.setAttribute('inert', '');
          p.on = on;
        }
      });
      updateWork(i);
      if (rail) rail.style.transform = 'translateY(' + (us / site.total) * 102 + 'px)';
    }
    requestAnimationFrame(frame);
  }

  // ---- selected work: which project is on screen ----
  var work = document.getElementById('work');
  var workIdx = scenes.indexOf(work);
  var workBtns = [].slice.call(document.querySelectorAll('.work-list button'));
  var nWork = workBtns.length;
  site.nWork = nWork;
  var curProj = -1;
  function updateWork(i) {
    var p = i === workIdx ? Math.min(nWork - 1, Math.floor(site.t * nWork)) : (i < workIdx ? 0 : nWork - 1);
    site.proj = p;
    if (p !== curProj) {
      workBtns.forEach(function (b, k) { b.setAttribute('aria-current', k === p ? 'true' : 'false'); });
      curProj = p;
    }
  }

  // ---- navigation ----
  function goTo(id, frac) {
    var i = scenes.findIndex(function (s) { return s.id === id; });
    if (i < 0) return;
    var u = site.cum[i] + (frac || 0) * (site.cum[i + 1] - site.cum[i]);
    var y = (u / site.total) * maxY;
    // land just before the target so the camera arrives instead of crawling through every scene
    if (Math.abs(u - site.us) > 1.2) { site.us = u - Math.sign(u - site.us) * 0.6; site.kick = 1; }
    window.scrollTo(0, y);
    readScroll();
  }
  document.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) {
      if (!isGL()) { closeAll(); return; }
      e.preventDefault();
      closeAll();
      goTo(go.dataset.go, go.dataset.go === 'top' ? 0 : 0.04);
      return;
    }
    var pj = e.target.closest('[data-proj]');
    if (pj && isGL()) { goTo('work', (+pj.dataset.proj + 0.25) / nWork); return; }
    var cs = e.target.closest('[data-case]');
    if (cs) { openCase(cs.dataset.case); }
  });

  // ---- dialogs ----
  var caseDlg = document.getElementById('case'), caseBody = document.getElementById('case-body');
  var menuDlg = document.getElementById('menu');
  var CLOSE = '<button class="x" type="button" data-close aria-label="Close case study"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="1.6"/></svg></button>';
  function lock(on) { H.style.overflow = on ? 'hidden' : ''; }
  function openCase(id) {
    var tpl = document.getElementById('case-' + id);
    if (!tpl) return;
    caseBody.innerHTML = CLOSE;
    caseBody.appendChild(tpl.content.cloneNode(true));
    caseBody.scrollTop = 0;
    if (menuDlg.open) menuDlg.close();
    if (!caseDlg.open) caseDlg.showModal();
    caseBody.querySelector('.x').focus();
    lock(true);
    if (history.replaceState) history.replaceState(null, '', '#case-' + id);
  }
  function closeAll() {
    [caseDlg, menuDlg].forEach(function (d) { if (d.open) d.close(); });
  }
  [caseDlg, menuDlg].forEach(function (d) {
    d.addEventListener('close', function () {
      lock(caseDlg.open || menuDlg.open);
      if (d === caseDlg && /^#case-/.test(location.hash) && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    });
    d.addEventListener('click', function (e) {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  });
  document.getElementById('menu-open').addEventListener('click', function () { menuDlg.showModal(); lock(true); });

  // ---- copy email ----
  var copyBtn = document.getElementById('copy-email'), copyMsg = document.getElementById('copy-msg');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var done = function () { copyMsg.textContent = 'Email copied to the clipboard.'; setTimeout(function () { copyMsg.textContent = ''; }, 3000); };
    if (navigator.clipboard) navigator.clipboard.writeText('yusufjawed8@gmail.com').then(done, function () { copyMsg.textContent = 'Copy failed. The address is yusufjawed8@gmail.com.'; });
  });

  // ---- start ----
  function fallback() {
    // 3D failed to load: show the plain document instead
    H.classList.remove('gl');
    H.classList.add('ready');
    scenes.forEach(function (s) { s.classList.remove('on'); s.panels.forEach(function (p) { p.el.classList.remove('on'); p.el.removeAttribute('inert'); }); });
    measure();
  }
  site.fallback = fallback;
  window.addEventListener('scroll', readScroll, { passive: true });
  var lastW = window.innerWidth, lastH = window.innerHeight;
  window.addEventListener('resize', function () {
    // ignore the small height changes from a mobile address bar showing or hiding
    if (window.innerWidth !== lastW || Math.abs(window.innerHeight - lastH) > 120) {
      var keep = site.u;
      lastW = window.innerWidth; lastH = window.innerHeight;
      measure();
      if (isGL()) window.scrollTo(0, (keep / site.total) * maxY);
    }
  });
  measure();
  if (isGL()) {
    site.us = site.u;
    setTimeout(function () { if (!H.classList.contains('ready')) fallback(); }, 12000);
  }
  if (/^#case-/.test(location.hash)) openCase(location.hash.slice(6));
  requestAnimationFrame(frame);
})();

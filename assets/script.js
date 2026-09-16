// Sfondo animato: macchie di luce colorate che si muovono e si fondono (canvas)
(() => {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const blobs = [
    { color: 'rgba(59,130,246,0.55)', rx: 0.28, ry: 0.22, r: 0.42, sx: 0.00021, sy: 0.00017, phx: 0.0, phy: 1.6 },
    { color: 'rgba(56,189,248,0.48)', rx: 0.78, ry: 0.28, r: 0.36, sx: 0.00017, sy: 0.00023, phx: 2.1, phy: 0.4 },
    { color: 'rgba(99,102,241,0.42)', rx: 0.18, ry: 0.82, r: 0.40, sx: 0.00025, sy: 0.00019, phx: 4.2, phy: 3.1 },
    { color: 'rgba(14,165,233,0.40)', rx: 0.85, ry: 0.80, r: 0.34, sx: 0.00019, sy: 0.00021, phx: 1.1, phy: 5.0 },
    { color: 'rgba(96,165,250,0.30)', rx: 0.50, ry: 0.50, r: 0.30, sx: 0.00015, sy: 0.00013, phx: 3.0, phy: 2.4 },
  ];

  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    blobs.forEach((b) => {
      const cx = (b.rx + Math.sin(t * b.sx + b.phx) * 0.1) * w;
      const cy = (b.ry + Math.cos(t * b.sy + b.phy) * 0.1) * h;
      const r = b.r * Math.max(w, h);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, b.color);
      g.addColorStop(1, 'rgba(7,11,22,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
  };

  if (reduceMotion) { draw(0); return; }

  let rafId = null;
  const loop = (t) => { draw(t); rafId = requestAnimationFrame(loop); };
  rafId = requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(rafId); rafId = null; }
    else if (!rafId) { rafId = requestAnimationFrame(loop); }
  });
})();

// Mobile nav toggle
document.querySelectorAll('[data-nav-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const links = document.querySelector('.nav-links');
    const isOpen = links.classList.toggle('open');
    btn.textContent = isOpen ? '✕' : '☰';
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
});
// Close mobile menu when a link inside it is tapped
document.querySelectorAll('.nav-links a').forEach((link) => {
  link.addEventListener('click', () => {
    const links = document.querySelector('.nav-links');
    links.classList.remove('open');
    const toggle = document.querySelector('[data-nav-toggle]');
    if (toggle) { toggle.textContent = '☰'; toggle.setAttribute('aria-expanded', 'false'); }
  });
});

// Card tilt: subtle 3D tilt following the cursor, premium hover feel
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && window.matchMedia('(hover: hover)').matches) {
  document.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `perspective(800px) rotateX(${(-py * 8).toFixed(2)}deg) rotateY(${(px * 8).toFixed(2)}deg) translateY(-4px)`;
    });
    card.addEventListener('mouseleave', () => { card.style.transform = ''; });
  });
}

// Animated counters
const counters = document.querySelectorAll('[data-count]');
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const el = entry.target;
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const duration = 1400;
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = target * eased;
      el.textContent = (target % 1 === 0 ? Math.round(value) : value.toFixed(1)) + suffix;
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.classList.add('pop');
      }
    };
    requestAnimationFrame(step);
    counterObserver.unobserve(el);
  });
}, { threshold: 0.5 });
counters.forEach((el) => counterObserver.observe(el));

// Scroll reveal (staggered per parent container)
const revealGroups = new Map();
document.querySelectorAll('.reveal').forEach((el) => {
  const parent = el.parentElement;
  const index = revealGroups.get(parent) || 0;
  el.style.setProperty('--reveal-delay', Math.min(index * 0.09, 0.45) + 's');
  revealGroups.set(parent, index + 1);
});
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

// Scroll progress bar
const progressBar = document.querySelector('[data-scroll-progress]');
if (progressBar) {
  window.addEventListener('scroll', () => {
    const h = document.documentElement;
    const scrolled = (h.scrollTop) / (h.scrollHeight - h.clientHeight) * 100;
    progressBar.style.width = scrolled + '%';
  }, { passive: true });
}

// Hero cursor spotlight (desktop only)
const spotlight = document.querySelector('[data-hero-spotlight]');
if (spotlight && window.matchMedia('(hover: hover)').matches) {
  spotlight.parentElement.addEventListener('mousemove', (e) => {
    const rect = spotlight.parentElement.getBoundingClientRect();
    spotlight.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
    spotlight.style.setProperty('--my', (e.clientY - rect.top) + 'px');
  });
}

// 3D tilt on cards (desktop only)
if (window.matchMedia('(hover: hover)').matches) {
  document.querySelectorAll('.card, .counter-card, .proof-card').forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `perspective(600px) rotateX(${(-py * 8).toFixed(2)}deg) rotateY(${(px * 8).toFixed(2)}deg) translateY(-3px)`;
    });
    card.addEventListener('mouseleave', () => { card.style.transform = ''; });
  });
}

// Sticky CTA + WhatsApp float appear after hero (avoids covering the hero buttons)
const stickyCta = document.querySelector('[data-sticky-cta]');
const waFloat = document.querySelector('.whatsapp-float');
if (stickyCta || waFloat) {
  const hero = document.querySelector('.hero');
  const stickyObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      if (stickyCta) stickyCta.classList.toggle('visible', show);
      if (waFloat) waFloat.classList.toggle('visible', show);
    });
  }, { threshold: 0 });
  if (hero) stickyObserver.observe(hero);
}

// Phone mockup notification cascade (replays each time it scrolls into view)
document.querySelectorAll('[data-phone]').forEach((phone) => {
  const notifs = phone.querySelectorAll('.phone-notif');
  const play = () => {
    notifs.forEach((n) => n.classList.remove('show'));
    notifs.forEach((n, i) => {
      setTimeout(() => n.classList.add('show'), 500 + i * 850);
    });
  };
  const phoneObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) play(); });
  }, { threshold: 0.6 });
  phoneObserver.observe(phone);
});

// FAQ accordion
document.querySelectorAll('.faq-item').forEach((item) => {
  const q = item.querySelector('.faq-q');
  q.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');
    item.parentElement.querySelectorAll('.faq-item').forEach((i) => i.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
  });
});

// Step quiz
const quiz = document.querySelector('[data-quiz]');
if (quiz) {
  const steps = [...quiz.querySelectorAll('.quiz-step')];
  const fill = quiz.querySelector('[data-quiz-fill]');
  let current = 0;
  const answers = {};
  const render = () => {
    steps.forEach((s, i) => s.classList.toggle('active', i === current));
    fill.style.width = (((current + 1) / steps.length) * 100) + '%';
  };
  quiz.querySelectorAll('.quiz-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const step = btn.closest('.quiz-step');
      step.querySelectorAll('.quiz-option').forEach((o) => o.classList.remove('selected'));
      btn.classList.add('selected');
      answers[step.dataset.quizStep] = btn.dataset.value;
      setTimeout(() => {
        if (current < steps.length - 1) { current++; render(); }
      }, 320);
    });
  });
  quiz.querySelectorAll('[data-quiz-back]').forEach((btn) => {
    btn.addEventListener('click', () => { if (current > 0) { current--; render(); } });
  });
  render();
}

// Timeline line-fill + traveling pulse
const timelineEl = document.querySelector('[data-timeline]');
if (timelineEl) {
  const timelineObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        timelineEl.classList.add('in-view');
        timelineObserver.unobserve(timelineEl);
      }
    });
  }, { threshold: 0.25 });
  timelineObserver.observe(timelineEl);
}

// Click-to-play YouTube facade (loads the player only after a click)
document.querySelectorAll('[data-yt-facade]').forEach((el) => {
  el.addEventListener('click', () => {
    const id = el.dataset.ytFacade;
    el.innerHTML = `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1" title="Video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }, { once: true });
});

// Click-to-play local video facade (loads the <video> only after a click)
// Click anywhere on the video toggles play/pause, like a YouTube embed,
// instead of relying on the native control bar (which was hard to hit and
// felt like the video "couldn't be stopped").
document.querySelectorAll('[data-video-trigger]').forEach((el) => {
  el.addEventListener('click', () => {
    const src = el.dataset.videoTrigger || 'assets/video/tg7-servizio.mp4';
    el.innerHTML = `<video src="${src}" autoplay playsinline style="cursor:pointer;"></video><button type="button" class="video-toggle" aria-label="Pausa / Riproduci">⏸</button>`;
    const video = el.querySelector('video');
    const toggleBtn = el.querySelector('.video-toggle');
    const sync = () => { toggleBtn.textContent = video.paused ? '▶' : '⏸'; };
    const toggle = (e) => { e.stopPropagation(); video.paused ? video.play() : video.pause(); };
    video.addEventListener('click', toggle);
    toggleBtn.addEventListener('click', toggle);
    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);
  }, { once: true });
});

// Mandate signing animation
document.querySelectorAll('[data-sign-anim]').forEach((el) => {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { el.classList.add('in-view'); obs.unobserve(el); }
    });
  }, { threshold: 0.4 });
  obs.observe(el);
});

// Scratch card reveal
document.querySelectorAll('[data-scratch]').forEach((card) => {
  const cover = card.querySelector('[data-scratch-cover]');
  if (!cover) return;
  cover.addEventListener('click', () => { card.classList.add('revealed'); }, { once: true });
});

// Copyright year
document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

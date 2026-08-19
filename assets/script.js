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

// Sticky CTA appears after hero
const stickyCta = document.querySelector('[data-sticky-cta]');
if (stickyCta) {
  const hero = document.querySelector('.hero');
  const stickyObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      stickyCta.classList.toggle('visible', !entry.isIntersecting && entry.boundingClientRect.top < 0);
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

// ROI calculator
const calcSlider = document.querySelector('[data-calc-input]');
if (calcSlider) {
  const currentLabel = document.querySelector('[data-calc-current]');
  const outMandati = document.querySelector('[data-calc-mandati]');
  const outFatturato = document.querySelector('[data-calc-fatturato]');
  const outSpesaAnnua = document.querySelector('[data-calc-spesa-annua]');
  const COMMISSIONE_MEDIA = 7000;
  const COSTO_PER_INCARICO = 250;
  const update = () => {
    const investimento = parseInt(calcSlider.value, 10);
    currentLabel.textContent = investimento.toLocaleString('it-IT');
    const incarichi = Math.floor(investimento / COSTO_PER_INCARICO);
    outMandati.textContent = incarichi + ' incarichi/mese';
    outFatturato.textContent = '+' + (incarichi * 12 * COMMISSIONE_MEDIA).toLocaleString('it-IT') + '€/anno';
    if (outSpesaAnnua) outSpesaAnnua.textContent = (investimento * 12).toLocaleString('it-IT') + '€/anno';
  };
  calcSlider.addEventListener('input', update);
  update();
}

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

// Scratch card reveal
document.querySelectorAll('[data-scratch]').forEach((card) => {
  const cover = card.querySelector('[data-scratch-cover]');
  if (!cover) return;
  cover.addEventListener('click', () => { card.classList.add('revealed'); }, { once: true });
});

// Copyright year
document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

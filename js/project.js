/* =========================================================
   NVIDIA Cosmos Lab — Shared Project Page Script
   Injects shared header/footer, fetches publications.json,
   populates hero from the matching entry, handles scroll
   and hamburger.
   ========================================================= */

// Capture root URL synchronously before any async work
const _rootURL = (() => {
  const src = document.currentScript?.src;
  return src ? new URL('../', src).href : '/';
})();
const HOME_TARGET_STORAGE_KEY = 'cosmoslab-home-target';

// Start fetching header/footer/publications immediately (before DOMContentLoaded)
const _headerPromise = fetch(`${_rootURL}header.html`).then(r => r.text()).catch(() => '');
const _footerPromise = fetch(`${_rootURL}footer.html`).then(r => r.text()).catch(() => '');
const _pubsPromise   = fetch(`${_rootURL}data/publications.json`).then(r => r.json()).catch(() => ({}));

document.addEventListener('DOMContentLoaded', async () => {
  // Inject shared header + footer
  const [headerHTML, footerHTML, pubs] = await Promise.all([_headerPromise, _footerPromise, _pubsPromise]);
  const main = document.querySelector('main');
  if (main) {
    if (headerHTML) {
      const preparedHeaderHTML = headerHTML
        .replaceAll('{{root}}', _rootURL)
        .replace(`href="${_rootURL}#products"`, `href="${_rootURL}" data-home-target="products"`)
        .replace(`href="${_rootURL}#press"`, `href="${_rootURL}" data-home-target="press"`)
        .replace(`href="${_rootURL}#publications"`, `href="${_rootURL}" data-home-target="publications"`);
      main.insertAdjacentHTML('beforebegin', preparedHeaderHTML);
    }
    if (footerHTML) main.insertAdjacentHTML('afterend', footerHTML.replaceAll('{{root}}', _rootURL));
  }

  initHeader();
  initHamburger();
  initScrollReveal();
  initCarouselEnhancements();
  initCaptionToggleAria();
  initPageNav();
  warnMissingPosters();
  initVideoLazyLoad();

  const _slug = location.pathname.replace(/\/index\.html$/, '').split('/').filter(Boolean).pop() ?? '';
  const pub = pubs[_slug];
  if (!pub) return;

  // Page metadata
  const colonIdx = pub.title.indexOf(': ');
  document.title = `${pub.title} — Cosmos Lab`;
  setMeta('og:title', pub.title);
  setMeta('og:description', colonIdx !== -1 ? pub.title.slice(colonIdx + 2) : pub.title);
  const teaserSrc = pub['teaser-file'] ?? '';
  if (teaserSrc && !teaserSrc.endsWith('.mp4') && !teaserSrc.endsWith('.webm')) {
    setMeta('og:image', `${_rootURL}${teaserSrc}`);
  }

  // Hero title
  const titleEl = document.querySelector('.project-title');
  const subtitleEl = document.querySelector('.project-subtitle');
  if (titleEl) {
    if (colonIdx !== -1) {
      titleEl.innerHTML = `<span class="title-special">${escapeHtml(pub.title.slice(0, colonIdx))}</span>: ${escapeHtml(pub.title.slice(colonIdx + 2))}`;
    } else {
      titleEl.textContent = pub.title;
    }
    if (subtitleEl) subtitleEl.style.display = 'none';
  }

  const authorsEl = document.querySelector('.project-authors');
  if (authorsEl) authorsEl.innerHTML = formatAuthors(pub.authors ?? []);

  const venuePill = document.querySelector('.venue-pill');
  if (venuePill) {
    venuePill.textContent = pub.venue ?? '';
    if ((pub.venue ?? '').toLowerCase().includes('technical report')) {
      venuePill.classList.add('venue-technical-report');
    }
  }

  if (pub.award) {
    const pill = document.createElement('span');
    pill.className = 'award-pill';
    pill.textContent = pub.award;
    venuePill?.insertAdjacentElement('afterend', pill);
  }

  const linksEl = document.querySelector('.project-links');
  if (linksEl) {
    linksEl.innerHTML = (pub.links ?? [])
      .filter(l => l.label !== 'Project')
      .map(l => `<a class="link-btn" href="${l.url}" target="_blank" rel="noopener">${getLinkIcon(l.label)}${escapeHtml(l.label)}</a>`)
      .join('');
  }
});

// ---- Helpers ----

function getLinkIcon(label) {
  const l = label.toLowerCase();
  const icon = (path) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">${path}</svg>`;
  if (l.includes('paper') || l.includes('arxiv'))
    return icon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>');
  if (l.includes('code') || l.includes('github'))
    return icon('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>');
  if (l.includes('hugging') || l.includes('dataset'))
    return icon('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>');
  if (l.includes('video') || l.includes('demo'))
    return icon('<polygon points="5 3 19 12 5 21 5 3"/>');
  return icon('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>');
}

function setMeta(property, content) {
  let el = document.querySelector(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function formatAuthors(authors) {
  return authors.map(a => `<span>${escapeHtml(typeof a === 'string' ? a : a.name)}</span>`).join(' · ');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Header scroll ----

function initHeader() {
  const header = document.getElementById('site-header');
  if (!header) return;
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });
}

// ---- Hamburger toggle ----

function initHamburger() {
  const hamburger = document.getElementById('hamburger');
  const nav = document.getElementById('header-nav');
  if (!hamburger || !nav) return;

  const closeNav = () => {
    hamburger.classList.remove('open');
    nav.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
  };

  hamburger.addEventListener('click', () => {
    const open = hamburger.classList.toggle('open');
    nav.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
  });

  nav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      closeNav();
    });
  });

  nav.querySelectorAll('[data-home-target]').forEach(link => {
    const target = link.getAttribute('data-home-target');
    if (!target) return;
    link.addEventListener('click', event => {
      event.preventDefault();
      try {
        sessionStorage.setItem(HOME_TARGET_STORAGE_KEY, target);
      } catch {
        // If storage is unavailable, still navigate to the clean home URL.
      }
      window.location.assign(_rootURL);
    });
  });
}

// ---- Citation copy (called from onclick attribute) ----

function copyCitation(btn) {
  const code = btn.closest('.citation-block')?.querySelector('code')
    ?? document.querySelector('.citation pre code');
  if (!code) return;
  navigator.clipboard.writeText(code.textContent).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  }).catch(() => {
    btn.textContent = 'Failed';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
}

// ---- Scroll reveal ----

function initScrollReveal() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });

  document.querySelectorAll('.proj-section').forEach(section => {
    section.classList.add('reveal-start');
    observer.observe(section);
  });
}

// ---- Carousel enhancements: slide counter + dots + keyboard + touch ----

function initCarouselEnhancements() {
  document.querySelectorAll('.carousel').forEach(carousel => {
    const track = carousel.querySelector('.carousel-videos');
    if (!track) return;
    const figures = track.querySelectorAll('.carousel-figure');
    if (figures.length <= 1) return;

    // Slide counter (inside carousel, absolute position)
    const counter = document.createElement('div');
    counter.className = 'carousel-counter';
    counter.textContent = `1 / ${figures.length}`;
    carousel.appendChild(counter);

    // Dot indicators (outside carousel's overflow:hidden, below it)
    const dots = document.createElement('div');
    dots.className = 'carousel-dots';
    for (let i = 0; i < figures.length; i++) {
      const dot = document.createElement('button');
      dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
      dot.addEventListener('click', () => { track.style.transform = `translateX(-${i * 100}%)`; });
      dots.appendChild(dot);
    }
    carousel.insertAdjacentElement('afterend', dots);

    const getIdx = () => {
      const match = (track.style.transform || '').match(/translateX\(-(\d+(?:\.\d+)?)%\)/);
      return match ? Math.round(parseFloat(match[1]) / 100) : 0;
    };

    const update = () => {
      const idx = getIdx();
      counter.textContent = `${idx + 1} / ${figures.length}`;
      dots.querySelectorAll('.carousel-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
    };

    new MutationObserver(update).observe(track, { attributes: true, attributeFilter: ['style'] });

    // Touch / swipe support
    let touchStartX = 0;
    carousel.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    carousel.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 80) {
        if (dx < 0) carousel.querySelector('.carousel-btn.next')?.click();
        else carousel.querySelector('.carousel-btn.prev')?.click();
      }
    }, { passive: true });

    // Keyboard navigation
    carousel.setAttribute('tabindex', '0');
    carousel.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { carousel.querySelector('.carousel-btn.prev')?.click(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { carousel.querySelector('.carousel-btn.next')?.click(); e.preventDefault(); }
    });
  });
}

// ---- Caption toggle ARIA ----

function initCaptionToggleAria() {
  document.querySelectorAll('.caption-toggle').forEach(btn => {
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => {
      const caption = btn.closest('.carousel-figure')?.querySelector('figcaption');
      const expanded = caption ? caption.classList.contains('expanded') : false;
      btn.setAttribute('aria-expanded', String(expanded));
    });
  });
}

// ---- Page nav (back to publications + back to top) ----

function initPageNav() {
  const main = document.querySelector('main.project-page');
  if (!main) return;
  const nav = document.createElement('nav');
  nav.className = 'page-nav';
  nav.innerHTML = `
    <button class="page-nav-btn" onclick="window.scrollTo({top:0,behavior:'smooth'})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
      Top
    </button>
  `;
  main.appendChild(nav);
}

// ---- Video poster warning (dev aid) ----

function warnMissingPosters() {
  document.querySelectorAll('video[autoplay]').forEach(v => {
    if (!v.poster) {
      const src = v.src || v.querySelector('source')?.src || '(unknown)';
      console.warn('project.js: autoplay <video> missing poster=', src);
    }
  });
}

// ---- Lazy-load off-screen videos ----

function initVideoLazyLoad() {
  // Defer video source loading until near viewport
  document.querySelectorAll('video').forEach(video => {
    const source = video.querySelector('source[src]');
    if (source) {
      source.dataset.src = source.src;
      source.removeAttribute('src');
      video.preload = 'none';
      video.load(); // cancel any pending requests
    }
  });

  function loadVideosIn(root) {
    root.querySelectorAll('source[data-src]').forEach(source => {
      source.src = source.dataset.src;
      delete source.dataset.src;
      const video = source.closest('video');
      if (video) { video.load(); video.play().catch(() => {}); }
    });
  }

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      loadVideosIn(entry.target);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '300px' });

  // Observe carousel containers whole (all slides load when carousel enters view)
  document.querySelectorAll('.carousel').forEach(c => observer.observe(c));

  // Observe individual videos outside carousels
  document.querySelectorAll('video').forEach(video => {
    if (!video.closest('.carousel')) observer.observe(video);
  });
}

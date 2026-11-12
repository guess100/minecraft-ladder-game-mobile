/* 공용 유틸: DOM, 난수, 사운드, 폭죽, 저장소 */
(function (global) {
  'use strict';

  // ---------- DOM ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') { for (const sk in v) { if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]); else el.style[sk] = v[sk]; } }
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 난수 ----------
  function rng(seed) {
    // mulberry32
    let a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function secureRandom() {
    const b = new Uint32Array(1);
    (global.crypto || global.msCrypto).getRandomValues(b);
    return b[0] / 4294967296;
  }
  function randInt(n, r) { return Math.floor((r || secureRandom)() * n); }
  function shuffle(arr, r) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1, r); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function pick(arr, r) { return arr[randInt(arr.length, r)]; }
  function uid(n) {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < (n || 10); i++) s += chars[randInt(chars.length)];
    return s;
  }

  // ---------- 저장소 ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } },
  };

  // ---------- 사운드 (WebAudio 합성, 음원 파일 없음) ----------
  const Sfx = {
    ctx: null, on: store.get('tg-sound', true), master: null, musicTimer: null,
    unlock() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    setOn(v) { this.on = v; store.set('tg-sound', v); if (!v) this.stopMusic(); },
    tone(freq, dur, type, vol, when, slide) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime + (when || 0);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(vol == null ? 0.2 : vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol, when, hp) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime + (when || 0);
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = this.ctx.createBufferSource();
      s.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = vol == null ? 0.2 : vol;
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = hp || 800;
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t);
    },
    play(name) {
      switch (name) {
        case 'tap': this.tone(880, 0.05, 'square', 0.08); break;
        case 'good': this.tone(660, 0.08, 'square', 0.12); this.tone(990, 0.12, 'square', 0.12, 0.07); break;
        case 'bad': this.tone(180, 0.25, 'sawtooth', 0.15, 0, 90); break;
        case 'pop': this.tone(1200, 0.06, 'triangle', 0.2, 0, 300); this.noise(0.06, 0.15, 0, 2000); break;
        case 'boom': this.noise(0.6, 0.4, 0, 100); this.tone(90, 0.5, 'sawtooth', 0.25, 0, 40); break;
        case 'tick': this.tone(1000, 0.03, 'square', 0.1); break;
        case 'count': this.tone(523, 0.18, 'square', 0.18); break;
        case 'go': this.tone(784, 0.1, 'square', 0.2); this.tone(1046, 0.35, 'square', 0.2, 0.1); break;
        case 'end': [784, 659, 523].forEach((f, i) => this.tone(f, 0.18, 'square', 0.18, i * 0.15)); break;
        case 'join': this.tone(660, 0.08, 'triangle', 0.25); this.tone(880, 0.12, 'triangle', 0.25, 0.08); break;
        case 'reveal': this.tone(392, 0.12, 'square', 0.2); this.tone(523, 0.3, 'square', 0.2, 0.1); break;
        case 'drum': for (let i = 0; i < 14; i++) this.noise(0.05, 0.15 + i * 0.01, i * 0.07, 400); break;
        case 'fanfare': {
          const seq = [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.36], [784, 0.6], [1046, 0.72]];
          seq.forEach(([f, w]) => { this.tone(f, 0.3, 'square', 0.18, w); this.tone(f / 2, 0.3, 'triangle', 0.15, w); });
          break;
        }
        case 'win': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.25, i * 0.09)); break;
        case 'spin': this.tone(1400, 0.02, 'square', 0.06); break;
        default: break;
      }
    },
    note(i) { const f = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5][i % 8]; this.tone(f, 0.35, 'triangle', 0.3); },
    // 진행 화면 배경음 (간단한 8비트 루프)
    startMusic(bpm) {
      this.stopMusic();
      if (!this.on || !this.ctx) return;
      const step = 60 / (bpm || 132) / 2;
      const bass = [131, 131, 196, 131, 175, 175, 196, 147];
      const mel = [523, 0, 659, 784, 0, 659, 784, 1046, 880, 0, 784, 659, 698, 0, 659, 587];
      let i = 0;
      const tick = () => {
        if (!this.on) return;
        this.tone(bass[(i >> 1) % bass.length], step * 0.9, 'triangle', 0.1);
        const m = mel[i % mel.length];
        if (m) this.tone(m, step * 0.8, 'square', 0.035);
        if (i % 2 === 0) this.noise(0.03, 0.04, 0, 5000);
        i++;
      };
      this.musicTimer = setInterval(tick, step * 1000);
    },
    stopMusic() { if (this.musicTimer) clearInterval(this.musicTimer); this.musicTimer = null; },
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => global.addEventListener(ev, () => Sfx.unlock(), { passive: true }));

  // ---------- 폭죽 ----------
  const Confetti = {
    canvas: null, parts: [], raf: 0,
    burst(n, opts) {
      opts = opts || {};
      if (!this.canvas) {
        this.canvas = h('canvas', { class: 'confetti-canvas' });
        document.body.appendChild(this.canvas);
      }
      const c = this.canvas;
      c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
      const colors = ['#ffc93c', '#ff5d8f', '#4cc9f0', '#7bf1a8', '#b388ff', '#ff8a3d', '#ffffff'];
      for (let i = 0; i < (n || 160); i++) {
        const x = opts.x != null ? opts.x : Math.random();
        this.parts.push({
          x: x * c.width, y: (opts.y != null ? opts.y : -0.05) * c.height,
          vx: (Math.random() - 0.5) * 14 * devicePixelRatio, vy: (Math.random() * (opts.y != null ? -14 : 4) + 2) * devicePixelRatio,
          w: (6 + Math.random() * 8) * devicePixelRatio, h: (8 + Math.random() * 10) * devicePixelRatio,
          r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
          c: colors[(Math.random() * colors.length) | 0], life: 0,
        });
      }
      if (!this.raf) this.loop();
    },
    rain(sec) {
      const end = performance.now() + (sec || 4) * 1000;
      const t = setInterval(() => { if (performance.now() > end) clearInterval(t); else this.burst(18); }, 160);
    },
    loop() {
      const c = this.canvas, g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      const grav = 0.25 * devicePixelRatio;
      this.parts = this.parts.filter((p) => p.y < c.height + 40 && p.life < 600);
      for (const p of this.parts) {
        p.vy += grav; p.vx *= 0.99; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
        g.restore();
      }
      if (this.parts.length) this.raf = requestAnimationFrame(() => this.loop());
      else { this.raf = 0; g.clearRect(0, 0, c.width, c.height); }
    },
  };

  // ---------- QR ----------
  function qrSvg(text, opts) {
    opts = opts || {};
    const qr = global.qrcode(0, 'M');
    qr.addData(text); qr.make();
    const n = qr.getModuleCount();
    const q = 2; // quiet zone
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q},${r + q}h1v1h-1z`;
    const size = n + q * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${opts.bg || '#fff'}"/><path d="${d}" fill="${opts.fg || '#111'}"/></svg>`;
  }

  // ---------- 팀 색상 ----------
  const TEAM_COLORS = ['#ff5d5d', '#ffb02e', '#ffe14d', '#59d97a', '#2ec4b6', '#4cc9f0', '#4f7cff', '#9d6bff',
    '#e86bff', '#ff6fae', '#ff8a5b', '#b5e655', '#3ddbd9', '#8fa8ff', '#c9a0ff', '#f5f5f5'];

  function fmtNum(v, d) { return Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: 0 }); }

  global.TG = { h, $, $$, esc, rng, secureRandom, randInt, shuffle, pick, uid, store, Sfx, Confetti, qrSvg, TEAM_COLORS, fmtNum };
})(window);

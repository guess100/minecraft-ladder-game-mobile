/* 경품 추첨: 참가자 명단 + 경품 목록 → 10가지 연출로 당첨자 뽑기 (폰 없이 큰 화면만) */
(function () {
  'use strict';
  const { h, $, store, Sfx, Confetti, shuffle, randInt, secureRandom, esc } = TG;

  const KEY = 'tg-draw-v1';
  const S = Object.assign({ names: '', prizes: '', winners: [], absent: [], method: 'wheel', exclude: true, panel: true }, store.get(KEY, {}));
  const save = () => store.set(KEY, S);

  const METHODS = [
    { id: 'wheel', name: '돌림판', icon: '🎡', desc: '최대 120칸', max: 120 },
    { id: 'ladder', name: '사다리', icon: '🪜', desc: '최대 30명', max: 30 },
    { id: 'duck', name: '오리 경주', icon: '🦆', desc: '내 오리가 1등?', max: 20 },
    { id: 'rocket', name: '로켓 레이스', icon: '🚀', desc: '먼저 도착하면 당첨', max: 20 },
    { id: 'marble', name: '구슬 레이스', icon: '🎱', desc: '떨어지는 구슬', max: 20 },
    { id: 'slot', name: '슬롯머신', icon: '🎰', desc: '잭팟 당첨', max: 999 },
    { id: 'capsule', name: '캡슐 뽑기', icon: '🥚', desc: '열어 봐야 안다', max: 999 },
    { id: 'balloon', name: '풍선 서바이벌', icon: '🎈', desc: '끝까지 남으면 당첨', max: 60 },
    { id: 'spot', name: '스포트라이트', icon: '🔦', desc: '조명이 멈추는 곳', max: 60 },
    { id: 'lotto', name: '바람 추첨기', icon: '🔮', desc: '로또처럼 공 뽑기', max: 40 },
  ];
  const COLORS = ['#ff5d5d', '#ffb02e', '#ffe14d', '#59d97a', '#2ec4b6', '#4cc9f0', '#4f7cff', '#9d6bff', '#e86bff', '#ff6fae'];

  // ---------------- 명단/경품 파싱 ----------------
  function names() {
    const seen = new Map();
    return S.names.split(/[\n,\t]/).map((s) => s.trim()).filter(Boolean).map((n) => {
      // 동명이인은 (2) 붙여 구분
      const c = (seen.get(n) || 0) + 1; seen.set(n, c);
      return c > 1 ? `${n} (${c})` : n;
    });
  }
  function prizeSlots() {
    const out = [];
    S.prizes.split('\n').map((s) => s.trim()).filter(Boolean).forEach((line) => {
      const m = line.match(/^(.*?)[\s]*[x×*]\s*(\d+)\s*(개|명)?$/i);
      const name = m ? m[1].trim() : line;
      const n = m ? Math.min(200, Number(m[2])) : 1;
      for (let i = 0; i < n; i++) out.push({ name, idx: i + 1, of: n });
    });
    return out;
  }
  function currentPrize() {
    const slots = prizeSlots();
    if (!slots.length) return { name: '당첨', idx: S.winners.length + 1, of: 0, free: true };
    return slots[S.winners.length] || null;
  }
  function pool() {
    const won = new Set(S.winners.map((w) => w.name));
    const ab = new Set(S.absent);
    return names().filter((n) => !(S.exclude && won.has(n)) && !ab.has(n));
  }

  // ---------------- 화면 ----------------
  const stage = $('#stage');
  let busy = false, pending = null; // pending = {name, prize}

  function render() {
    $('#panel').classList.toggle('hidden', !S.panel);
    $('#names').value = S.names;
    $('#prizes').value = S.prizes;
    $('#exclude').checked = S.exclude;
    const all = names();
    $('#name-count').textContent = `${all.length}명`;
    const slots = prizeSlots();
    $('#prize-count').textContent = slots.length ? `총 ${slots.length}개` : '비우면 횟수 제한 없이 뽑기';
    const mg = $('#methods'); mg.innerHTML = '';
    METHODS.forEach((m) => mg.appendChild(h('button', { class: 'method' + (S.method === m.id ? ' sel' : ''), onclick: () => { if (busy) return; S.method = m.id; save(); render(); idle(); } },
      h('span', { class: 'mi' }, m.icon), h('b', null, m.name), h('small', null, m.desc))));
    renderWinners();
    renderBar();
  }
  function renderBar() {
    const p = currentPrize();
    const left = pool().length;
    const bar = $('#bar'); bar.innerHTML = '';
    if (!p) {
      bar.append(h('div', { class: 'now' }, '🎉 모든 경품 추첨이 끝났어요!'), h('span', { class: 'grow' }), h('button', { class: 'fbtn', onclick: copyWinners }, '📋 당첨자 엑셀로 복사'));
      return;
    }
    bar.append(h('div', { class: 'now' }, h('small', null, '지금 뽑을 경품'), h('b', null, p.name), p.of > 1 ? h('span', { class: 'of' }, `${p.idx}/${p.of}`) : null),
      h('div', { class: 'left' }, `추첨 대상 ${left}명`), h('span', { class: 'grow' }));
    if (pending) {
      bar.append(h('button', { class: 'fbtn primary', onclick: confirmWin }, '✓ 당첨 확정', h('kbd', null, 'Space')),
        h('button', { class: 'fbtn', onclick: absentRedraw }, '🙅 자리에 없음 → 다시 뽑기'));
    } else {
      bar.append(h('button', { class: 'fbtn primary' + (busy || left < 1 ? ' disabled' : ''), onclick: start }, `${METHODS.find((m) => m.id === S.method).icon} 추첨 시작`, h('kbd', null, 'Space')));
    }
  }
  function renderWinners() {
    const list = $('#winners'); list.innerHTML = '';
    if (!S.winners.length && !S.absent.length) list.append(h('div', { class: 'empty' }, '아직 당첨자가 없어요'));
    S.winners.forEach((w, i) => list.appendChild(h('div', { class: 'wrow' }, h('span', { class: 'n' }, i + 1), h('span', { class: 'p' }, w.prize), h('b', null, w.name))));
    if (S.absent.length) list.appendChild(h('div', { class: 'wrow absent' }, h('span', { class: 'p' }, '자리에 없음'), h('b', null, S.absent.join(', '))));
  }
  function copyWinners() {
    const tsv = ['순서\t경품\t당첨자', ...S.winners.map((w, i) => `${i + 1}\t${w.prize}\t${w.name}`)].join('\n');
    const done = () => toast('당첨자 목록을 복사했어요. 엑셀에 붙여넣기 하세요!');
    if (navigator.clipboard) navigator.clipboard.writeText(tsv).then(done, () => fallbackCopy(tsv, done)); else fallbackCopy(tsv, done);
  }
  function fallbackCopy(t, cb) { const ta = h('textarea', null, t); document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); cb(); }
  function toast(msg) { const t = h('div', { class: 'toast' }, msg); document.body.appendChild(t); setTimeout(() => t.remove(), 2400); }

  // 대기 화면
  function idle() {
    stage.innerHTML = '';
    const m = METHODS.find((x) => x.id === S.method);
    const p = currentPrize();
    stage.append(h('div', { class: 'idle' }, h('div', { class: 'idle-icon' }, m.icon), h('h1', null, m.name),
      p ? h('div', { class: 'idle-prize' }, '🎁 ', p.name) : h('div', { class: 'idle-prize' }, '추첨 완료'),
      h('p', null, names().length ? `참가자 ${names().length}명 · 추첨 대상 ${pool().length}명` : '왼쪽에 참가자 이름이나 번호를 넣어 주세요')));
  }

  // ---------------- 추첨 ----------------
  function start() {
    if (busy || pending) return;
    const p = currentPrize();
    if (!p) return;
    const cand = pool();
    if (!cand.length) { toast('추첨할 사람이 없어요. 참가자 명단을 확인해 주세요.'); return; }
    const winner = cand[randInt(cand.length, secureRandom)];
    busy = true; renderBar();
    stage.innerHTML = '';
    const m = METHODS.find((x) => x.id === S.method);
    const shown = sampleWith(cand, winner, m.max);
    const go = () => RUN[m.id](stage, shown, winner, () => { busy = false; reveal(winner, p); });
    if (shown.length < cand.length) prelim(cand.length, shown.length, go); else go();
  }
  // 인원이 많으면 "예선 통과" 연출 후 본선
  function prelim(total, k, next) {
    const box = h('div', { class: 'prelim' }, h('div', { class: 'pre-num' }, total + '명'), h('div', null, `중 무작위 ${k}명이 본선에 올라가요!`));
    stage.append(box);
    Sfx.play('drum');
    setTimeout(() => { box.remove(); next(); }, 1800);
  }
  function sampleWith(arr, w, k) {
    if (arr.length <= k) return shuffle(arr);
    const others = shuffle(arr.filter((x) => x !== w)).slice(0, k - 1);
    return shuffle([...others, w]);
  }
  function reveal(name, prize) {
    pending = { name, prize: prize.name };
    Sfx.play('fanfare'); Confetti.rain(3);
    stage.appendChild(h('div', { class: 'reveal' }, h('div', { class: 'rv-card' },
      h('div', { class: 'rv-top' }, '🎉 축하합니다!'), h('div', { class: 'rv-name' }, name), h('div', { class: 'rv-prize' }, '🎁 ', prize.name))));
    renderBar();
  }
  function confirmWin() {
    if (!pending) return;
    S.winners.push({ name: pending.name, prize: pending.prize, at: Date.now() });
    pending = null; save(); render(); idle();
  }
  function absentRedraw() {
    if (!pending) return;
    S.absent.push(pending.name);
    pending = null; save(); render(); start();
  }

  // ---------------- 연출 10종 ----------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function canvasIn(el) {
    const cv = h('canvas', { class: 'dcanvas' });
    el.appendChild(cv);
    const r = cv.getBoundingClientRect();
    cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio;
    return { cv, g: cv.getContext('2d'), W: cv.width, H: cv.height, dpr: devicePixelRatio };
  }
  const ease = (t) => 1 - Math.pow(1 - t, 4);
  const fit = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  const RUN = {
    // 1) 돌림판
    wheel(el, list, winner, done) {
      const wrap = h('div', { class: 'wheel-wrap' }, h('div', { class: 'wheel-pin' }, '▼'));
      el.appendChild(wrap);
      const { g, W, H } = canvasIn(wrap);
      const n = list.length, R = Math.min(W, H) / 2 - 10 * devicePixelRatio, cx = W / 2, cy = H / 2;
      const seg = (Math.PI * 2) / n;
      const wi = list.indexOf(winner);
      // 포인터는 위(-90°). 당첨 칸 중앙이 위에 오도록 회전값 계산 (+칸 안에서 약간 랜덤)
      const jitter = (secureRandom() - 0.5) * seg * 0.7;
      const target = Math.PI * 2 * (6 + randInt(3)) - (wi * seg + seg / 2) + jitter;
      const fs = Math.max(9, Math.min(28, 900 / n)) * devicePixelRatio;
      function draw(rot) {
        g.clearRect(0, 0, W, H);
        g.save(); g.translate(cx, cy); g.rotate(rot - Math.PI / 2);
        for (let i = 0; i < n; i++) {
          g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, i * seg, (i + 1) * seg); g.closePath();
          g.fillStyle = COLORS[i % COLORS.length]; g.fill();
          g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke();
          if (n <= 120) {
            g.save(); g.rotate(i * seg + seg / 2); g.textAlign = 'right'; g.textBaseline = 'middle';
            g.fillStyle = '#1a1426'; g.font = `800 ${fs}px Pretendard, sans-serif`;
            g.fillText(fit(list[i], n > 40 ? 6 : 10), R - 14 * devicePixelRatio, 0); g.restore();
          }
        }
        g.restore();
        g.beginPath(); g.arc(cx, cy, R * 0.12, 0, Math.PI * 2); g.fillStyle = '#1a1426'; g.fill();
        g.lineWidth = 6 * devicePixelRatio; g.strokeStyle = '#ffc93c'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      }
      const dur = 7000, t0 = performance.now();
      let lastSeg = -1;
      (function loop() {
        const t = Math.min(1, (performance.now() - t0) / dur);
        const rot = target * ease(t);
        draw(rot);
        const s = Math.floor(((-rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / seg);
        if (s !== lastSeg) { lastSeg = s; Sfx.play('spin'); }
        if (t < 1) requestAnimationFrame(loop); else setTimeout(done, 400);
      })();
    },

    // 2) 사다리
    ladder(el, list, winner, done) {
      const box = h('div', { class: 'ladder-wrap' });
      el.appendChild(box);
      const { g, W, H, dpr } = canvasIn(box);
      const n = list.length;
      const L = 14; // 가로줄 층 수
      const rungs = Array.from({ length: L }, () => new Array(Math.max(0, n - 1)).fill(false));
      for (let y = 0; y < L; y++) for (let x = 0; x < n - 1; x++) if (!rungs[y][x - 1] && secureRandom() < 0.42) rungs[y][x] = true;
      const trace = (c) => { const pts = [[c, -1]]; for (let y = 0; y < L; y++) { pts.push([c, y]); if (rungs[y][c - 1]) c--; else if (rungs[y][c]) c++; pts.push([c, y]); } pts.push([c, L]); return { pts, end: c }; };
      const paths = list.map((_, i) => trace(i));
      const giftCol = paths[list.indexOf(winner)].end;
      const top = 70 * dpr, bot = H - 70 * dpr, left = 40 * dpr, right = W - 40 * dpr;
      const X = (c) => (n === 1 ? (left + right) / 2 : left + (c * (right - left)) / (n - 1));
      const Y = (y) => top + ((y + 1) * (bot - top)) / (L + 1);
      const fs = Math.max(10, Math.min(22, 600 / n)) * dpr;
      function base() {
        g.clearRect(0, 0, W, H);
        g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3 * dpr; g.lineCap = 'round';
        for (let i = 0; i < n; i++) { g.beginPath(); g.moveTo(X(i), top); g.lineTo(X(i), bot); g.stroke(); }
        for (let y = 0; y < L; y++) for (let x = 0; x < n - 1; x++) if (rungs[y][x]) { g.beginPath(); g.moveTo(X(x), Y(y)); g.lineTo(X(x + 1), Y(y)); g.stroke(); }
        g.textAlign = 'center'; g.font = `800 ${fs}px Pretendard, sans-serif`;
        list.forEach((nm, i) => { g.save(); g.translate(X(i), top - 12 * dpr); if (n > 12) { g.rotate(-Math.PI / 3); g.textAlign = 'left'; } g.fillStyle = '#fff'; g.fillText(fit(nm, 8), 0, 0); g.restore(); });
        for (let i = 0; i < n; i++) { g.font = `${fs * 1.3}px serif`; g.fillText(i === giftCol ? '🎁' : '·', X(i), bot + 34 * dpr); }
      }
      const segLen = (p) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.abs(p[i][0] - p[i - 1][0]) + Math.abs(p[i][1] - p[i - 1][1]); return s; };
      const maxLen = Math.max(...paths.map((p) => segLen(p.pts)));
      function drawPath(p, upto, color, w) {
        g.strokeStyle = color; g.lineWidth = w * dpr; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(X(p[0][0]), top);
        let acc = 0;
        for (let i = 1; i < p.length; i++) {
          const [c0, y0] = p[i - 1], [c1, y1] = p[i];
          const d = Math.abs(c1 - c0) + Math.abs(y1 - y0);
          const yy = (y) => (y < 0 ? top : y >= L ? bot : Y(y));
          if (acc + d <= upto) { g.lineTo(X(c1), yy(y1)); acc += d; }
          else { const f = d ? (upto - acc) / d : 0; g.lineTo(X(c0) + (X(c1) - X(c0)) * f, yy(y0) + (yy(y1) - yy(y0)) * f); break; }
        }
        g.stroke();
      }
      const dur = 5000, t0 = performance.now();
      const wi = list.indexOf(winner);
      (function loop() {
        const t = Math.min(1, (performance.now() - t0) / dur);
        base();
        paths.forEach((p, i) => { if (i !== wi) drawPath(p.pts, maxLen * t, COLORS[i % COLORS.length] + 'aa', 4); });
        drawPath(paths[wi].pts, maxLen * t, '#ffc93c', t >= 1 ? 9 : 4);
        if (Math.random() < 0.15) Sfx.play('spin');
        if (t < 1) requestAnimationFrame(loop); else setTimeout(done, 600);
      })();
    },

    // 3~5) 레이스 3종
    duck(el, list, winner, done) { race(el, list, winner, done, { dir: 'right', icon: '🦆', bg: 'water', title: '🦆 오리 경주' }); },
    rocket(el, list, winner, done) { race(el, list, winner, done, { dir: 'up', icon: '🚀', bg: 'space', title: '🚀 로켓 레이스' }); },
    marble(el, list, winner, done) { race(el, list, winner, done, { dir: 'down', icon: '●', bg: 'board', title: '🎱 구슬 레이스' }); },

    // 6) 슬롯머신
    slot(el, list, winner, done) {
      const reel = h('div', { class: 'reel-strip' });
      const box = h('div', { class: 'slot' }, h('div', { class: 'slot-top' }, '🎰 JACKPOT 🎰'), h('div', { class: 'slot-window' }, reel), h('div', { class: 'bulbs' }));
      el.appendChild(box);
      for (let i = 0; i < 24; i++) box.querySelector('.bulbs').appendChild(h('i', { style: { animationDelay: (i % 2) * 0.25 + 's' } }));
      const seq = [];
      for (let i = 0; i < 60; i++) seq.push(list[randInt(list.length)]);
      seq.push(winner);
      seq.forEach((n) => reel.appendChild(h('div', { class: 'reel-item' }, n)));
      const itemH = box.querySelector('.slot-window').clientHeight;
      const dur = 6000, t0 = performance.now();
      let last = -1;
      (function loop() {
        const t = Math.min(1, (performance.now() - t0) / dur);
        const pos = ease(t) * (seq.length - 1);
        reel.style.transform = `translateY(${-pos * itemH}px)`;
        if (Math.floor(pos) !== last) { last = Math.floor(pos); Sfx.play('spin'); }
        if (t < 1) requestAnimationFrame(loop); else { box.classList.add('win'); setTimeout(done, 700); }
      })();
    },

    // 7) 캡슐 뽑기
    async capsule(el, list, winner, done) {
      const glass = h('div', { class: 'cap-glass' });
      const machine = h('div', { class: 'cap-machine' }, glass, h('div', { class: 'cap-body' }, h('div', { class: 'cap-handle' }, '⟳'), h('div', { class: 'cap-slot' })));
      el.appendChild(machine);
      const k = Math.min(30, list.length + 8);
      for (let i = 0; i < k; i++) {
        glass.appendChild(h('div', { class: 'cap', style: { left: 6 + secureRandom() * 80 + '%', top: 30 + secureRandom() * 58 + '%', '--a': COLORS[i % COLORS.length], '--b': '#fff', animationDelay: secureRandom() + 's' } }));
      }
      machine.classList.add('shaking');
      for (let i = 0; i < 8; i++) { Sfx.play('spin'); await sleep(250); }
      machine.querySelector('.cap-handle').classList.add('turn');
      await sleep(900);
      machine.classList.remove('shaking');
      const drop = h('div', { class: 'cap big', style: { '--a': '#ffc93c', '--b': '#fff' } });
      machine.querySelector('.cap-slot').appendChild(drop);
      Sfx.play('pop');
      await sleep(900);
      drop.classList.add('open');
      Sfx.play('reveal');
      drop.appendChild(h('div', { class: 'cap-paper' }, winner));
      await sleep(900);
      done();
    },

    // 8) 풍선 서바이벌
    async balloon(el, list, winner, done) {
      const grid = h('div', { class: 'bal-grid', style: { '--cols': Math.ceil(Math.sqrt(list.length * 1.8)) } });
      el.appendChild(grid);
      const map = new Map();
      list.forEach((n, i) => { const b = h('div', { class: 'bal', style: { '--c': COLORS[i % COLORS.length], animationDelay: secureRandom() * 2 + 's' } }, h('span', null, n)); grid.appendChild(b); map.set(n, b); });
      await sleep(900);
      const order = shuffle(list.filter((x) => x !== winner));
      for (let i = 0; i < order.length; i++) {
        const b = map.get(order[i]);
        b.classList.add('pop'); Sfx.play('pop');
        const left = order.length - i;
        await sleep(left > 20 ? 90 : left > 8 ? 220 : left > 3 ? 500 : 900);
      }
      map.get(winner).classList.add('survivor');
      await sleep(800);
      done();
    },

    // 9) 스포트라이트
    async spot(el, list, winner, done) {
      const grid = h('div', { class: 'spot-grid', style: { '--cols': Math.ceil(Math.sqrt(list.length * 1.8)) } });
      const light = h('div', { class: 'spot-light' });
      const box = h('div', { class: 'spot-wrap' }, grid, light);
      el.appendChild(box);
      const cards = list.map((n) => { const c = h('div', { class: 'spot-card' }, n); grid.appendChild(c); return c; });
      const wi = list.indexOf(winner);
      const steps = 28 + randInt(6);
      const seq = [];
      for (let i = 0; i < steps; i++) seq.push(randInt(list.length));
      seq.push(wi);
      for (let i = 0; i < seq.length; i++) {
        const c = cards[seq[i]];
        const r = c.getBoundingClientRect(), br = box.getBoundingClientRect();
        light.style.left = r.left - br.left + r.width / 2 + 'px';
        light.style.top = r.top - br.top + r.height / 2 + 'px';
        cards.forEach((x) => x.classList.remove('lit')); c.classList.add('lit');
        Sfx.play('tick');
        await sleep(60 + Math.pow(i / seq.length, 3) * 600);
      }
      box.classList.add('final');
      await sleep(700);
      done();
    },

    // 10) 바람 추첨기
    lotto(el, list, winner, done) {
      const box = h('div', { class: 'lotto-wrap' });
      el.appendChild(box);
      const { g, W, H, dpr } = canvasIn(box);
      const cx = W / 2, cy = H * 0.58, R = Math.min(W, H) * 0.36;
      const br = Math.max(14, Math.min(34, R / dpr / Math.sqrt(list.length) * 0.75)) * dpr;
      const balls = list.map((n, i) => ({ n, x: cx + (secureRandom() - 0.5) * R, y: cy + secureRandom() * R * 0.6, vx: 0, vy: 0, c: COLORS[i % COLORS.length] }));
      const win = balls[list.indexOf(winner)];
      const dur = 5200, t0 = performance.now();
      let out = 0;
      (function loop() {
        const now = performance.now(), t = (now - t0) / dur;
        // 바람: 아래에서 위로 + 무작위 흔들림
        balls.forEach((b) => {
          if (b === win && t > 1) return;
          b.vy += 0.35 * dpr; b.vx += (Math.random() - 0.5) * 2.2 * dpr; b.vy += (Math.random() - 0.7) * 2.6 * dpr * (t < 1 ? 1 : 0.3);
          b.vx *= 0.985; b.vy *= 0.985; b.x += b.vx; b.y += b.vy;
          const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
          if (d > R - br) { const nx = dx / d, ny = dy / d; b.x = cx + nx * (R - br); b.y = cy + ny * (R - br); const dot = b.vx * nx + b.vy * ny; b.vx -= 1.8 * dot * nx; b.vy -= 1.8 * dot * ny; }
        });
        if (t > 1) {
          // 당첨 공이 위쪽 관으로 빠져나옴
          out = Math.min(1, out + 0.012);
          const sx = cx, sy = cy - R;
          win.x = sx; win.y = sy - out * (H * 0.18);
        }
        g.clearRect(0, 0, W, H);
        g.fillStyle = 'rgba(120,160,255,.08)'; g.strokeStyle = 'rgba(200,220,255,.5)'; g.lineWidth = 4 * dpr;
        g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillRect(cx - br * 1.2, cy - R - H * 0.2, br * 2.4, H * 0.2); g.strokeRect(cx - br * 1.2, cy - R - H * 0.2, br * 2.4, H * 0.2);
        balls.forEach((b) => {
          const big = b === win && t > 1 ? 1 + out * 1.6 : 1;
          const r = br * big;
          g.beginPath(); g.arc(b.x, b.y, r, 0, Math.PI * 2); g.fillStyle = b.c; g.fill();
          g.beginPath(); g.arc(b.x - r * 0.3, b.y - r * 0.3, r * 0.3, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.5)'; g.fill();
          g.fillStyle = '#1a1426'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `800 ${r * 0.62}px Pretendard, sans-serif`;
          g.fillText(fit(b.n, big > 1.5 ? 6 : 3), b.x, b.y);
        });
        if (Math.random() < 0.2) Sfx.play('tick');
        if (out < 1) requestAnimationFrame(loop); else setTimeout(done, 500);
      })();
    },
  };

  // 레이스 공용: 당첨자가 먼저 들어오도록 각 선수의 도착 시간을 정해 두고, 중간에 순위가 뒤집히도록 흔들어 줌
  function race(el, list, winner, done, o) {
    const n = list.length;
    const box = h('div', { class: 'race ' + o.dir + ' ' + o.bg }, h('div', { class: 'race-title' }, o.title));
    const lanes = h('div', { class: 'race-lanes', style: { '--n': n } });
    box.appendChild(lanes);
    el.appendChild(box);
    const base = 9000;
    const finish = list.map(() => base + secureRandom() * 2500);
    const wi = list.indexOf(winner);
    finish[wi] = Math.min(...finish) - 300 - secureRandom() * 400;
    const wob = list.map(() => ({ a: 0.05 + secureRandom() * 0.08, k: 1 + randInt(3), ph: secureRandom() * 6 }));
    const runners = list.map((nm, i) => {
      const r = h('div', { class: 'runner', style: { '--c': COLORS[i % COLORS.length] } }, h('span', { class: 'ico' }, o.icon), h('span', { class: 'lbl' }, fit(nm, 8)));
      const lane = h('div', { class: 'lane' }, r);
      lanes.appendChild(lane);
      return r;
    });
    const t0 = performance.now();
    const end = Math.max(...finish) + 300;
    let first = false;
    (function loop() {
      const t = performance.now() - t0;
      runners.forEach((r, i) => {
        const u = Math.min(1, t / finish[i]);
        const p = Math.max(0, Math.min(1, u + wob[i].a * Math.sin(Math.PI * 2 * wob[i].k * u + wob[i].ph) * u * (1 - u) * 4));
        r.style.setProperty('--p', p);
        if (u >= 1 && i === wi && !first) { first = true; r.classList.add('first'); Sfx.play('win'); }
      });
      if (Math.random() < 0.1) Sfx.play('tick');
      if (t < Math.min(end, finish[wi] + 1500)) requestAnimationFrame(loop); else done();
    })();
  }

  // ---------------- 입력 ----------------
  $('#names').addEventListener('input', (e) => { S.names = e.target.value; save(); render(); if (!busy && !pending) idle(); });
  $('#prizes').addEventListener('input', (e) => { S.prizes = e.target.value; save(); renderBar(); });
  $('#exclude').addEventListener('change', (e) => { S.exclude = e.target.checked; save(); renderBar(); });
  $('#fill-num').onclick = () => {
    const n = Number(prompt('번호를 몇 번까지 만들까요? (1 ~ 999)', '50'));
    if (!n || n < 1) return;
    S.names = Array.from({ length: Math.min(999, n) }, (_, i) => String(i + 1) + '번').join('\n');
    save(); render(); idle();
  };
  $('#reset').onclick = () => { if (confirm('당첨 기록을 지우고 처음부터 다시 뽑을까요? (명단·경품은 유지)')) { S.winners = []; S.absent = []; pending = null; save(); render(); idle(); } };
  $('#copy').onclick = copyWinners;
  $('#toggle').onclick = () => { S.panel = !S.panel; save(); render(); setTimeout(() => { if (!busy && !pending) idle(); }, 50); };
  $('#snd').onclick = () => { Sfx.unlock(); Sfx.setOn(!Sfx.on); $('#snd').textContent = Sfx.on ? '🔊' : '🔇'; };
  $('#snd').textContent = Sfx.on ? '🔊' : '🔇';
  $('#full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); };
  addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'PageDown') { e.preventDefault(); if (pending) confirmWin(); else start(); }
    if (e.key === 'h' || e.key === 'H') $('#toggle').click();
  });

  if (!S.names) S.names = '';
  render(); idle();
  void esc;
})();

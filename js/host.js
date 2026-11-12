/* 진행 화면 (노트북 + TV/빔프로젝터) */
(function () {
  'use strict';
  const { h, $, store, uid, Sfx, Confetti, qrSvg, TEAM_COLORS, randInt, secureRandom } = TG;

  const KEY = 'tg-host-v1';
  const MAX_TEAMS = 16;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  // ---------------- 저장 상태 ----------------
  const S = Object.assign({
    code: null, title: '송년회 팀 대항 오락실', teams: [], members: {}, history: [], allowNew: true,
  }, store.get(KEY, {}));
  if (!S.code) S.code = Array.from({ length: 5 }, () => CODE_CHARS[randInt(CODE_CHARS.length)]).join('');
  const save = () => store.set(KEY, S);
  save();

  // ---------------- 실행 상태 ----------------
  let view = S.teams.length ? 'menu' : 'lobby';
  let round = null;          // 진행 중인 게임
  let final = null;          // 최종 발표 {order, revealed}
  let selIdx = 0;            // 메뉴 선택 커서
  let netStatus = 'connecting';
  const conns = new Map();   // connId -> cid
  const online = new Map();  // cid -> connId

  // ---------------- 네트워크 ----------------
  const net = Net.createHost(S.code, {
    onStatus(s) { netStatus = s; renderTop(); },
    onConnect() { },
    onClose(id) {
      const cid = conns.get(id);
      conns.delete(id);
      if (cid && online.get(cid) === id) online.delete(cid);
      changed();
    },
    onMessage(id, m) { if (m && typeof m === 'object') handle(id, m); },
  });

  function handle(id, m) {
    if (m.t === 'ping') { net.send(id, { t: 'pong' }); return; }
    if (m.t === 'hello' && typeof m.cid === 'string') {
      const prev = online.get(m.cid);
      conns.set(id, m.cid); online.set(m.cid, id);
      if (prev && prev !== id) conns.delete(prev);
      sendState(id);
      changed();
      return;
    }
    const cid = conns.get(id);
    if (!cid) return;
    if (m.t === 'join') {
      let team = null;
      if (m.teamId) team = S.teams.find((t) => t.id === m.teamId);
      else if (typeof m.name === 'string') {
        const name = m.name.trim().slice(0, 12);
        if (!name) return net.send(id, { t: 'error', msg: '팀 이름을 입력해 주세요' });
        team = S.teams.find((t) => t.name.replace(/\s/g, '').toLowerCase() === name.replace(/\s/g, '').toLowerCase());
        if (!team) {
          if (!S.allowNew) return net.send(id, { t: 'error', msg: '진행자가 만든 팀 중에서 골라 주세요' });
          if (S.teams.length >= MAX_TEAMS) return net.send(id, { t: 'error', msg: `팀이 가득 찼어요 (최대 ${MAX_TEAMS}팀)` });
          team = addTeam(name);
        }
      }
      if (!team) return;
      S.members[cid] = team.id; save();
      Sfx.play('join');
      changed();
      if (view === 'lobby') flashChip(team.id);
      return;
    }
    if (m.t === 'leave') { delete S.members[cid]; save(); changed(); return; }
    if (m.t === 'score' && round && m.rid === round.rid && (round.phase === 'play' || round.phase === 'collect')) {
      const teamId = S.members[cid];
      if (!teamId) return;
      const v = Number(m.v);
      if (!Number.isFinite(v)) return;
      round.reports[cid] = { teamId, v, p: Number(m.p) || 0, done: !!m.done };
      if (m.done) checkAllDone();
    }
  }

  function addTeam(name, bot) {
    const used = new Set(S.teams.map((t) => t.color));
    const color = TEAM_COLORS.find((c) => !used.has(c)) || TEAM_COLORS[S.teams.length % TEAM_COLORS.length];
    const team = { id: 't' + uid(6), name, color, adj: 0 };
    if (bot) team.bot = true;
    S.teams.push(team); save();
    return team;
  }

  // ---------------- 점수 ----------------
  function totals() {
    const tot = {};
    S.teams.forEach((t) => { tot[t.id] = t.adj || 0; });
    S.history.forEach((r) => { for (const k in r.points) if (k in tot) tot[k] += r.points[k]; });
    return tot;
  }
  function standings() {
    const tot = totals();
    const arr = S.teams.map((t) => ({ team: t, total: tot[t.id] }));
    arr.sort((a, b) => b.total - a.total);
    arr.forEach((x, i) => { x.rank = i > 0 && arr[i - 1].total === x.total ? arr[i - 1].rank : i + 1; });
    return arr;
  }
  function membersOf(teamId) { return Object.keys(S.members).filter((c) => S.members[c] === teamId); }
  function onlineCount(teamId) { return membersOf(teamId).filter((c) => online.has(c)).length; }

  function teamValues() {
    // 팀별 평균값 (여러 폰이면 평균)
    const acc = {};
    for (const cid in round.reports) {
      const r = round.reports[cid];
      if (!S.teams.find((t) => t.id === r.teamId)) continue;
      (acc[r.teamId] = acc[r.teamId] || []).push(r);
    }
    const out = {};
    for (const k in acc) {
      const list = acc[k];
      out[k] = {
        v: list.reduce((a, r) => a + r.v, 0) / list.length,
        p: list.reduce((a, r) => a + r.p, 0) / list.length,
        done: list.filter((r) => r.done).length, n: list.length,
      };
    }
    return out;
  }

  function computeResult() {
    const g = GameById[round.gameId];
    const vals = teamValues();
    const rows = Object.keys(vals).map((k) => ({ teamId: k, v: Math.round(vals[k].v * 1000) / 1000 }));
    rows.sort((a, b) => (g.better === 'low' ? a.v - b.v : b.v - a.v));
    rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].v === r.v ? rows[i - 1].rank : i + 1; });
    const T = S.teams.length;
    const points = {};
    rows.forEach((r) => { r.pts = Math.max(1, T - r.rank + 1); points[r.teamId] = r.pts; });
    S.teams.forEach((t) => { if (!(t.id in points)) points[t.id] = 0; });
    return { rows, points };
  }

  // ---------------- 게임 진행 ----------------
  function openIntro(gameId) {
    round = { rid: uid(8), gameId, phase: 'intro', seed: Math.floor(secureRandom() * 2 ** 31), reports: {} };
    view = 'round';
    render(); changed();
  }
  function startCountdown() {
    if (!round || round.phase !== 'intro') return;
    const g = GameById[round.gameId];
    round.phase = 'countdown';
    round.startAt = Date.now() + 3600;
    round.endAt = round.startAt + g.dur * 1000;
    round.reports = {};
    round.bots = setupBots(g);
    Sfx.stopMusic();
    render(); changed();
  }
  let timer = null;
  function tick() {
    if (!round) return;
    const now = Date.now();
    if (round.phase === 'countdown') {
      const n = Math.max(0, Math.ceil((round.startAt - now) / 1000));
      const el = $('#cd-num');
      if (el && el.dataset.n !== String(n)) {
        el.dataset.n = n; el.textContent = n > 0 ? n : 'GO!';
        el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
        Sfx.play(n > 0 ? 'count' : 'go');
      }
      if (now >= round.startAt) { round.phase = 'play'; Sfx.startMusic(); render(); changed(); }
    } else if (round.phase === 'play') {
      runBots(now);
      if (now >= round.endAt) endPlay();
      else updateLive();
    }
  }
  function endPlay() {
    if (!round || round.phase !== 'play') return;
    round.phase = 'collect';
    round.endAt = Math.min(round.endAt, Date.now());
    Sfx.stopMusic(); Sfx.play('end');
    runBots(Date.now(), true);
    render(); changed();
    setTimeout(finishRound, 1600); // 마지막 점수 수신 대기
  }
  function finishRound() {
    if (!round || round.phase !== 'collect') return;
    const res = computeResult();
    round.result = res;
    round.phase = 'result';
    S.history.push({ rid: round.rid, gameId: round.gameId, at: Date.now(), points: res.points, rows: res.rows });
    save();
    Sfx.play('fanfare');
    setTimeout(() => Confetti.burst(220), 300);
    render(); changed();
  }
  function checkAllDone() {
    if (!round || round.phase !== 'play') return;
    const players = [...online.keys()].filter((c) => S.members[c]);
    if (!players.length) return;
    const allDone = players.every((c) => round.reports[c] && round.reports[c].done);
    const botsDone = !round.bots || round.bots.every((b) => b.done);
    if (allDone && botsDone) setTimeout(endPlay, 800);
  }
  function abortRound() {
    round = null; view = 'menu'; Sfx.stopMusic();
    render(); changed();
  }
  function backToMenu() { round = null; view = 'menu'; render(); changed(); }
  function undoLast() {
    if (!S.history.length) return;
    const last = S.history[S.history.length - 1];
    const g = GameById[last.gameId];
    if (!confirm(`직전 게임 "${g ? g.name : last.gameId}" 결과를 취소할까요?\n(그 게임에서 받은 점수가 모두 빠져요)`)) return;
    S.history.pop(); save();
    if (round && round.rid === last.rid) round = null;
    view = 'menu'; render(); changed();
  }

  // ---------------- 리허설용 가상 팀 ----------------
  function setupBots(g) {
    return S.teams.filter((t) => t.bot).map((t) => {
      const [a, b] = g.bot || [10, 30];
      const target = a + Math.random() * (b - a);
      const doneAt = g.better === 'low' || g.id === 'dodge' || g.id === 'memory' ? 0.3 + Math.random() * 0.6 : 2;
      return { teamId: t.id, cid: 'bot:' + t.id, target, doneAt, done: false };
    });
  }
  function runBots(now, force) {
    if (!round || !round.bots) return;
    const g = GameById[round.gameId];
    const prog = Math.min(1, (now - round.startAt) / (g.dur * 1000));
    round.bots.forEach((b) => {
      if (b.done) return;
      let v, p = prog, done = false;
      if (g.id === 'run') {
        const finishAt = (b.target / g.dur);
        p = Math.min(1, prog / finishAt);
        if (p >= 1) { v = b.target; done = true; } else v = 1000 - p * 100;
        if (force && !done) v = 1000 - p * 100;
      } else if (g.better === 'low') {
        if (prog >= b.doneAt || force) { v = b.target; done = true; } else return;
      } else {
        v = Math.round(b.target * Math.min(1, prog / Math.min(1, b.doneAt)) * (0.9 + Math.random() * 0.2) * 10) / 10;
        if (prog >= b.doneAt) done = true;
        const prev = round.reports[b.cid];
        if (prev && prev.v > v) v = prev.v;
      }
      round.reports[b.cid] = { teamId: b.teamId, v, p, done };
      b.done = done;
    });
  }

  // ---------------- 참가자에게 상태 전송 ----------------
  let pending = false;
  function changed() {
    if (pending) return;
    pending = true;
    Promise.resolve().then(() => { pending = false; broadcast(); if (view === 'lobby' || view === 'menu') renderSide(); renderTop(); });
  }
  function broadcast() { for (const id of conns.keys()) sendState(id); }
  function sendState(id) {
    const cid = conns.get(id);
    const st = standings();
    const now = Date.now();
    const msg = {
      t: 'state', title: S.title, view, allowNew: S.allowNew, full: S.teams.length >= MAX_TEAMS,
      teams: st.map((x) => ({ id: x.team.id, name: x.team.name, color: x.team.color, total: x.total, rank: x.rank })),
      me: cid && S.members[cid] ? { teamId: S.members[cid] } : null,
      round: null, final: null,
    };
    if (round) {
      const r = { rid: round.rid, gameId: round.gameId, phase: round.phase, seed: round.seed };
      if (round.startAt) { r.playIn = round.startAt - now; r.endIn = round.endAt - now; }
      if (round.phase === 'result' && round.result && msg.me) {
        const row = round.result.rows.find((x) => x.teamId === msg.me.teamId);
        r.mine = row ? { rank: row.rank, pts: row.pts, v: row.v } : { rank: null, pts: 0 };
        r.teams = round.result.rows.length;
      }
      msg.round = r;
    }
    if (view === 'final' && final) {
      const f = { revealed: final.revealed, total: final.order.length };
      if (msg.me) {
        const idx = final.order.findIndex((x) => x.team.id === msg.me.teamId);
        if (idx >= final.order.length - final.revealed) f.mine = { rank: final.order[idx].rank, total: final.order[idx].total };
      }
      msg.final = f;
    }
    net.send(id, msg);
  }

  // ---------------- 화면 ----------------
  const main = $('#main'), foot = $('#foot');

  function joinUrl() {
    const base = location.href.replace(/[^/]*(\?.*)?(#.*)?$/, '');
    const p = Net.passParams(); p.set('r', S.code);
    return `${base}play.html?${p.toString()}`;
  }

  function renderTop() {
    $('#title').textContent = S.title;
    const badge = { lobby: '참가 접수', menu: '게임 선택', round: round ? { intro: '게임 안내', countdown: '준비', play: '플레이 중', collect: '집계 중', result: '결과' }[round.phase] : '', final: '최종 발표' }[view];
    $('#phase').textContent = badge || '';
    const nOnline = [...online.keys()].filter((c) => S.members[c]).length;
    const ns = $('#netstat');
    const txt = { online: `● 접속 ${nOnline}대`, connecting: '○ 연결 준비 중…', reconnecting: '○ 다시 연결 중…', 'waiting-id': '○ 방 다시 여는 중…' }[netStatus] || `⚠ 연결 오류 (${netStatus})`;
    ns.textContent = txt;
    ns.className = 'netstat ' + (netStatus === 'online' ? 'ok' : 'warn');
    $('#mini-code').textContent = S.code;
    $('#snd').textContent = Sfx.on ? '🔊' : '🔇';
  }

  function render() {
    main.innerHTML = ''; foot.innerHTML = '';
    document.body.dataset.view = view + (round ? '-' + round.phase : '');
    ({ lobby: renderLobby, menu: renderMenu, round: renderRound, final: renderFinal })[view]();
    renderTop();
  }

  function btn(label, onClick, cls, key) {
    return h('button', { class: 'fbtn ' + (cls || ''), onclick: onClick }, label, key ? h('kbd', null, key) : null);
  }

  // ----- 참가 접수 -----
  function renderLobby() {
    const url = joinUrl();
    main.append(h('div', { class: 'lobby' },
      h('div', { class: 'qr-card' }, h('div', { class: 'qr', html: qrSvg(url) }), h('div', { class: 'qr-code' }, '방 코드 ', h('b', null, S.code))),
      h('div', { class: 'lobby-copy' },
        h('h1', null, '폰 카메라로', h('br'), h('em', null, 'QR'), '을 찍어주세요'),
        h('ol', { class: 'steps' },
          h('li', null, h('b', null, '1'), 'QR 찍기 (앱 설치 X)'),
          h('li', null, h('b', null, '2'), '우리 팀 이름 입력'),
          h('li', null, h('b', null, '3'), '같은 팀원은 같은 팀 선택')),
        h('div', { class: 'joined' }, '참가 ', h('b', { id: 'team-count' }, S.teams.length + '팀')),
        h('div', { class: 'chips', id: 'chips' }),
        h('div', { class: 'url' }, url))));
    foot.append(
      btn('게임 고르러 가기', () => { view = 'menu'; render(); changed(); }, 'primary', 'Space'),
      btn('⚙️ 팀 관리·설정', openSettings));
    renderSide();
  }
  function renderChips(el) {
    el.innerHTML = '';
    S.teams.forEach((t) => {
      const n = onlineCount(t.id);
      el.appendChild(h('span', { class: 'chip', 'data-id': t.id, style: { '--c': t.color } }, h('i'), t.name, h('small', null, t.bot ? '가상' : n ? `${n}대` : '대기')));
    });
  }
  function flashChip(id) { const c = document.querySelector(`.chip[data-id="${id}"]`); if (c) { c.classList.remove('new'); void c.offsetWidth; c.classList.add('new'); } }

  // ----- 게임 선택 -----
  function playedCount(id) { return S.history.filter((r) => r.gameId === id).length; }
  function renderMenu() {
    const grid = h('div', { class: 'game-grid' });
    GAMES.forEach((g, i) => {
      const n = playedCount(g.id);
      const card = h('button', { class: 'game-card' + (i === selIdx ? ' sel' : '') + (n ? ' played' : ''), onclick: () => { selIdx = i; openIntro(g.id); } },
        h('div', { class: 'gc-icon' }, g.icon),
        h('div', { class: 'gc-name' }, g.name),
        h('div', { class: 'gc-desc' }, g.desc),
        h('div', { class: 'gc-meta' }, h('span', { class: 'tag' }, g.tag), `${g.dur}초`, n ? h('span', { class: 'done' }, `✓ ${n}회`) : null));
      card.addEventListener('mouseenter', () => { selIdx = i; markSel(); });
      grid.appendChild(card);
    });
    main.append(h('div', { class: 'menu' },
      h('div', { class: 'menu-left' }, h('div', { class: 'sec-title' }, '게임을 골라주세요 ', h('small', null, `${GAMES.length}종 · 방향키+Space로도 선택`)), grid),
      h('aside', { class: 'side', id: 'side' })));
    foot.append(
      btn('📱 참가 QR 크게', () => showQR()), btn('⚙️ 팀 관리·설정', openSettings), btn('± 점수 보정', openAdjust),
      btn('↩ 직전 게임 결과 취소', undoLast, S.history.length ? '' : 'disabled'),
      h('span', { class: 'grow' }),
      btn('🏆 최종 순위 발표', startFinal, 'gold'));
    renderSide();
  }
  function markSel() { document.querySelectorAll('.game-card').forEach((c, i) => c.classList.toggle('sel', i === selIdx)); }

  function renderSide() {
    const side = $('#side');
    if (side) {
      const st = standings();
      side.innerHTML = '';
      side.append(h('div', { class: 'side-title' }, '종합 순위 ', h('small', null, `${S.history.length}게임 진행`)));
      if (!st.length) side.append(h('div', { class: 'empty' }, '아직 참가한 팀이 없어요'));
      st.forEach((x) => side.appendChild(h('div', { class: 'srow' + (x.rank <= 3 && S.history.length ? ' top' + x.rank : '') },
        h('span', { class: 'rk' }, x.rank), h('i', { style: { background: x.team.color } }), h('span', { class: 'nm' }, x.team.name),
        h('span', { class: 'on' }, x.team.bot ? '' : onlineCount(x.team.id) ? '●' : '○'), h('b', null, `${x.total}점`))));
    }
    const chips = $('#chips');
    if (chips) { renderChips(chips); $('#team-count').textContent = S.teams.length + '팀'; }
  }

  // ----- 게임 라운드 -----
  function renderRound() {
    const g = GameById[round.gameId];
    if (round.phase === 'intro') {
      const ready = [...online.keys()].filter((c) => S.members[c]).length;
      main.append(h('div', { class: 'intro' },
        h('div', { class: 'intro-icon' }, g.icon),
        h('div', { class: 'intro-copy' },
          h('div', { class: 'intro-tag' }, `${g.tag} · ${g.dur}초 · ${g.better === 'low' ? '낮을수록 승리' : '높을수록 승리'}`),
          h('h1', null, g.name),
          h('p', { class: 'intro-desc' }, g.desc),
          h('ul', null, g.howto.map((x) => h('li', null, x))),
          h('div', { class: 'intro-ready' }, `📱 준비된 폰 ${ready}대 · 팀당 평균 점수로 순위를 매겨요`)),
        h('div', { class: 'phone-mock' }, h('div', { class: 'pm-screen' }, h('div', { class: 'pm-icon' }, g.icon), h('div', null, g.name), h('small', null, '폰 화면에도 방법이 떠요')))));
      foot.append(btn('▶ 시작', startCountdown, 'primary', 'Space'), btn('← 다른 게임', backToMenu, '', 'Esc'));
    } else if (round.phase === 'countdown') {
      main.append(h('div', { class: 'countdown' }, h('div', { id: 'cd-num', class: 'cd-num' }, ''), h('div', { class: 'cd-game' }, g.icon + ' ' + g.name)));
      foot.append(btn('중단 (점수 반영 안 함)', abortRound));
    } else if (round.phase === 'play' || round.phase === 'collect') {
      main.append(h('div', { class: 'live' },
        h('div', { class: 'live-head' }, h('span', { class: 'lh-icon' }, g.icon), h('span', { class: 'lh-name' }, g.name),
          g.live === 'hidden' ? h('span', { class: 'lh-note' }, '🔒 결과는 끝나고 공개!') : null,
          round.phase === 'collect' ? h('span', { class: 'lh-note' }, '⏳ 결과 집계 중…') : null,
          h('span', { class: 'grow' }),
          h('div', { class: 'ring', id: 'ring', html: '<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" class="bg"/><circle cx="18" cy="18" r="16" class="fg" id="ring-fg"/></svg><b id="ring-t"></b>' })),
        h('div', { class: 'lanes mode-' + g.live, id: 'lanes' })));
      if (round.phase === 'play') foot.append(btn('⏹ 지금 종료하고 결과 보기', endPlay), btn('중단 (점수 반영 안 함)', abortRound));
      buildLanes(g);
      updateLive();
    } else if (round.phase === 'result') {
      renderResult(g);
    }
  }

  let laneEls = {};
  function buildLanes(g) {
    const lanes = $('#lanes');
    laneEls = {};
    S.teams.forEach((t) => {
      const row = h('div', { class: 'lane', style: { '--c': t.color } },
        h('span', { class: 'ln-rank' }, ''), h('span', { class: 'ln-name' }, h('i'), t.name),
        h('div', { class: 'ln-track' }, h('div', { class: 'ln-bar' }), g.live === 'race' ? h('div', { class: 'ln-runner' }, g.icon) : null),
        h('span', { class: 'ln-val' }, ''));
      lanes.appendChild(row);
      laneEls[t.id] = row;
    });
    lanes.style.setProperty('--n', Math.max(4, S.teams.length));
  }
  function updateLive() {
    if (!round || (round.phase !== 'play' && round.phase !== 'collect')) return;
    const g = GameById[round.gameId];
    const now = Date.now();
    const total = g.dur * 1000;
    const left = Math.max(0, round.endAt - now);
    const fg = $('#ring-fg'), rt = $('#ring-t');
    if (fg) { fg.style.strokeDashoffset = String(100.5 * (1 - left / total)); rt.textContent = Math.ceil(left / 1000); $('#ring').classList.toggle('hurry', left < 5000); }
    const vals = teamValues();
    let order = S.teams.map((t) => ({ t, x: vals[t.id] }));
    if (g.live === 'bars') {
      const max = Math.max(1, ...order.map((o) => (o.x ? o.x.v : 0)));
      order.sort((a, b) => (b.x ? b.x.v : -1) - (a.x ? a.x.v : -1));
      order.forEach((o, i) => {
        const row = laneEls[o.t.id]; if (!row) return;
        row.style.order = i;
        row.querySelector('.ln-rank').textContent = o.x ? (i === 0 ? '👑' : i + 1) : '';
        row.querySelector('.ln-bar').style.width = (o.x ? (o.x.v / max) * 100 : 0) + '%';
        row.querySelector('.ln-val').textContent = o.x ? (o.x.n > 1 ? '평균 ' : '') + fmtValue(g, o.x.v) : '-';
      });
    } else if (g.live === 'race') {
      order.forEach((o) => {
        const row = laneEls[o.t.id]; if (!row) return;
        const p = o.x ? o.x.p : 0;
        row.querySelector('.ln-bar').style.width = p * 100 + '%';
        row.querySelector('.ln-runner').style.left = `calc(${p * 100}% - ${p * 2.2}em)`;
        row.querySelector('.ln-val').textContent = o.x ? (o.x.done === o.x.n ? '🏁 ' + fmtValue(g, o.x.v) : Math.round(p * 100) + 'm') : '-';
      });
    } else {
      order.forEach((o) => {
        const row = laneEls[o.t.id]; if (!row) return;
        const n = Math.max(onlineCount(o.t.id), o.x ? o.x.n : 0) || (o.t.bot ? 1 : 0);
        const d = o.x ? o.x.done : 0;
        row.querySelector('.ln-bar').style.width = (n ? (d / n) * 100 : 0) + '%';
        row.querySelector('.ln-val').textContent = n ? (d >= n ? '✅ 완료' : `${d}/${n} 완료`) : '-';
      });
    }
  }

  function renderResult(g) {
    const rows = round.result.rows;
    const team = (id) => S.teams.find((t) => t.id === id) || { name: '?', color: '#888' };
    const podium = h('div', { class: 'podium' });
    [1, 0, 2].forEach((i) => {
      const r = rows[i];
      if (!r) { podium.appendChild(h('div', { class: 'pod empty' })); return; }
      const t = team(r.teamId);
      podium.appendChild(h('div', { class: 'pod p' + r.rank, style: { '--c': t.color } },
        h('div', { class: 'pod-medal' }, ['🥇', '🥈', '🥉'][r.rank - 1] || r.rank),
        h('div', { class: 'pod-name' }, t.name),
        h('div', { class: 'pod-val' }, fmtValue(g, r.v)),
        h('div', { class: 'pod-block' }, h('b', null, r.rank), h('span', { class: 'pts' }, `+${r.pts}점`))));
    });
    const rest = h('div', { class: 'rest' });
    rows.slice(3).forEach((r) => {
      const t = team(r.teamId);
      rest.appendChild(h('div', { class: 'rrow' }, h('span', { class: 'rk' }, r.rank), h('i', { style: { background: t.color } }), h('span', { class: 'nm' }, t.name), h('span', { class: 'v' }, fmtValue(g, r.v)), h('b', null, `+${r.pts}`)));
    });
    S.teams.filter((t) => !rows.find((r) => r.teamId === t.id)).forEach((t) => {
      rest.appendChild(h('div', { class: 'rrow absent' }, h('span', { class: 'rk' }, '-'), h('i', { style: { background: t.color } }), h('span', { class: 'nm' }, t.name), h('span', { class: 'v' }, '참가 안 함'), h('b', null, '+0')));
    });
    main.append(h('div', { class: 'result' }, h('div', { class: 'res-head' }, g.icon + ' ' + g.name + ' ', h('small', null, '결과')), podium, rest));
    foot.append(btn('계속 → 게임 선택', backToMenu, 'primary', 'Space'), btn('↩ 이 결과 취소', undoLast));
  }

  // ----- 최종 발표 -----
  function startFinal() {
    if (!S.teams.length) return;
    if (!confirm('최종 순위 발표를 시작할까요?\n(꼴찌부터 한 팀씩 공개돼요)')) return;
    round = null;
    final = { order: standings(), revealed: 0 };
    view = 'final';
    render(); changed();
  }
  function revealNext() {
    if (!final || final.revealed >= final.order.length) return;
    final.revealed++;
    const done = final.revealed >= final.order.length;
    if (done) { Sfx.play('drum'); setTimeout(() => { Sfx.play('fanfare'); Confetti.rain(5); render(); }, 1100); }
    else Sfx.play('reveal');
    if (!done) render(); else renderFinal(true);
    changed();
  }
  function renderFinal(drumroll) {
    if (drumroll === true) {
      // 1등 공개 직전 두구두구
      const row = document.querySelector('.frow.next');
      if (row) row.classList.add('drum');
      return;
    }
    const n = final.order.length;
    const allShown = final.revealed >= n;
    const list = h('div', { class: 'flist' });
    final.order.forEach((x, i) => {
      const shown = i >= n - final.revealed;
      const isNext = i === n - final.revealed - 1;
      list.appendChild(h('div', { class: 'frow' + (shown ? ' shown' : '') + (isNext ? ' next' : '') + (shown && i === n - final.revealed ? ' just' : ''), style: { '--c': x.team.color } },
        h('span', { class: 'rk' }, shown ? x.rank : '?'),
        shown ? h('i') : null,
        h('span', { class: 'nm' }, shown ? x.team.name : '두구두구…'),
        h('b', null, shown ? `${x.total}점` : '')));
    });
    if (allShown) {
      const winners = final.order.filter((x) => x.rank === 1);
      main.append(h('div', { class: 'celebrate' },
        h('div', { class: 'rays' }),
        h('div', { class: 'champ' }, h('div', { class: 'crown' }, '👑'), h('div', { class: 'champ-label' }, '우승'),
          h('div', { class: 'champ-name' }, winners.map((w) => w.team.name).join(' · ')),
          h('div', { class: 'champ-pts' }, `${winners[0].total}점`)),
        h('div', { class: 'final-side' }, h('h2', null, '축하합니다! 🎉'), list)));
      foot.append(btn('← 게임 선택으로', () => { final = null; view = 'menu'; render(); changed(); }), btn('🎉 폭죽 한 번 더', () => { Confetti.rain(3); Sfx.play('win'); }, 'gold', 'Space'));
    } else {
      main.append(h('div', { class: 'final' }, h('h1', null, '최종 순위 발표'), h('div', { class: 'final-sub' }, `${S.title} · ${S.history.length}게임 합산`), list));
      foot.append(btn(final.revealed === n - 1 ? '👑 우승팀 공개!' : '다음 팀 공개', revealNext, 'primary', 'Space'), btn('← 취소', () => { final = null; view = 'menu'; render(); changed(); }, '', 'Esc'));
    }
  }

  // ---------------- 모달: QR / 설정 / 점수 보정 ----------------
  function modal(content, cls) {
    closeModal();
    const m = h('div', { class: 'modal ' + (cls || ''), id: 'modal', onclick: (e) => { if (e.target === m) closeModal(); } }, h('div', { class: 'modal-box' }, h('button', { class: 'modal-x', onclick: closeModal }, '✕'), content));
    document.body.appendChild(m);
    return m;
  }
  function closeModal() { const m = $('#modal'); if (m) m.remove(); }

  function showQR() {
    const url = joinUrl();
    modal(h('div', { class: 'bigqr' }, h('div', { class: 'qr', html: qrSvg(url) }), h('div', null, h('h2', null, 'QR 찍고 참가하기'), h('p', null, '늦게 온 팀원도 같은 QR로 합류해요'), h('div', { class: 'qr-code' }, '방 코드 ', h('b', null, S.code)), h('div', { class: 'url' }, url))), 'qrmodal');
  }

  function openSettings() {
    const list = h('div', { class: 'tm-list' });
    function draw() {
      list.innerHTML = '';
      if (!S.teams.length) list.append(h('div', { class: 'empty' }, '팀이 없어요. 폰으로 참가하거나 아래에서 미리 만들 수 있어요.'));
      S.teams.forEach((t) => {
        list.appendChild(h('div', { class: 'tm-row' },
          h('i', { style: { background: t.color } }),
          h('input', { value: t.name, maxlength: 12, onchange: (e) => { t.name = e.target.value.trim() || t.name; save(); changed(); } }),
          h('small', null, t.bot ? '가상 팀' : `폰 ${membersOf(t.id).length}대 (접속 ${onlineCount(t.id)})`),
          h('button', { class: 'mini danger', onclick: () => {
            if (!confirm(`"${t.name}" 팀을 삭제할까요?`)) return;
            S.teams = S.teams.filter((x) => x.id !== t.id);
            for (const c in S.members) if (S.members[c] === t.id) delete S.members[c];
            save(); draw(); changed();
          } }, '삭제')));
      });
    }
    draw();
    const pre = h('textarea', { rows: 3, placeholder: '예) 1조, 2조, 3조, 4조  (쉼표나 줄바꿈으로 구분)' });
    const title = h('input', { value: S.title, maxlength: 30 });
    const allow = h('input', { type: 'checkbox' }); allow.checked = S.allowNew;
    modal(h('div', { class: 'settings' },
      h('h2', null, '⚙️ 팀 관리 · 설정'),
      h('label', { class: 'field' }, '행사 이름', title),
      h('label', { class: 'check' }, allow, ' 참가자가 새 팀 이름을 만들 수 있게 허용'),
      h('h3', null, `팀 목록 (${S.teams.length}/${MAX_TEAMS})`), list,
      h('label', { class: 'field' }, '팀 미리 만들기', pre),
      h('div', { class: 'row' },
        h('button', { class: 'mini', onclick: () => {
          pre.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).forEach((n) => { if (S.teams.length < MAX_TEAMS && !S.teams.find((t) => t.name === n)) addTeam(n.slice(0, 12)); });
          pre.value = ''; draw(); changed();
        } }, '팀 추가'),
        h('button', { class: 'mini', onclick: () => {
          const k = Number(prompt('리허설용 가상 팀을 몇 개 추가할까요? (실제 행사 전 삭제하세요)', '4'));
          for (let i = 0; i < k && S.teams.length < MAX_TEAMS; i++) addTeam('가상' + (S.teams.filter((t) => t.bot).length + 1) + '팀', true);
          draw(); changed();
        } }, '🤖 리허설용 가상 팀')),
      h('h3', null, '초기화'),
      h('div', { class: 'row' },
        h('button', { class: 'mini', onclick: () => { if (confirm('점수 기록만 모두 지울까요? (팀은 유지)')) { S.history = []; S.teams.forEach((t) => { t.adj = 0; }); save(); closeModal(); render(); changed(); } } }, '점수만 초기화'),
        h('button', { class: 'mini danger', onclick: () => { if (confirm('팀과 점수를 모두 지우고 새 방을 만들까요?\n참가자는 QR을 다시 찍어야 해요.')) { store.del(KEY); location.reload(); } } }, '전체 초기화 (새 방)')),
      h('div', { class: 'row end' }, h('button', { class: 'fbtn primary', onclick: () => { S.title = title.value.trim() || S.title; S.allowNew = allow.checked; save(); closeModal(); render(); changed(); } }, '저장'))));
  }

  function openAdjust() {
    const list = h('div', { class: 'tm-list' });
    const tot = totals();
    S.teams.forEach((t) => {
      const val = h('b', { class: 'adj-v' }, `${tot[t.id]}점`);
      const set = (d) => { t.adj = (t.adj || 0) + d; save(); val.textContent = `${totals()[t.id]}점`; changed(); };
      list.appendChild(h('div', { class: 'tm-row' }, h('i', { style: { background: t.color } }), h('span', { class: 'nm' }, t.name), val,
        h('button', { class: 'mini', onclick: () => set(-1) }, '−1'), h('button', { class: 'mini', onclick: () => set(1) }, '+1'), h('button', { class: 'mini', onclick: () => set(5) }, '+5'),
        h('small', null, t.adj ? `보정 ${t.adj > 0 ? '+' : ''}${t.adj}` : '')));
    });
    modal(h('div', { class: 'settings' }, h('h2', null, '± 점수 보정'), h('p', { class: 'muted' }, '장기자랑·응원상 같은 현장 이벤트 점수도 여기서 더해 주세요.'), list));
  }

  // ---------------- 키보드 (스페이스바 하나로 진행) ----------------
  addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if ($('#modal')) { if (e.key === 'Escape') closeModal(); return; }
    const k = e.key;
    if (k === 'f' || k === 'F') { toggleFull(); return; }
    if (k === 'q' || k === 'Q') { showQR(); return; }
    const primary = k === ' ' || k === 'Enter' || k === 'PageDown' || k === 'ArrowRight' && view !== 'menu';
    if (view === 'menu' && /^Arrow/.test(k)) {
      e.preventDefault();
      const cols = getComputedStyle($('.game-grid')).gridTemplateColumns.split(' ').length;
      selIdx = (selIdx + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[k]) + GAMES.length) % GAMES.length;
      markSel();
      return;
    }
    if (primary) {
      e.preventDefault();
      if (view === 'lobby') { view = 'menu'; render(); changed(); }
      else if (view === 'menu') openIntro(GAMES[selIdx].id);
      else if (view === 'round' && round) {
        if (round.phase === 'intro') startCountdown();
        else if (round.phase === 'result') backToMenu();
      } else if (view === 'final') {
        if (final.revealed < final.order.length) revealNext(); else { Confetti.rain(3); Sfx.play('win'); }
      }
    } else if (k === 'Escape' || k === 'PageUp') {
      if (view === 'round' && round && round.phase === 'intro') backToMenu();
      else if (view === 'final') { final = null; view = 'menu'; render(); changed(); }
    }
  });

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
  }

  $('#snd').onclick = () => { Sfx.unlock(); Sfx.setOn(!Sfx.on); renderTop(); };
  $('#full').onclick = toggleFull;
  $('#mini-qr').onclick = showQR;
  $('#mini-qr-svg').innerHTML = qrSvg(joinUrl());
  $('#title').onclick = openSettings;

  timer = setInterval(tick, 100);
  // 접속 폰 수 등 주기적 갱신
  setInterval(() => { if (view === 'lobby' || view === 'menu') renderSide(); if (round && round.phase === 'intro') { const el = document.querySelector('.intro-ready'); if (el) el.textContent = `📱 준비된 폰 ${[...online.keys()].filter((c) => S.members[c]).length}대 · 팀당 평균 점수로 순위를 매겨요`; } }, 1500);
  // 폰 쪽 남은 시간 보정용 주기적 브로드캐스트
  setInterval(() => { if (round && (round.phase === 'countdown' || round.phase === 'play')) broadcast(); }, 2000);

  render();
  window.__host = { S, get round() { return round; }, get view() { return view; }, openIntro, startCountdown, endPlay, backToMenu };
})();

/* 참가자 폰 화면 */
(function () {
  'use strict';
  const { h, $, store, uid, Sfx, Confetti, rng } = TG;

  const params = new URLSearchParams(location.search);
  let code = (params.get('r') || '').toUpperCase();
  const cid = store.get('tg-cid') || uid(12);
  store.set('tg-cid', cid);

  const wrap = $('#wrap');
  const topbar = $('#top');
  let st = null;          // 마지막으로 받은 상태
  let client = null;
  let status = 'connecting';
  let screen = '';        // 현재 그려진 화면 키
  let game = null;        // 진행 중인 게임 인스턴스
  let motionOK = false;

  function vibrate(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* 무시 */ } }

  // ---------------- 방 코드 입력 ----------------
  if (!code) {
    const inp = h('input', { class: 'code-input', maxlength: 5, placeholder: 'ABCDE', autocapitalize: 'characters', autocomplete: 'off' });
    wrap.append(h('div', { class: 'card center' },
      h('div', { class: 'logo' }, '🎮'), h('h1', null, '팀 대항 오락실'),
      h('p', null, '큰 화면에 보이는 방 코드 5자리를 입력하세요'), inp,
      h('button', { class: 'btn primary', onclick: () => { const v = inp.value.trim().toUpperCase(); if (v.length >= 4) { const p = new URLSearchParams(location.search); p.set('r', v); location.search = p.toString(); } } }, '입장하기')));
    return;
  }

  // ---------------- 연결 ----------------
  client = Net.createClient(code, {
    onStatus(s) {
      status = s;
      $('#conn').classList.toggle('hidden', s === 'open' || !st);
      if (!st) renderConnecting();
    },
    onOpen() { client.send({ t: 'hello', cid }); },
    onMessage(m) {
      if (!m) return;
      if (m.t === 'state') { onState(m); }
      else if (m.t === 'error') { toast(m.msg); }
    },
  });

  function renderConnecting() {
    if (screen === 'connecting') { const s = $('#cstat'); if (s) s.textContent = statusText(); return; }
    screen = 'connecting';
    wrap.innerHTML = '';
    wrap.append(h('div', { class: 'card center' }, h('div', { class: 'spinner' }), h('h2', null, '진행 화면에 연결 중…'), h('p', { id: 'cstat', class: 'muted' }, statusText()), h('p', { class: 'muted small' }, `방 코드 ${code}`)));
  }
  function statusText() {
    return { 'no-host': '진행 화면을 찾지 못했어요. 진행자 노트북이 켜져 있는지 확인해 주세요. 계속 다시 시도할게요.', error: '연결이 불안정해요. 다시 시도 중…', closed: '연결이 끊겼어요. 다시 연결 중…' }[status] || '잠시만 기다려 주세요';
  }

  function toast(msg) {
    const t = h('div', { class: 'toast' }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ---------------- 상태 처리 ----------------
  let localStart = 0, localEnd = 0, curRid = null;
  function onState(m) {
    const prevRound = st && st.round;
    st = m;
    $('#conn').classList.add('hidden');
    document.title = m.title + ' · 참가';
    const r = m.round;
    if (r && r.playIn != null) {
      const ns = Date.now() + r.playIn, ne = Date.now() + r.endIn;
      // 2초마다 오는 보정은 크게 어긋날 때만 반영 (네트워크 지연 흔들림 무시)
      if (curRid !== r.rid || Math.abs(ns - localStart) > 400) { localStart = ns; localEnd = ne; }
      curRid = r.rid;
    }
    if (prevRound && (!r || r.rid !== prevRound.rid) && game) stopGame();
    render();
  }

  function myTeam() { return st && st.me && st.teams.find((t) => t.id === st.me.teamId); }

  function renderTop() {
    const t = myTeam();
    topbar.classList.toggle('hidden', !t);
    if (!t) return;
    $('#tTeam').innerHTML = '';
    $('#tTeam').append(h('i', { style: { background: t.color } }), t.name);
    $('#tScore').textContent = `${t.rank}위 · ${t.total}점`;
    $('#tSnd').textContent = Sfx.on ? '🔊' : '🔇';
  }
  $('#tSnd').onclick = () => { Sfx.unlock(); Sfx.setOn(!Sfx.on); renderTop(); };

  function render() {
    renderTop();
    const t = myTeam();
    if (!t) return renderJoin();
    const r = st.round;
    if (st.view === 'final' && st.final) return renderFinal();
    if (r) {
      if (r.phase === 'intro') return renderIntro(r);
      if (r.phase === 'countdown') return renderCountdown(r);
      if (r.phase === 'play') return renderPlay(r);
      if (r.phase === 'collect') return renderCollect(r);
      if (r.phase === 'result') return renderResult(r);
    }
    renderWait();
  }

  function setScreen(key) {
    if (screen === key) return false;
    screen = key;
    wrap.innerHTML = '';
    document.body.dataset.screen = key.split(':')[0];
    return true;
  }

  const isSolo = () => !!(st && st.mode === 'solo');

  // ----- 팀 선택 / 개인전 이름 입력 -----
  function renderJoin() {
    if (isSolo()) return renderJoinSolo();
    const key = 'join:' + st.teams.map((x) => x.id + x.name).join(',') + st.allowNew + st.full;
    const prev = $('.name-input');
    const typed = prev ? prev.value : '';
    if (!setScreen(key)) return;
    const inp = h('input', { class: 'name-input', maxlength: 12, placeholder: '예) 영업1팀, 3조', value: typed || null });
    const go = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } Sfx.unlock(); client.send({ t: 'join', name: v }); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const card = h('div', { class: 'card' }, h('div', { class: 'eyebrow' }, st.title), h('h1', null, '우리 팀을 골라 주세요'));
    if (st.teams.length) {
      card.append(h('p', { class: 'muted' }, '이미 만들어진 팀이면 눌러서 합류'));
      const list = h('div', { class: 'team-pick' });
      st.teams.forEach((tm) => list.appendChild(h('button', { class: 'team-btn', style: { '--c': tm.color }, onclick: () => { Sfx.unlock(); client.send({ t: 'join', teamId: tm.id }); } }, h('i'), tm.name)));
      card.append(list);
    }
    if (st.allowNew && !st.full) {
      card.append(h('p', { class: 'muted' }, st.teams.length ? '또는 새 팀 만들기' : '팀 이름을 입력하면 입장 끝!'), h('div', { class: 'name-row' }, inp, h('button', { class: 'btn primary', onclick: go }, '입장')));
    } else if (st.full) card.append(h('p', { class: 'muted' }, '팀이 가득 찼어요. 위에서 우리 팀을 골라 주세요.'));
    wrap.append(card);
  }
  function renderJoinSolo() {
    const prev = $('.name-input');
    const typed = prev ? prev.value : '';
    if (!setScreen('join-solo:' + st.full)) return;
    const inp = h('input', { class: 'name-input', maxlength: 12, placeholder: '예) 홍길동', value: typed || null, autocomplete: 'name' });
    const go = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } Sfx.unlock(); client.send({ t: 'join', name: v }); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const card = h('div', { class: 'card' }, h('div', { class: 'eyebrow' }, st.title + ' · 개인전'), h('h1', null, '내 이름을 입력해 주세요'),
      h('p', { class: 'muted' }, '큰 화면과 순위표에 이 이름으로 나와요'));
    if (st.full) card.append(h('p', { class: 'muted' }, '정원이 가득 찼어요. 진행자에게 알려 주세요.'));
    else card.append(h('div', { class: 'name-row' }, inp, h('button', { class: 'btn primary', onclick: go }, '입장')));
    wrap.append(card);
  }

  // ----- 대기 -----
  function renderWait() {
    const t = myTeam();
    const key = 'wait';
    const fresh = setScreen(key);
    if (fresh) {
      wrap.append(h('div', { class: 'card center wait' },
        h('div', { class: 'team-badge', id: 'wBadge' }),
        h('div', { class: 'big-rank', id: 'wRank' }),
        h('p', { class: 'muted', id: 'wMsg' }),
        h('div', { class: 'mini-board', id: 'wBoard' }),
        isSolo() ? null : h('button', { class: 'link', onclick: () => { if (confirm('다른 팀으로 바꿀까요?')) client.send({ t: 'leave' }); } }, '팀 바꾸기')));
    }
    $('#wBadge').innerHTML = ''; $('#wBadge').append(h('i', { style: { background: t.color } }), t.name);
    $('#wRank').innerHTML = ''; $('#wRank').append(h('b', null, t.rank), '위 ', h('small', null, `${t.total}점`));
    $('#wMsg').textContent = st.view === 'lobby' ? (isSolo() ? '입장 완료! 다른 참가자를 기다리는 중이에요 🙌' : '입장 완료! 다른 팀을 기다리는 중이에요 🙌') : '진행자가 다음 게임을 고르는 중이에요';
    const b = $('#wBoard'); b.innerHTML = '';
    st.teams.slice(0, 8).forEach((x) => b.appendChild(h('div', { class: 'mb-row' + (x.id === t.id ? ' me' : '') }, h('span', null, x.rank), h('i', { style: { background: x.color } }), h('span', { class: 'nm' }, x.name), h('b', null, x.total + '점'))));
  }

  // ----- 게임 안내 -----
  function renderIntro(r) {
    const g = GameById[r.gameId];
    if (!setScreen('intro:' + r.rid)) return;
    const card = h('div', { class: 'card center intro' },
      h('div', { class: 'g-icon' }, g.icon), h('h1', null, g.name), h('p', { class: 'muted' }, `${g.dur}초 · ${g.desc}`),
      h('ul', { class: 'howto' }, g.howto.map((x) => h('li', null, x))),
      h('div', { class: 'ready' }, '진행자가 [시작]을 누르면 바로 시작해요!'));
    if (g.needsMotion) {
      const btn = h('button', { class: 'btn primary' }, motionOK ? '✅ 흔들기 준비 완료' : '📳 흔들기 센서 켜기 (꼭 눌러주세요)');
      btn.onclick = async () => {
        Sfx.unlock();
        try {
          if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') {
            const res = await DeviceMotionEvent.requestPermission();
            motionOK = res === 'granted';
          } else motionOK = true;
        } catch (e) { motionOK = false; }
        btn.textContent = motionOK ? '✅ 흔들기 준비 완료' : '센서를 못 켰어요 · 화면 연타로 참여해요';
      };
      card.append(btn);
    }
    wrap.append(card);
  }

  // ----- 카운트다운 -----
  let cdTimer = null;
  function renderCountdown(r) {
    const g = GameById[r.gameId];
    if (!setScreen('cd:' + r.rid)) return;
    const num = h('div', { class: 'cd' }, '');
    wrap.append(h('div', { class: 'card center cdwrap' }, h('div', { class: 'muted' }, g.icon + ' ' + g.name), num, h('div', { class: 'muted small' }, '준비!')));
    clearInterval(cdTimer);
    let last = null;
    cdTimer = setInterval(() => {
      const left = localStart - Date.now();
      const n = Math.ceil(left / 1000);
      if (n !== last) {
        last = n;
        num.textContent = n > 0 ? n : 'GO!';
        num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop');
        if (n > 0) { Sfx.play('count'); vibrate(40); }
      }
      if (left <= 0) { clearInterval(cdTimer); startGame(r); }
    }, 50);
  }

  // ----- 플레이 -----
  function renderPlay(r) {
    if (game && game.rid === r.rid) return;
    startGame(r);
  }
  function startGame(r) {
    if (game && game.rid === r.rid) return;
    clearInterval(cdTimer);
    const g = GameById[r.gameId];
    setScreen('play:' + r.rid);
    Sfx.play('go'); vibrate(80);
    const t0 = Math.min(Date.now(), localStart);
    const dur = Math.max(1000, localEnd - t0);
    const bar = h('div', { class: 'tbar' }, h('div', { class: 'tbar-fill' }));
    const myv = h('div', { class: 'myv' }, '');
    const area = h('div', { class: 'garea ga-' + g.id });
    wrap.append(h('div', { class: 'playwrap' }, h('div', { class: 'phead' }, h('span', null, g.icon + ' ' + g.name), myv), bar, area));
    $('#tClock').classList.remove('hidden');

    let lastV = null, lastP = 0, done = false, lastSent = 0, sendTimer = null;
    function send(final) {
      if (lastV == null) return;
      client.send({ t: 'score', rid: r.rid, v: lastV, p: lastP, done: done || !!final });
      lastSent = Date.now();
    }
    const ctx = {
      rand: rng(r.seed),
      dur: localEnd - Date.now(),
      elapsed: () => Date.now() - t0,
      left: () => localEnd - Date.now(),
      sfx: (n) => Sfx.play(n),
      vibrate,
      report(v, o) {
        if (game && game.over && !(o && o.done)) return;
        lastV = v; lastP = (o && o.p != null) ? o.p : lastP;
        if (o && o.done) done = true;
        myv.textContent = fmtValue(g, v);
        if (done || Date.now() - lastSent > 180) send();
        else if (!sendTimer) sendTimer = setTimeout(() => { sendTimer = null; send(); }, 200);
      },
    };
    game = { rid: r.rid, g, inst: null, over: false, send, ctx, area };
    ctx.dur = Math.max(1000, localEnd - Date.now());
    try { game.inst = g.play(area, ctx) || {}; } catch (e) { console.error(e); game.inst = {}; }
    void dur;
    // 타이머
    game.clock = setInterval(() => {
      const left = localEnd - Date.now();
      const total = Math.max(1, localEnd - localStart);
      bar.firstChild.style.width = Math.max(0, (left / total) * 100) + '%';
      bar.classList.toggle('hurry', left < 5000);
      $('#tClock').textContent = Math.max(0, Math.ceil(left / 1000)) + '초';
      if (left <= 0) endGame();
    }, 100);
  }
  function endGame() {
    if (!game || game.over) return;
    game.over = true;
    clearInterval(game.clock);
    const inst = game.inst || {};
    try { inst.stop && inst.stop(); } catch (e) { /* 무시 */ }
    let v = null;
    try { v = inst.final ? inst.final() : null; } catch (e) { /* 무시 */ }
    if (v != null && Number.isFinite(v)) {
      client.send({ t: 'score', rid: game.rid, v, p: game.g.live === 'race' ? (v < 900 ? 1 : (1000 - v) / 100) : 1, done: true });
    }
    $('#tClock').classList.add('hidden');
    Sfx.play('end'); vibrate(200);
    game.area.appendChild(h('div', { class: 'over' }, h('div', null, '끝!'), h('small', null, v != null ? '내 기록 ' + fmtValue(game.g, v) : '')));
  }
  function stopGame() {
    if (!game) return;
    if (!game.over) endGame();
    clearInterval(game.clock);
    game = null;
  }

  // ----- 집계 -----
  function renderCollect(r) {
    if (game && game.rid === r.rid) { endGame(); return; }
    if (!setScreen('collect:' + r.rid)) return;
    wrap.append(h('div', { class: 'card center' }, h('div', { class: 'spinner' }), h('h2', null, '결과 집계 중…'), h('p', { class: 'muted' }, '큰 화면을 봐 주세요!')));
  }

  // ----- 결과 -----
  function renderResult(r) {
    if (game) { stopGame(); }
    if (!setScreen('result:' + r.rid)) return;
    const g = GameById[r.gameId];
    const mine = r.mine || { rank: null, pts: 0 };
    const medal = ['🥇', '🥈', '🥉'][mine.rank - 1];
    wrap.append(h('div', { class: 'card center result' + (mine.rank === 1 ? ' win' : '') },
      h('div', { class: 'muted' }, g.icon + ' ' + g.name + ' 결과'),
      mine.rank ? h('div', { class: 'res-rank' }, medal || '🎖️', h('b', null, mine.rank + '위'), h('small', null, `/ ${r.teams}${isSolo() ? '명' : '팀'}`)) : h('div', { class: 'res-rank' }, '😴', h('b', null, '기록 없음')),
      mine.rank ? h('div', { class: 'res-val' }, (isSolo() ? '내 기록 ' : '팀 기록 ') + fmtValue(g, mine.v)) : null,
      h('div', { class: 'res-pts' }, `+${mine.pts}점`),
      h('p', { class: 'muted small' }, '큰 화면에서 다음 게임을 기다려요')));
    if (mine.rank === 1) { Confetti.burst(140); Sfx.play('win'); }
  }

  // ----- 최종 발표 -----
  function renderFinal() {
    const f = st.final;
    const key = 'final:' + (f.mine ? 'shown' : 'hidden');
    if (!setScreen(key)) return;
    if (!f.mine) {
      wrap.append(h('div', { class: 'card center' }, h('div', { class: 'g-icon drum' }, '🥁'), h('h2', null, '최종 순위 발표 중…'), h('p', { class: 'muted' }, '두구두구… 큰 화면을 봐 주세요!')));
    } else {
      const win = f.mine.rank === 1;
      wrap.append(h('div', { class: 'card center result' + (win ? ' win' : '') },
        h('div', { class: 'g-icon' }, win ? '👑' : '🏁'),
        h('div', { class: 'res-rank' }, h('small', null, '최종'), h('b', null, f.mine.rank + '위')),
        h('div', { class: 'res-pts' }, `${f.mine.total}점`),
        h('p', { class: 'muted' }, win ? '우승을 축하합니다! 🎉' : '수고 많으셨어요! 🙌')));
      if (win) { Confetti.rain(4); Sfx.play('fanfare'); }
    }
  }

  // 폰을 눕혔을 때 안내 (CSS 로 처리), 화면 꺼짐 방지 시도
  async function wake() { try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch (e) { /* 무시 */ } }
  document.addEventListener('pointerdown', wake, { once: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

  renderConnecting();
})();

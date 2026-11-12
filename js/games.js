/*
 * 팀 대항 미니게임 모음.
 * 각 게임: 메타 정보(진행 화면/폰 공용) + play(el, ctx) (폰에서 실행).
 *
 * ctx = {
 *   rand()          : 같은 판이면 모든 폰이 같은 순서로 나오는 난수
 *   report(v, o)    : 현재 점수 보고 (o.p = 0~1 진행도, o.done = 끝남)
 *   sfx(name), vibrate(ms), dur(ms), elapsed(), left()
 * }
 * play() 는 { final?: () => 최종값, stop?: () => void } 를 돌려준다.
 * better: 'high' 높을수록 좋음 / 'low' 낮을수록 좋음
 * live  : 'bars' 실시간 막대 / 'race' 달리기 트랙 / 'hidden' 결과 전까지 비공개
 */
(function (global) {
  'use strict';
  const { h, shuffle, pick, randInt } = global.TG;

  // ---------- 공용 도우미 ----------
  function flash(el, cls) {
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  }
  function floatText(parent, text, cls, x, y) {
    const f = h('div', { class: 'g-float ' + (cls || '') }, text);
    if (x != null) { f.style.left = x + 'px'; f.style.top = y + 'px'; }
    parent.appendChild(f);
    setTimeout(() => f.remove(), 700);
  }
  function scoreLine(el) {
    const s = h('div', { class: 'g-scoreline' });
    el.appendChild(s);
    return s;
  }

  // 객관식 게임 공통 틀: 맞으면 +1, 틀리면 -1(옵션) + 잠깐 잠김
  function choiceGame(el, ctx, next, opt) {
    opt = opt || {};
    let score = 0, locked = false, q = null, streak = 0;
    const prompt = h('div', { class: 'g-prompt' });
    const sub = h('div', { class: 'g-sub' });
    const grid = h('div', { class: 'g-choices' + (opt.cols ? ' cols-' + opt.cols : '') });
    const fb = h('div', { class: 'g-feedback' });
    el.append(sub, prompt, grid, fb);
    function render() {
      q = next(score);
      prompt.innerHTML = '';
      prompt.append(q.prompt instanceof Node ? q.prompt : document.createTextNode(q.prompt));
      sub.textContent = q.sub || '';
      grid.innerHTML = '';
      grid.className = 'g-choices cols-' + (q.cols || opt.cols || 2);
      q.choices.forEach((c) => {
        const b = h('button', { class: 'g-btn', style: c.style || null }, c.label);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); answer(c, b); });
        grid.appendChild(b);
      });
    }
    function answer(c, b) {
      if (locked) return;
      if (c.correct) {
        score++; streak++;
        ctx.sfx('good'); flash(b, 'ok');
        fb.textContent = streak >= 3 ? `${streak}연속 정답!` : '정답!';
        fb.className = 'g-feedback ok';
        ctx.report(score);
        locked = true;
        setTimeout(() => { locked = false; render(); }, opt.okDelay || 160);
      } else {
        streak = 0;
        if (opt.penalty !== false) score = Math.max(0, score - 1);
        ctx.sfx('bad'); ctx.vibrate(120); flash(b, 'no'); flash(el, 'shake');
        fb.textContent = opt.penalty !== false ? '땡! -1' : '땡!';
        fb.className = 'g-feedback no';
        ctx.report(score);
        locked = true;
        setTimeout(() => { locked = false; if (opt.nextOnWrong !== false) render(); }, opt.lock || 700);
      }
    }
    render();
    return { final: () => score };
  }

  // ---------- 단어/문제 은행 ----------
  const WORDS = ['송년회', '신년회', '회식', '건배', '노래방', '크리스마스', '산타클로스', '눈사람', '썰매', '선물',
    '케이크', '떡국', '해돋이', '달력', '연말정산', '보너스', '야근', '출근', '퇴근', '월급', '사원증', '회의실',
    '커피', '아메리카노', '라면', '김치찌개', '삼겹살', '치킨', '피자', '떡볶이', '붕어빵', '호빵', '군고구마',
    '귤', '딸기', '수박', '바나나', '고양이', '강아지', '호랑이', '토끼', '다람쥐', '펭귄', '기린', '코끼리',
    '비행기', '자전거', '지하철', '버스', '택시', '스마트폰', '노트북', '텔레비전', '냉장고', '세탁기', '에어컨',
    '축구', '야구', '농구', '배구', '볼링', '스키', '눈썰매', '줄넘기', '윷놀이', '팽이', '연날리기', '장갑',
    '목도리', '붕어', '오징어', '고등어', '미역국', '비빔밥', '불고기', '냉면', '만두', '김밥', '도시락', '편의점',
    '백화점', '영화관', '도서관', '박물관', '놀이공원', '수영장', '병원', '약국', '경찰서', '소방서', '우체국',
    '사다리', '두더지', '폭죽', '불꽃놀이', '트로피', '박수', '응원', '단합', '팀워크', '우승'];
  const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  function chosung(w) {
    return Array.from(w).map((ch) => {
      const c = ch.charCodeAt(0) - 0xac00;
      return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
    }).join('');
  }

  // [문제, 정답, 오답, 오답, 오답]
  const QUIZ = [
    ['대한민국의 수도는?', '서울', '부산', '인천', '대전'],
    ['1년은 며칠일까요? (평년)', '365일', '360일', '366일', '364일'],
    ['태양계에서 가장 큰 행성은?', '목성', '토성', '지구', '해왕성'],
    ['물의 화학식은?', 'H₂O', 'CO₂', 'O₂', 'NaCl'],
    ['한글을 만든 왕은?', '세종대왕', '태조', '정조', '광개토대왕'],
    ['축구 한 팀의 경기 인원은?', '11명', '9명', '10명', '12명'],
    ['무지개 색깔은 몇 가지?', '7가지', '5가지', '6가지', '8가지'],
    ['대한민국 국보 제1호였던 것은?', '숭례문', '흥인지문', '석굴암', '경복궁'],
    ['일본의 수도는?', '도쿄', '오사카', '교토', '삿포로'],
    ['피아노 건반은 모두 몇 개?', '88개', '72개', '76개', '96개'],
    ['오륜기 고리는 몇 개?', '5개', '4개', '6개', '7개'],
    ['물이 끓는 온도는? (1기압)', '100℃', '90℃', '80℃', '120℃'],
    ['지구에서 가장 넓은 바다는?', '태평양', '대서양', '인도양', '북극해'],
    ['우리나라 지폐 중 가장 큰 단위는?', '5만원권', '1만원권', '10만원권', '5천원권'],
    ['1만원권 지폐 속 인물은?', '세종대왕', '신사임당', '이황', '이이'],
    ['5만원권 지폐 속 인물은?', '신사임당', '유관순', '세종대왕', '이순신'],
    ['거북선을 만든 장군은?', '이순신', '강감찬', '을지문덕', '권율'],
    ['크리스마스는 몇 월 며칠?', '12월 25일', '12월 24일', '12월 31일', '1월 1일'],
    ['한국의 국화(나라꽃)는?', '무궁화', '진달래', '개나리', '벚꽃'],
    ['빛의 삼원색이 아닌 것은?', '노랑', '빨강', '초록', '파랑'],
    ['하루는 몇 시간?', '24시간', '12시간', '20시간', '36시간'],
    ['세계에서 가장 높은 산은?', '에베레스트', '한라산', '후지산', '킬리만자로'],
    ['남한에서 가장 높은 산은?', '한라산', '지리산', '설악산', '백두산'],
    ['개구리의 어릴 때 이름은?', '올챙이', '애벌레', '병아리', '송아지'],
    ['독도는 어느 도에 속할까요?', '경상북도', '강원도', '경상남도', '울릉도'],
    ['윷놀이에서 한 칸 가는 것은?', '도', '개', '걸', '윷'],
    ['윷놀이에서 다섯 칸 가는 것은?', '모', '윷', '걸', '도'],
    ['얼음이 녹는 온도는?', '0℃', '10℃', '-10℃', '4℃'],
    ['사계절 중 가장 낮이 긴 계절은?', '여름', '봄', '가을', '겨울'],
    ['동지에 먹는 음식은?', '팥죽', '송편', '떡국', '오곡밥'],
    ['설날에 먹는 음식은?', '떡국', '송편', '팥죽', '삼계탕'],
    ['추석에 먹는 떡은?', '송편', '인절미', '시루떡', '가래떡'],
    ['컴퓨터의 두뇌라 불리는 장치는?', 'CPU', '모니터', '마우스', '프린터'],
    ['달이 지구 주위를 한 바퀴 도는 데 약?', '한 달', '하루', '일주일', '1년'],
    ['올림픽은 몇 년마다 열릴까요?', '4년', '2년', '3년', '5년'],
    ['반대말 짝이 틀린 것은?', '크다-높다', '덥다-춥다', '길다-짧다', '빠르다-느리다'],
    ['곤충의 다리는 몇 개?', '6개', '8개', '4개', '10개'],
    ['거미의 다리는 몇 개?', '8개', '6개', '10개', '12개'],
    ['12간지의 첫 번째 동물은?', '쥐', '소', '호랑이', '용'],
    ['2026년은 무슨 띠?', '말띠', '뱀띠', '양띠', '용띠'],
    ['훈민정음 창제 당시 글자 수는?', '28자', '24자', '26자', '30자'],
    ['태극기 네 모서리의 검은 막대 이름은?', '괘', '획', '줄', '효'],
    ['사과(apple)의 영어 첫 글자는?', 'A', 'P', 'E', 'L'],
    ['다음 중 포유류는?', '고래', '상어', '참치', '오징어'],
    ['우리 몸에서 가장 큰 장기는?', '피부', '간', '폐', '심장'],
  ];

  const LR_SETS = [
    { L: '과일', R: '동물', l: ['🍎', '🍌', '🍇', '🍓', '🍑', '🍍', '🥝', '🍒', '🍉', '🍋'], r: ['🐶', '🐱', '🐰', '🦊', '🐼', '🐯', '🐸', '🐵', '🐧', '🐮'] },
    { L: '탈것', R: '음식', l: ['🚗', '🚌', '🚲', '✈️', '🚀', '🚂', '🛵', '🚁', '⛵', '🚕'], r: ['🍕', '🍔', '🍜', '🍣', '🍩', '🍗', '🌭', '🍙', '🥟', '🍰'] },
    { L: '운동', R: '날씨', l: ['⚽', '🏀', '⚾', '🎾', '🏐', '🏓', '🎳', '⛳', '🥊', '🏈'], r: ['☀️', '🌧️', '⛄', '🌈', '⚡', '🌪️', '❄️', '☁️', '🌤️', '🌫️'] },
    { L: '바다', R: '하늘', l: ['🐳', '🐙', '🦀', '🐠', '🦈', '🐬', '🦑', '🐚', '🦞', '🐡'], r: ['🦅', '🐦', '🦋', '🦉', '🐝', '🦜', '🕊️', '🐞', '🦆', '🦇'] },
  ];

  const WIRE_COLORS = [
    { k: 'red', name: '빨간', c: '#ff4d4d' }, { k: 'blue', name: '파란', c: '#3d7bff' },
    { k: 'yellow', name: '노란', c: '#ffd23d' }, { k: 'green', name: '초록', c: '#34c76b' },
    { k: 'white', name: '하얀', c: '#f2f2f2' }, { k: 'purple', name: '보라', c: '#a05cff' },
  ];

  // =====================================================================
  const GAMES = [
    // ---------------------------------------------------------------- 연타
    {
      id: 'tap', name: '연타왕', icon: '👆', tag: '파워', desc: '화면 연타', dur: 15, better: 'high', unit: '회', live: 'bars',
      howto: ['화면 아무 곳이나 빠르게 두드리기', '손가락 여러 개도 OK'], bot: [70, 150],
      play(el, ctx) {
        let n = 0;
        const pad = h('div', { class: 'g-pad' }, h('div', { class: 'g-pad-num' }, '0'), h('div', { class: 'g-pad-hint' }, '마구 두드리세요!'));
        const num = pad.firstChild;
        el.appendChild(pad);
        pad.addEventListener('pointerdown', (e) => {
          e.preventDefault(); n++; num.textContent = n; ctx.report(n); ctx.sfx('tap');
          flash(pad, 'hit');
          const r = pad.getBoundingClientRect();
          floatText(pad, '+1', '', e.clientX - r.left, e.clientY - r.top);
        });
        return { final: () => n };
      },
    },
    // ---------------------------------------------------------------- 박자
    {
      id: 'beat', name: '박자왕', icon: '🎵', tag: '리듬', desc: '박자 맞춰 탭', dur: 25, better: 'high', unit: '점', live: 'bars',
      howto: ['바깥 원이 가운데 원에 딱 겹칠 때 탭!', '정확하면 3점 · 비슷하면 1점', '아무 때나 누르면 -1점'], bot: [30, 80],
      play(el, ctx) {
        let score = 0;
        const bpm = 100, beat = 60000 / bpm;
        // 박자 패턴: 4분음표 위주 + 가끔 8분음표 (모든 폰 동일)
        const beats = [];
        let t = 1500;
        while (t < ctx.dur - 400) {
          beats.push({ t, hit: false });
          t += ctx.rand() < 0.25 && t > 6000 ? beat / 2 : beat;
        }
        const stage = h('div', { class: 'g-beat' });
        const target = h('div', { class: 'g-beat-target' });
        const ring = h('div', { class: 'g-beat-ring' });
        const judge = h('div', { class: 'g-beat-judge' });
        stage.append(ring, target, judge);
        el.appendChild(stage);
        const t0 = performance.now();
        let raf, lastTick = -1;
        function loop() {
          const now = performance.now() - t0;
          // 다음 박자까지 남은 시간으로 바깥 원 크기 결정
          const nb = beats.find((b) => !b.hit && b.t > now - 180);
          if (nb) {
            const d = Math.max(0, nb.t - now);
            const s = 1 + Math.min(1.6, d / 500);
            ring.style.transform = `translate(-50%,-50%) scale(${s})`;
            ring.style.opacity = d > 800 ? 0.25 : 1;
          }
          const idx = beats.findIndex((b) => b.t > now);
          if (idx !== lastTick && idx > 0) { lastTick = idx; ctx.sfx('tick'); flash(target, 'pulse'); }
          raf = requestAnimationFrame(loop);
        }
        loop();
        stage.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const now = performance.now() - t0;
          let best = null, bd = 1e9;
          for (const b of beats) { if (b.hit) continue; const d = Math.abs(b.t - now); if (d < bd) { bd = d; best = b; } }
          if (best && bd < 90) { best.hit = true; score += 3; judge.textContent = 'PERFECT +3'; judge.className = 'g-beat-judge perfect'; ctx.sfx('good'); }
          else if (best && bd < 190) { best.hit = true; score += 1; judge.textContent = 'GOOD +1'; judge.className = 'g-beat-judge good'; ctx.sfx('tap'); }
          else { score = Math.max(0, score - 1); judge.textContent = 'MISS -1'; judge.className = 'g-beat-judge miss'; ctx.vibrate(60); }
          flash(judge, 'show');
          ctx.report(score);
        });
        return { final: () => score, stop: () => cancelAnimationFrame(raf) };
      },
    },
    // ---------------------------------------------------------------- 흔들기
    {
      id: 'shake', name: '흔들흔들', icon: '📳', tag: '파워', desc: '폰 흔들기', dur: 15, better: 'high', unit: '회', live: 'bars',
      howto: ['폰을 꽉 쥐고 위아래로 힘껏 흔들기', '폰을 놓치지 않게 조심!', '센서가 안 되는 폰은 화면 연타로 대신해요'], bot: [40, 110], needsMotion: true,
      play(el, ctx) {
        let n = 0, lastSign = 0, lastT = 0, gotMotion = false;
        const big = h('div', { class: 'g-shake' }, h('div', { class: 'g-shake-phone' }, '📱'), h('div', { class: 'g-pad-num' }, '0'), h('div', { class: 'g-pad-hint' }, '흔들어요!'));
        const num = big.children[1];
        el.appendChild(big);
        function add() { n++; num.textContent = n; ctx.report(n); ctx.sfx('tap'); flash(big, 'hit'); }
        function onMotion(e) {
          const a = e.accelerationIncludingGravity || e.acceleration;
          if (!a || (a.x == null && a.y == null)) return;
          gotMotion = true;
          const v = (a.y || 0) + (a.x || 0) * 0.5;
          const sign = v > 14 ? 1 : v < -4 ? -1 : 0;
          const now = performance.now();
          if (sign && sign !== lastSign && now - lastT > 90) { if (lastSign) add(); lastSign = sign; lastT = now; }
        }
        addEventListener('devicemotion', onMotion);
        // 센서가 없으면 연타로 대체
        const fallback = setTimeout(() => {
          if (gotMotion) return;
          big.querySelector('.g-pad-hint').textContent = '센서가 없어서 화면 연타로 해요!';
          big.addEventListener('pointerdown', (e) => { e.preventDefault(); add(); });
        }, 1500);
        return { final: () => n, stop: () => { removeEventListener('devicemotion', onMotion); clearTimeout(fallback); } };
      },
    },
    // ---------------------------------------------------------------- 문지르기
    {
      id: 'rub', name: '문질문질', icon: '🫲', tag: '파워', desc: '좌우로 문지르기', dur: 15, better: 'high', unit: '회', live: 'bars',
      howto: ['손가락으로 화면을 좌우로 빠르게 문지르기', '왕복할 때마다 1회'], bot: [50, 120],
      play(el, ctx) {
        let n = 0, dir = 0, anchor = null;
        const pad = h('div', { class: 'g-pad rub' }, h('div', { class: 'g-rub-arrows' }, '⬅️ ➡️'), h('div', { class: 'g-pad-num' }, '0'), h('div', { class: 'g-pad-hint' }, '좌우로 슥슥!'));
        const num = pad.children[1];
        el.appendChild(pad);
        pad.addEventListener('pointerdown', (e) => { e.preventDefault(); anchor = e.clientX; dir = 0; });
        pad.addEventListener('pointermove', (e) => {
          if (anchor == null) return;
          const dx = e.clientX - anchor;
          if (Math.abs(dx) > 28) {
            const d = Math.sign(dx);
            if (d !== dir) { if (dir !== 0) { n++; num.textContent = n; ctx.report(n); ctx.sfx('tap'); flash(pad, 'hit'); } dir = d; }
            anchor = e.clientX;
          }
        });
        const up = () => { anchor = null; };
        pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
        return { final: () => n };
      },
    },
    // ---------------------------------------------------------------- 두더지
    {
      id: 'mole', name: '두더지', icon: '🐹', tag: '순발력', desc: '두더지 잡기', dur: 25, better: 'high', unit: '점', live: 'bars',
      howto: ['튀어나온 🐹 두더지를 탭!', '💣 폭탄을 누르면 -3점'], bot: [18, 40],
      play(el, ctx) {
        let score = 0;
        const grid = h('div', { class: 'g-mole' });
        const holes = [];
        for (let i = 0; i < 9; i++) {
          const hole = h('div', { class: 'g-hole' }, h('div', { class: 'g-mole-face' }));
          hole.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            const st = hole.dataset.s;
            if (st === 'mole') { score += 1; hole.dataset.s = 'hit'; ctx.sfx('pop'); floatText(hole, '+1', 'ok'); }
            else if (st === 'bomb') { score = Math.max(0, score - 3); hole.dataset.s = 'boom'; ctx.sfx('boom'); ctx.vibrate(200); floatText(hole, '-3', 'no'); flash(el, 'shake'); }
            else return;
            ctx.report(score);
            setTimeout(() => { if (hole.dataset.s === 'hit' || hole.dataset.s === 'boom') hole.dataset.s = ''; }, 250);
          });
          holes.push(hole); grid.appendChild(hole);
        }
        el.appendChild(grid);
        let alive = true;
        function spawn() {
          if (!alive) return;
          const prog = ctx.elapsed() / ctx.dur;
          const free = holes.filter((x) => !x.dataset.s);
          if (free.length) {
            const hole = pick(free, ctx.rand);
            const bomb = ctx.rand() < 0.16;
            hole.dataset.s = bomb ? 'bomb' : 'mole';
            hole.firstChild.textContent = bomb ? '💣' : '🐹';
            const life = 1100 - prog * 500;
            setTimeout(() => { if (hole.dataset.s === 'mole' || hole.dataset.s === 'bomb') hole.dataset.s = ''; }, life);
          }
          setTimeout(spawn, 520 - prog * 250);
        }
        spawn();
        return { final: () => score, stop: () => { alive = false; } };
      },
    },
    // ---------------------------------------------------------------- 가위바위보
    {
      id: 'rps', name: '가위바위보', icon: '✌️', tag: '두뇌', desc: '지시대로 내기', dur: 25, better: 'high', unit: '점', live: 'bars',
      howto: ['상대 손과 지시(이겨라/져라/비겨라)를 보고', '알맞은 손을 빠르게 내기', '틀리면 -1점'], bot: [12, 30],
      play(el, ctx) {
        const H = ['✊', '✌️', '🖐️'], N = ['바위', '가위', '보'];
        // 이기는 손: 바위>가위, 가위>보, 보>바위
        const winOf = (i) => (i + 2) % 3; // i 를 이기는 손
        const loseOf = (i) => (i + 1) % 3; // i 에게 지는 손
        return choiceGame(el, ctx, () => {
          const cpu = randInt(3, ctx.rand);
          const cmd = randInt(3, ctx.rand);
          const ans = cmd === 0 ? winOf(cpu) : cmd === 1 ? loseOf(cpu) : cpu;
          const label = ['이겨라!', '져라!', '비겨라!'][cmd];
          const color = ['#59d97a', '#ff5d5d', '#ffc93c'][cmd];
          return {
            prompt: h('div', { class: 'g-rps' }, h('div', { class: 'g-rps-hand' }, H[cpu]), h('div', { class: 'g-rps-cmd', style: { color } }, label)),
            sub: `상대: ${N[cpu]}`,
            cols: 3,
            choices: [0, 1, 2].map((i) => ({ label: H[i], correct: i === ans })),
          };
        }, { lock: 500 });
      },
    },
    // ---------------------------------------------------------------- 100m
    {
      id: 'run', name: '100m 달리기', icon: '🏃', tag: '파워', desc: '왼발·오른발 레이스', dur: 30, better: 'low', unit: '초', live: 'race',
      howto: ['왼발 👣 오른발 👣 버튼을 번갈아 탭', '같은 발을 연속으로 누르면 넘어져요', '100m 먼저 도착하면 승리!'], bot: [11, 22],
      fmt: (v) => (v >= 900 ? `${Math.round(1000 - v)}m` : `${v.toFixed(2)}초`),
      play(el, ctx) {
        let m = 0, last = null, stun = 0, done = false, time = null;
        const track = h('div', { class: 'g-run-track' }, h('div', { class: 'g-run-fill' }), h('div', { class: 'g-run-man' }, '🏃'), h('div', { class: 'g-run-flag' }, '🏁'));
        const meter = h('div', { class: 'g-pad-num' }, '0m');
        const btns = h('div', { class: 'g-run-btns' });
        const L = h('button', { class: 'g-foot' }, '👣', h('small', null, '왼발'));
        const R = h('button', { class: 'g-foot' }, '👣', h('small', null, '오른발'));
        btns.append(L, R);
        el.append(track, meter, btns);
        function step(side, b) {
          if (done) return;
          const now = performance.now();
          if (now < stun) return;
          if (side === last) {
            stun = now + 600; ctx.sfx('bad'); ctx.vibrate(150); flash(el, 'shake');
            meter.textContent = '꽈당! 😵'; last = null; return;
          }
          last = side; m = Math.min(100, m + 1.25); flash(b, 'hit'); ctx.sfx('tap');
          meter.textContent = Math.floor(m) + 'm';
          track.children[0].style.width = m + '%';
          track.children[1].style.left = `calc(${m}% - 18px)`;
          if (m >= 100) {
            done = true; time = ctx.elapsed() / 1000;
            meter.textContent = `골인! ${time.toFixed(2)}초`;
            ctx.sfx('win');
            ctx.report(time, { p: 1, done: true });
          } else ctx.report(1000 - m, { p: m / 100 });
        }
        L.addEventListener('pointerdown', (e) => { e.preventDefault(); step('L', L); });
        R.addEventListener('pointerdown', (e) => { e.preventDefault(); step('R', R); });
        return { final: () => (done ? time : 1000 - m) };
      },
    },
    // ---------------------------------------------------------------- 피아노
    {
      id: 'piano', name: '피아노', icon: '🎹', tag: '집중', desc: '건반 순서대로', dur: 25, better: 'high', unit: '음', live: 'bars',
      howto: ['위에서 내려오는 음표와 같은 색 건반을 탭', '틀리면 -1음'], bot: [30, 70],
      play(el, ctx) {
        const K = [['도', '#ff5d5d'], ['레', '#ffb02e'], ['미', '#59d97a'], ['파', '#4f7cff']];
        const seq = [];
        const add = () => seq.push(randInt(4, ctx.rand));
        for (let i = 0; i < 6; i++) add();
        let score = 0;
        const lane = h('div', { class: 'g-piano-lane' });
        const keys = h('div', { class: 'g-piano-keys' });
        el.append(lane, keys);
        function draw() {
          lane.innerHTML = '';
          seq.slice(0, 5).forEach((k, i) => {
            const n = h('div', { class: 'g-note' + (i === 0 ? ' now' : ''), style: { background: K[k][1], left: `${k * 25 + 2}%`, bottom: `${i * 20}%` } }, K[k][0]);
            lane.appendChild(n);
          });
        }
        K.forEach(([name, c], i) => {
          const b = h('button', { class: 'g-key', style: { '--c': c } }, name);
          b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (seq[0] === i) { score++; seq.shift(); add(); global.TG.Sfx.note(i * 2); flash(b, 'hit'); }
            else { score = Math.max(0, score - 1); ctx.sfx('bad'); ctx.vibrate(100); flash(el, 'shake'); }
            ctx.report(score); draw();
          });
          keys.appendChild(b);
        });
        draw();
        return { final: () => score };
      },
    },
    // ---------------------------------------------------------------- 10초
    {
      id: 'stop10', name: '10초를 멈춰라', icon: '⏱️', tag: '감각', desc: '감으로 딱 10초', dur: 25, better: 'low', unit: '초', live: 'hidden',
      howto: ['[시작]을 누르면 타이머가 돌아가요', '3초 뒤 숫자가 사라져요', '딱 10초라고 느낄 때 [멈춰!]'], bot: [0.05, 1.8],
      fmt: (v) => `±${v.toFixed(2)}초`,
      play(el, ctx) {
        let state = 0, t0 = 0, diff = 10, raf;
        const disp = h('div', { class: 'g-stop-disp' }, '0.00');
        const btn = h('button', { class: 'g-big-btn' }, '시작');
        const msg = h('div', { class: 'g-sub' }, '한 번만 도전할 수 있어요');
        el.append(msg, disp, btn);
        function loop() {
          const t = (performance.now() - t0) / 1000;
          disp.textContent = t < 3 ? t.toFixed(2) : '?.??';
          if (t >= 3) disp.classList.add('hidden-time');
          raf = requestAnimationFrame(loop);
        }
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          if (state === 0) { state = 1; t0 = performance.now(); btn.textContent = '멈춰!'; btn.classList.add('stop'); ctx.sfx('go'); loop(); }
          else if (state === 1) {
            state = 2; cancelAnimationFrame(raf);
            const t = (performance.now() - t0) / 1000;
            diff = Math.abs(t - 10);
            disp.classList.remove('hidden-time');
            disp.textContent = t.toFixed(2);
            msg.textContent = diff < 0.1 ? '🎯 거의 완벽!' : `10초와 ${diff.toFixed(2)}초 차이`;
            btn.remove();
            ctx.sfx(diff < 0.3 ? 'win' : 'end');
            ctx.report(diff, { done: true });
          }
        });
        return { final: () => (state === 2 ? diff : 10), stop: () => cancelAnimationFrame(raf) };
      },
    },
    // ---------------------------------------------------------------- 레몬
    {
      id: 'lemon', name: '레몬짜기', icon: '🍋', tag: '감각', desc: '게이지 유지', dur: 20, better: 'high', unit: '초', live: 'bars',
      howto: ['버튼을 누르고 있으면 게이지가 올라가요', '손을 떼면 내려가요', '초록 구간 안에 오래 머물수록 점수!'], bot: [6, 15],
      fmt: (v) => `${v.toFixed(1)}초`,
      play(el, ctx) {
        let g = 0, vel = 0, press = false, inZone = 0, raf, last = performance.now();
        const gauge = h('div', { class: 'g-gauge' }, h('div', { class: 'g-gauge-zone' }), h('div', { class: 'g-gauge-fill' }));
        const zone = gauge.children[0], fill = gauge.children[1];
        const lemon = h('button', { class: 'g-lemon' }, '🍋');
        const info = h('div', { class: 'g-pad-num small' }, '0.0초');
        el.append(h('div', { class: 'g-lemon-wrap' }, gauge, h('div', { class: 'g-lemon-side' }, info, lemon)));
        const zr = ctx.rand() * 1000;
        function loop(now) {
          const dt = Math.min(50, now - last) / 1000; last = now;
          vel += (press ? 1.8 : -1.5) * dt; vel *= 0.92;
          g = Math.max(0, Math.min(1, g + vel * dt * 2.5));
          if (g === 0 || g === 1) vel = 0;
          const t = ctx.elapsed() / 1000;
          const zc = 0.5 + Math.sin(t * 0.9 + zr) * 0.25 + Math.sin(t * 2.1 + zr) * 0.08;
          const zh = 0.22;
          zone.style.bottom = (zc - zh / 2) * 100 + '%'; zone.style.height = zh * 100 + '%';
          fill.style.height = g * 100 + '%';
          const ok = Math.abs(g - zc) < zh / 2;
          fill.classList.toggle('ok', ok);
          if (ok) { inZone += dt; info.textContent = inZone.toFixed(1) + '초'; }
          raf = requestAnimationFrame(loop);
        }
        raf = requestAnimationFrame(loop);
        const rep = setInterval(() => ctx.report(Math.round(inZone * 10) / 10), 300);
        lemon.addEventListener('pointerdown', (e) => { e.preventDefault(); press = true; lemon.classList.add('squeeze'); });
        const up = () => { press = false; lemon.classList.remove('squeeze'); };
        lemon.addEventListener('pointerup', up); lemon.addEventListener('pointercancel', up); lemon.addEventListener('pointerleave', up);
        return { final: () => Math.round(inZone * 10) / 10, stop: () => { cancelAnimationFrame(raf); clearInterval(rep); } };
      },
    },
    // ---------------------------------------------------------------- 반응속도
    {
      id: 'react', name: '순간포착', icon: '📏', tag: '순발력', desc: '반응 속도', dur: 35, better: 'low', unit: 'ms', live: 'hidden',
      howto: ['화면이 초록색으로 바뀌는 순간 탭!', '5번 측정해 평균을 내요', '미리 누르면 부정출발 (1000ms로 기록)'], bot: [260, 520],
      fmt: (v) => `${Math.round(v)}ms`,
      play(el, ctx) {
        const N = 5, times = [];
        let state = 'wait', goAt = 0, tm;
        const pad = h('div', { class: 'g-react wait' }, h('div', { class: 'g-react-big' }, '기다려요…'), h('div', { class: 'g-sub' }, `1 / ${N}`));
        el.appendChild(pad);
        const big = pad.children[0], sub = pad.children[1];
        const delays = Array.from({ length: N }, () => 1200 + ctx.rand() * 2600);
        function arm() {
          state = 'wait'; pad.className = 'g-react wait'; big.textContent = '기다려요…'; sub.textContent = `${times.length + 1} / ${N}`;
          tm = setTimeout(() => { state = 'go'; goAt = performance.now(); pad.className = 'g-react go'; big.textContent = '지금!'; ctx.sfx('go'); }, delays[times.length]);
        }
        pad.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          if (state === 'wait') {
            clearTimeout(tm); times.push(1000); // 부정출발은 1000ms 로 기록
            state = 'pause'; pad.className = 'g-react foul'; big.textContent = '부정출발! (1000ms)'; ctx.sfx('bad'); ctx.vibrate(200);
          } else if (state === 'go') {
            const ms = performance.now() - goAt; times.push(ms);
            state = 'pause'; pad.className = 'g-react done'; big.textContent = `${Math.round(ms)}ms`; ctx.sfx('good');
          } else return;
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          if (times.length >= N) {
            sub.textContent = `평균 ${Math.round(avg)}ms`;
            ctx.report(avg, { done: true });
            state = 'end';
          } else { ctx.report(avg, { p: times.length / N }); setTimeout(arm, 1000); }
        });
        arm();
        return { final: () => (times.length ? (times.reduce((a, b) => a + b, 0) + (N - times.length) * 1000) / N : 1000), stop: () => clearTimeout(tm) };
      },
    },
    // ---------------------------------------------------------------- 탑 쌓기
    {
      id: 'tower', name: '탑 쌓기', icon: '🏗️', tag: '집중', desc: '블록 딱 맞춰 쌓기', dur: 35, better: 'high', unit: '층', live: 'bars',
      howto: ['좌우로 움직이는 블록을 탭해서 내려놓기', '삐져나온 부분은 잘려요', '떨어뜨리면 다시 1층부터 (최고 기록 인정)'], bot: [8, 25],
      play(el, ctx) {
        const cv = h('canvas', { class: 'g-canvas' });
        const info = h('div', { class: 'g-scoreline' }, '0층 · 최고 0층');
        el.append(info, cv);
        const g = cv.getContext('2d');
        let W, Hh, raf, stack, cur, best = 0, speed;
        function size() { const r = cv.getBoundingClientRect(); W = cv.width = r.width * devicePixelRatio; Hh = cv.height = r.height * devicePixelRatio; }
        size();
        const BH = () => Hh / 14;
        function reset() { stack = [{ x: W * 0.2, w: W * 0.6 }]; speed = W * 0.0075; newBlock(); }
        function newBlock() { const top = stack[stack.length - 1]; cur = { x: 0, w: top.w, dir: 1 }; speed *= 1.04; }
        reset();
        const colors = ['#ff5d5d', '#ffb02e', '#ffe14d', '#59d97a', '#4cc9f0', '#4f7cff', '#9d6bff', '#ff6fae'];
        function loop() {
          cur.x += speed * cur.dir;
          if (cur.x + cur.w > W) { cur.x = W - cur.w; cur.dir = -1; }
          if (cur.x < 0) { cur.x = 0; cur.dir = 1; }
          g.clearRect(0, 0, W, Hh);
          const bh = BH();
          const offset = Math.max(0, stack.length - 9) * bh;
          stack.forEach((b, i) => { g.fillStyle = colors[i % colors.length]; g.fillRect(b.x, Hh - (i + 1) * bh + offset, b.w, bh - 2); });
          g.fillStyle = colors[stack.length % colors.length];
          g.fillRect(cur.x, Hh - (stack.length + 1) * bh + offset, cur.w, bh - 2);
          raf = requestAnimationFrame(loop);
        }
        loop();
        cv.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const top = stack[stack.length - 1];
          const l = Math.max(top.x, cur.x), r = Math.min(top.x + top.w, cur.x + cur.w);
          if (r - l <= 2) {
            ctx.sfx('boom'); ctx.vibrate(250); flash(el, 'shake'); reset();
          } else {
            const perfect = Math.abs(cur.x - top.x) < W * 0.012;
            stack.push(perfect ? { x: top.x, w: top.w } : { x: l, w: r - l });
            ctx.sfx(perfect ? 'good' : 'tap');
            if (perfect) floatText(el, 'PERFECT!', 'ok');
            newBlock();
          }
          const fl = stack.length - 1;
          best = Math.max(best, fl);
          info.textContent = `${fl}층 · 최고 ${best}층`;
          ctx.report(best);
        });
        return { final: () => best, stop: () => cancelAnimationFrame(raf) };
      },
    },
    // ---------------------------------------------------------------- 폭탄
    {
      id: 'bomb', name: '폭탄 해체', icon: '💣', tag: '두뇌', desc: '지시대로 전선 끊기', dur: 30, better: 'high', unit: '개', live: 'bars',
      howto: ['지시문의 "글자"를 읽고 그 색 전선을 끊기', '글자 색깔에 속지 마세요!', '틀리면 💥 쾅! -1개'], bot: [8, 20],
      play(el, ctx) {
        return choiceGame(el, ctx, (score) => {
          const n = Math.min(6, 3 + Math.floor(score / 3));
          const wires = shuffle(WIRE_COLORS, ctx.rand).slice(0, n);
          const ans = pick(wires, ctx.rand);
          const inkPool = WIRE_COLORS.filter((w) => w.k !== ans.k);
          const ink = pick(inkPool, ctx.rand);
          return {
            prompt: h('div', { class: 'g-bomb-cmd' }, '💣 ', h('b', { style: { color: ink.c } }, ans.name), ' 선을 끊어라!'),
            cols: 1,
            choices: wires.map((w) => ({ label: '✂️', correct: w.k === ans.k, style: { background: w.c, color: '#111' } })),
          };
        }, { lock: 900 });
      },
    },
    // ---------------------------------------------------------------- 장애물 피하기
    {
      id: 'dodge', name: '장애물 피하기', icon: '🚀', tag: '집중', desc: '운석 피해 살아남기', dur: 40, better: 'high', unit: '초', live: 'bars',
      howto: ['손가락으로 로켓을 좌우로 움직여 운석 피하기', '목숨은 3개 ❤️❤️❤️', '오래 살아남을수록 점수'], bot: [12, 40],
      fmt: (v) => `${v.toFixed(1)}초`,
      play(el, ctx) {
        const cv = h('canvas', { class: 'g-canvas dark' });
        const info = h('div', { class: 'g-scoreline' }, '❤️❤️❤️ · 0.0초');
        el.append(info, cv);
        const g = cv.getContext('2d');
        const r = cv.getBoundingClientRect();
        const W = cv.width = r.width * devicePixelRatio, Hh = cv.height = r.height * devicePixelRatio;
        let px = W / 2, lives = 3, alive = true, inv = 0, t = 0, raf, last = performance.now();
        const rocks = [];
        let spawnAcc = 0;
        const move = (e) => { const b = cv.getBoundingClientRect(); px = (e.clientX - b.left) * devicePixelRatio; };
        cv.addEventListener('pointerdown', (e) => { e.preventDefault(); move(e); });
        cv.addEventListener('pointermove', move);
        const S = W / 14;
        function loop(now) {
          const dt = Math.min(50, now - last) / 1000; last = now;
          if (alive) t += dt;
          spawnAcc += dt;
          const rate = 0.55 - Math.min(0.4, t * 0.012);
          while (spawnAcc > rate) { spawnAcc -= rate; rocks.push({ x: ctx.rand() * W, y: -S, v: Hh * (0.35 + ctx.rand() * 0.3 + t * 0.012), s: S * (0.6 + ctx.rand() * 0.8) }); }
          g.fillStyle = '#0b0b1a'; g.fillRect(0, 0, W, Hh);
          g.font = `${S}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
          const py = Hh - S * 1.6;
          for (let i = rocks.length - 1; i >= 0; i--) {
            const k = rocks[i]; k.y += k.v * dt;
            g.font = `${k.s}px serif`; g.fillText('☄️', k.x, k.y);
            if (alive && now > inv && Math.hypot(k.x - px, k.y - py) < (k.s + S) * 0.38) {
              lives--; inv = now + 1200; rocks.splice(i, 1);
              ctx.sfx('boom'); ctx.vibrate(200); flash(el, 'shake');
              if (lives <= 0) { alive = false; ctx.report(Math.round(t * 10) / 10, { done: true }); info.textContent = `💥 끝! ${t.toFixed(1)}초 생존`; }
            } else if (k.y > Hh + S) rocks.splice(i, 1);
          }
          if (alive) {
            g.globalAlpha = now < inv && Math.floor(now / 100) % 2 ? 0.3 : 1;
            g.font = `${S * 1.2}px serif`; g.save(); g.translate(px, py); g.rotate(-Math.PI / 4); g.fillText('🚀', 0, 0); g.restore();
            g.globalAlpha = 1;
            info.textContent = `${'❤️'.repeat(lives)} · ${t.toFixed(1)}초`;
          }
          raf = requestAnimationFrame(loop);
        }
        raf = requestAnimationFrame(loop);
        const rep = setInterval(() => { if (alive) ctx.report(Math.round(t * 10) / 10); }, 500);
        return { final: () => Math.round(t * 10) / 10, stop: () => { cancelAnimationFrame(raf); clearInterval(rep); } };
      },
    },
    // ---------------------------------------------------------------- 홀짝
    {
      id: 'oddeven', name: '홀짝 계산기', icon: '🔢', tag: '두뇌', desc: '계산 결과가 홀? 짝?', dur: 25, better: 'high', unit: '점', live: 'bars',
      howto: ['계산 결과가 홀수인지 짝수인지 고르기', '틀리면 -1점'], bot: [8, 22],
      play(el, ctx) {
        return choiceGame(el, ctx, (score) => {
          const terms = 2 + Math.min(2, Math.floor(score / 5));
          let expr = '', val = 0;
          for (let i = 0; i < terms; i++) {
            const n = 1 + randInt(score > 8 ? 30 : 15, ctx.rand);
            if (i === 0) { expr = String(n); val = n; }
            else if (ctx.rand() < 0.5 || val - n < 0) { expr += ` + ${n}`; val += n; }
            else { expr += ` − ${n}`; val -= n; }
          }
          const odd = val % 2 !== 0;
          return { prompt: expr, sub: '결과는?', cols: 2, choices: [{ label: '홀', correct: odd }, { label: '짝', correct: !odd }] };
        }, { lock: 600 });
      },
    },
    // ---------------------------------------------------------------- 왼쪽 오른쪽
    {
      id: 'lr', name: '왼쪽 오른쪽', icon: '↔️', tag: '순발력', desc: '규칙대로 분류', dur: 25, better: 'high', unit: '점', live: 'bars',
      howto: ['위에 적힌 규칙대로 그림을 왼쪽/오른쪽으로', '틀리면 -1점'], bot: [15, 35],
      play(el, ctx) {
        const set = LR_SETS[randInt(LR_SETS.length, ctx.rand)];
        return choiceGame(el, ctx, () => {
          const left = ctx.rand() < 0.5;
          const item = pick(left ? set.l : set.r, ctx.rand);
          return {
            prompt: h('div', { class: 'g-lr-item' }, item), sub: `⬅️ ${set.L}  |  ${set.R} ➡️`, cols: 2,
            choices: [{ label: `⬅️ ${set.L}`, correct: left }, { label: `${set.R} ➡️`, correct: !left }],
          };
        }, { lock: 500, okDelay: 80 });
      },
    },
    // ---------------------------------------------------------------- 색깔 풍선
    {
      id: 'balloon', name: '색깔 풍선', icon: '🎈', tag: '순발력', desc: '함정 주의', dur: 25, better: 'high', unit: '점', live: 'bars',
      howto: ['위에 표시된 색 풍선만 터뜨리기', '다른 색은 -1점, 💣 폭탄은 -3점', '목표 색은 중간에 바뀌어요!'], bot: [15, 40],
      play(el, ctx) {
        const C = [['빨간', '#ff4d6d'], ['파란', '#3d8bff'], ['노란', '#ffd23d'], ['초록', '#34c76b']];
        let score = 0, target = randInt(4, ctx.rand), alive = true, lastSwitch = 0;
        const head = h('div', { class: 'g-balloon-head' });
        const field = h('div', { class: 'g-balloon-field' });
        el.append(head, field);
        function setHead() { head.innerHTML = ''; head.append(h('span', { class: 'dot', style: { background: C[target][1] } }), `${C[target][0]} 풍선만 터뜨려요!`); flash(head, 'pulse'); }
        setHead();
        function spawn() {
          if (!alive) return;
          const el2 = ctx.elapsed();
          if (el2 - lastSwitch > 8000) { lastSwitch = el2; target = (target + 1 + randInt(3, ctx.rand)) % 4; setHead(); ctx.sfx('reveal'); }
          const bomb = ctx.rand() < 0.1;
          const c = ctx.rand() < 0.4 ? target : randInt(4, ctx.rand);
          const b = h('div', { class: 'g-balloon' + (bomb ? ' bomb' : ''), style: { left: 5 + ctx.rand() * 75 + '%', background: bomb ? '#333' : C[c][1], animationDuration: 2.6 + ctx.rand() * 1.4 + 's' } }, bomb ? '💣' : '');
          b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (b.dataset.p) return; b.dataset.p = 1;
            if (bomb) { score = Math.max(0, score - 3); ctx.sfx('boom'); ctx.vibrate(200); flash(el, 'shake'); floatText(field, '-3', 'no', b.offsetLeft, b.offsetTop); }
            else if (c === target) { score++; ctx.sfx('pop'); floatText(field, '+1', 'ok', b.offsetLeft, b.offsetTop); }
            else { score = Math.max(0, score - 1); ctx.sfx('bad'); floatText(field, '-1', 'no', b.offsetLeft, b.offsetTop); }
            b.classList.add('popped'); setTimeout(() => b.remove(), 200);
            ctx.report(score);
          });
          b.addEventListener('animationend', () => b.remove());
          field.appendChild(b);
          setTimeout(spawn, 330);
        }
        spawn();
        return { final: () => score, stop: () => { alive = false; } };
      },
    },
    // ---------------------------------------------------------------- 구구단
    {
      id: 'gugu', name: '구구단 릴레이', icon: '📐', tag: '두뇌', desc: '스피드 구구단', dur: 25, better: 'high', unit: '점', live: 'bars',
      howto: ['구구단 답을 빠르게 고르기', '틀리면 -1점'], bot: [10, 25],
      play(el, ctx) {
        return choiceGame(el, ctx, (score) => {
          const a = 2 + randInt(score > 6 ? 18 : 8, ctx.rand), b = 2 + randInt(8, ctx.rand);
          const ans = a * b;
          const set = new Set([ans]);
          while (set.size < 4) { const d = ans + (randInt(2, ctx.rand) ? 1 : -1) * (1 + randInt(a > 9 ? 12 : 6, ctx.rand)); if (d > 0) set.add(d); }
          return { prompt: `${a} × ${b} = ?`, cols: 2, choices: shuffle([...set], ctx.rand).map((v) => ({ label: String(v), correct: v === ans })) };
        }, { lock: 600 });
      },
    },
    // ---------------------------------------------------------------- 숫자 사냥
    {
      id: 'numhunt', name: '숫자 사냥', icon: '🔟', tag: '순발력', desc: '1~16 순서대로', dur: 30, better: 'high', unit: '개', live: 'bars',
      howto: ['1부터 16까지 순서대로 터치', '다 찾으면 새 판이 나와요'], bot: [30, 60],
      play(el, ctx) {
        let next = 1, total = 0, round = 0;
        const info = h('div', { class: 'g-scoreline' });
        const grid = h('div', { class: 'g-numgrid' });
        el.append(info, grid);
        function board() {
          grid.innerHTML = ''; next = 1; round++;
          info.textContent = `${round}판 · 다음: 1`;
          shuffle(Array.from({ length: 16 }, (_, i) => i + 1), ctx.rand).forEach((n) => {
            const b = h('button', { class: 'g-num' }, n);
            b.addEventListener('pointerdown', (e) => {
              e.preventDefault();
              if (n === next) {
                b.classList.add('done'); next++; total++; ctx.sfx('tap'); ctx.report(total);
                info.textContent = `${round}판 · 다음: ${next}`;
                if (next > 16) { ctx.sfx('good'); setTimeout(board, 250); }
              } else if (!b.classList.contains('done')) { flash(b, 'no'); ctx.sfx('bad'); ctx.vibrate(80); }
            });
            grid.appendChild(b);
          });
        }
        board();
        return { final: () => total };
      },
    },
    // ---------------------------------------------------------------- 기억
    {
      id: 'memory', name: '반짝 기억', icon: '🧠', tag: '두뇌', desc: '반짝인 칸 기억', dur: 45, better: 'high', unit: '단계', live: 'bars',
      howto: ['잠깐 반짝인 칸들을 기억했다가', '같은 칸을 모두 터치', '틀리면 목숨 -1 (3개)'], bot: [3, 9],
      play(el, ctx) {
        let level = 1, lives = 3, cleared = 0, phase = 'show', picked = new Set(), cells = [], ans = new Set(), tm;
        const info = h('div', { class: 'g-scoreline' });
        const grid = h('div', { class: 'g-memgrid' });
        el.append(info, grid);
        for (let i = 0; i < 16; i++) {
          const c = h('button', { class: 'g-mem' });
          c.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (phase !== 'input' || picked.has(i)) return;
            if (ans.has(i)) {
              picked.add(i); c.classList.add('on'); ctx.sfx('tap');
              if (picked.size === ans.size) { phase = 'wait'; cleared++; level++; ctx.report(cleared); ctx.sfx('good'); tm = setTimeout(round, 700); }
            } else {
              c.classList.add('wrong'); lives--; ctx.sfx('bad'); ctx.vibrate(150); phase = 'wait';
              ans.forEach((k) => cells[k].classList.add('hint'));
              if (lives <= 0) { info.textContent = `끝! ${cleared}단계 성공`; ctx.report(cleared, { done: true }); }
              else tm = setTimeout(round, 1100);
            }
          });
          cells.push(c); grid.appendChild(c);
        }
        function round() {
          picked = new Set(); phase = 'show';
          cells.forEach((c) => (c.className = 'g-mem'));
          const k = Math.min(10, level + 2);
          ans = new Set(shuffle([...Array(16).keys()], ctx.rand).slice(0, k));
          info.textContent = `${level}단계 · ${k}칸 · ${'❤️'.repeat(lives)}`;
          ans.forEach((i) => cells[i].classList.add('flash'));
          tm = setTimeout(() => { cells.forEach((c) => c.classList.remove('flash')); phase = 'input'; }, 700 + k * 120);
        }
        round();
        return { final: () => cleared, stop: () => clearTimeout(tm) };
      },
    },
    // ---------------------------------------------------------------- 금고
    {
      id: 'safe', name: '금고 열기', icon: '🔐', tag: '두뇌', desc: '업·다운 추리', dur: 45, better: 'high', unit: '개', live: 'bars',
      howto: ['비밀번호(1~100)를 숫자로 입력', 'UP ⬆️ / DOWN ⬇️ 힌트를 보고 좁혀가기', '많이 열수록 승리!'], bot: [2, 6],
      play(el, ctx) {
        let secret, input = '', opened = 0, tries = 0, lo, hi;
        const disp = h('div', { class: 'g-safe-disp' });
        const hint = h('div', { class: 'g-safe-hint' });
        const pad = h('div', { class: 'g-keypad' });
        el.append(h('div', { class: 'g-scoreline' }, '🔐 금고 '), disp, hint, pad);
        const line = el.querySelector('.g-scoreline');
        function newSafe() { secret = 1 + randInt(100, ctx.rand); lo = 1; hi = 100; tries = 0; input = ''; upd(); hint.textContent = `범위 ${lo} ~ ${hi}`; hint.className = 'g-safe-hint'; line.textContent = `🔐 ${opened + 1}번째 금고 · 연 금고 ${opened}개`; }
        function upd() { disp.textContent = input || '_ _ _'; }
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '지움', '0', '확인'].forEach((k) => {
          const b = h('button', { class: 'g-key2' + (k === '확인' ? ' ok' : '') }, k);
          b.addEventListener('pointerdown', (e) => {
            e.preventDefault(); ctx.sfx('tick');
            if (k === '지움') input = input.slice(0, -1);
            else if (k === '확인') {
              const v = Number(input); input = '';
              if (!v) { upd(); return; }
              tries++;
              if (v === secret) { opened++; ctx.sfx('win'); ctx.report(opened); hint.textContent = `🔓 열렸다! (${tries}번 만에)`; hint.className = 'g-safe-hint ok'; setTimeout(newSafe, 800); }
              else if (v < secret) { lo = Math.max(lo, v + 1); hint.textContent = `${v} 보다 UP ⬆️  (${lo}~${hi})`; hint.className = 'g-safe-hint up'; flash(hint, 'pulse'); }
              else { hi = Math.min(hi, v - 1); hint.textContent = `${v} 보다 DOWN ⬇️  (${lo}~${hi})`; hint.className = 'g-safe-hint down'; flash(hint, 'pulse'); }
            } else if (input.length < 3) input += k;
            upd();
          });
          pad.appendChild(b);
        });
        newSafe();
        return { final: () => opened };
      },
    },
    // ---------------------------------------------------------------- 다른 색
    {
      id: 'color', name: '다른 색 찾기', icon: '🎨', tag: '눈썰미', desc: '눈썰미 테스트', dur: 30, better: 'high', unit: '단계', live: 'bars',
      howto: ['색이 살짝 다른 칸 하나를 찾아 터치', '단계가 오를수록 칸이 많아지고 비슷해져요'], bot: [12, 28],
      play(el, ctx) {
        let stage = 0;
        const info = h('div', { class: 'g-scoreline' });
        const grid = h('div', { class: 'g-colorgrid' });
        el.append(info, grid);
        function next() {
          const n = Math.min(7, 2 + Math.floor(stage / 3));
          const hue = randInt(360, ctx.rand), sat = 55 + randInt(30, ctx.rand), lig = 45 + randInt(15, ctx.rand);
          const diff = Math.max(4, 20 - stage * 0.8);
          const odd = randInt(n * n, ctx.rand);
          grid.innerHTML = ''; grid.style.gridTemplateColumns = `repeat(${n},1fr)`;
          info.textContent = `${stage + 1}단계`;
          for (let i = 0; i < n * n; i++) {
            const c = h('button', { class: 'g-colorcell', style: { background: `hsl(${hue},${sat}%,${i === odd ? lig + diff : lig}%)` } });
            c.addEventListener('pointerdown', (e) => {
              e.preventDefault();
              if (i === odd) { stage++; ctx.sfx('good'); ctx.report(stage); next(); }
              else { ctx.sfx('bad'); ctx.vibrate(80); flash(grid, 'shake'); }
            });
            grid.appendChild(c);
          }
        }
        next();
        return { final: () => stage };
      },
    },
    // ---------------------------------------------------------------- 초성
    {
      id: 'chosung', name: '초성 퀴즈', icon: '💬', tag: '두뇌', desc: '초성 보고 단어', dur: 35, better: 'high', unit: '개', live: 'bars',
      howto: ['초성을 보고 알맞은 단어 고르기', '틀리면 1초 동안 잠겨요'], bot: [8, 20],
      play(el, ctx) {
        const order = shuffle(WORDS, ctx.rand);
        let i = 0;
        return choiceGame(el, ctx, () => {
          const w = order[i++ % order.length];
          const sameLen = WORDS.filter((x) => x !== w && x.length === w.length);
          const pool = sameLen.length >= 3 ? sameLen : WORDS.filter((x) => x !== w);
          const wrong = shuffle(pool, ctx.rand).slice(0, 3);
          return { prompt: h('div', { class: 'g-chosung' }, chosung(w)), sub: '이 초성의 단어는?', cols: 2, choices: shuffle([w, ...wrong], ctx.rand).map((x) => ({ label: x, correct: x === w })) };
        }, { penalty: false, lock: 1000 });
      },
    },
    // ---------------------------------------------------------------- 상식
    {
      id: 'quiz', name: '상식 퀴즈', icon: '💡', tag: '두뇌', desc: '제한 시간 안에 많이', dur: 40, better: 'high', unit: '개', live: 'bars',
      howto: ['문제를 보고 정답 고르기', '틀리면 1.5초 동안 잠겨요', '많이 맞힐수록 승리!'], bot: [6, 16],
      play(el, ctx) {
        const order = shuffle(QUIZ, ctx.rand);
        let i = 0;
        return choiceGame(el, ctx, () => {
          const q = order[i++ % order.length];
          return { prompt: h('div', { class: 'g-quiz-q' }, q[0]), cols: 1, choices: shuffle(q.slice(1), ctx.rand).map((x) => ({ label: x, correct: x === q[1] })) };
        }, { penalty: false, lock: 1500, okDelay: 250 });
      },
    },
  ];

  const byId = {};
  GAMES.forEach((g) => { byId[g.id] = g; });

  function fmtValue(game, v) {
    if (v == null || Number.isNaN(v)) return '-';
    if (game.fmt) return game.fmt(v);
    return `${global.TG.fmtNum(v, Number.isInteger(v) ? 0 : 1)}${game.unit}`;
  }

  global.GAMES = GAMES;
  global.GameById = byId;
  global.fmtValue = fmtValue;
})(window);

/*
 * 진행 노트북(호스트) ↔ 참가자 폰 실시간 연결.
 *
 * 두 가지 길을 동시에 씁니다 (기본값, ?net=auto):
 *  1) 직접 연결 — WebRTC(PeerJS). 같은 와이파이 등에서 빠름.
 *  2) 중계 연결 — 공개 MQTT 브로커(WebSocket, wss)를 거쳐 주고받음.
 *     폰이 LTE·5G라서 직접 연결이 막혀도 일반 웹 접속만 되면 동작.
 * 폰은 두 길 중 먼저 열린 쪽을 쓰고, 그쪽이 끊기면 다른 쪽으로 넘어갑니다.
 *
 * 옵션 (QR 링크로 폰에도 그대로 전달):
 *  ?net=peer   직접 연결만     ?net=relay  중계 연결만
 *  ?net=local  같은 브라우저 탭끼리(BroadcastChannel) — 리허설/테스트용
 *  ?ps=host:port/path [&pss=0|1]   자체 PeerServer
 *  ?mqtt=wss://주소1,wss://주소2   자체 MQTT 브로커(WebSocket)
 */
(function (global) {
  'use strict';
  const PREFIX = 'tgparty-';
  const TOPIC = 'tgparty/v1/';
  const DEFAULT_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
  const params = new URLSearchParams(location.search);

  function netMode() {
    const v = params.get('net');
    return v === 'local' || v === 'peer' || v === 'relay' ? v : 'auto';
  }
  function brokers() {
    const v = params.get('mqtt');
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_BROKERS;
  }
  function rid(n) { return Math.random().toString(36).slice(2, 2 + (n || 10)); }

  function peerOptions() {
    const o = { debug: 0 };
    const ps = params.get('ps');
    if (ps) {
      const m = ps.match(/^([^:/]+)(?::(\d+))?(\/.*)?$/);
      if (m) {
        o.host = m[1];
        o.port = Number(m[2] || (location.protocol === 'https:' ? 443 : 80));
        o.path = m[3] || '/';
        o.secure = params.get('pss') ? params.get('pss') === '1' : location.protocol === 'https:';
      }
    }
    return o;
  }

  // 참가 URL에 그대로 넘겨줄 연결 관련 파라미터
  function passParams() {
    const out = new URLSearchParams();
    ['net', 'ps', 'pss', 'mqtt'].forEach((k) => { if (params.get(k)) out.set(k, params.get(k)); });
    return out;
  }

  // ===================== 최소 MQTT 3.1.1 클라이언트 (WebSocket) =====================
  // QoS 0 발행/구독만 지원. 끊기면 자동 재접속 + 재구독.
  function Mqtt(url, onMessage, onStatus) {
    const te = new TextEncoder(), td = new TextDecoder();
    const subs = new Set();
    let ws = null, buf = new Uint8Array(0), open = false, dead = false, pingT = null, backoff = 1000, pid = 1, retryT = null;

    function u16(n) { return [(n >> 8) & 255, n & 255]; }
    function strBytes(s) { const b = te.encode(s); return concat([new Uint8Array(u16(b.length)), b]); }
    function varLen(n) { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return new Uint8Array(out); }
    function concat(parts) { let len = 0; parts.forEach((p) => { len += p.length; }); const o = new Uint8Array(len); let i = 0; parts.forEach((p) => { o.set(p, i); i += p.length; }); return o; }
    function packet(first, body) { return concat([new Uint8Array([first]), varLen(body.length), body]); }
    function raw(p) { if (ws && ws.readyState === 1) { ws.send(p); return true; } return false; }

    function connect() {
      if (dead) return;
      try { ws = new WebSocket(url, 'mqtt'); } catch (e) { schedule(); return; }
      ws.binaryType = 'arraybuffer';
      buf = new Uint8Array(0);
      const sock = ws;
      sock.onopen = () => {
        const cid = 'tg' + rid(12);
        // 프로토콜 "MQTT" 레벨 4, clean session, keepalive 30초
        const vh = concat([strBytes('MQTT'), new Uint8Array([4, 0x02]), new Uint8Array(u16(30))]);
        raw(packet(0x10, concat([vh, strBytes(cid)])));
      };
      sock.onmessage = (e) => { if (sock === ws) feed(new Uint8Array(e.data)); };
      sock.onclose = sock.onerror = () => {
        if (sock !== ws) return;
        ws = null;
        if (open) { open = false; onStatus && onStatus('closed'); }
        clearInterval(pingT);
        schedule();
      };
    }
    function schedule() {
      if (dead || retryT) return;
      retryT = setTimeout(() => { retryT = null; connect(); }, backoff);
      backoff = Math.min(10000, backoff * 1.7);
    }
    function feed(chunk) {
      buf = concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        let mult = 1, len = 0, i = 1, b;
        do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * mult; mult *= 128; } while (b & 128 && i < 5);
        if (buf.length < i + len) return;
        handle(buf[0], buf.subarray(i, i + len));
        buf = buf.slice(i + len);
      }
    }
    function handle(first, body) {
      const type = first >> 4;
      if (type === 2) { // CONNACK
        if (body[1] !== 0) { try { ws.close(); } catch (e) { /* 무시 */ } return; }
        open = true; backoff = 1000;
        subs.forEach(sendSub);
        clearInterval(pingT);
        pingT = setInterval(() => raw(new Uint8Array([0xc0, 0])), 20000);
        onStatus && onStatus('open');
      } else if (type === 3) { // PUBLISH
        const qos = (first >> 1) & 3;
        const tl = (body[0] << 8) | body[1];
        const topic = td.decode(body.subarray(2, 2 + tl));
        let p = 2 + tl;
        if (qos > 0) p += 2;
        onMessage && onMessage(topic, td.decode(body.subarray(p)));
      }
    }
    function sendSub(topic) {
      const id = pid++ & 0xffff || 1;
      raw(packet(0x82, concat([new Uint8Array(u16(id)), strBytes(topic), new Uint8Array([0])])));
    }
    connect();
    return {
      subscribe(topic) { subs.add(topic); if (open) sendSub(topic); },
      publish(topic, text) { if (!open) return false; return raw(packet(0x30, concat([strBytes(topic), te.encode(text)]))); },
      isOpen() { return open; },
      destroy() { dead = true; clearInterval(pingT); clearTimeout(retryT); if (ws) try { ws.close(); } catch (e) { /* 무시 */ } },
    };
  }

  // ===================== 호스트 =====================
  function createHost(code, H) {
    const mode = netMode();
    if (mode === 'local') return localHost(code, H);
    if (mode === 'peer') return peerHost(code, H);
    if (mode === 'relay') return relayHost(code, H);
    // auto: 두 길을 모두 열어 둠
    const st = { peer: 'connecting', relay: 'connecting' };
    const emit = () => {
      const s = st.peer === 'online' || st.relay === 'online' ? 'online' : st.peer;
      H.onStatus && H.onStatus(s, { peer: st.peer, relay: st.relay });
    };
    const sub = (k) => Object.assign({}, H, { onStatus(s) { st[k] = s; emit(); } });
    const p = peerHost(code, sub('peer'));
    const r = relayHost(code, sub('relay'));
    return {
      send(id, msg) { (String(id).startsWith('r:') ? r : p).send(id, msg); },
      ids() { return p.ids().concat(r.ids()); },
      destroy() { p.destroy(); r.destroy(); },
    };
  }

  function peerHost(code, H) {
    const conns = new Map();
    let peer = null, destroyed = false, retry = 0;
    const api = {
      send(id, msg) { const c = conns.get(id); if (c && c.open) { try { c.send(msg); } catch (e) { /* 무시 */ } } },
      ids() { return Array.from(conns.keys()); },
      destroy() { destroyed = true; if (peer) peer.destroy(); },
    };
    if (!global.Peer) { setTimeout(() => H.onStatus && H.onStatus('error:no-peerjs'), 0); return api; }
    function start() {
      peer = new global.Peer(PREFIX + code, peerOptions());
      peer.on('open', () => { retry = 0; H.onStatus && H.onStatus('online'); });
      peer.on('connection', (conn) => {
        conn.on('open', () => { conns.set(conn.peer, conn); H.onConnect && H.onConnect(conn.peer); });
        conn.on('data', (d) => { H.onMessage && H.onMessage(conn.peer, d); });
        const gone = () => { if (conns.get(conn.peer) === conn) { conns.delete(conn.peer); H.onClose && H.onClose(conn.peer); } };
        conn.on('close', gone); conn.on('error', gone);
      });
      peer.on('disconnected', () => {
        if (destroyed) return;
        H.onStatus && H.onStatus('reconnecting');
        setTimeout(() => { if (!destroyed && peer && !peer.destroyed) peer.reconnect(); }, 1000);
      });
      peer.on('error', (err) => {
        if (destroyed) return;
        const t = err && err.type;
        if (t === 'unavailable-id') {
          // 새로고침 직후: 이전 연결이 서버에서 아직 안 풀렸을 수 있음 → 잠시 후 재시도
          H.onStatus && H.onStatus('waiting-id');
          peer.destroy();
          setTimeout(start, Math.min(8000, 2000 + retry++ * 1500));
        } else if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') {
          H.onStatus && H.onStatus('reconnecting');
          if (peer.destroyed) setTimeout(start, 3000);
        } else if (t !== 'peer-unavailable') {
          H.onStatus && H.onStatus('error:' + t);
        }
      });
    }
    start();
    return api;
  }

  // 중계 호스트: 모든 브로커에 붙어서 "방 주제"를 구독. 폰마다 마지막으로 들어온 브로커로 답장.
  function relayHost(code, H) {
    const inTopic = TOPIC + code + '/h';
    const outTopic = (cid) => TOPIC + code + '/c/' + cid;
    const seen = new Map(); // id -> { at, m }
    const clients = brokers().map((url) => {
      const m = Mqtt(url, (topic, text) => {
        let msg; try { msg = JSON.parse(text); } catch (e) { return; }
        if (!msg || typeof msg.from !== 'string' || msg.from.length > 40) return;
        const id = 'r:' + msg.from;
        const isNew = !seen.has(id);
        seen.set(id, { at: Date.now(), m });
        if (msg.type === 'connect') {
          m.publish(outTopic(msg.from), JSON.stringify({ type: 'accept' }));
          if (isNew) H.onConnect && H.onConnect(id);
        } else if (msg.type === 'msg') {
          if (isNew) {
            // 진행 화면을 새로고침한 경우: 폰에게 다시 인사(hello)하라고 알림
            m.publish(outTopic(msg.from), JSON.stringify({ type: 'accept' }));
            H.onConnect && H.onConnect(id);
          }
          H.onMessage && H.onMessage(id, msg.data);
        } else if (msg.type === 'close') {
          seen.delete(id); H.onClose && H.onClose(id);
        }
      }, () => report());
      m.subscribe(inTopic);
      return m;
    });
    function report() { H.onStatus && H.onStatus(clients.some((c) => c.isOpen()) ? 'online' : 'connecting'); }
    // 12초 넘게 소식 없는 폰은 끊긴 것으로 처리 (폰은 3초마다 ping)
    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [id, s] of seen) if (now - s.at > 12000) { seen.delete(id); H.onClose && H.onClose(id); }
    }, 4000);
    setTimeout(report, 0);
    return {
      send(id, msg) { const s = seen.get(id); if (s) s.m.publish(outTopic(id.slice(2)), JSON.stringify({ type: 'msg', data: msg })); },
      ids() { return Array.from(seen.keys()); },
      destroy() { clearInterval(sweep); clients.forEach((c) => c.destroy()); },
    };
  }

  function localHost(code, H) {
    const ch = new BroadcastChannel(PREFIX + code);
    const ids = new Set();
    ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.to !== 'host') return;
      if (m.type === 'connect') { ids.add(m.from); ch.postMessage({ to: m.from, type: 'accept' }); H.onConnect && H.onConnect(m.from); }
      else if (m.type === 'msg') { if (!ids.has(m.from)) { ids.add(m.from); H.onConnect && H.onConnect(m.from); } H.onMessage && H.onMessage(m.from, m.data); }
      else if (m.type === 'close') { ids.delete(m.from); H.onClose && H.onClose(m.from); }
    };
    ch.postMessage({ to: '*', type: 'host-up' });
    setTimeout(() => H.onStatus && H.onStatus('online'), 0);
    return {
      send(id, msg) { ch.postMessage({ to: id, type: 'msg', data: msg }); },
      ids() { return Array.from(ids); },
      destroy() { ch.close(); },
    };
  }

  // ===================== 참가자 =====================
  function createClient(code, H) {
    const mode = netMode();
    if (mode === 'local') return localClient(code, H);
    if (mode === 'peer') return peerClient(code, H);
    if (mode === 'relay') return relayClient(code, H);
    return hybridClient(code, H);
  }

  // 두 길을 동시에 시도하고, 열린 쪽 하나만 "활성"으로 사용
  function hybridClient(code, H) {
    const names = ['peer', 'relay'];
    const st = { peer: 'connecting', relay: 'connecting' };
    let active = null, justPicked = false;
    const t = {};
    function isOpen(n) { return t[n] && t[n].isOpen(); }
    function pick() {
      if (active && isOpen(active)) return;
      const next = names.find(isOpen) || null;
      const changed = next !== active;
      active = next;
      if (active && changed) {
        justPicked = true; Promise.resolve().then(() => { justPicked = false; });
        H.onStatus && H.onStatus('open', active); H.onOpen && H.onOpen(active);
      }
    }
    function status() {
      if (active && isOpen(active)) return;
      // 둘 다 안 열렸을 때: 둘 다 "진행 화면 없음"이면 그것을, 아니면 연결 중
      const s = st.peer === 'no-host' && st.relay === 'no-host' ? 'no-host' : st.relay === 'closed' || st.peer === 'closed' ? 'closed' : 'connecting';
      H.onStatus && H.onStatus(s);
    }
    names.forEach((n) => {
      const sub = {
        onStatus(s) { st[n] = s; if (s === 'open') pick(); else if (n === active && !isOpen(n)) { active = null; pick(); } status(); },
        onOpen() { if (n === active && !justPicked) H.onOpen && H.onOpen(n); else pick(); },
        onMessage(m) { if (n === active) H.onMessage && H.onMessage(m); },
      };
      t[n] = n === 'peer' ? peerClient(code, sub) : relayClient(code, sub);
    });
    return {
      send(msg) {
        if (active && isOpen(active)) return t[active].send(msg);
        pick();
        return active ? t[active].send(msg) : false;
      },
      isOpen() { return !!(active && isOpen(active)); },
      via() { return active; },
      destroy() { names.forEach((n) => t[n].destroy()); },
    };
  }

  function peerClient(code, H) {
    let peer = null, conn = null, lastRx = 0, destroyed = false, backoff = 1000, connecting = false;
    const api = {
      send(msg) { if (conn && conn.open) { try { conn.send(msg); return true; } catch (e) { /* 무시 */ } } return false; },
      isOpen() { return !!(conn && conn.open); },
      destroy() { destroyed = true; if (peer) peer.destroy(); },
    };
    if (!global.Peer) { setTimeout(() => H.onStatus && H.onStatus('no-host'), 0); return api; }
    function ensurePeer(cb) {
      if (peer && !peer.destroyed && peer.open) return cb();
      if (peer && !peer.destroyed && !peer.disconnected) { peer.once('open', cb); return; }
      if (peer) try { peer.destroy(); } catch (e) { /* 무시 */ }
      peer = new global.Peer(peerOptions());
      peer.once('open', cb);
      peer.on('error', (err) => {
        connecting = false;
        H.onStatus && H.onStatus(err && err.type === 'peer-unavailable' ? 'no-host' : 'error');
        schedule();
      });
      peer.on('disconnected', () => { if (!destroyed) setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 1000); });
    }
    function connect() {
      if (destroyed || connecting) return;
      connecting = true;
      H.onStatus && H.onStatus('connecting');
      ensurePeer(() => {
        const c = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        const timer = setTimeout(() => { if (!c.open) { connecting = false; try { c.close(); } catch (e) { /* 무시 */ } H.onStatus && H.onStatus('error'); schedule(); } }, 9000);
        c.on('open', () => {
          clearTimeout(timer); connecting = false; conn = c; backoff = 1000; lastRx = Date.now();
          H.onStatus && H.onStatus('open'); H.onOpen && H.onOpen();
        });
        c.on('data', (d) => { lastRx = Date.now(); H.onMessage && H.onMessage(d); });
        const gone = () => { if (conn === c) { conn = null; H.onStatus && H.onStatus('closed'); schedule(); } };
        c.on('close', gone); c.on('error', gone);
      });
    }
    let pending = null;
    function schedule() {
      if (destroyed || pending) return;
      pending = setTimeout(() => { pending = null; connect(); }, backoff);
      backoff = Math.min(8000, backoff * 1.6);
    }
    // 하트비트
    setInterval(() => {
      if (destroyed) return;
      if (conn && conn.open) {
        api.send({ t: 'ping' });
        if (Date.now() - lastRx > 10000) { const c = conn; conn = null; try { c.close(); } catch (e) { /* 무시 */ } H.onStatus && H.onStatus('closed'); schedule(); }
      }
    }, 3000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !(conn && conn.open)) { backoff = 500; if (pending) { clearTimeout(pending); pending = null; } connect(); }
    });
    connect();
    return api;
  }

  // 중계 참가자: 브로커 하나에 붙어 "connect"를 보내고, 진행 화면의 "accept"를 받으면 열림.
  // 답이 없으면 다음 브로커로 바꿔가며 계속 시도.
  function relayClient(code, H) {
    const me = rid(12);
    const list = brokers();
    const inTopic = TOPIC + code + '/c/' + me;
    const hostTopic = TOPIC + code + '/h';
    let idx = 0, m = null, open = false, lastRx = 0, destroyed = false, helloT = null, tries = 0;
    function pub(obj) { return m ? m.publish(hostTopic, JSON.stringify(Object.assign({ from: me }, obj))) : false; }
    function use(i) {
      if (m) m.destroy();
      open = false; idx = i % list.length;
      m = Mqtt(list[idx], (topic, text) => {
        if (topic !== inTopic) return;
        let msg; try { msg = JSON.parse(text); } catch (e) { return; }
        lastRx = Date.now();
        if (msg.type === 'accept') {
          if (!open) { open = true; tries = 0; H.onStatus && H.onStatus('open'); H.onOpen && H.onOpen(); }
          else H.onOpen && H.onOpen(); // 진행 화면이 새로고침됨 → 다시 hello
        } else if (msg.type === 'msg') {
          if (!open) { open = true; H.onStatus && H.onStatus('open'); H.onOpen && H.onOpen(); }
          H.onMessage && H.onMessage(msg.data);
        }
      }, (s) => { if (s === 'open') knock(); else if (open) { open = false; H.onStatus && H.onStatus('closed'); } });
      m.subscribe(inTopic);
      H.onStatus && H.onStatus('connecting');
      // 브로커 접속 + 진행 화면 응답까지 7초 안에 안 되면 다음 브로커로
      clearTimeout(helloT);
      helloT = setTimeout(() => { if (!open && !destroyed) { tries++; if (tries >= list.length * 2) H.onStatus && H.onStatus('no-host'); use(idx + 1); } }, 7000);
    }
    function knock() { pub({ type: 'connect' }); }
    use(0);
    // 3초마다 ping (진행 화면이 살아 있음을 알게 함), 응답 끊기면 재접속 시도
    const hb = setInterval(() => {
      if (destroyed) return;
      if (open) {
        pub({ type: 'msg', data: { t: 'ping' } });
        if (Date.now() - lastRx > 12000) { open = false; H.onStatus && H.onStatus('closed'); use(idx); }
      } else if (m && m.isOpen()) knock();
    }, 3000);
    addEventListener('pagehide', () => pub({ type: 'close' }));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !open && !destroyed) use(idx); });
    return {
      send(msg) { return open ? pub({ type: 'msg', data: msg }) : false; },
      isOpen() { return open; },
      destroy() { destroyed = true; clearInterval(hb); clearTimeout(helloT); if (m) m.destroy(); },
    };
  }

  function localClient(code, H) {
    const ch = new BroadcastChannel(PREFIX + code);
    const me = 'c-' + Math.random().toString(36).slice(2);
    let open = false;
    ch.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.to === '*' && m.type === 'host-up') { ch.postMessage({ to: 'host', from: me, type: 'connect' }); return; }
      if (m.to !== me) return;
      if (m.type === 'accept') { if (!open) { open = true; H.onStatus && H.onStatus('open'); H.onOpen && H.onOpen(); } }
      else if (m.type === 'msg') { H.onMessage && H.onMessage(m.data); }
    };
    H.onStatus && H.onStatus('connecting');
    ch.postMessage({ to: 'host', from: me, type: 'connect' });
    addEventListener('pagehide', () => ch.postMessage({ to: 'host', from: me, type: 'close' }));
    return {
      send(msg) { ch.postMessage({ to: 'host', from: me, type: 'msg', data: msg }); return true; },
      isOpen() { return open; },
      destroy() { ch.close(); },
    };
  }

  global.Net = { createHost, createClient, passParams, netMode };
})(window);

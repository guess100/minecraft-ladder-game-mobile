/*
 * 진행 노트북(호스트) ↔ 참가자 폰 실시간 연결.
 * - 기본: WebRTC(PeerJS). 별도 서버 없이 정적 호스팅(GitHub Pages)만으로 동작.
 *   공개 PeerJS 시그널링 서버를 쓰며, ?ps=host:port[/path] 로 자체 PeerServer 지정 가능.
 * - ?net=local : 같은 브라우저 탭끼리(BroadcastChannel) 연결 — 리허설/테스트용.
 */
(function (global) {
  'use strict';
  const PREFIX = 'tgparty-';
  const params = new URLSearchParams(location.search);

  function netMode() { return params.get('net') === 'local' ? 'local' : 'peer'; }

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
    ['net', 'ps', 'pss'].forEach((k) => { if (params.get(k)) out.set(k, params.get(k)); });
    return out;
  }

  // ===================== 호스트 =====================
  function createHost(code, handlers) {
    return netMode() === 'local' ? localHost(code, handlers) : peerHost(code, handlers);
  }

  function peerHost(code, H) {
    const conns = new Map();
    let peer = null, destroyed = false, retry = 0;
    const api = {
      send(id, msg) { const c = conns.get(id); if (c && c.open) { try { c.send(msg); } catch (e) { /* 무시 */ } } },
      ids() { return Array.from(conns.keys()); },
      destroy() { destroyed = true; if (peer) peer.destroy(); },
    };
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
  function createClient(code, handlers) {
    return netMode() === 'local' ? localClient(code, handlers) : peerClient(code, handlers);
  }

  // 공통: 하트비트 + 끊기면 자동 재연결
  function peerClient(code, H) {
    let peer = null, conn = null, lastRx = 0, destroyed = false, backoff = 1000, connecting = false;
    const api = {
      send(msg) { if (conn && conn.open) { try { conn.send(msg); return true; } catch (e) { /* 무시 */ } } return false; },
      isOpen() { return !!(conn && conn.open); },
      destroy() { destroyed = true; if (peer) peer.destroy(); },
    };
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
        const timer = setTimeout(() => { if (!c.open) { connecting = false; try { c.close(); } catch (e) { /* 무시 */ } schedule(); } }, 9000);
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
        if (Date.now() - lastRx > 10000) { try { conn.close(); } catch (e) { /* 무시 */ } conn = null; schedule(); }
      }
    }, 3000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !(conn && conn.open)) { backoff = 500; if (pending) { clearTimeout(pending); pending = null; } connect(); }
    });
    connect();
    return api;
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

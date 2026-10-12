'use strict';
/*
 * Dominó: tú contra el celular.
 * Doble seis, 7 fichas por jugador, se roba del pozo cuando no hay jugada.
 * Gana la partida quien llegue primero a la meta de puntos.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const HUMAN = 0;
  const CPU = 1;
  const SAVE_KEY = 'domino.save.v1';
  const SETTINGS_KEY = 'domino.settings.v1';

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
  };

  const settings = Object.assign(
    { level: 'normal', target: 100, sound: true, hints: true, view: '3d' },
    store.get(SETTINGS_KEY) || {},
  );
  const saveSettings = () => store.set(SETTINGS_KEY, settings);

  /* ================= Dibujo de fichas ================= */

  // Posiciones de los puntos en una cuadrícula 3x3 (columna, fila) para media ficha vertical.
  const PIPS = {
    0: [],
    1: [[1, 1]],
    2: [[2, 0], [0, 2]],
    3: [[2, 0], [1, 1], [0, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
  };

  function pipsSVG(n, ox, oy, swap) {
    return PIPS[n].map(([c, r]) => {
      const [x, y] = swap ? [r, c] : [c, r];
      return `<circle class="pip" cx="${ox + 24 + x * 26}" cy="${oy + 24 + y * 26}" r="9.5"/>`;
    }).join('');
  }

  // first = mitad superior (vertical) o izquierda (horizontal).
  function tileSVG(first, second, vertical) {
    const W = vertical ? 100 : 200;
    const H = vertical ? 200 : 100;
    const line = vertical
      ? '<line class="div" x1="14" y1="100" x2="86" y2="100"/>'
      : '<line class="div" x1="100" y1="14" x2="100" y2="86"/>';
    const p1 = pipsSVG(first, 0, 0, !vertical);
    const p2 = vertical ? pipsSVG(second, 0, 100, false) : pipsSVG(second, 100, 0, true);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">`
      + `<rect class="face" x="2" y="2" width="${W - 4}" height="${H - 4}" rx="14"/>`
      + `${line}${p1}${p2}<circle class="pin" cx="${W / 2}" cy="${H / 2}" r="5"/></svg>`;
  }

  function backSVG() {
    return '<svg viewBox="0 0 100 200" aria-hidden="true">'
      + '<rect class="back" x="2" y="2" width="96" height="196" rx="14"/>'
      + '<rect class="back-mark" x="18" y="18" width="64" height="164" rx="8"/>'
      + '<circle class="back-mark" cx="50" cy="100" r="16"/></svg>';
  }

  /* ================= Mesa (disposición en serpiente) ================= */

  // Coordenadas en "unidades": una ficha mide 2x1. La ficha inicial está centrada en (0,0).
  // El brazo derecho crece hacia la derecha y baja al llegar al borde; el izquierdo crece
  // hacia la izquierda y sube. Los dobles se colocan atravesados.
  class Board {
    constructor(halfW) {
      this.halfW = halfW;
      this.moves = [];
      this.placed = [];
      this.arms = null;
    }

    get empty() { return this.placed.length === 0; }

    endValue(side) { return this.arms[side].value; }

    fits(t, side) {
      if (this.empty) return true;
      const v = this.arms[side].value;
      return t.a === v || t.b === v;
    }

    plan(t, side) {
      const dbl = t.a === t.b;
      if (this.empty) {
        const half = dbl ? 1 : 0.5;
        const ex = dbl ? 0.5 : 1;
        return {
          x: -ex, y: -half, w: dbl ? 1 : 2, h: dbl ? 2 : 1, vertical: dbl,
          first: t.a, second: t.b,
          arms: {
            L: { value: t.a, endX: -ex, rowY: 0, dir: -1, sgn: -1, half },
            R: { value: t.b, endX: ex, rowY: 0, dir: 1, sgn: 1, half },
          },
        };
      }
      const arm = this.arms[side];
      const v = arm.value;
      const other = t.a === v ? t.b : t.a;
      const len = dbl ? 1 : 2;
      const fitsRow = arm.dir > 0 ? arm.endX + len <= this.halfW : arm.endX - len >= -this.halfW;
      let p;
      let na;
      if (fitsRow) {
        const x = arm.dir > 0 ? arm.endX : arm.endX - len;
        p = dbl
          ? { x, y: arm.rowY - 1, w: 1, h: 2, vertical: true, first: v, second: v }
          : {
            x, y: arm.rowY - 0.5, w: 2, h: 1, vertical: false,
            first: arm.dir > 0 ? v : other, second: arm.dir > 0 ? other : v,
          };
        na = { ...arm, value: other, endX: arm.endX + arm.dir * len, half: dbl ? 1 : 0.5 };
      } else {
        // Vuelta: una ficha vertical bajo (o sobre) el extremo, y la fila siguiente va al revés.
        const x = arm.dir > 0 ? arm.endX - 1 : arm.endX;
        const yStart = arm.rowY + arm.sgn * arm.half;
        p = {
          x, y: arm.sgn > 0 ? yStart : yStart - 2, w: 1, h: 2, vertical: true,
          first: arm.sgn > 0 ? v : other, second: arm.sgn > 0 ? other : v,
        };
        na = {
          ...arm,
          value: other,
          rowY: arm.rowY + arm.sgn * (arm.half + 1.5),
          endX: arm.dir > 0 ? arm.endX - 1 : arm.endX + 1,
          dir: -arm.dir,
          half: 0.5,
        };
      }
      p.arms = { ...this.arms, [side]: na };
      return p;
    }

    play(t, side) {
      const p = this.plan(t, side);
      this.arms = p.arms;
      this.placed.push({ ...p, tile: t, side });
      this.moves.push({ a: t.a, b: t.b, id: t.id, side });
      return p;
    }

    static replay(halfW, moves) {
      const b = new Board(halfW);
      for (const m of moves) b.play({ a: m.a, b: m.b, id: m.id }, m.side);
      return b;
    }

    // Fichas en la mesa que contienen el valor e.
    countValue(e) {
      return this.placed.filter((p) => p.tile.a === e || p.tile.b === e).length;
    }
  }

  /* ================= Sonido ================= */

  const sound = {
    ctx: null,
    unlock() {
      if (this.ctx) return;
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
    },
    burst(freq, gain, dur) {
      if (!settings.sound || !this.ctx) return;
      const ctx = this.ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f).connect(g).connect(ctx.destination);
      src.start();
    },
    clack() { this.burst(1900, 1.4, 0.07); this.burst(700, 0.8, 0.05); },
    draw() { this.burst(2600, 0.5, 0.05); },
    win() {
      if (!settings.sound || !this.ctx) return;
      const ctx = this.ctx;
      [523, 659, 784, 1047].forEach((fq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = fq;
        o.type = 'triangle';
        const t0 = ctx.currentTime + i * 0.12;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        o.connect(g).connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + 0.32);
      });
    },
  };
  const buzz = (ms) => { try { if (settings.sound && navigator.vibrate) navigator.vibrate(ms); } catch { /* nada */ } };

  /* ================= Estado del juego ================= */

  let g = null; // estado de la partida en curso
  let board = null;
  let token = 0; // invalida turnos del celular pendientes al reiniciar
  let layout = { unit: 30, ox: 0, oy: 0 }; // escala de la mesa 2D
  let view3d = null; // mesa 3D (board3d.js); null si se usa la mesa 2D

  const el = {
    board: $('board'), boardInner: $('boardInner'), hand: $('hand'),
    cpu: $('cpu'), cpuHand: $('cpuHand'), cpuCount: $('cpuCount'),
    msg: $('msg'), pool: $('pool'), poolCount: $('poolCount'), passBtn: $('passBtn'),
    scoreMe: $('scoreMe'), scoreCpu: $('scoreCpu'), goal: $('goal'),
    overlay: $('overlay'), card: $('card'), toast: $('toast'), menuBtn: $('menuBtn'),
  };

  const pips = (t) => t.a + t.b;
  const handSum = (h) => h.reduce((s, t) => s + pips(t), 0);
  const label = (t) => `${t.a}|${t.b}`;

  function halfWidthForBoard() {
    // Depende solo de la orientación de la pantalla, para que la serpiente no cambie
    // de forma cuando la mano crece o se encoge.
    const ratio = window.innerWidth / window.innerHeight;
    // En 3D la cámara inclinada aprovecha mejor el alto: filas más cortas y fichas más grandes.
    if (ratio < 1) return view3d ? 4.5 : 6.5;
    return Math.max(7.5, Math.min(view3d ? 9 : 12, Math.round(ratio * 5 * 2) / 2));
  }

  function newMatch() {
    store.del(SAVE_KEY);
    g = {
      scores: [0, 0],
      target: settings.target,
      roundNo: 0,
      lastWinner: null,
    };
    newRound();
  }

  function newRound() {
    token++;
    const deck = [];
    for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) deck.push({ a, b, id: `${a}${b}` });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    g.hands = [deck.slice(0, 7), deck.slice(7, 14)];
    g.pool = deck.slice(14);
    g.hands[HUMAN].sort((x, y) => x.a - y.a || x.b - y.b);
    g.moves = [];
    g.passes = 0;
    g.lacks = [[], []];
    g.phase = 'play';
    g.roundNo++;
    board = new Board(halfWidthForBoard());

    if (g.lastWinner === null) {
      const { player, tile } = findOpener();
      g.turn = player;
      g.mustPlay = tile.id;
    } else {
      g.turn = g.lastWinner;
      g.mustPlay = null;
    }
    renderAll();
    startTurn();
  }

  // Abre quien tenga el doble más alto (o, si nadie tiene dobles, la ficha más alta).
  function findOpener() {
    for (let d = 6; d >= 0; d--) {
      for (const p of [HUMAN, CPU]) {
        const t = g.hands[p].find((x) => x.a === d && x.b === d);
        if (t) return { player: p, tile: t };
      }
    }
    let best = null;
    for (const p of [HUMAN, CPU]) {
      for (const t of g.hands[p]) {
        if (!best || pips(t) > pips(best.tile) || (pips(t) === pips(best.tile) && Math.max(t.a, t.b) > Math.max(best.tile.a, best.tile.b))) {
          best = { player: p, tile: t };
        }
      }
    }
    return best;
  }

  function legalMoves(p) {
    const res = [];
    for (const t of g.hands[p]) {
      if (g.mustPlay && t.id !== g.mustPlay) continue;
      if (board.empty) { res.push({ tile: t, side: 'R' }); continue; }
      for (const side of ['L', 'R']) if (board.fits(t, side)) res.push({ tile: t, side });
    }
    return res;
  }

  function sidesFor(t) {
    return legalMoves(HUMAN).filter((m) => m.tile.id === t.id).map((m) => m.side);
  }

  function save() {
    if (!g) return;
    store.set(SAVE_KEY, { ...g, moves: board.moves });
  }

  function load() {
    const s = store.get(SAVE_KEY);
    if (!s || !s.hands || (s.phase !== 'play' && s.phase !== 'roundEnd')) return false;
    g = s;
    board = Board.replay(halfWidthForBoard(), s.moves || []);
    return true;
  }

  function recordLacks(p) {
    if (board.empty) return;
    for (const side of ['L', 'R']) {
      const v = board.endValue(side);
      if (!g.lacks[p].includes(v)) g.lacks[p].push(v);
    }
  }

  /* ================= Flujo de turnos ================= */

  function startTurn() {
    save();
    renderAll();
    if (g.turn === CPU) cpuTurn();
    else promptHuman();
  }

  function nextTurn() {
    g.turn = 1 - g.turn;
    startTurn();
  }

  function promptHuman() {
    const moves = legalMoves(HUMAN);
    el.passBtn.hidden = true;
    el.pool.classList.remove('pulse');
    if (moves.length) {
      if (g.mustPlay) {
        const t = moves[0].tile;
        setMsg(t.a === t.b ? `Empiezas tú con el doble ${t.a}. Arrástralo a la mesa.` : `Empiezas tú con el ${label(t)}. Arrástralo a la mesa.`);
      } else if (board.empty) {
        setMsg('Ganaste la mano anterior: sale cualquier ficha.');
      } else {
        setMsg('Tu turno: arrastra una ficha a un extremo.');
      }
    } else if (g.pool.length) {
      setMsg('No tienes jugada. Toca el pozo para robar.');
      el.pool.classList.add('pulse');
    } else {
      setMsg('No tienes jugada y el pozo está vacío.');
      el.passBtn.hidden = false;
    }
    renderHand();
  }

  function humanDraw() {
    if (!g || g.phase !== 'play' || g.turn !== HUMAN) return;
    if (legalMoves(HUMAN).length) { toast('Tienes jugada: no puedes robar'); return; }
    if (!g.pool.length) return;
    recordLacks(HUMAN);
    const t = g.pool.pop();
    g.hands[HUMAN].push(t);
    sound.draw();
    renderPool();
    save();
    promptHuman();
    const node = el.hand.querySelector(`[data-id="${t.id}"]`);
    if (node) node.classList.add('pop');
  }

  function humanPass() {
    if (!g || g.phase !== 'play' || g.turn !== HUMAN || legalMoves(HUMAN).length || g.pool.length) return;
    recordLacks(HUMAN);
    el.passBtn.hidden = true;
    g.passes++;
    if (g.passes >= 2) { endRound(null, 'tranque'); return; }
    nextTurn();
  }

  function doPlay(p, t, side, fromRect) {
    g.hands[p] = g.hands[p].filter((x) => x.id !== t.id);
    g.mustPlay = null;
    g.passes = 0;
    board.play(t, side);
    sound.clack();
    buzz(12);
    renderAll();
    animateLastTile(fromRect);
    if (!g.hands[p].length) { endRound(p, 'domino'); return; }
    if (!g.pool.length && !legalMoves(HUMAN).length && !legalMoves(CPU).length) {
      endRound(null, 'tranque');
      return;
    }
    nextTurn();
  }

  async function cpuTurn() {
    const my = token;
    el.cpu.classList.add('thinking');
    setMsg('El celular está pensando…');
    await sleep(650 + Math.random() * 550);
    if (my !== token) return;
    let moves = legalMoves(CPU);
    while (!moves.length && g.pool.length) {
      recordLacks(CPU);
      g.hands[CPU].push(g.pool.pop());
      sound.draw();
      setMsg('El celular roba del pozo…');
      renderCpu();
      renderPool();
      save();
      await sleep(420);
      if (my !== token) return;
      moves = legalMoves(CPU);
    }
    el.cpu.classList.remove('thinking');
    if (!moves.length) {
      recordLacks(CPU);
      g.passes++;
      setMsg('El celular no tiene jugada y pasa.');
      toast('El celular pasa');
      save();
      await sleep(900);
      if (my !== token) return;
      if (g.passes >= 2) { endRound(null, 'tranque'); return; }
      nextTurn();
      return;
    }
    const m = chooseMove(moves);
    const r = el.cpuHand.getBoundingClientRect();
    doPlay(CPU, m.tile, m.side, { left: r.left + r.width / 2 - 15, top: r.top, width: 30, height: 60, vertical: true });
  }

  /* ================= Inteligencia del celular ================= */

  function chooseMove(moves) {
    if (settings.level === 'facil') {
      // Juega casi al azar, pero a veces suelta la ficha más pesada.
      if (Math.random() < 0.3) return moves.reduce((a, b) => (pips(b.tile) > pips(a.tile) ? b : a));
      return moves[Math.floor(Math.random() * moves.length)];
    }
    const hand = g.hands[CPU];
    const hard = settings.level === 'dificil';
    let best = null;
    let bestScore = -Infinity;
    for (const m of moves) {
      const t = m.tile;
      const rest = hand.filter((x) => x.id !== t.id);
      let s = pips(t);
      if (t.a === t.b) s += 6;
      if (!rest.length) s += 1000;

      let ends;
      if (board.empty) ends = [t.a, t.b];
      else {
        const v = board.endValue(m.side);
        const o = t.a === v ? t.b : t.a;
        ends = m.side === 'L' ? [o, board.endValue('R')] : [board.endValue('L'), o];
      }
      // Conservar control: preferir dejar extremos que el celular pueda seguir jugando.
      for (const e of new Set(ends)) s += 2.5 * rest.filter((x) => x.a === e || x.b === e).length;

      if (hard) {
        const lacks = g.lacks[HUMAN];
        for (const e of new Set(ends)) {
          if (lacks.includes(e)) s += 6;
          const seen = board.countValue(e) + rest.filter((x) => x.a === e || x.b === e).length
            + ((t.a === e || t.b === e) ? 1 : 0);
          if (seen >= 7) s += 5; // nadie más tiene ese número
        }
        // Si el jugador tiene pocas fichas, cerrar el juego tiene más valor.
        if (g.hands[HUMAN].length <= 2) s += ends.filter((e) => lacks.includes(e)).length * 6;
      }
      s += Math.random() * 1.5;
      if (s > bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  /* ================= Fin de mano y de partida ================= */

  function endRound(winner, reason) {
    token++;
    g.phase = 'roundEnd';
    el.cpu.classList.remove('thinking');
    el.passBtn.hidden = true;
    el.pool.classList.remove('pulse');
    const sums = g.hands.map(handSum);
    let w = winner;
    if (reason === 'tranque') {
      if (sums[HUMAN] < sums[CPU]) w = HUMAN;
      else if (sums[CPU] < sums[HUMAN]) w = CPU;
      else w = null;
    }
    const points = w === null ? 0 : sums[1 - w];
    if (w !== null) {
      g.scores[w] += points;
      g.lastWinner = w;
    }
    const matchOver = w !== null && g.scores[w] >= g.target;
    if (matchOver) { g.phase = 'over'; store.del(SAVE_KEY); } else save();
    renderScores();
    renderCpu(true);
    renderHand();
    setMsg(reason === 'tranque' ? '¡Tranque!' : (w === HUMAN ? '¡Dominó!' : 'El celular dominó'));
    if (w === HUMAN) sound.win();

    setTimeout(() => {
      const title = reason === 'tranque'
        ? (w === null ? 'Tranque: empate' : `Tranque: ${w === HUMAN ? 'ganas tú' : 'gana el celular'}`)
        : (w === HUMAN ? '¡Dominaste! 🎉' : 'El celular dominó');
      const detail = reason === 'tranque'
        ? 'Nadie puede jugar. Gana quien tenga menos puntos en la mano.'
        : (w === HUMAN ? 'Te quedaste sin fichas.' : 'El celular se quedó sin fichas.');
      const cpuTiles = g.hands[CPU].map((t) => tileSVG(t.a, t.b, true)).join('');
      const html = `
        <h2>${title}</h2>
        <p class="sub">${detail}</p>
        ${cpuTiles ? `<p class="hint">Fichas del celular</p><div class="reveal">${cpuTiles}</div>` : ''}
        <table class="tally">
          <tr><td>Puntos en tu mano</td><td>${sums[HUMAN]}</td></tr>
          <tr><td>Puntos en la mano del celular</td><td>${sums[CPU]}</td></tr>
          <tr><td>${w === null ? 'Nadie suma' : (w === HUMAN ? 'Sumas' : 'Suma el celular')}</td><td>+${points}</td></tr>
          <tr><td><b>Marcador</b></td><td>Tú ${g.scores[HUMAN]} · Celular ${g.scores[CPU]}</td></tr>
        </table>`;
      if (matchOver) {
        const won = w === HUMAN;
        showDialog(`
          <div class="logo">${tileSVG(6, 6, true)}</div>
          <h1>${won ? '¡Ganaste la partida!' : 'Ganó el celular'}</h1>
          <p class="big">Tú ${g.scores[HUMAN]} · Celular ${g.scores[CPU]}</p>
          ${html}
          <button class="btn" data-act="new">Jugar otra partida</button>
          <button class="btn secondary" data-act="menu">Menú</button>`);
      } else {
        showDialog(`${html}<button class="btn" data-act="next">Siguiente mano</button>`);
      }
    }, 900);
  }

  /* ================= Renderizado ================= */

  function renderAll() {
    renderScores();
    renderCpu(false);
    renderPool();
    renderBoard();
    renderHand();
  }

  function renderScores() {
    el.scoreMe.textContent = g.scores[HUMAN];
    el.scoreCpu.textContent = g.scores[CPU];
    el.goal.textContent = g.target;
  }

  function renderCpu(reveal) {
    const h = g.hands[CPU];
    el.cpuCount.textContent = h.length;
    el.cpuHand.classList.toggle('revealed', !!reveal);
    el.cpuHand.classList.toggle('crowded', !reveal && h.length > 10);
    el.cpuHand.innerHTML = h.map((t) => `<div class="ctile">${reveal ? tileSVG(t.a, t.b, true) : backSVG()}</div>`).join('');
  }

  function renderPool() {
    el.poolCount.textContent = g.pool.length;
    el.pool.disabled = g.pool.length === 0;
  }

  // Rectángulos que debe abarcar la vista: las fichas y el lugar de la próxima en cada
  // extremo, así la mesa no salta al soltar.
  function boardRects() {
    const rects = board.placed.slice();
    if (board.empty) rects.push({ x: -1.5, y: -1.5, w: 3, h: 3 });
    else {
      for (const side of ['L', 'R']) {
        const v = board.endValue(side);
        rects.push(board.plan({ a: v, b: (v + 1) % 7 }, side));
      }
    }
    return rects;
  }

  // Solo para la mesa 2D: escala y desplazamiento para pasar de unidades a píxeles.
  function computeLayout(rects) {
    const bw = el.board.clientWidth;
    const bh = el.board.clientHeight;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    }
    const pad = 12;
    const unit = Math.max(8, Math.min((bw - 2 * pad) / (maxX - minX), (bh - 2 * pad) / (maxY - minY), 34, bw / 9));
    layout = {
      unit,
      ox: bw / 2 - ((minX + maxX) / 2) * unit,
      oy: bh / 2 - ((minY + maxY) / 2) * unit,
    };
  }

  function placeRect(node, r) {
    const u = layout.unit;
    node.style.left = `${layout.ox + r.x * u}px`;
    node.style.top = `${layout.oy + r.y * u}px`;
    node.style.width = `${r.w * u}px`;
    node.style.height = `${r.h * u}px`;
  }

  function renderBoard() {
    const rects = boardRects();
    const frag = document.createDocumentFragment();
    if (view3d) {
      view3d.sync(board.placed, rects);
    } else {
      computeLayout(rects);
      for (const p of board.placed) {
        const d = document.createElement('div');
        d.className = 'placed';
        d.innerHTML = tileSVG(p.first, p.second, p.vertical);
        placeRect(d, p);
        frag.appendChild(d);
      }
    }
    if (board.empty) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = g && g.phase === 'play' && g.turn === HUMAN ? 'Arrastra tu ficha aquí' : '';
      frag.appendChild(hint);
    }
    el.boardInner.replaceChildren(frag);
    clearGhosts();
  }

  // from: { world, rotY } (ficha 3D que se arrastraba) o un rectángulo de pantalla
  // { left, top, width, height, vertical } (la mano o la zona del celular).
  function animateLastTile(from) {
    if (view3d) {
      if (from && from.world) view3d.animateLast(from);
      else if (from) view3d.animateLast({ screen: { x: from.left + from.width / 2, y: from.top + from.height / 2 }, vertical: from.vertical });
      else view3d.animateLast(null);
      return;
    }
    const all = el.boardInner.querySelectorAll('.placed');
    const node = all[all.length - 1];
    if (!node) return;
    if (!from || from.world || !node.animate) { node.classList.add('pop'); return; }
    const to = node.getBoundingClientRect();
    const p = board.placed[board.placed.length - 1];
    const rotate = from.vertical !== p.vertical;
    const fromLong = Math.max(from.width, from.height);
    const toLong = Math.max(to.width, to.height) || 1;
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    node.animate([
      { transform: `translate(${dx}px, ${dy}px) rotate(${rotate ? 90 : 0}deg) scale(${fromLong / toLong})` },
      { transform: 'none' },
    ], { duration: 320, easing: 'cubic-bezier(.2,.8,.25,1)' });
  }

  function renderHand() {
    const tiles = g.hands[HUMAN];
    const n = tiles.length;
    const perRow = n <= 10 ? Math.max(n, 7) : Math.ceil(n / 2);
    const avail = (el.hand.clientWidth || window.innerWidth) - 16;
    const tw = Math.floor(Math.max(24, Math.min(54, window.innerHeight * 0.075, (avail - 6 * (perRow - 1)) / perRow)));
    document.documentElement.style.setProperty('--tw', `${tw}px`);
    const active = g.phase === 'play' && g.turn === HUMAN;
    const playable = new Set(active ? legalMoves(HUMAN).map((m) => m.tile.id) : []);
    el.hand.innerHTML = tiles.map((t) => {
      const cls = ['htile'];
      if (active && settings.hints && !playable.has(t.id)) cls.push('dim');
      if (selected && selected.id === t.id) cls.push('selected');
      return `<div class="${cls.join(' ')}" data-id="${t.id}">${tileSVG(t.a, t.b, true)}</div>`;
    }).join('');
  }

  function setMsg(text) { el.msg.textContent = text; }

  let toastTimer = 0;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1400);
  }

  /* ================= Arrastrar y soltar ================= */

  let drag = null;
  let selected = null; // ficha elegida con un toque cuando cabe en ambos extremos
  let ghosts = []; // mesa 2D: { side, node }. En 3D los recuadros los maneja view3d.

  // Muestra dónde cabría la ficha (recuadros iluminados).
  function showGhosts(t, sides) {
    clearGhosts();
    if (view3d) {
      view3d.showGhosts(sides.map((side) => ({ side, plan: board.plan(t, side) })));
      return;
    }
    for (const side of sides) {
      const d = document.createElement('div');
      d.className = 'ghost';
      d.dataset.side = side;
      placeRect(d, board.plan(t, side));
      el.boardInner.appendChild(d);
      ghosts.push({ side, node: d });
    }
  }

  function clearGhosts() {
    if (view3d) view3d.clearGhosts();
    for (const gh of ghosts) gh.node.remove();
    ghosts = [];
  }

  // Extremo ('L' o 'R') cuyo recuadro está más cerca del punto de la pantalla.
  function nearestGhost(x, y, maxDist = Infinity) {
    if (view3d) return view3d.nearestGhost(x, y, maxDist);
    let best = null;
    let bestD = maxDist;
    for (const gh of ghosts) {
      const r = gh.node.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
      if (d < bestD) { bestD = d; best = gh.side; }
    }
    return best;
  }

  function setHot(side) {
    if (view3d) view3d.setHot(side);
    for (const gh of ghosts) gh.node.classList.toggle('hot', gh.side === side);
  }

  function canAct() {
    return g && g.phase === 'play' && g.turn === HUMAN && el.overlay.hidden;
  }

  function clearSelection() {
    selected = null;
    clearGhosts();
    el.hand.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
  }

  el.hand.addEventListener('pointerdown', (e) => {
    sound.unlock();
    const node = e.target.closest('.htile');
    if (!node || drag) return;
    if (!canAct()) {
      if (g && g.phase === 'play') toast('Espera tu turno');
      return;
    }
    const t = g.hands[HUMAN].find((x) => x.id === node.dataset.id);
    const sides = sidesFor(t);
    if (!sides.length) {
      node.classList.remove('shake');
      void node.offsetWidth;
      node.classList.add('shake');
      if (g.mustPlay) toast('Debes salir con la ficha indicada');
      else if (!legalMoves(HUMAN).length) toast(g.pool.length ? 'Roba del pozo' : 'Toca «Pasar»');
      else toast('Esa ficha no entra');
      buzz(30);
      return;
    }
    e.preventDefault();
    drag = { t, node, sides, x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId, float: null };
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) return;
      drag.moved = true;
      clearSelection();
      const r = drag.node.getBoundingClientRect();
      const f = document.createElement('div');
      f.className = 'floating';
      const w = r.width * 1.15;
      f.style.width = `${w}px`;
      f.style.height = `${w * 2}px`;
      f.innerHTML = tileSVG(drag.t.a, drag.t.b, true);
      document.body.appendChild(f);
      drag.float = f;
      drag.w = w;
      drag.node.classList.add('lifted');
      showGhosts(drag.t, drag.sides);
    }
    moveFloat(e.clientX, e.clientY);
  });

  function moveFloat(x, y) {
    const f = drag.float;
    // La ficha va un poco por encima del dedo para que se vea.
    f.style.left = `${x - drag.w / 2}px`;
    f.style.top = `${y - drag.w * 1.6}px`;
    const overBoard = y < el.hand.getBoundingClientRect().top;
    const hot = overBoard ? nearestGhost(x, y - drag.w * 0.6) : null;
    setHot(hot);
    drag.hot = hot;
    if (view3d) {
      // Sobre la mesa, la ficha pasa a ser 3D y gira hacia el extremo donde caería.
      f.style.visibility = overBoard ? 'hidden' : '';
      if (overBoard) view3d.hoverAt(drag.t, x, y - drag.w * 0.9, hot);
      else view3d.hoverHide();
    }
  }

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      if (!cancelled) tapTile(d);
      return;
    }
    const fr = d.float.getBoundingClientRect();
    const from3d = view3d ? view3d.hoverEnd() : null;
    d.float.remove();
    d.node.classList.remove('lifted');
    clearGhosts();
    if (!cancelled && d.hot) {
      doPlay(HUMAN, d.t, d.hot, from3d || { left: fr.left, top: fr.top, width: fr.width, height: fr.height, vertical: true });
    }
  }

  window.addEventListener('pointerup', (e) => endDrag(e, false));
  window.addEventListener('pointercancel', (e) => endDrag(e, true));

  function tapTile(d) {
    if (d.sides.length === 1) {
      clearSelection();
      const r = d.node.getBoundingClientRect();
      doPlay(HUMAN, d.t, d.sides[0], { left: r.left, top: r.top, width: r.width, height: r.height, vertical: true });
      return;
    }
    if (selected && selected.id === d.t.id) { clearSelection(); return; }
    clearSelection();
    selected = d.t;
    d.node.classList.add('selected');
    showGhosts(d.t, d.sides);
    setMsg('Cabe en los dos extremos: toca dónde ponerla.');
  }

  el.board.addEventListener('click', (e) => {
    if (!selected || !canAct()) return;
    if (view3d && view3d.wasDragged()) return; // fue un giro de la mesa, no un toque
    const side = view3d
      ? nearestGhost(e.clientX, e.clientY, 90)
      : e.target.closest('.ghost')?.dataset.side;
    if (side) {
      const t = selected;
      const node = el.hand.querySelector(`[data-id="${t.id}"]`);
      const r = node ? node.getBoundingClientRect() : null;
      clearSelection();
      doPlay(HUMAN, t, side, r && { left: r.left, top: r.top, width: r.width, height: r.height, vertical: true });
    } else {
      clearSelection();
      promptHuman();
    }
  });

  el.pool.addEventListener('click', () => { sound.unlock(); humanDraw(); });
  el.passBtn.addEventListener('click', () => { sound.unlock(); humanPass(); });
  el.menuBtn.addEventListener('click', () => { sound.unlock(); showMenu(); });

  /* ================= Menús ================= */

  function showDialog(html) {
    el.card.innerHTML = html;
    el.overlay.hidden = false;
  }
  function hideDialog() { el.overlay.hidden = true; }

  function seg(name, options, value) {
    return `<div class="seg" data-setting="${name}">${options.map(([v, text]) =>
      `<button type="button" data-value="${v}" class="${String(v) === String(value) ? 'on' : ''}">${text}</button>`).join('')}</div>`;
  }

  function settingsHTML() {
    return `
      <div class="field"><label>Dificultad del celular</label>
        ${seg('level', [['facil', 'Fácil'], ['normal', 'Normal'], ['dificil', 'Difícil']], settings.level)}</div>
      <div class="field"><label>Puntos para ganar (partida nueva)</label>
        ${seg('target', [[50, '50'], [100, '100'], [150, '150'], [200, '200']], settings.target)}</div>
      <div class="field"><label>Mesa</label>
        ${seg('view', [['3d', '3D'], ['2d', '2D']], settings.view)}</div>
      <div class="field"><label>Opciones</label>
        ${seg('sound', [[true, '🔊 Sonido'], [false, '🔇 Silencio']], settings.sound)}
        <div style="height:6px"></div>
        ${seg('hints', [[true, 'Resaltar jugadas'], [false, 'Sin ayudas']], settings.hints)}</div>`;
  }

  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function showStart() {
    const canResume = g && (g.phase === 'play' || g.phase === 'roundEnd');
    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showDialog(`
      <div class="logo">${tileSVG(5, 3, true)}${tileSVG(6, 6, true)}${tileSVG(2, 4, true)}</div>
      <h1>Dominó</h1>
      <p class="sub">Tú contra el celular</p>
      ${canResume ? '<button class="btn" data-act="resume">Continuar partida</button>' : ''}
      <button class="btn ${canResume ? 'secondary' : ''}" data-act="new">Nueva partida</button>
      ${settingsHTML()}
      <button class="btn secondary" data-act="rules">Cómo se juega</button>
      ${!isStandalone() && installEvent ? '<button class="btn secondary" data-act="install">📲 Instalar en el celular</button>' : ''}
      ${!isStandalone() && !installEvent ? `<p class="hint">${iOS
        ? 'Para instalarlo: botón Compartir → «Agregar a pantalla de inicio».'
        : 'Para instalarlo: menú ⋮ del navegador → «Instalar app» o «Agregar a pantalla principal».'}</p>` : ''}
    `);
  }

  const showMenu = () => showStart();

  function showRules() {
    showDialog(`
      <h2>Cómo se juega</h2>
      <ul class="rules">
        <li>Se juega con las 28 fichas del doble seis. Cada uno recibe 7; el resto queda en el <b>pozo</b>.</li>
        <li>En la primera mano sale quien tenga el doble más alto. Después, sale quien ganó la mano anterior.</li>
        <li><b>Arrastra</b> una ficha de tu mano hasta un extremo de la mesa (se ilumina dónde cabe). También puedes tocarla.</li>
        <li>Si no tienes jugada, toca el pozo para robar hasta que puedas jugar. Si el pozo se acaba, pasas.</li>
        <li>Gana la mano quien se quede sin fichas (<b>dominó</b>) y suma los puntos de la mano del rival.</li>
        <li>Si nadie puede jugar (<b>tranque</b>), gana quien tenga menos puntos y suma los del rival.</li>
        <li>Gana la partida el primero en llegar a la meta.</li>
      </ul>
      <button class="btn" data-act="back">Volver</button>`);
  }

  el.card.addEventListener('click', async (e) => {
    const s = e.target.closest('.seg button');
    if (s) {
      const name = s.parentElement.dataset.setting;
      let v = s.dataset.value;
      if (name === 'target') v = Number(v);
      if (name === 'sound' || name === 'hints') v = v === 'true';
      settings[name] = v;
      saveSettings();
      s.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === s));
      if (name === 'hints' && g) renderHand();
      if (name === 'sound' && v) { sound.unlock(); sound.clack(); }
      if (name === 'view') {
        // Cambiar de mesa recarga la app; la partida en curso está guardada.
        save();
        location.reload();
      }
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    sound.unlock();
    switch (b.dataset.act) {
      case 'resume':
        hideDialog();
        if (g.phase === 'roundEnd') newRound();
        break;
      case 'new': hideDialog(); newMatch(); break;
      case 'next': hideDialog(); newRound(); break;
      case 'menu': showStart(); break;
      case 'rules': showRules(); break;
      case 'back': showStart(); break;
      case 'install':
        if (installEvent) {
          installEvent.prompt();
          try { await installEvent.userChoice; } catch { /* nada */ }
          installEvent = null;
          showStart();
        }
        break;
      default: break;
    }
  });

  /* ================= Inicio ================= */

  let lastHalfW = null;
  const ro = new ResizeObserver(() => {
    if (!g || !board) return;
    if (view3d) view3d.resize();
    const hw = halfWidthForBoard();
    if (hw !== lastHalfW) {
      lastHalfW = hw;
      board = Board.replay(hw, board.moves);
    }
    const keepSel = selected;
    renderBoard();
    renderHand();
    if (keepSel) showGhosts(keepSel, sidesFor(keepSel));
  });
  ro.observe(el.board);

  function boot() {
    if (settings.view !== '2d' && window.Board3D) {
      view3d = window.Board3D.create(el.board);
      if (view3d) el.board.classList.add('is3d');
    }
    if (load()) {
      lastHalfW = board.halfW;
      renderAll();
      if (g.phase === 'roundEnd') setMsg('Mano terminada.');
      else if (g.turn === CPU) cpuTurn();
      else promptHuman();
    } else {
      // Mesa de muestra detrás del menú inicial.
      g = { scores: [0, 0], target: settings.target, hands: [[], []], pool: [], phase: 'idle', turn: HUMAN, lacks: [[], []] };
      board = new Board(halfWidthForBoard());
      renderAll();
      setMsg('');
    }
    showStart();
  }

  // Exponer para pruebas automáticas.
  window.__domino = { get state() { return g; }, get board() { return board; }, legalMoves, newMatch };

  boot();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo offline */ });
    });
  }
})();

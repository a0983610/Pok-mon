// 模擬 AI 的選擇邏輯：比強弱（vs）、和「老師」比對找出快速模式選錯的地方（diff）。改進 js/engine/sim.js 的決策
// （simDecide 往前算一回合＝快速、simSearch 樹搜尋、simGreedyAct／simGreedyPick 簡單規則）用；不需要 Showdown。
// 用法（在 repo 根目錄）：
//   node tools/sim_ai.js vs 決策A 決策B [組數 200] [種子 7] [排名前幾名 60]
//     隨機兩隊（單打排名前幾名，各 3 隻、同家族不重複、超級進化最多 1 隻；配招照 OP.GG 預設、道具同一隊不重複＝simItems；先發是第一隻），
//     每組打兩場：A 當第 0 方、B 當第 1 方，再交換決策打一次（兩場同一組亂數），印 A 的得分率（贏 1、平手 0.5）與標準誤。
//     兩邊的決策一模一樣時每組正好 50%（拿來檢查工具本身、或確認改動沒有改到選擇）。
//   node tools/sim_ai.js diff 輸出檔 [場數 100] [老師 tree:800] [種子 7] [排名前幾名 60]
//     雙方都用目前的快速（ply1）打（組隊同 vs），每次要選擇（出招、補位）時也讓老師在同一個局面算一次（老師不影響這場怎麼打）。
//     輸出檔每行一筆 JSON：type 'dec' 一方的一次選擇（局面、選項、快速和老師的出法比例、各選項在老師評分下的分數、
//     regret＝照老師的評分，快速的出法比老師的少拿多少分（0～1，1＝整場勝負））；type 'game' 一場（雙方隊伍、勝負、逐回合紀錄）。
//     最後印 regret 的分布、「快速最常選的 → 老師最常選的」各類合計、regret 最大的幾筆。
// 決策寫法：ply1（往前算一回合，simDecide）、tree:800（樹搜尋 800 次，simSearch）；前面加「git 版本@」用那個版本的引擎與資料
// （例如 HEAD@ply1：改 sim.js 前後比強弱）。對打的規則（simTurn 等）一律用目前的檔案，只有選擇（含打完換人換誰）用各自的引擎。
const fs = require('fs'), vm = require('vm'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const R = path.resolve(__dirname, '..');
const FILES = ['base-stats.js', 'mons-data.js', 'js/engine/core.js', 'js/engine/roles.js', 'js/engine/damage.js', 'js/engine/sim.js'];
const NAMES = ['MONS', 'MON', 'MOVES', 'SIM_MAX_TURN', 'simMon', 'simItems', 'simStart', 'simTurn', 'simReplace', 'simOver', 'simNeed', 'simWinner',
  'simCtx', 'simDecide', 'simSearch', 'simGreedyPick', 'simRng', 'simKey', 'simBaseKey'];
// 各方決策用的亂數（和打的亂數分開，兩場交換決策時同一方的亂數不變）
const SALT = [0x5bd1e995, 0x27d4eb2f, 0x165667b1];

// ---------- 載入引擎 ----------
// 原始碼：ref＝git 版本（空字串＝目前的檔案）；主程式讀好傳給 worker
const srcOf = ref => FILES.map(f => ref ? execFileSync('git', ['show', `${ref}:${f}`], { cwd: R, encoding: 'utf8', maxBuffer: 1 << 28 }) : fs.readFileSync(path.join(R, f), 'utf8'));
const engines = new Map();
function engine(ref = '') {
  if (engines.has(ref)) return engines.get(ref);
  const src = (!isMainThread && workerData.src[ref]) || srcOf(ref), g = { console };
  vm.createContext(g);
  vm.runInContext(src.join('\n;\n') + `\n;globalThis.E = { ${NAMES.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} };`, g);
  engines.set(ref, g.E);
  return g.E;
}
// 決策：spec 見檔案開頭；decide(ctx, st, phase, rnd, stats) 回傳 [第 0 方, 第 1 方] 的選擇（stats＝附上根節點的評分，見 simDecide／simSearch）
function decider(spec) {
  const at = spec.lastIndexOf('@'), ref = at >= 0 ? spec.slice(0, at) : '', [algo, n] = spec.slice(at + 1).split(':');
  if (algo !== 'ply1' && algo !== 'tree') throw new Error(`看不懂的決策「${spec}」：寫 ply1、tree:800，或前面加 git 版本@（例如 HEAD@ply1）`);
  const E = engine(ref);
  return { spec, ref, algo, E, decide: algo === 'tree' ? (ctx, st, phase, rnd, stats) => E.simSearch(ctx, st, phase, +n || 200, rnd, stats)
    : (ctx, st, phase, rnd, stats) => E.simDecide(ctx, st, phase, rnd, stats) };
}

// ---------- 組隊、打一場 ----------
// n 組隨機兩隊（寶可夢 key，先發排第一）
function teams(n, seed, top) {
  const E = engine(), rnd = E.simRng(seed), pickOf = xs => xs[Math.floor(rnd() * xs.length)];
  const pool = E.MONS.filter(m => m.rank.s > 0 && m.rank.s <= top).map(m => m.key), fam = k => E.MON[k].base || k;
  const one = () => {
    const T = [];
    while (T.length < 3) { const k = pickOf(pool); if (!T.some(x => fam(x) === fam(k)) && !(E.MON[k].base && T.some(x => E.MON[x].base))) T.push(k); }
    return T;
  };
  return Array.from({ length: n }, (_, id) => ({ id, T: [one(), one()], seed: seed * 100000 + id }));
}
// 打一場（同 simPlay，但雙方的選擇由 mk(st) 給的 decide(phase)、pick 決定）：T＝[第 0 方, 第 1 方] 的寶可夢 key
function play(T, seed, log, mk) {
  const E = engine(), rnd = E.simRng(seed), rctx = E.simCtx('s');
  const st = E.simStart(T.map((keys, s) => { const items = E.simItems(keys, 's'); return { mons: keys.map((k, j) => E.simMon(k, undefined, items[j], s, 's')) }; }), log);
  const { decide, pick } = mk(st);
  while (!E.simOver(st) && st.turn < E.SIM_MAX_TURN) {
    E.simTurn(rctx, st, decide('turn'), rnd, 0, pick);
    while (!E.simOver(st) && (E.simNeed(st, 0) || E.simNeed(st, 1))) E.simReplace(st, decide('replace'), rnd);
  }
  return { w: E.simWinner(st), turns: st.turn, log: st.log };
}
// vs：第 s 方用 D[s] 選（各自的計算快取與亂數；打完換人換誰也用自己的簡單規則）
const mkVs = (D, seed) => st => {
  const ctx = D.map(d => d.E.simCtx('s')), rnd = [0, 1].map(s => engine().simRng(seed ^ SALT[s]));
  return { decide: phase => [0, 1].map(s => D[s].decide(ctx[s], st, phase, rnd[s])[s]), pick: (c, s, hit) => D[s].E.simGreedyPick(ctx[s], c, s, hit) };
};

// ---------- diff：快速和老師比對 ----------
const r3 = x => Math.round(x * 1000) / 1000;
const kindOf = (E, o) => o.t === 'sw' ? '換人' : o.t === 'mv' ? (E.MOVES[o.k]?.[2] === 'status' ? '輔助' : '攻擊') : o.t;
const labelOf = (E, st, s, o) => o.t === 'mv' ? E.MOVES[o.k]?.[0] || o.k : o.t === 'sw' ? '換' + E.MON[E.simBaseKey(st.sd[s].mons[o.i])].zh : o.t;
const monSum = (E, M) => {
  const b = Object.fromEntries(Object.entries(M.st).filter(([, v]) => v)), v = Object.keys(M.v).filter(k => M.v[k]);
  return { zh: E.MON[E.simBaseKey(M)].zh, hp: Math.round(Math.max(0, M.hp) / M.max * 100), ...(M.status && { stt: M.status }), ...(Object.keys(b).length && { b }),
    ...(v.length && { v }), it: M.item || '', ab: M.b.ab, mv: M.moves.map(k => E.MOVES[k]?.[0] || k) };
};
const sideSum = (E, st, s) => {
  const x = st.sd[s], haz = Object.fromEntries(Object.entries(x.haz).filter(([, v]) => v));
  return { act: x.act, mons: x.mons.map(M => monSum(E, M)), ...(Object.keys(haz).length && { haz }), ...(Object.keys(x.scr).length && { scr: x.scr }) };
};
// 第 s 方各選項對「對手照 p 出」的分數（我方角度 0～1）：v＝[第 0 方選項][第 1 方選項] 的分數（第 0 方角度）
const rowVal = (v, s, p) => s === 0 ? v.map(r => r.reduce((t, x, j) => t + x * p[j], 0)) : v[0].map((_, j) => 1 - v.reduce((t, r, i) => t + r[j] * p[i], 0));
// 一次選擇：S＝快速的 stats（v 是 simValue，換成 0～1）、Tt＝老師的 stats；雙方各自有 2 個以上選項的記一筆
function compare(st, phase, S, Tt, teach, g, out) {
  const E = engine(), sv0 = S.v.map(r => r.map(x => (x + 1.5) / 3)), tv0 = teach.algo === 'ply1' ? Tt.v.map(r => r.map(x => (x + 1.5) / 3)) : Tt.v;
  for (const s of [0, 1]) {
    const opts = S.opts[s];
    if (opts.length < 2) continue;
    const keys = opts.map(E.simKey), tk = Tt.opts[s].map(E.simKey), at = keys.map(k => tk.indexOf(k));
    if (at.includes(-1) || tk.length !== keys.length) { out.push({ type: 'skip', g, turn: st.turn + 1, s, why: '老師的選項和快速的對不起來', keys, tk }); continue; }
    const tvAll = rowVal(tv0, s, Tt.p[1 - s]), tv = at.map(i => tvAll[i]), q = at.map(i => Tt.p[s][i]), p = S.p[s];
    const sv = rowVal(sv0, s, S.p[1 - s]), tn = at.map(i => s === 0 ? Tt.n?.[i].reduce((a, x) => a + x, 0) : Tt.n?.reduce((a, r) => a + r[i], 0));
    const dot = (a, b) => a.reduce((t, x, i) => t + x * b[i], 0), top = xs => xs.indexOf(Math.max(...xs));
    out.push({ type: 'dec', g, turn: st.turn + 1, phase, s, me: sideSum(E, st, s), opp: sideSum(E, st, 1 - s),
      ...((st.wx || st.ter || st.troom) && { fld: { wx: st.wx, ter: st.ter, troom: st.troom } }),
      opts: opts.map(o => labelOf(E, st, s, o)), kinds: opts.map(o => kindOf(E, o)), p: p.map(r3), q: q.map(r3), tv: tv.map(r3), sv: sv.map(r3),
      ...(Tt.n && { tn }), top: [top(p), top(q)], regret: r3(dot(q, tv) - dot(p, tv)) });
  }
}
const mkDiff = (S, teach, seed, g, out) => st => {
  const sctx = S.E.simCtx('s'), tctx = teach.E.simCtx('s'), srnd = engine().simRng(seed ^ SALT[0]), trnd = engine().simRng(seed ^ SALT[2]);
  return {
    decide: phase => {
      const a = S.decide(sctx, st, phase, srnd, true);
      if (a.stats) compare(st, phase, a.stats, teach.decide(tctx, st, phase, trnd, true).stats, teach, g, out);
      return [a[0], a[1]];
    },
    pick: (c, s, hit) => S.E.simGreedyPick(sctx, c, s, hit)
  };
};

// ---------- worker：收到一組，打完回傳 ----------
if (!isMainThread) {
  const { mode, specs } = workerData, D = specs.map(decider);
  parentPort.on('message', c => {
    if (mode === 'vs') {
      // 第一場 A 是第 0 方，第二場交換；A 的分數：贏 1、平手 0.5
      const g = [[D[0], D[1]], [D[1], D[0]]].map(pair => play(c.T, c.seed, false, mkVs(pair, c.seed)));
      const scA = [g[0].w === 0 ? 1 : g[0].w === 1 ? 0 : 0.5, g[1].w === 1 ? 1 : g[1].w === 0 ? 0 : 0.5];
      parentPort.postMessage({ id: c.id, sc: scA, turns: g.map(x => x.turns) });
    } else {
      const out = [], E = engine(), r = play(c.T, c.seed, true, mkDiff(D[0], D[1], c.seed, c.id, out));
      out.push({ type: 'game', g: c.id, T: c.T.map(ks => ks.map(k => E.MON[k].zh)), w: r.w, turns: r.turns, log: r.log });
      parentPort.postMessage({ id: c.id, out });
    }
  });
} else main().catch(e => { console.error(e); process.exit(1); });

// 分給 worker_threads，每組回來呼叫 got
async function runAll(mode, specs, cases, got) {
  const refs = [...new Set(specs.map(sp => { const at = sp.lastIndexOf('@'); return at >= 0 ? sp.slice(0, at) : ''; }))];
  const src = Object.fromEntries(refs.map(ref => [ref, srcOf(ref)]));
  specs.forEach(decider);  // 先在主程式檢查寫法、版本讀得到
  const nw = Math.max(1, Math.min(os.cpus().length - 1, cases.length)), t0 = Date.now();
  let next = 0, done = 0, shown = Date.now();
  await new Promise(resolve => {
    for (let i = 0; i < nw; i++) {
      const w = new Worker(__filename, { workerData: { mode, specs, src } });
      const give = () => { if (next < cases.length) w.postMessage(cases[next++]); else w.terminate(); };
      w.on('message', m => {
        got(m);
        if (++done === cases.length) resolve();
        if (Date.now() - shown > 30000) { shown = Date.now(); console.log(`  ${done}／${cases.length}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`); }
        give();
      });
      w.on('error', e => { console.error(e); process.exit(1); });
      give();
    }
  });
  return (Date.now() - t0) / 1000;
}

async function main() {
  const [mode, ...a] = process.argv.slice(2);
  if (mode === 'vs') {
    const [A, B] = a, [N, SEED, TOP] = [+(a[2] || 200), +(a[3] || 7), +(a[4] || 60)];
    if (!A || !B) throw new Error('用法：node tools/sim_ai.js vs 決策A 決策B [組數 200] [種子 7] [排名前幾名 60]');
    const cases = teams(N, SEED, TOP), sc = [], turns = [];
    console.log(`A＝${A}、B＝${B}：單打前 ${TOP} 名隨機兩隊 ${N} 組，每組交換決策各打一場`);
    const sec = await runAll('vs', [A, B], cases, m => { sc.push((m.sc[0] + m.sc[1]) / 2); turns.push(...m.turns); });
    const all = sc.length, mean = sc.reduce((t, x) => t + x, 0) / all, sd = Math.sqrt(sc.reduce((t, x) => t + (x - mean) ** 2, 0) / Math.max(1, all - 1));
    const res = { win: 0, lose: 0, draw: 0 };
    sc.forEach(x => { res[x > 0.5 ? 'win' : x < 0.5 ? 'lose' : 'draw']++; });
    console.log(`A 得分率 ${(mean * 100).toFixed(1)}% ± ${(sd / Math.sqrt(all) * 100).toFixed(1)}（標準誤）；兩場合計 A 較好 ${res.win} 組、B 較好 ${res.lose} 組、平分 ${res.draw} 組；` +
      `平均 ${(turns.reduce((t, x) => t + x, 0) / turns.length).toFixed(1)} 回合（${sec.toFixed(0)} 秒）`);
  } else if (mode === 'diff') {
    const OUT = a[0], [N, TEACH, SEED, TOP] = [+(a[1] || 100), a[2] || 'tree:800', +(a[3] || 7), +(a[4] || 60)];
    if (!OUT) throw new Error('用法：node tools/sim_ai.js diff 輸出檔 [場數 100] [老師 tree:800] [種子 7] [排名前幾名 60]');
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    const fd = fs.openSync(OUT, 'w'), decs = [];
    let skip = 0;
    console.log(`快速（ply1）對打 ${N} 場（單打前 ${TOP} 名隨機兩隊），老師＝${TEACH}，紀錄寫到 ${OUT}`);
    const sec = await runAll('diff', ['ply1', TEACH], teams(N, SEED, TOP), m => {
      fs.writeSync(fd, m.out.map(x => JSON.stringify(x)).join('\n') + '\n');
      m.out.forEach(x => { if (x.type === 'dec') decs.push(x); else if (x.type === 'skip') skip++; });
    });
    fs.closeSync(fd);
    summary(decs, skip, sec);
  } else throw new Error('用法見 tools/sim_ai.js 開頭：vs 或 diff');
}

// diff 的摘要：regret 分布、「快速最常選的種類 → 老師最常選的種類」合計、regret 最大的幾筆
function summary(decs, skip, sec) {
  const n = decs.length, avg = xs => xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length), pct = x => (x / Math.max(1, n) * 100).toFixed(1) + '%';
  const diffTop = decs.filter(d => d.top[0] !== d.top[1]).length;
  console.log(`\n${n} 次選擇（出招 ${decs.filter(d => d.phase === 'turn').length}、補位 ${decs.filter(d => d.phase === 'replace').length}${skip ? `、對不起來略過 ${skip}` : ''}；${sec.toFixed(0)} 秒）`);
  console.log(`最常選的和老師不同 ${diffTop}（${pct(diffTop)}）；regret 平均 ${avg(decs.map(d => d.regret)).toFixed(4)}；` +
    [0.02, 0.05, 0.1].map(t => `> ${t}：${decs.filter(d => d.regret > t).length}`).join('、'));
  const by = new Map();
  decs.filter(d => d.regret > 0.02).forEach(d => { const k = `${d.kinds[d.top[0]]} → ${d.kinds[d.top[1]]}`, e = by.get(k) || { n: 0, r: 0 }; e.n++; e.r += d.regret; by.set(k, e); });
  console.log('regret > 0.02 的（快速最常選的種類 → 老師最常選的種類）：');
  [...by].sort((x, y) => y[1].r - x[1].r).forEach(([k, e]) => console.log(`  ${k}：${e.n} 次，regret 合計 ${e.r.toFixed(2)}、平均 ${(e.r / e.n).toFixed(3)}`));
  console.log('regret 最大的 10 筆：');
  decs.slice().sort((x, y) => y.regret - x.regret).slice(0, 10).forEach(d => {
    const me = d.me.mons[d.me.act], op = d.opp.mons[d.opp.act];
    console.log(`  #${d.g} 第 ${d.turn} 回合${d.phase === 'replace' ? '補位' : ''} 第 ${d.s} 方 ${me.zh}(${me.hp}%) vs ${op.zh}(${op.hp}%)：快速 ${d.opts[d.top[0]]} → 老師 ${d.opts[d.top[1]]}，regret ${d.regret}`);
  });
}

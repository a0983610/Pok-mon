// 計算引擎：資料與純邏輯，不碰 DOM（畫面在 js/ui/）
// ---------- 考試出題 ----------
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function weighted(entries, rng) {
  let r = rng() * entries.reduce((s, e) => s + e[1], 0);
  for (const [v, w] of entries) if ((r -= w) < 0) return v;
  return entries[entries.length - 1][0];
}

// 依倍率分桶，出題時先抽倍率再抽組合，避免一堆 ×1
const POOL1 = {}, POOL2 = {};
IDS.forEach(a => {
  IDS.forEach(d => (POOL1[eff(a, [d])] ||= []).push([a, d]));
  DUALS.forEach(([d1, d2]) => (POOL2[eff(a, [d1, d2])] ||= []).push([a, d1, d2]));
});
const W1 = [[0, 12], [0.5, 30], [1, 23], [2, 35]];
const W2 = [[0, 10], [0.25, 12], [0.5, 22], [1, 18], [2, 22], [4, 16]];

const KINDS = {
  mult1:  { label: '單屬性倍率', eg: '火 → 草 = ?' },
  mult2:  { label: '雙屬性倍率', eg: '火 → 草/鋼 = ?' },
  weak:   { label: '找弱點',     eg: '誰打牠效果絕佳' },
  hit:    { label: '攻擊克制',   eg: '火 剋誰' },
  resist: { label: '找抵抗',     eg: '誰打牠不痛' },
  cover:  { label: '配招缺口',   eg: '這組招式打不動誰' },
  count:  { label: '弱點數量',   eg: '牠怕幾種屬性' },
};

function makeQuestion(kind, rng = Math.random) {
  if (kind === 'mult1') {
    const m = weighted(W1, rng), [a, d] = pick(POOL1[m], rng);
    return { kind, key: `${kind}:${a}>${d}`, atk: a, defs: [d], answer: m, options: [0, 0.5, 1, 2] };
  }
  if (kind === 'mult2') {
    const m = weighted(W2, rng), [a, d1, d2] = pick(POOL2[m], rng);
    return { kind, key: `${kind}:${a}>${d1}/${d2}`, atk: a, defs: [d1, d2], answer: m, options: [0, 0.25, 0.5, 1, 2, 4] };
  }
  if (kind === 'weak' || kind === 'resist') {
    const defs = rng() < 0.5 ? [pick(IDS, rng)] : pick(DUALS, rng).slice();
    const ok = kind === 'weak' ? id => eff(id, defs) >= 2 : id => eff(id, defs) < 1;
    const right = IDS.filter(ok), wrong = IDS.filter(id => !ok(id));
    if (!right.length || wrong.length < 3) return null;
    const ans = pick(right, rng);
    return { kind, key: `${kind}:${defs.join('/')}`, defs, answer: ans, options: shuffle([ans, ...shuffle(wrong, rng).slice(0, 3)], rng) };
  }
  if (kind === 'hit') {
    const a = pick(IDS, rng);
    const right = IDS.filter(d => eff(a, [d]) >= 2), wrong = IDS.filter(d => eff(a, [d]) < 2);
    if (!right.length) return null;
    const ans = pick(right, rng);
    return { kind, key: `${kind}:${a}`, atk: a, answer: ans, options: shuffle([ans, ...shuffle(wrong, rng).slice(0, 3)], rng) };
  }
  if (kind === 'cover') {
    const moves = shuffle(IDS, rng).slice(0, rng() < 0.5 ? 3 : 4);
    const ok = d => bestEff(moves, [d]) < 2;
    const right = IDS.filter(ok), wrong = IDS.filter(d => !ok(d));
    if (!right.length || wrong.length < 3) return null;
    const ans = pick(right, rng);
    return { kind, key: `${kind}:${moves.join('/')}`, moves, answer: ans, options: shuffle([ans, ...shuffle(wrong, rng).slice(0, 3)], rng) };
  }
  if (kind === 'count') {
    const defs = rng() < 0.5 ? [pick(IDS, rng)] : pick(DUALS, rng).slice();
    const n = IDS.filter(a => eff(a, defs) >= 2).length;
    const opts = new Set([n]);
    while (opts.size < 4) { const v = n + Math.floor(rng() * 7) - 3; if (v >= 0) opts.add(v); }
    return { kind, key: `${kind}:${defs.join('/')}`, defs, answer: n, options: [...opts].sort((x, y) => x - y) };
  }
  return null;
}

// 隨機抽題型出題，盡量避開最近出過的題目
function nextQuestion(kinds, recent = [], rng = Math.random) {
  let q = null;
  for (let i = 0; i < 50; i++) {
    const c = makeQuestion(pick(kinds, rng), rng);
    if (!c) continue;
    q = c;
    if (!recent.includes(c.key)) break;
  }
  return q;
}

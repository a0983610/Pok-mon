// ---------- 隊伍分析：整隊模擬（單打 3 對 3 打熱門隊伍）----------
// 對手＝simMetaTeams（單打排名前 SIM_META_N 名各當核心＋OP.GG 隊友名單前 5 隻）。每隊照「出戰選角」的方法：我方帶 simMyPlan 的第 1 名組合與先發，
// 對手照 simOppScenarios（對手看我方 6 隻、用同一套方法選）的前 TSIM_SC 種帶法，各打 TSIM_K 場；雙方用模擬分頁的「快速」（每步把各種出法試算一回合）。
// 換人：每一格拿掉後，隊伍分析的推薦（recommendMon，同「第 N 隻推薦」）前 TSIM_ALT 名（不含被換掉那隻的同家族；配招用預設 defaultSet）換上，打同一批對手。
// 每場的亂數種子照「對手隊伍、帶法排第幾、第幾場」（simHash；背景計算每場開打前 ctx.flip 也歸零）：換人前後同一場用同一組亂數，差值比較準。
// 選角前先把對位勝率（duelVs）還沒算好的交給背景計算（pBg）算完，選角才和「出戰選角」分頁一樣。
// 按「開始評估」才算（使用者選的），結果只放在記憶體；隊伍改過標「結果是改之前的」。背景計算開不起來（file://）在畫面這邊一場一場打。
const TSIM_SC = 3, TSIM_K = 5, TSIM_ALT = 3, TSIM_OPT = { algo: 'ply1' };
// 預估時間用：每個背景計算打一場 3 對 3 約幾毫秒（2026-11-13 實測，i7-14700、Chromium、8 個背景計算：打的階段 7030 場 162 秒，約 186 毫秒；
// 加上選角與等對位勝率，全部 8265 場 210 秒）
const TSIM_MS = 200;
// run＝進行中的評估（停止或打完後搬到 res，畫面照同一份資料畫）
const tSim = { run: null, res: null, redraw: 0 };
// 隊伍的簽名（單打雙打、隊員、配招）：結果是不是目前這一隊的
const tSimSig = () => JSON.stringify([team.fmt, team.mons, team.sets]);
const tSimTick = ms => new Promise(r => setTimeout(r, ms || 0));
function tSimStart() {
  const mine = simMine();
  if (tSim.run || team.fmt !== 's' || mine.length < BRING_N.s) return;
  // 換人的候補照按下時的隊伍算（評估中改隊伍不影響這次）
  const snap = { slots: team.slots.map(s => s.slice()), mons: team.mons.slice(), sets: team.sets.slice() }, teams = simMetaTeams('s');
  const adds = snap.slots.some(s => !s.length) ? TSIM_ALT : 0;
  tSim.run = { sig: tSimSig(), teams, vs: [], jobs: [], q: [], wks: [], idle: [], done: 0, total: 0, expect: (1 + adds + mine.length * TSIM_ALT) * teams.length * TSIM_SC * TSIM_K,
    planned: false, stop: false, local: false, timer: 0, draw: 0, wait: false, t0: performance.now(), ctx: null };
  tSim.res = null;
  tSimDraw();
  tSimPlanAll(tSim.run, mine, snap);
}
// 先排原本的隊伍；隊伍還沒滿 6 隻時，第一個空格（沒選屬性的，同隊伍總評的「下一隻建議」）補上推薦的前 TSIM_ALT 名；再一格一格算換人的候補、排換上去的隊伍
async function tSimPlanAll(run, mine, snap) {
  await tSimAdd(run, mine, null);
  const empty = snap.slots.findIndex(s => !s.length);
  if (empty >= 0) for (const k of tSimCands(snap, empty)) {
    if (run.stop) return;
    await tSimAdd(run, [...mine, { key: k, set: defaultSet(k, 's'), slot: empty }].sort((a, b) => a.slot - b.slot), { slot: empty, from: '', to: k });
  }
  for (const x of mine) {
    if (run.stop) return;
    const cands = tSimCands(snap, x.slot);
    await tSimTick();
    for (const k of cands) {
      if (run.stop) return;
      await tSimAdd(run, mine.map(y => y === x ? { key: k, set: defaultSet(k, 's'), slot: x.slot } : y), { slot: x.slot, from: x.key, to: k });
    }
  }
  run.planned = true;
  tSimCheck(run);
}
// 第 slot 格拿掉（空格就是補上）後的推薦前 TSIM_ALT 名（recommendMon，其他格照 snap；不含被換掉那隻的同家族、單打沒排名或沒有預設配招的）
function tSimCands(snap, slot) {
  const members = snap.slots.map((s, i) => [s, i]).filter(([s, i]) => s.length && i !== slot);
  const unit = ([s, i]) => ({ defs: s, atk: attacksOf(snap.mons[i], s, 's', snap.sets[i]), key: snap.mons[i], set: snap.sets[i] });
  const named = members.filter(([, i]) => snap.mons[i]), fam = snap.mons[slot] ? family(MON[snap.mons[slot]]) : null;
  const sets = Object.fromEntries(named.filter(([, i]) => snap.sets[i]).map(([, i]) => [snap.mons[i], snap.sets[i]]));
  return recommendMon(members.map(([s]) => s), [], 's', named.map(([, i]) => snap.mons[i]), members.map(unit), sets)
    .filter(r => family(r.mon) !== fam && r.mon.rank.s && defaultSet(r.mon.key, 's')).slice(0, TSIM_ALT).map(r => r.mon.key);
}
// 加一種隊伍（mine；swap＝{ slot, from, to } 換了哪一格，原本的隊伍是 null）：對每隊對手選好帶法，排進要打的場次
async function tSimAdd(run, mine, swap) {
  const plans = await tSimPlans(run, mine);
  if (!plans) return;
  const v = run.vs.length;
  run.vs.push({ mine, swap, plans, win: [], opp: {} });
  plans.forEach((p, t) => p.scs.forEach((sc, r) => {
    for (let i = 0; i < TSIM_K; i++) {
      run.q.push(run.jobs.length);
      run.jobs.push({ v, t, r, k: (t * TSIM_SC + r) * TSIM_K + i, seed: simHash(JSON.stringify([run.teams[t].keys, r, i])) });
      run.total++;
    }
  }));
  tSimPump(run);
}
// 隊伍 mine 對每隊對手的帶法 [{ my 我方帶出場的, scs 對手前 TSIM_SC 種帶法 }]（對應 run.teams）。對位勝率還沒算好的先交給背景計算，
// 算好再選一次（正面的勝率算好才知道要不要算換上來那場，所以最多重選 2 次）；每 30 毫秒讓畫面喘口氣。停止時回傳 null
async function tSimPlans(run, mine) {
  for (let round = 0; ; round++) {
    const plans = [];
    let t0 = performance.now();
    for (const T of run.teams) {
      if (run.stop) return null;
      const p = simMyPlan(mine, T.keys, 's');
      plans.push({ my: simMySide(mine, p.slots, p.evo, 's'), scs: simOppScenarios(T.keys, mine.map(x => x.key), 's').slice(0, TSIM_SC) });
      if (performance.now() - t0 > 30) { await tSimTick(); t0 = performance.now(); }
    }
    pBgFlush();
    if (!pBgLeft() || round === 2) return plans;
    run.wait = true;
    tSimDraw();
    while (pBgLeft()) { if (run.stop) return null; await tSimTick(300); }
    run.wait = false;
  }
}
// 把排好的場次分給背景計算（開幾個同模擬分頁的 simWkN）；開不了改在畫面這邊打
function tSimPump(run) {
  if (run.stop || !run.q.length) return;
  const n = run.local ? 0 : simWkN();
  if (!n) { if (!run.timer) run.timer = setTimeout(() => tSimLocal(run), 0); return; }
  while (run.wks.length < n) {
    let w;
    try { w = new Worker('js/engine/sim-worker.js'); } catch { tSimFail(run); return; }
    w.cur = -1;
    w.onmessage = e => { w.cur = -1; run.idle.push(w); tSimSave(run, e.data.i, e.data); tSimPump(run); };
    w.onerror = e => { e.preventDefault(); tSimFail(run); };
    run.wks.push(w);
    run.idle.push(w);
  }
  while (run.idle.length && run.q.length) {
    const w = run.idle.pop(), id = run.q.shift(), j = run.jobs[id], p = run.vs[j.v].plans[j.t];
    w.cur = id;
    w.postMessage({ i: id, sides: [{ mons: p.my }, { mons: p.scs[j.r].mons }], opt: TSIM_OPT, log: false, seed: j.seed });
  }
}
// 背景計算不能用：全部停掉，正在打的放回去，改在畫面這邊打
function tSimFail(run) {
  run.wks.forEach(w => { if (w.cur >= 0) run.q.unshift(w.cur); w.terminate(); });
  Object.assign(run, { wks: [], idle: [], local: true });
  tSimPump(run);
}
// 在畫面這邊打：每段約 50 毫秒，打完讓畫面喘口氣
function tSimLocal(run) {
  run.timer = 0;
  run.ctx ||= simCtx('s');
  const t0 = performance.now();
  while (run.q.length && !run.stop && performance.now() - t0 < 50) {
    const id = run.q.shift(), j = run.jobs[id], p = run.vs[j.v].plans[j.t];
    run.ctx.flip = 0;
    tSimSave(run, id, simPlay(run.ctx, [{ mons: p.my }, { mons: p.scs[j.r].mons }], simRng(j.seed), false, TSIM_OPT));
  }
  if (run.q.length && !run.stop) run.timer = setTimeout(() => tSimLocal(run), 0);
}
// 記一場：贏記 1（打滿回合平手、輸記 0，同模擬分頁的勝率）；原本的隊伍另外記對手每隻帶出場的場數、那幾場我方贏幾場、打倒我方幾隻
function tSimSave(run, id, out) {
  const j = run.jobs[id], V = run.vs[j.v], win = out.res > 0 ? 1 : 0;
  V.win[j.k] = win;
  if (!j.v) out.mons[1].forEach(m => { const t = V.opp[m.key] ||= { n: 0, win: 0, kos: 0 }; t.n++; t.win += win; t.kos += m.kos; });
  run.done++;
  tSimCheck(run);
}
// 都排完又都打完（或停止）就結束；不然每秒最多重畫一次卡片
function tSimCheck(run) {
  if (run.stop || run.planned && run.done >= run.total) { tSimEnd(run); return; }
  if (!run.draw) run.draw = setTimeout(() => { run.draw = 0; tSimDraw(); }, 1000);
}
function tSimEnd(run) {
  if (tSim.run !== run) return;
  clearTimeout(run.timer);
  clearTimeout(run.draw);
  run.wks.forEach(w => w.terminate());
  Object.assign(run, { wks: [], idle: [], q: [] });
  tSim.run = null;
  tSim.res = run;
  tSimDraw();
}
// 只重畫這張卡片（在別的分頁時不畫，切回來 renderTeam 會畫）；滑鼠按著時等一下，免得按鈕被換掉沒按到
function tSimDraw() {
  if (curTab !== 'team') return;
  clearTimeout(tSim.redraw);
  if (pBg.down) { tSim.redraw = setTimeout(tSimDraw, 300); return; }
  $('#tSim').innerHTML = tSimHTML();
}
$('#tSim').addEventListener('click', e => {
  const b = e.target.closest('[data-tsim]');
  if (!b) return;
  if (b.dataset.tsim === 'run') tSimStart();
  else if (tSim.run) { tSim.run.stop = true; tSimEnd(tSim.run); }
});
const tSimPct = x => `${Math.round(x * 1000) / 10}%`;
// 勝率 { n 場數, w 贏的場數 }（ks＝場次索引，沒給是全部）
const tSimRate = (V, ks) => (ks || Object.keys(V.win)).reduce((a, k) => V.win[k] == null ? a : { n: a.n + 1, w: a.w + V.win[k] }, { n: 0, w: 0 });
// 換人和原本的隊伍比：兩邊都打完的同一場配對，d＝差值平均、se＝差值的標準誤
function tSimDiff(base, V) {
  const ds = Object.keys(V.win).filter(k => base.win[k] != null).map(k => V.win[k] - base.win[k]), n = ds.length;
  if (!n) return null;
  const d = ds.reduce((a, x) => a + x, 0) / n, sd = Math.sqrt(ds.reduce((a, x) => a + (x - d) ** 2, 0) / Math.max(1, n - 1));
  const b = Object.keys(V.win).filter(k => base.win[k] != null).reduce((a, k) => a + base.win[k], 0) / n;
  return { n, d, se: sd / Math.sqrt(n), from: b, to: b + d };
}
function tSimHTML() {
  const head = '<div class="res-head">整隊模擬<span class="muted small">（單打 3 對 3，打熱門隊伍）</span></div>';
  if (team.fmt !== 's') return head + '<p class="empty">整隊模擬只做單打（對手隊伍照單打的排名與隊友名單組），切到單打再評估。</p>';
  const mine = simMine(), R = tSim.run || tSim.res, n = simMetaTeams('s').length, per = n * TSIM_SC * TSIM_K;
  const empty = team.slots.findIndex(s => !s.length), all = (1 + (empty >= 0 ? TSIM_ALT : 0) + mine.length * TSIM_ALT) * per, wk = simWkN();
  const btn = tSim.run ? '<button class="btn" data-tsim="stop">停止</button>'
    : `<button class="btn primary" data-tsim="run"${mine.length < BRING_N.s ? ' disabled' : ''}>${tSim.res ? '重新評估' : '開始評估'}</button>`;
  const intro = `<p class="muted small b-intro">拿這隊打 ${n} 隊熱門隊伍（每隊照「出戰選角」選 3 隻，對手的前 ${TSIM_SC} 種帶法各打 ${TSIM_K} 場，共 ${per} 場），`
    + `${empty >= 0 ? `隊伍還沒滿：第 ${empty + 1} 格補上推薦的前 ${TSIM_ALT} 名各打一次，看補誰最好；` : ''}`
    + `再把每一格換成推薦的前 ${TSIM_ALT} 名各打一次，看換誰勝率最會升；全部約 ${all} 場，`
    + `約 ${simEta(TSIM_MS * all / Math.max(1, wk))}${wk ? `（${wk} 個背景計算一起打）` : ''}。</p>`;
  const bar = `<div class="c-f">${btn}${mine.length < BRING_N.s ? `<span class="muted small">至少要挑 ${BRING_N.s} 隻寶可夢（只選屬性的沒有能力值，不算）。</span>` : ''}</div>`;
  if (!R) return head + intro + bar;
  const stale = R.sig !== tSimSig() ? '<p class="x-msg">⚠ 隊伍改過了，下面是改之前那隊的結果，按「重新評估」重算。</p>' : '';
  const prog = tSim.run ? `<p class="muted small b-intro">⏳ 打了 ${R.done}／${R.planned ? R.total : `約 ${R.expect}`} 場`
    + (R.done ? `，預估還要 ${simEta((performance.now() - R.t0) / R.done * Math.max(0, (R.planned ? R.total : R.expect) - R.done))}` : '')
    + (R.wait ? '・先等對位勝率算好再選角' : '') + '。結果會邊打邊更新。</p>'
    : R.stop ? `<p class="muted small b-intro">已停止，只打了 ${R.done} 場。</p>` : '';
  const base = R.vs[0];
  if (!base || !tSimRate(base).n) return head + intro + bar + stale + prog;
  const all0 = tSimRate(base), nm = k => MON[k].zh, per0 = TSIM_SC * TSIM_K;
  // 每隊對手的勝率（低的在前）
  const rows = R.teams.map((T, t) => ({ T, t, ...tSimRate(base, Array.from({ length: per0 }, (_, x) => t * per0 + x)) })).filter(x => x.n)
    .sort((x, y) => x.w / x.n - y.w / y.n || MON[x.T.core].rank.s - MON[y.T.core].rank.s);
  const row = x => { const p = base.plans[x.t];
    return `<div class="combo"><span class="rank">#${MON[x.T.core].rank.s}</span><b>${nm(x.T.core)}隊</b><span class="meta">勝率 ${simPctText(x.w, x.n)}（${x.n} 場）</span>`
      + `<span class="who">對手：${x.T.keys.map(nm).join('、')}</span><span class="who">我方帶 ${simTeamText(p.my)}；對手最可能帶 ${simTeamText(p.scs[0].mons)}</span></div>`; };
  // 對手每隻：平均打倒我方幾隻（多的在前），出場太少的（不到 TSIM_K 場）不列
  const opp = Object.entries(base.opp).filter(([, t]) => t.n >= TSIM_K).sort((x, y) => y[1].kos / y[1].n - x[1].kos / x[1].n).slice(0, 5)
    .map(([k, t]) => `<div class="x-line"><b>${nm(k)}</b><span class="meta">平均打倒我方 ${Math.round(t.kos / t.n * 100) / 100} 隻・對手帶牠時我方勝率 ${simPctText(t.win, t.n)}（${t.n} 場）</span></div>`).join('');
  // 換人、補位：差值大的在前；超過 2 倍誤差的標 ▲／▼（補位 from 是空的）
  const vs = R.vs.slice(1).map(V => ({ V, r: tSimDiff(base, V) })).filter(x => x.r).sort((x, y) => y.r.d - x.r.d);
  const sw = vs.filter(x => x.V.swap.from), add = vs.filter(x => !x.V.swap.from);
  const swRow = ({ V, r }) => { const sig = Math.abs(r.d) > 2 * r.se, d = Math.round(r.d * 1000) / 10;
    return `<div class="x-line"><b>${V.swap.slot + 1} ${V.swap.from ? `${nm(V.swap.from)} → ` : '補上 '}${nm(V.swap.to)}</b><span class="meta">${tSimPct(r.from)} → ${tSimPct(r.to)}`
      + `（<span class="${sig ? (r.d > 0 ? 'ts-up' : 'ts-dn') : ''}">${sig ? (r.d > 0 ? '▲' : '▼') : ''}${d > 0 ? '+' : ''}${d}</span>，±${Math.round(r.se * 1000) / 10}；${r.n} 場）</span></div>`; };
  const addSec = add.length ? `<h3>補上哪一隻（第 ${add[0].V.swap.slot + 1} 格）</h3><p class="muted small b-intro">「現在 → 補上以後」的勝率（同一批場次），排序同下面的換人；`
    + `補上的照預設配招（OP.GG 最常見），點隊伍總評的「下一隻建議」放進去。</p>${add.map(swRow).join('')}` : '';
  return head + intro + bar + stale + prog
    + `<div class="c-sum ${all0.w / all0.n >= 0.5 ? 'good' : 'bad'}"><b>整隊勝率 ${simPctText(all0.w, all0.n)}</b>（${all0.n} 場，誤差約 ±${Math.round(50 / Math.sqrt(all0.n) * 10) / 10}%）</div>`
    + `<h3>最難打的隊伍</h3>${rows.slice(0, 5).map(row).join('')}`
    + (rows.length > 5 ? `<details class="b-more"><summary>其他 ${rows.length - 5} 隊</summary>${rows.slice(5).map(row).join('')}</details>` : '')
    + `<h3>最常打倒我方的</h3>${opp || '<p class="muted small">還沒有資料。</p>'}` + addSec
    + `<h3>換掉哪一隻</h3>${sw.length ? `<p class="muted small b-intro">「原本 → 換了以後」的勝率（兩邊都打完的同一批場次），括號裡是差幾個百分點與誤差；超過誤差 2 倍的標 ▲／▼，其他的差異可能只是運氣。</p>${sw.map(swRow).join('')}`
      : `<p class="muted small">${tSim.run ? '原本的隊伍打完後開始比。' : '沒有比到。'}</p>`}`
    + '<p class="note">※ 對手隊伍：單打排名前 ' + SIM_META_N + ' 名各當核心，加上 OP.GG 隊友名單的前 5 隻（6 隻一樣的只留一隊；OP.GG 只有每隻的隊友名單，沒有整隊統計），'
    + '配招照 OP.GG 最常見、道具同一隊不重複、超級石使用率過半的當成超級進化（同「模擬對戰」的對手）。帶法：我方照「出戰選角」第 1 名的組合與先發（一場只能超級進化一隻）；'
    + `對手照「出戰選角」的「對手可能帶的」前 ${TSIM_SC} 種（對手看不到我方的配招）。出招：雙方都用「模擬對戰」的「快速」（每步把雙方各種出法都試算一回合，照算出來的比例抽）；`
    + '勝率＝贏的場數／場數（打滿回合的平手不算贏）。換人：每一格拿掉後，隊伍分析推薦的前 ' + TSIM_ALT + ' 名（不含被換掉那隻的同家族）換上，配招用預設（OP.GG 最常見），'
    + '換上去後重新選角，打同一批對手；同一場用同一組亂數，所以差值比兩邊各自的勝率準。'
    + '補位：隊伍還沒滿 6 隻時，第一個沒選屬性的空格補上隊伍總評「下一隻建議」的前 ' + TSIM_ALT + ' 名（配招用預設），同樣重新選角、打同一批對手。「最常打倒我方的」只算原本的隊伍、出場 ' + TSIM_K + ' 場以上的。'
    + '模擬的規則（算到哪些效果）見「模擬對戰」分頁的說明；結果只存在這個頁面，重新整理就沒了。</p>';
}

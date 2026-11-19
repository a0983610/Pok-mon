// ---------- 隊伍分析：推薦（補誰、換誰；單打用 3 對 3 模擬排名）----------
// 組隊流程（使用者定的）：先挑 2 隻左右的核心 → 照聯防推薦候選 → 用模擬決定補誰 → 放進去，再推薦下一格，一格一格補到 6 隻。
// 隊伍還有空格（沒選屬性的格子）＝第一個空格補誰（TREC_N 個候選）；6 格都選了＝每隻挑了寶可夢的換成誰（每格 TSIM_ALT 個候選）。
// 單打分兩段：①候選（tRecCands，畫面一打開就列）：只看聯防（同「聯防搭檔」卡片只算屬性），放進去後隊上沒人扛的弱點最少的；
// ②按「用模擬排序」：原本的隊伍和每個候選放進去的隊伍拿去打熱門隊伍（3 對 3），照勝率排。雙打還沒有模擬：照原本的規則（recommendMon）排，6 格都選了不推薦。
// 3 對 3 的打法：對手＝simMetaTeams（單打排名前 SIM_META_N 名各當核心＋Showdown 隊友名單前 5 隻）。每隊照「出戰選角」的方法：我方帶 simMyPlan 的第 1 名組合與先發，
// 對手照 simOppScenarios（對手看我方 6 隻、用同一套方法選）的前 TSIM_SC 種帶法，各打 TSIM_K 場；雙方用模擬分頁的「快速」（每步把各種出法試算一回合）。
// 每場的亂數種子照「對手隊伍、帶法排第幾、第幾場」（simHash；背景計算每場開打前 ctx.flip 也歸零）：不同隊伍的同一場用同一組亂數，差值比較準。
// 選角前先把對位勝率（duelVs）還沒算好的交給背景計算（pBg）算完，選角才和「出戰選角」分頁一樣。
// 按按鈕才算（使用者選的），結果只放在記憶體；改隊伍就停掉、收起結果（候選跟著隊伍變）。背景計算開不起來（file://）在畫面這邊一場一場打。
const TSIM_SC = 3, TSIM_K = 5, TSIM_OPT = { algo: 'ply1' };
// TREC_N：補空格的候選數；TSIM_ALT：換人時每格的候選數；TREC_RANK：候選只從單打排名前幾名挑
const TREC_N = 8, TSIM_ALT = 3, TREC_RANK = 100;
// 預估時間用：每個背景計算打一場 3 對 3 約幾毫秒（2026-11-13 實測，i7-14700、Chromium、8 個背景計算：打的階段 7030 場 162 秒，約 186 毫秒；
// 加上選角與等對位勝率，全部 8265 場 210 秒）；2026-11-17 推演改成只看 3 回合（SIM_LOOK），照 Node 實測快速決策快 1.8 倍改成 110（沒在瀏覽器重量）
const TSIM_MS = 110;
// run＝進行中的評估（停止或打完後搬到 res，畫面照同一份資料畫）
const tSim = { run: null, res: null, redraw: 0 };
// 隊伍的簽名（單打雙打、每格屬性、隊員、配招）：候選與結果是不是目前這一隊的
const tSimSig = () => JSON.stringify([team.fmt, team.slots, team.mons, team.sets]);
const tSimTick = ms => new Promise(r => setTimeout(r, ms || 0));
// 候選名單：單打排名前 TREC_RANK 名（樣本多、配招統計可信；同 1 對 1 勝率表的範圍，選角要的對位勝率大多事先算好，排序不用等太久）有預設配招的型態；
// 同家族屬性一樣的型態只留一種（Showdown 超級進化佔過半的留超級進化，見 likelyForm；不然留原型），屬性不一樣的超級進化另列
let tRecPool = null;
const tRecForms = () => tRecPool ||= MONS.filter(m => !m.base && m.rank.s && m.rank.s <= TREC_RANK).flatMap(m => {
  const out = [];
  [likelyForm(m, 's'), m, ...megasOf(m)].filter(x => defaultSet(x.key, 's')).forEach(x => { if (!out.some(y => sameTypes(y.types, x.types))) out.push(x); });
  return out;
});
// 第 slot 格（空格＝補上、有寶可夢＝換掉）的 n 個候選，其他格照 snap（只選屬性的格子也算隊員）。只看聯防，同「聯防搭檔」卡片只算屬性
// （怕＝受到 ×2 以上、扛＝×½ 以下含免疫，不含特性與道具）：把每隻放進去，依序比
//   ① 隊上沒人扛的弱點（缺口，memberScore 的 gaps：有人怕、沒人扛）剩幾個，少的優先──能扛原本沒人扛的、自己怕的又有隊友扛的排前面
//   ② ⚠（3 隻以上都怕，或 2 隻以上怕又沒人扛）剩幾個 ③ 單打排名；不含隊上（含被換掉那隻）的同家族。
// 回傳 [{ key, gaps 放進去後的缺口, warn 放進去後的 ⚠ 數, now 現在的缺口, warnNow 現在的 ⚠ 數 }]（gapDeltaHTML 的格式）
function tRecCands(snap, slot, n) {
  const others = snap.slots.filter((s, i) => s.length && i !== slot), fams = snap.mons.filter(Boolean).map(k => family(MON[k]));
  const rows = teamProfile(others), now = teamGaps(rows), warnNow = rows.filter(r => r.warn).length;
  return tRecForms().filter(m => !fams.includes(family(m))).map(m => ({ m, ...memberScore(others, m.types) }))
    .sort((x, y) => x.gaps.length - y.gaps.length || x.warn - y.warn || x.m.rank.s - y.m.rank.s).slice(0, n)
    .map(({ m, gaps, warn }) => ({ key: m.key, gaps, warn, now, warnNow }));
}
// 目前隊伍的候選（照 tSimSig 快取，換隊伍才重算；6 格都選了時每格算一次）：
// { snap 算的時候的隊伍, add 補的空格（6 格都選了是 -1）, cands [[格子, tRecCands 的結果]...] }
const tRec = { sig: '', plan: null };
function tRecPlan() {
  const sig = tSimSig();
  if (tRec.sig !== sig) {
    const snap = { slots: team.slots.map(s => s.slice()), mons: team.mons.slice(), sets: team.sets.slice() }, add = snap.slots.findIndex(s => !s.length);
    tRec.plan = { snap, add, cands: add >= 0 ? [[add, tRecCands(snap, add, TREC_N)]]
      : snap.mons.map((k, i) => [i, k ? tRecCands(snap, i, TSIM_ALT) : []]).filter(([, c]) => c.length) };
    tRec.sig = sig;
  }
  return tRec.plan;
}
// 能不能用模擬排序：3 對 3 要湊滿 BRING_N 隻挑了寶可夢的（補空格時現在至少 2 隻、換人時至少 3 隻）
const tRecCanSim = (mine, plan) => plan.cands.length > 0 && mine.length + (plan.add >= 0 ? 1 : 0) >= BRING_N.s;
// 要打幾種隊伍：原本的隊伍（滿 BRING_N 隻才打）＋每個候選
const tRecTeams = (mine, plan) => (mine.length >= BRING_N.s ? 1 : 0) + plan.cands.reduce((a, [, c]) => a + c.length, 0);
function tSimStart() {
  const mine = simMine(), plan = tRecPlan();
  if (tSim.run || team.fmt !== 's' || !tRecCanSim(mine, plan)) return;
  const teams = simMetaTeams('s');
  tSim.run = { sig: tSimSig(), plan, teams, vs: [], jobs: [], q: [], wks: [], idle: [], done: 0, total: 0, expect: tRecTeams(mine, plan) * teams.length * TSIM_SC * TSIM_K,
    planned: false, stop: false, local: false, timer: 0, draw: 0, wait: false, base: false, t0: performance.now(), ctx: null };
  tSim.res = null;
  tSimDraw();
  tSimPlanAll(tSim.run, mine, plan);
}
// 先排原本的隊伍（滿 BRING_N 隻才排），再排每個候選放進去的隊伍（候選的配招用預設 defaultSet）。
// 6 格都選了（換人）：等原本的隊伍打完，照隊員貢獻（tSimMem 的 per）低的格子先排（每格都會試，只是先出結果；使用者選的）
async function tSimPlanAll(run, mine, plan) {
  if (mine.length >= BRING_N.s) await tSimAdd(run, mine, null);
  let order = plan.cands;
  if (plan.add < 0 && run.vs[0] && !run.vs[0].swap) {
    run.base = true;
    tSimDraw();
    while (!run.stop && run.done < run.total) await tSimTick(200);
    run.base = false;
    if (run.stop) return;
    const per = new Map(tSimWeak(run.vs[0]).map((x, r) => [x.slot, r]));
    order = plan.cands.slice().sort((x, y) => per.get(x[0]) - per.get(y[0]));
  }
  for (const [slot, cands] of order) {
    await tSimTick();
    for (const c of cands) {
      if (run.stop) return;
      await tSimAdd(run, [...mine.filter(y => y.slot !== slot), { key: c.key, set: defaultSet(c.key, 's'), slot }].sort((a, b) => a.slot - b.slot),
        { slot, from: plan.snap.mons[slot], to: c.key });
    }
  }
  run.planned = true;
  tSimCheck(run);
}
// 加一種隊伍（mine；swap＝{ slot, from, to } 第 slot 格從 from（空格是 ''）換成 to，原本的隊伍是 null）：對每隊對手選好帶法，排進要打的場次
async function tSimAdd(run, mine, swap) {
  const plans = await tSimPlans(run, mine);
  if (!plans) return;
  const v = run.vs.length;
  run.vs.push({ mine, swap, plans, win: [], opp: {}, mem: {} });
  plans.forEach((p, t) => p.scs.forEach((sc, r) => {
    for (let i = 0; i < TSIM_K; i++) {
      run.q.push(run.jobs.length);
      run.jobs.push({ v, t, r, k: (t * TSIM_SC + r) * TSIM_K + i, seed: simHash(JSON.stringify([run.teams[t].keys, r, i])) });
      run.total++;
    }
  }));
  tSimPump(run);
}
// 隊伍 mine 對每隊對手的帶法 [{ my 我方帶出場的, slots 帶出場的是哪幾格（順序同 my）, scs 對手前 TSIM_SC 種帶法 }]（對應 run.teams）。對位勝率還沒算好的先交給背景計算，
// 算好再選一次（正面的勝率算好才知道要不要算換上來那場，所以最多重選 2 次）；每 30 毫秒讓畫面喘口氣。停止時回傳 null
async function tSimPlans(run, mine) {
  for (let round = 0; ; round++) {
    const plans = [];
    let t0 = performance.now();
    for (const T of run.teams) {
      if (run.stop) return null;
      const p = simMyPlan(mine, T.keys, 's');
      plans.push({ my: simMySide(mine, p.slots, p.evo, 's'), slots: p.slots, scs:simOppScenarios(T.keys, mine.map(x => x.key), 's').slice(0, TSIM_SC) });
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
// 記一場：贏記 1（打滿回合平手、輸記 0，同模擬分頁的勝率）；原本的隊伍另外記對手每隻帶出場的場數、那幾場我方贏幾場、打倒我方幾隻，
// 和我方每格（mem，照帶出場的順序對回格子）帶出場的場數、打倒幾隻、倒下幾次
function tSimSave(run, id, out) {
  const j = run.jobs[id], V = run.vs[j.v], win = out.res > 0 ? 1 : 0;
  V.win[j.k] = win;
  if (!V.swap) {
    out.mons[1].forEach(m => { const t = V.opp[m.key] ||= { n: 0, win: 0, kos: 0 }; t.n++; t.win += win; t.kos += m.kos; });
    out.mons[0].forEach((m, q) => { const t = V.mem[V.plans[j.t].slots[q]] ||= { n: 0, kos: 0, down: 0 }; t.n++; t.kos += m.kos; if (m.hp <= 0) t.down++; });
  }
  run.done++;
  tSimCheck(run);
}
// 都排完又都打完（或停止）就結束；不然每秒最多重畫一次卡片
function tSimCheck(run) {
  if (run.stop || run.planned && run.done >= run.total) { tSimEnd(run); return; }
  if (!run.draw) run.draw = setTimeout(() => { run.draw = 0; tSimDraw(); }, 1000);
}
// quiet＝不重畫（tSimStale 在畫卡片途中呼叫）
function tSimEnd(run, quiet) {
  if (tSim.run !== run) return;
  clearTimeout(run.timer);
  clearTimeout(run.draw);
  run.wks.forEach(w => w.terminate());
  Object.assign(run, { wks: [], idle: [], q: [] });
  tSim.run = null;
  tSim.res = run;
  if (!quiet) tSimDraw();
}
// 隊伍改過了：正在算的停掉、算好的收起（候選和結果都是改之前那隊的）；tSimHTML 一開始呼叫
// （能力點數欄改了不整區重畫，這時候等算的時候每秒重畫卡片才發現）
function tSimStale() {
  if (tSim.run && tSim.run.sig !== tSimSig()) { tSim.run.stop = true; tSimEnd(tSim.run, true); }
  if (tSim.res && tSim.res.sig !== tSimSig()) tSim.res = null;
}
// 只重畫這張卡片（在別的分頁時不畫，切回來 renderTeam 會畫）；滑鼠按著時等一下，免得按鈕被換掉沒按到
function tSimDraw() {
  if (curTab !== 'team') return;
  clearTimeout(tSim.redraw);
  if (pBg.down) { tSim.redraw = setTimeout(tSimDraw, 300); return; }
  $('#tSim').innerHTML = tSimHTML();
}
$('#tSim').addEventListener('click', e => {
  const m = e.target.closest('[data-mon]'), b = e.target.closest('[data-tsim]');
  if (m) tRecPut(+m.dataset.slot, m.dataset.mon);
  else if (b?.dataset.tsim === 'run') tSimStart();
  else if (b && tSim.run) { tSim.run.stop = true; tSimEnd(tSim.run); }
});
// 把推薦的寶可夢放進第 slot 格（配招用預設，見 pickTeamMon）；換掉的那隻配招改過（和預設不同）時先確認
function tRecPut(slot, key) {
  const k = team.mons[slot];
  if (k && JSON.stringify(team.sets[slot]) !== JSON.stringify(defaultSet(k, team.fmt))
    && !confirm(`換掉第 ${slot + 1} 隻的${MON[k].zh}會丟掉改過的配招，確定嗎？`)) return;
  team.cur = slot;
  pickTeamMon(key);
}
const tSimPct = x => `${Math.round(x * 1000) / 10}%`;
// 勝率 { n 場數, w 贏的場數 }（ks＝場次索引，沒給是全部）
const tSimRate = (V, ks) => (ks || Object.keys(V.win)).reduce((a, k) => V.win[k] == null ? a : { n: a.n + 1, w: a.w + V.win[k] }, { n: 0, w: 0 });
// 原本的隊伍每格的貢獻（隊伍分析的格子順序）：{ slot, key, teams 選角帶出場的隊數, lead 先發的隊數（每隊對手我方照一種帶法），
//   n 打完的場次裡帶出場的場數, kos 打倒幾隻, down 倒下幾次, per 每場平均打倒（打完的全部場次算，沒帶出場的算 0）}
function tSimMem(base) {
  const all = tSimRate(base).n;
  return base.mine.map(x => { const m = base.mem[x.slot] || { n: 0, kos: 0, down: 0 };
    return { slot: x.slot, key: x.key, teams: base.plans.filter(p => p.slots.includes(x.slot)).length,
      lead: base.plans.filter(p => p.slots[0] === x.slot).length, ...m, per: all ? m.kos / all : 0 }; });
}
// 貢獻低的在前（換人先試）：每場平均打倒少的，一樣再比帶出場的隊數少的
const tSimWeak = base => tSimMem(base).sort((x, y) => x.per - y.per || x.teams - y.teams);
// V 和 base 比：兩邊都打完的同一場配對，d＝差值平均、se＝差值的標準誤、from／to＝這些場次 base 與 V 的勝率
function tSimDiff(base, V) {
  const ds = Object.keys(V.win).filter(k => base.win[k] != null).map(k => V.win[k] - base.win[k]), n = ds.length;
  if (!n) return null;
  const d = ds.reduce((a, x) => a + x, 0) / n, sd = Math.sqrt(ds.reduce((a, x) => a + (x - d) ** 2, 0) / Math.max(1, n - 1));
  const b = Object.keys(V.win).filter(k => base.win[k] != null).reduce((a, k) => a + base.win[k], 0) / n;
  return { n, d, se: sd / Math.sqrt(n), from: b, to: b + d };
}
// 差幾個百分點（±誤差）；超過誤差 2 倍的標 ▲／▼，其他的差異可能只是運氣
const tSimDiffText = r => { const sig = Math.abs(r.d) > 2 * r.se, d = Math.round(r.d * 1000) / 10;
  return `<span class="${sig ? (r.d > 0 ? 'ts-up' : 'ts-dn') : ''}">${sig ? (r.d > 0 ? '▲' : '▼') : ''}${d > 0 ? '+' : ''}${d}</span>，±${Math.round(r.se * 1000) / 10}`; };
// 候選的說明：名字、屬性、角色（照預設配招）、聯防（放進去後缺口和 ⚠ 怎麼變）、超級進化提醒（slot＝要換掉的格子，不算那隻）、排名
const tRecInfo = (c, slot) => { const m = MON[c.key], r = roleOf(c.key, 's', defaultSet(c.key, 's'));
  return `<b>${m.zh}</b>${chips(m.types)}${r ? roleTags(r) : ''}<span class="fill">聯防：${gapDeltaHTML(c.now, c.warnNow, c)}</span>`
    + (m.base && megaOn(slot).length ? `<span class="meta">⚠ 隊上已有超級進化（${megaOn(slot).map(k => MON[k].zh).join('、')}），一場只能進化一隻</span>` : '')
    + `<span class="meta">${rankText(m)}</span>`; };
function tSimHTML() {
  tSimStale();
  if (team.fmt !== 's') return tRecDoublesHTML();
  const head = '<div class="res-head">推薦<span class="muted small">（單打：補誰、換誰）</span></div>';
  if (!team.slots.some(s => s.length)) return head + '<p class="empty">先在上面挑 2 隻左右想當核心的寶可夢，這裡會照聯防推薦下一隻的候選，'
    + '再用模擬決定補誰最好；放進去後接著推薦下一格，一格一格補到 6 隻。6 隻都選了會推薦換掉誰、換成誰。</p>';
  const mine = simMine(), plan = tRecPlan(), add = plan.add >= 0, can = tRecCanSim(mine, plan), R = tSim.run || tSim.res;
  const n = simMetaTeams('s').length, per = n * TSIM_SC * TSIM_K, kinds = tRecTeams(mine, plan), wk = simWkN();
  const intro = `<p class="muted small b-intro">${add ? `第 ${plan.add + 1} 格（第一個空格）補誰` : `6 格都選了：每隻換成 ${TSIM_ALT} 個候選，看換誰最好（模擬時先打原本的隊伍看隊員貢獻，貢獻低的格子先試）`}。`
    + '候選照聯防挑（同「聯防搭檔」只看屬性：放進去後隊上沒人扛的弱點最少的排前面）；'
    + `按「用模擬排序」把候選放進隊伍，整隊打 ${n} 隊熱門隊伍（3 對 3），照勝率決定${add ? '補誰' : '換誰'}。點寶可夢直接放進那一格${add ? '，接著推薦下一格' : ''}。</p>`;
  const btn = tSim.run ? '<button class="btn" data-tsim="stop">停止</button>'
    : `<button class="btn primary" data-tsim="run"${can ? '' : ' disabled'}>${R ? '重新排序' : '用模擬排序'}</button>`;
  const bar = `<div class="c-f">${btn}<span class="muted small">${can ? `${kinds} 種隊伍各打 ${per} 場，約 ${simEta(TSIM_MS * kinds * per / Math.max(1, wk))}`
    + `${wk ? `（${wk} 個背景計算一起打）` : ''}；改隊伍會停掉` : `至少要挑 ${BRING_N.s - (add ? 1 : 0)} 隻寶可夢才能用模擬排序（3 對 3 要湊滿 ${BRING_N.s} 隻，只選屬性的不算）`}</span></div>`;
  const prog = tSim.run ? `<p class="muted small b-intro">⏳ 打了 ${R.done}／${R.planned ? R.total : `約 ${R.expect}`} 場`
    + (R.done ? `，預估還要 ${simEta((performance.now() - R.t0) / R.done * Math.max(0, (R.planned ? R.total : R.expect) - R.done))}` : '')
    + (R.wait ? '・先等對位勝率算好再選角' : '') + (R.base ? '・先打原本的隊伍看隊員貢獻，打完照貢獻低的格子先試換人' : '') + '。結果會邊打邊更新。</p>'
    : R?.stop ? `<p class="muted small b-intro">已停止，只打了 ${R.done} 場。</p>` : '';
  const nm = k => MON[k].zh;
  const items = plan.cands.flatMap(([slot, cs]) => cs.map(c => ({ slot, c, V: R?.vs.find(V => V.swap?.slot === slot && V.swap.to === c.key) })));
  const base = R?.vs.find(V => !V.swap);
  let list;
  if (!items.some(x => x.V && tSimRate(x.V).n)) {
    // 還沒模擬：照聯防的順序，補空格列候選卡片；換人每格一行
    list = add ? `<div class="b-rec">${items.map(({ slot, c }) => `<button data-mon="${c.key}" data-slot="${slot}">${tRecInfo(c, slot)}</button>`).join('')}</div>`
      : plan.cands.map(([slot, cs]) => `<div class="issue"><b>${slot + 1} ${nm(plan.snap.mons[slot])}</b><span class="x-msg">換成：</span>`
        + cs.map(c => `<button class="mini" data-mon="${c.key}" data-slot="${slot}">${nm(c.key)}<span class="meta">缺口 ${c.now.length}→${c.gaps.length}</span></button>`).join('') + '</div>').join('');
  } else {
    // 照勝率排：有原本的隊伍就比和原本差多少（同一批場次配對），沒有（隊伍只有 2 隻）就比勝率、再和第 1 名比
    const scored = items.map(x => ({ ...x, rt: x.V ? tSimRate(x.V) : { n: 0, w: 0 }, df: base && x.V ? tSimDiff(base, x.V) : null }));
    const key = x => base ? (x.df ? x.df.d : -Infinity) : (x.rt.n ? x.rt.w / x.rt.n : -Infinity);
    scored.sort((x, y) => key(y) - key(x));
    const top = scored[0].V;
    const row = (x, i) => {
      const dt = !base && i && key(x) > -Infinity ? tSimDiff(top, x.V) : null;
      const res = key(x) === -Infinity ? '還沒打' : base ? `整隊勝率 ${tSimPct(x.df.from)} → ${tSimPct(x.df.to)}（${tSimDiffText(x.df)}；${x.df.n} 場）`
        : `勝率 ${simPctText(x.rt.w, x.rt.n)}（${x.rt.n} 場）` + (dt ? `・和第 1 名比 ${tSimDiffText(dt)}` : '');
      return `<button data-mon="${x.c.key}" data-slot="${x.slot}"><span class="rank">${key(x) > -Infinity ? i + 1 : '—'}</span>`
        + `${add ? '' : `<span>換掉第 ${x.slot + 1} 隻${nm(plan.snap.mons[x.slot])} →</span>`}${tRecInfo(x.c, x.slot)}<span class="fill">${res}</span></button>`;
    };
    const show = add ? scored.length : 5;
    list = `<p class="muted small b-intro">${base ? '括號裡是和原本的隊伍差幾個百分點（同一批場次比）與誤差；超過誤差 2 倍的標 ▲／▼，其他的差異可能只是運氣。'
      : `隊伍只有 ${mine.length} 隻，沒有原本的隊伍可比，直接比勝率；「和第 1 名比」沒標 ▼ 的可以當成差不多。`}</p>`
      + `<div class="b-rec">${scored.slice(0, show).map(row).join('')}</div>`
      + (scored.length > show ? tFoldHTML('tsimmore', `其他 ${scored.length - show} 種換法（點開看）`, `<div class="b-rec">${scored.slice(show).map((x, i) => row(x, i + show)).join('')}</div>`) : '');
  }
  return head + intro + bar + prog + list + (base && tSimRate(base).n ? tSimMemHTML(R, base, !add) + tSimTeamHTML(R, base) : '') + tRecNote();
}
// 隊員貢獻（原本的隊伍打的結果，不收合）：每隻帶出場幾隊、先發幾隊、帶出場時平均打倒幾隻、倒下比例；swap＝6 格都選了，列出換人先試的順序
function tSimMemHTML(R, base, swap) {
  const nm = k => MON[k].zh, T0 = base.plans.length, all = tSimRate(base).n, r2 = x => Math.round(x * 100) / 100;
  const row = x => `<div class="x-line"><b>${x.slot + 1} ${nm(x.key)}</b>` + (x.teams
    ? `<span class="meta">帶出場 ${x.teams}／${T0} 隊（先發 ${x.lead} 隊）`
      + (x.n ? `・帶出場時平均打倒 ${r2(x.kos / x.n)} 隻、倒下 ${Math.round(x.down / x.n * 100)}%（${x.n} 場）` : '') + '</span>'
    : `<span class="x-msg">${T0} 隊都沒帶出場</span>`) + '</div>';
  return `<h3>隊員貢獻<span class="muted small">（原本的隊伍打了 ${all} 場${R === tSim.run ? '，邊打邊更新' : ''}）</span></h3>`
    + tSimMem(base).map(row).join('')
    + (swap ? `<p class="muted small b-intro">換人時貢獻低的格子先試（每場平均打倒少的先，沒帶出場的場次算 0）：`
      + `${tSimWeak(base).map(x => `${x.slot + 1} ${nm(x.key)}`).join(' → ')}；每格都會試，看夠了可以按停止。</p>` : '');
}
// 原本的隊伍打的結果（收合）：整隊勝率、最難打的隊伍、最常打倒我方的
function tSimTeamHTML(R, base) {
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
  return tFoldHTML('tsimteam', `原本的隊伍：整隊勝率 ${simPctText(all0.w, all0.n)}（${all0.n} 場；點開看最難打的隊伍、最常打倒我方的）`,
    `<div class="c-sum ${all0.w / all0.n >= 0.5 ? 'good' : 'bad'}"><b>整隊勝率 ${simPctText(all0.w, all0.n)}</b>（${all0.n} 場，誤差約 ±${Math.round(50 / Math.sqrt(all0.n) * 10) / 10}%）</div>`
    + `<h3>最難打的隊伍</h3>${rows.slice(0, 5).map(row).join('')}`
    + (rows.length > 5 ? `<details class="b-more"><summary>其他 ${rows.length - 5} 隊</summary>${rows.slice(5).map(row).join('')}</details>` : '')
    + `<h3>最常打倒我方的</h3>${opp || '<p class="muted small">還沒有資料。</p>'}`);
}
const tRecNote = () => tFoldHTML('tsimnote', '怎麼挑候選、怎麼排（點開看）', '<p class="note">'
  + '※ 候選（聯防）：同「聯防搭檔」卡片只算屬性（怕＝受到 ×2 以上、扛＝×½ 以下含免疫，不含特性與道具），只選屬性的格子也算隊員。把每隻放進那一格，依序比：'
  + '① 隊上沒人扛的弱點（缺口：有人怕、沒人扛）剩幾個，少的優先──能扛隊上原本沒人扛的、自己怕的又有隊友扛的會排前面；'
  + '② ⚠（3 隻以上都怕，或 2 隻以上怕又沒人扛）剩幾個；③ 單打排名。'
  + `只從單打排名前 ${TREC_RANK} 名挑（樣本多、配招統計可信；選角要的對位勝率大多事先算好，排序不用等太久），不含隊上的同家族；`
  + '超級進化和原型屬性一樣時只留一種（Showdown 統計超級進化佔過半的留超級進化，不然留原型）。'
  + `補空格取 ${TREC_N} 個，換人每格取 ${TSIM_ALT} 個。聯防只看屬性，打不打得贏交給模擬排序。`
  + `排序：對手隊伍＝單打排名前 ${SIM_META_N} 名各當核心，加上 Showdown 隊友名單的前 5 隻（6 隻一樣的只留一隊；統計只有每隻的隊友名單，沒有整隊統計），`
  + '配招照 Showdown 最常見、道具同一隊不重複、超級進化佔過半的當成超級進化（同「模擬對戰」的對手）。帶法：我方照「出戰選角」第 1 名的組合與先發（一場只能超級進化一隻）；'
  + `對手照「出戰選角」的「對手可能帶的」前 ${TSIM_SC} 種（對手看不到我方的配招），各打 ${TSIM_K} 場。出招：雙方都用「模擬對戰」的「快速」（每步把雙方各種出法都試算一回合，照算出來的比例抽）；`
  + '勝率＝贏的場數／場數（打滿回合的平手不算贏）。候選的配招用預設（Showdown 最常見），放進去後重新選角，打同一批對手；同一場用同一組亂數，所以差值比各自的勝率準。'
  + `「最常打倒我方的」只算原本的隊伍、出場 ${TSIM_K} 場以上的。`
  + '「隊員貢獻」也只算原本的隊伍（挑了 3 隻以上才打）：帶出場／先發幾隊照選角（每隊對手我方照一種帶法），平均打倒、倒下照帶出場的場次；'
  + '6 格都選了時，換人照「每場平均打倒」（全部場次算，沒帶出場的算 0）少的格子先試，再比帶出場的隊數，每格都會試，只是先出結果。'
  + '輔助手打倒的本來就少，貢獻低不一定代表換掉最好，換誰還是看模擬排序的結果。模擬的規則（算到哪些效果）見「模擬對戰」分頁的說明；結果只存在這個頁面，重新整理或改隊伍就沒了。</p>');
// 雙打：還沒有模擬，照原本的規則（recommendMon，含能對付幾隻沒解的熱門威脅）排前 5 名；6 格都選了不推薦
function tRecDoublesHTML() {
  const head = '<div class="res-head">推薦<span class="muted small">（雙打：補誰）</span></div>';
  const members = team.slots.map((s, i) => [s, i]).filter(([s]) => s.length), slot = team.slots.findIndex(s => !s.length);
  if (!members.length) return head + '<p class="empty">先在上面挑 1 隻以上想用的寶可夢，這裡會推薦下一隻補誰。</p>';
  if (slot < 0) return head + '<p class="muted small b-intro">6 格都選了。雙打還沒有模擬，換人建議要等雙打模擬做好（切到單打可以看單打的換人建議）。</p>';
  const recs = recommendMon(members.map(([s]) => s), [], 'd', members.filter(([, i]) => team.mons[i]).map(([, i]) => team.mons[i]), members.map(unitOf), teamSets());
  return head + `<p class="muted small b-intro">第 ${slot + 1} 格（第一個空格）補誰。雙打還沒有模擬，照原本的規則排，依序比：①搭配──能解決幾個「隊伍特性與場地招式」的提醒`
    + '（隊上有戲法空間時，慢的攻擊手也算），扣掉會新增的；②能補上幾個「隊伍角色」缺的角色，加上能當幾隻「沒解」熱門威脅的對策'
    + `（對策要雙打排名前 ${COUNTER_RANK}、屬性上擋得住或剋得到，又正面打得贏）；③是不是 Showdown 上隊上成員的常見隊友；④加入後隊伍的屬性弱點；⑤雙打排名。點一下直接放進這格。</p>`
    + `<div class="b-rec">${recs.slice(0, 5).map((r, i) => `<button data-mon="${r.mon.key}" data-slot="${slot}"><span class="rank">${i + 1}</span>${recInfo(r)}<span class="meta">${rankText(r.mon)}</span></button>`).join('')}</div>`;
}

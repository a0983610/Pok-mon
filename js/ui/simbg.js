// ---------- 單打對位勝率的背景計算 ----------
// duelVs 用到、還沒算好的勝率（duelP 排進 SIM_P_WANT）交給背景計算（sim-worker.js 的 duel 訊息，開幾個同模擬分頁的 simWkN），
// 算好一組就 simPDone（存進 MATCH_P、清掉用到它的對位快取）；累積一下（PBG_REDRAW 毫秒）就重畫目前的分頁（隊伍分析、出戰選角、對戰中、模擬對戰），
// 滑鼠按著或游標在輸入框、選單時先不畫（同隊伍分析的 teamBg，免得吃掉點擊、打到一半的數字被換掉）。
// file:// 或背景計算開不起來時，在畫面這邊一小段一小段算（每次一組，算完讓畫面喘口氣再算下一組）。
// 進度：畫面上 data-pprog 的元素寫「算了 N／M 組」（pBgNote 給的提示）
const pBg = { wks: [], idle: [], args: new Map(), q: [], done: 0, total: 0, timer: 0, redraw: 0, local: false, down: false };
const PBG_REDRAW = 600;
// 每次畫完分頁呼叫：把新排進來的勝率交出去算
function pBgFlush() {
  SIM_P_WANT.forEach((args, k) => {
    if (pBg.args.has(k) || MATCH_P.has(k)) return;
    pBg.args.set(k, args);
    pBg.q.push(k);
    pBg.total++;
  });
  SIM_P_WANT.clear();
  pBgPump();
}
// 還在算的組數（給畫面判斷要不要顯示提示）
const pBgLeft = () => pBg.args.size;
// 還在算時的提示（畫到一半呼叫：先把這次畫面排進來的交出去，組數才對）
const pBgNote = what => (pBgFlush(), pBgLeft()) ?`<p class="muted small b-intro">⏳ ${what}的勝率還在背景算（<span data-pprog>算了 ${pBg.done}／${pBg.total} 組</span>），先照模擬一場的勝負，算好會自動更新。</p>` : '';
function pBgPump() {
  if (!pBg.q.length) return;
  const n = pBg.local ? 0 : simWkN();
  if (!n) { if (!pBg.timer) pBg.timer = setTimeout(pBgLocal, 0); return; }
  while (pBg.wks.length < n) {
    let w;
    try { w = new Worker('js/engine/sim-worker.js'); } catch { pBgFail(); return; }
    w.onmessage = e => pBgGot(w, e.data);
    w.onerror = pBgFail;
    pBg.wks.push(w);
    pBg.idle.push(w);
  }
  while (pBg.idle.length && pBg.q.length) {
    const w = pBg.idle.pop(), k = pBg.q.shift();
    w.postMessage({ duel: { k, args: pBg.args.get(k) } });
  }
}
function pBgGot(w, d) {
  if (d.duel == null) return;
  pBgSave(d.duel, d.p);
  pBg.idle.push(w);
  pBgPump();
}
function pBgSave(k, p) {
  simPDone(k, p);
  pBg.args.delete(k);
  pBg.done++;
  document.querySelectorAll('[data-pprog]').forEach(e => { e.textContent = `算了 ${pBg.done}／${pBg.total} 組`; });
  if (!pBg.redraw) pBg.redraw = setTimeout(pBgRedraw, PBG_REDRAW);
  if (!pBg.args.size) { pBg.done = 0; pBg.total = 0; }
}
// 背景計算不能用：全部停掉，還沒算完的（含正在算的）改在畫面這邊算
function pBgFail() {
  pBg.wks.forEach(w => w.terminate());
  Object.assign(pBg, { wks: [], idle: [], local: true, q: [...pBg.args.keys()] });
  pBgPump();
}
function pBgLocal() {
  pBg.timer = 0;
  const k = pBg.q.shift();
  if (k) pBgSave(k, simDuelP(...pBg.args.get(k)));
  if (pBg.q.length) pBg.timer = setTimeout(pBgLocal, 0);
}
function pBgRedraw() {
  pBg.redraw = 0;
  if (pBg.down || document.activeElement?.matches('input, select, textarea')) { pBg.redraw = setTimeout(pBgRedraw, 300); return; }
  if (curTab === 'team') renderTeam();
  else if (curTab === 'bring') renderBring();
  else if (curTab === 'battle') renderBattle();
  else if (curTab === 'sim') renderSim();
}
document.addEventListener('pointerdown', () => { pBg.down = true; });
document.addEventListener('pointerup', () => { pBg.down = false; });
document.addEventListener('pointercancel', () => { pBg.down = false; });

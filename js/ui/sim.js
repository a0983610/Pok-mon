// ---------- 對戰模擬 ----------
// mode：rand 對上隨機熱門隊、opp 對上「出戰選角」的對手；range 隨機隊從單打排名前幾名挑；n 場數。
// run 模擬中（{ stop }）、res 上一次的結果（不存網址）
const SIM_MODES = ['rand', 'opp'], SIM_RANGES = [30, 60, 100], SIM_NS = [100, 300, 1000];
const sim = { mode: 'rand', range: 30, n: 100, run: null, res: null };
// 我方：隊伍分析挑了寶可夢的隊員（只選屬性的沒有能力值，不算）
const simMine = () => team.mons.map((k, i) => k ? { key: k, set: team.sets[i] } : null).filter(Boolean);
const simPctText = (x, n) => n ? `${Math.round(x / n * 1000) / 10}%` : '—';
function renderSim() {
  const seg = (id, list, cur) => document.querySelectorAll(`#${id} button`).forEach((b, i) => b.setAttribute('aria-pressed', list[i] === cur));
  seg('sMode', SIM_MODES, sim.mode);
  seg('sRange', SIM_RANGES, sim.range);
  seg('sN', SIM_NS, sim.n);
  $('#sRangeRow').hidden = sim.mode !== 'rand';
  const mine = simMine(), noOpp = sim.mode === 'opp' && !bring.opp.some(Boolean);
  $('#sRun').disabled = !!sim.run || !mine.length || noOpp;
  $('#sStop').hidden = !sim.run;
  const r = sim.res;
  if (!sim.run) $('#sMsg').textContent = !mine.length ? '先到「隊伍分析」挑好我方寶可夢（只選屬性的不算）。'
    : noOpp ? '先到「出戰選角」選好對手的寶可夢。' : !r ? '' : r.n < r.total ? `已停止，只跑了 ${r.n} 場。` : `完成 ${r.n} 場。`;
  $('#sResult').innerHTML = sim.res ? simResultHTML(sim.res)
    : '<p class="empty">按「開始模擬」後，這裡會列出勝率、我方每隻的表現、最難對付的對手，以及贏、輸各一場的逐回合紀錄。</p>';
  saveState();
}
// 跑模擬：每跑超過 50 毫秒就讓畫面喘口氣、更新進度；按「停止」就以已跑完的場數出結果
async function runSim() {
  const mine = simMine(), fmt = 's';
  if (sim.run || !mine.length) return;
  const run = sim.run = { stop: false }, mode = sim.mode, total = sim.n;
  // 對上出戰選角的對手：雙方帶誰每場都一樣，先算好、快取共用
  const fixed = mode === 'opp' ? simSides(mine, bring.opp, fmt) : null, fixedCtx = fixed && simCtx(fmt);
  const res = { mode, range: sim.range, total, n: 0, win: 0, lose: 0, draw: 0, turns: 0, my: {}, opp: {}, logs: {}, fixed };
  renderSim();
  let t0 = performance.now();
  for (let g = 0; g < total && !run.stop; g++) {
    const oppKeys = fixed ? null : simRandTeam(fmt, sim.range, Math.random), sides = fixed || simSides(mine, oppKeys, fmt);
    const want = !res.logs.win || !res.logs.lose;
    const out = simPlay(fixed ? fixedCtx : simCtx(fmt), sides, Math.random, want);
    simTally(res, sides, out, g + 1);
    if (performance.now() - t0 > 50) {
      $('#sMsg').textContent = `模擬中… ${res.n}／${total} 場`;
      await new Promise(r => setTimeout(r));
      t0 = performance.now();
    }
  }
  sim.run = null;
  sim.res = res;
  renderSim();
}
// 一場的結果加進統計：我方每隻（帶出場、先發、上場、打倒、倒下、帶出場那場贏）；
// 對手每隻（隨機隊：在隊上、被帶出場、帶出場那場我方贏；指定對手：同我方）
function simTally(res, sides, out, g) {
  res.n++;
  res.turns += out.turns;
  res[out.res > 0 ? 'win' : out.res < 0 ? 'lose' : 'draw']++;
  const kind = out.res > 0 ? 'win' : out.res < 0 ? 'lose' : '';
  if (kind && out.log && !res.logs[kind]) res.logs[kind] = { g, log: out.log, keys: sides[1].keys };
  [['my', 0], ['opp', 1]].forEach(([k, s]) => {
    sides[s].keys.forEach(key => { (res[k][key] ||= { team: 0, bring: 0, lead: 0, out: 0, kos: 0, faint: 0, win: 0 }).team++; });
    out.mons[s].forEach((m, n) => {
      // 不進化而以原型上場的超級進化記在隊上那格（隊上的型態）
      const key = sides[s].keys.includes(m.key) ? m.key : sides[s].keys.find(x => MON[x].base === m.key) || m.key;
      const t = res[k][key] ||= { team: 0, bring: 0, lead: 0, out: 0, kos: 0, faint: 0, win: 0 };
      t.bring++;
      if (!n) t.lead++;
      if (m.out) t.out++;
      t.kos += m.kos;
      if (m.hp <= 0) t.faint++;
      if (out.res > 0) t.win++;
    });
  });
}
function simResultHTML(res) {
  const n = res.n;
  if (!n) return '<p class="empty">沒有跑完任何一場。</p>';
  const rate = res.win / n, nm = k => MON[k].zh;
  const head = `<div class="res-head">模擬結果<span class="muted small">（單打 6 選 3，${res.mode === 'rand' ? `對手從排名前 ${res.range} 隨機組隊` : '對手是出戰選角的 6 隻'}，共 ${n} 場）</span></div>`
    + `<div class="c-sum ${rate >= 0.5 ? 'good' : 'bad'}"><b>勝率 ${simPctText(res.win, n)}</b>　贏 ${res.win}・輸 ${res.lose}・平手 ${res.draw}`
    + `<span class="meta">　平均 ${Math.round(res.turns / n * 10) / 10} 回合</span></div>`;
  // 對上出戰選角的對手：雙方帶誰固定，列出來
  const bringLine = res.fixed ? res.fixed.map((x, s) => `<div class="x-line"><b>${s ? '對手' : '我方'}帶</b>`
    + `<span>${x.mons.map((m, i) => `${MON[m.key].zh}${i ? '' : '（先發）'}`).join('、')}</span></div>`).join('') : '';
  const myRows = Object.entries(res.my).sort((x, y) => y[1].bring - x[1].bring).map(([k, t]) => `<div class="x-line"><b>${nm(k)}</b>`
    + `<span class="meta">帶出場 ${simPctText(t.bring, n)}・先發 ${simPctText(t.lead, n)}`
    + (t.bring ? `・有上場 ${simPctText(t.out, t.bring)}・平均打倒 ${Math.round(t.kos / t.bring * 100) / 100} 隻・被打倒 ${simPctText(t.faint, t.bring)}・帶牠那場勝率 ${simPctText(t.win, t.bring)}` : '')
    + '</span></div>').join('');
  let oppPart;
  if (res.mode === 'rand') {
    // 對手帶出場至少 MIN 場的才排（場數太少的勝率不準）
    const MIN = Math.max(3, Math.round(n * 0.02));
    const list = Object.entries(res.opp).filter(([, t]) => t.bring >= MIN).map(([k, t]) => [k, t, t.win / t.bring]);
    const row = ([k, t, r]) => `<div class="x-line"><b>${nm(k)}</b><span class="meta">對手帶牠時我方勝率 ${simPctText(t.win, t.bring)}（${t.bring} 場）`
      + `・在對手隊上時被帶出場 ${simPctText(t.bring, t.team)}・平均打倒我方 ${Math.round(t.kos / t.bring * 100) / 100} 隻</span></div>`;
    const hard = list.slice().sort((x, y) => x[2] - y[2] || y[1].bring - x[1].bring).slice(0, 10);
    const easy = list.slice().sort((x, y) => y[2] - x[2] || y[1].bring - x[1].bring).slice(0, 5);
    oppPart = `<h3>最難對付的對手</h3><p class="muted small b-intro">對手把這隻帶出場的那幾場，我方的勝率由低到高（帶出場不到 ${MIN} 場的不排）。</p>`
      + (hard.length ? hard.map(row).join('') : '<p class="muted small">場數太少，還排不出來；多跑幾場再看。</p>')
      + (easy.length ? `<h3>最好打的對手</h3>${easy.map(row).join('')}` : '');
  } else {
    oppPart = '<h3>對手每隻</h3>' + Object.entries(res.opp).filter(([, t]) => t.bring).map(([k, t]) => `<div class="x-line"><b>${nm(k)}</b>`
      + `<span class="meta">有上場 ${simPctText(t.out, t.bring)}・平均打倒我方 ${Math.round(t.kos / t.bring * 100) / 100} 隻・被打倒 ${simPctText(t.faint, t.bring)}</span></div>`).join('');
  }
  const logBox = (kind, zh) => {
    const x = res.logs[kind];
    if (!x) return '';
    return `<details class="b-more"><summary>看一場${zh}的（第 ${x.g} 場${res.mode === 'rand' ? `，對手隊伍：${x.keys.map(nm).join('、')}` : ''}）</summary>`
      + `<div class="small">${x.log.map(line => `<div>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('')}</div></details>`;
  };
  return head + bringLine + `<h3>我方每隻</h3>${myRows}` + oppPart
    + `<h3>逐回合紀錄</h3>${logBox('win', '贏') + logBox('lose', '輸') || '<p class="muted small">這次沒有分出勝負的場次。</p>'}`
    + '<p class="note">※ 怎麼模擬：雙方都用「出戰選角」的方法選帶哪 3 隻、誰先發（對手看不到我方的配招，同「對手可能帶的」；'
    + '對手選一般型態、但某顆超級石使用率過半的當成超級進化；一場只能超級進化一隻）。每回合雙方同時決定出哪一招或換誰：'
    + '把「我方每種選擇 × 對手每種選擇」都試算這一回合（傷害取平均），之後雙方用簡單規則（出最痛的一招、倒下時換上一對一打得贏的）打到分出勝負來估分數，'
    + '雙方各自找「對手不管怎麼應對都最不吃虧」的出法（同時出招的賽局解：可能是幾種選擇按比例混著出，像 70% 換人、30% 留場打，'
    + '只固定出一種會被對手抓到），照比例抽一種；倒下後換上誰也用同樣方法決定。實際出招時傷害抽 16 段亂數、'
    + '急所機率 1/24（容易擊中要害的招式、超幸運、焦點鏡各提高一級：1/8、1/2、必定），同速各 50%。'
    + '我方照「隊伍分析」登錄的配招（沒登錄的照 OP.GG 常見），對手照 OP.GG 使用率前 4 招、最常見的特性、能力點數與性格，道具同一隊不重複（使用率高的先拿）。'
    + '只算攻擊招式的傷害，加上招式本身的效果：擊掌奇襲、迎頭一擊只有上場後第一回合能用；大爆炸、自爆、薄霧炸裂用了自己倒下；'
    + '破壞光線等下一回合不能動；日光束、日光刃、電光束、挖洞、潛靈奇襲要先蓄力一回合（沒有天氣；挖洞、潛靈奇襲蓄力時打不到）；預知未來兩回合後打中；'
    + '突襲在對手沒出攻擊招式時失敗、快手還擊只在對手出先制招式時有效；流星群、近身戰等自己的能力變化（換下場歸零）；'
    + '勇鳥猛攻等反作用力、吸取拳等吸血、生命寶珠扣 1/10、鐵蹄光線扣一半；急速折返等打完換人；講究圍巾鎖招；氣勢披帶、抗性樹果用掉、拍落打掉道具。'
    + '不算：輔助招式（強化、守住、順風、回復…）、異常狀態、畏縮與降對手能力等追加效果、天氣場地、出場特性（如威嚇）、命中率（當全中）、'
    + '逆鱗的連續攻擊與混亂；連續攻擊招式照「傷害計算」以 3 下計，雜技、掃墓等威力會變的招式照資料的威力（噴火、噴水會隨 HP 變小）。'
    + '連續兩回合雙方都沒扣血也沒換人時，打不到對方的招式就不能選（模擬沒有剩飯、中毒這類每回合會變的效果，不然會原地空轉）；雙方同時全倒（如打倒對手最後一隻後被反作用力打倒）、打滿 100 回合都算平手。'
    + '只是用來比較隊伍強弱的參考：雙方用同一套判斷，實戰對手不一定這樣選。</p>';
}
$('#sMode').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !sim.run) { sim.mode = SIM_MODES[[...b.parentNode.children].indexOf(b)]; renderSim(); } });
$('#sRange').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !sim.run) { sim.range = SIM_RANGES[[...b.parentNode.children].indexOf(b)]; renderSim(); } });
$('#sN').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !sim.run) { sim.n = SIM_NS[[...b.parentNode.children].indexOf(b)]; renderSim(); } });
$('#sRun').addEventListener('click', runSim);
$('#sStop').addEventListener('click', () => { if (sim.run) sim.run.stop = true; });

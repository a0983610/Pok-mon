// ---------- 傷害計算 ----------
// atk／def：攻擊方／防守方寶可夢 key；ai：攻擊方投資；hi、di：防守方 HP、防禦／特防投資（投資都是 [能力點數, 性格 ×10]）；
// st：能力變化 [攻擊方攻擊, 攻擊方特攻, 防守方防禦, 防守方特防, 攻擊方速度, 防守方速度]；aItem／dItem：道具 key；aAb／dAb：選的特性（空＝用 abOf 的預設）；
// weather：天氣；crit：急所；extra：加算的招式；terrain：場地；hh：隊友用了幫助（只在雙打算）；walls：防守方的牆（WALLS 的 key）；burn：攻擊方灼傷；
// sa、sd：攻擊方、防守方速度投資；tw：有順風的一方、par：麻痺的一方（'a' 攻擊方／'d' 防守方）；tr：戲法空間；
// noSet：關掉「套用登錄配招」的一方（預設有登錄就套用，鏡像對戰時對手是同一隻可以關掉）
const CALC0 = { atk: '', def: '', ai: [32, 11], hi: [0, 10], di: [0, 10], st: [0, 0, 0, 0, 0, 0], aItem: '', dItem: '', aAb: '', dAb: '', weather: '', crit: false, extra: '',
  terrain: '', hh: false, walls: [], burn: false, sa: [32, 11], sd: [32, 11], tw: [], par: [], tr: false, noSet: [] };
// 我方隊伍裡寶可夢 key 登錄的配招（見 useOf；沒在隊上或沒登錄是 null）；calcSet＝這一方（'a'／'d'）實際套用的配招（關掉了就是 null）
const teamSetOf = key => { const i = key ? team.mons.indexOf(key) : -1; return i >= 0 ? team.sets[i] : null; };
const calcSet = s => calc.noSet.includes(s) ? null : teamSetOf(calc[s === 'a' ? 'atk' : 'def']);
// 套用配招時這一方的道具：登錄了就用登錄的（這一方帶不了、或不影響傷害／速度的算沒帶），沒登錄照這頁選的 cur
const itemFor = (side, set, key, cur) => set?.item ? (itemOK(side, key, set.item) ? set.item : '') : cur;
const WALLS = ['reflect', 'light-screen', 'aurora-veil'], SIDES = ['a', 'd'];
// 投資欄位：[calc 的 key, 快選檔位的元素 id, 快選檔位, 有沒有性格]（網址 ce 也照這個順序）
const INVS = [['ai', 'cAi', ATK_INV, true], ['hi', 'cHi', HP_INV, false], ['di', 'cDi', DEF_INV, true], ['sa', 'cSa', SPE_INV, true], ['sd', 'cSd', SPE_INV, true]];
// 快選檔位旁加能力點數（0～32）輸入和性格選單
INVS.forEach(([k, id, , nat]) => $('#' + id).insertAdjacentHTML('afterend', `<span class="c-inv">點數<input type="number" class="sel c-num" min="0" max="32" step="1"`
  + ` inputmode="numeric" data-inv="${k}" aria-label="能力點數（0～32）">${nat ? `<select class="sel" data-nat="${k}" aria-label="性格">`
  + '<option value="11">＋性格</option><option value="10">性格不加減</option><option value="9">−性格</option></select>' : ''}</span>`));
const calc = structuredClone(CALC0);
const CALC_MOVES = Object.keys(MOVES).filter(canCalc);
// 能力變化：下拉選單兩旁加 −1／+1／歸0 按鈕（data-st 是 calc.st 的索引，data-d 是增減量，0＝歸零）
['cSt0', 'cSt1', 'cSt2', 'cSt3', 'cSt4', 'cSt5'].forEach((id, i) => {
  const btn = (d, text) => `<button class="mini" data-st="${i}" data-d="${d}">${text}</button>`;
  $('#' + id).innerHTML = [6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6].map(v => `<option value="${v}">${v > 0 ? '+' + v : v < 0 ? '−' + -v : '0'}</option>`).join('');
  $('#' + id).insertAdjacentHTML('beforebegin', btn(-1, '−1'));
  $('#' + id).insertAdjacentHTML('afterend', btn(1, '+1') + btn(0, '歸0'));
});
$('#cExtra').innerHTML = '<option value="">（不加）</option>' + TYPES.map(t => {
  const ks = CALC_MOVES.filter(k => MOVES[k][1] === t.id).sort((x, y) => MOVES[y][3] - MOVES[x][3]);
  return ks.length ? `<optgroup label="${t.zh}">${ks.map(k => `<option value="${k}">${MOVES[k][0]}（${CAT_ZH[MOVES[k][2]]} ${MOVES[k][3]}）</option>`).join('')}</optgroup>` : '';
}).join('');
const segHTML = (list, [sp, nat]) => list.map((x, i) => `<button data-v="${i}" aria-pressed="${x[0] === sp && x[1] === nat}">${x[2]}</button>`).join('');
// 道具選單上的效果說明；排序：通用的在前，屬性道具和樹果依屬性順序
function itemNote(v) {
  if (v.berry) return `${T[v.berry].zh}招式效果絕佳時減半`;
  if (v.sash) return 'HP 全滿時撐住一擊';
  if (v.type) return `${T[v.type].zh}招式 ×${v.gem ? '1.3，限一次' : '1.2'}`;
  if (v.cat) return `${CAT_ZH[v.cat]}招式 ×1.1`;
  if (v.final) return '×1.3';
  if (v.se) return '效果絕佳時 ×1.2';
  if (v.spe) return '速度 ×1.5';
  return '皮卡丘攻擊、特攻 ×2';
}
const itemRank = v => v.type || v.berry ? 1 + IDS.indexOf(v.type || v.berry) : 0;
// 這一方（side a 攻擊方／d 防守方）的寶可夢 key 能不能帶道具 item：超級進化要帶超級石，電氣球限皮卡丘
const itemOK = (side, key, item) => { const v = DMG_ITEMS[item], m = MON[key]; return !!v?.side.includes(side) && !m?.base && (!v.mon || (m && family(m) === v.mon)); };
// 道具選單：只列影響傷害或速度的道具，這隻 OP.GG 常帶的排前面
function itemOptions(side, key, cur) {
  if (MON[key]?.base) return '<option value="">超級進化（帶超級石）</option>';
  const use = Object.fromEntries((key && useOf(key, team.fmt)?.items) || []);
  const list = Object.entries(DMG_ITEMS).filter(([k]) => itemOK(side, key, k)).sort(([, x], [, y]) => itemRank(x) - itemRank(y));
  const opt = ([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${ITEMS[k][0]}（${itemNote(v)}${use[k] ? `・這隻 ${use[k]}% 帶` : ''}）</option>`;
  const top = list.filter(([k]) => use[k]).sort(([x], [y]) => use[y] - use[x]), rest = list.filter(([k]) => !use[k]);
  return '<option value="">不帶影響傷害或速度的道具</option>'
    + (top.length ? `<optgroup label="這隻常帶">${top.map(opt).join('')}</optgroup>` : '')
    + `<optgroup label="${top.length ? '其他' : '影響傷害或速度的道具'}">${rest.map(opt).join('')}</optgroup>`;
}
// 寶可夢 key 實際用的特性（見 defAbOf，看目前的單打／雙打）
const abOf = (key, cur) => defAbOf(key, team.fmt, cur);
// 特性選單上算「影響這裡的計算」的：傷害（ATK_ABILS／DEF_ABILS）加上速度（speedOf）
const SPE_ABIL_KEYS = [...Object.keys(SPE_ABILS), 'quick-feet'];
const ATK_REL = new Set([...ATK_ABILS, ...SPE_ABIL_KEYS]), DEF_REL = new Set([...DEF_ABILS, ...SPE_ABIL_KEYS]);
// 特性選單：這隻的 OP.GG 常用特性（附使用率），rel 以外的標「不影響這裡的計算」；超級進化只列固定特性
function abilOptions(rel, key, cur) {
  const m = MON[key], tag = k => rel.has(k) ? '' : '・不影響這裡的計算';
  if (!m) return '<option value="">（先選寶可夢）</option>';
  if (m.base) { const k = m.megaAbils[0] || ''; return `<option value="${k}">${abilZh(k) || '固定特性'}（超級進化${tag(k)}）</option>`; }
  const list = useOf(key, team.fmt)?.abils || [];
  if (!list.length) return '<option value="">沒有 OP.GG 特性統計（不算特性）</option>';
  return list.map(([k, p]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${abilZh(k) || k}（${p}%${tag(k)}）</option>`).join('');
}
// 出場就開天氣的特性（FIELD_SET 對應天氣）
const ENTRY_WEATHER = ['drought', 'drizzle', 'sand-stream', 'snow-warning'];
// 出場就開場地的特性（FIELD_SET 對應場地）
const ENTRY_TERRAIN = ['electric-surge', 'grassy-surge', 'misty-surge', 'psychic-surge'];
// 威嚇對攻擊方特性 ab 的效果 [攻擊變化, 特攻變化]，照 Smogon util.ts 的 checkIntimidate；不吃威嚇回傳 null
function intimidateOn(ab) {
  if (['clear-body', 'white-smoke', 'hyper-cutter', 'full-metal-body', 'inner-focus', 'own-tempo', 'oblivious', 'scrappy'].includes(ab)) return null;
  if (['contrary', 'defiant', 'guard-dog'].includes(ab)) return [1, 0];
  return ab === 'simple' ? [-2, 0] : ab === 'competitive' ? [-1, 2] : [-1, 0];
}
// 快選：我方隊伍（隊伍分析）挑了的寶可夢和對手（出戰選角）
// 對手後面接著列出牠常帶超級石的超級進化型態（megaInfo 算進去的，同出戰選角的對位判斷）
function quickHTML(side) {
  const btn = (k, tip = '') => `<button class="mini" data-side="${side}" data-k="${k}" aria-pressed="${calc[side] === k}"${tip ? ` title="${tip}"` : ''}>${MON[k].zh}</button>`;
  const mine = team.mons.filter(Boolean), opp = bring.opp.filter(Boolean);
  const oppBtns = opp.flatMap(k => [btn(k), ...megaInfo(MON[k], team.fmt).filter(x => x.counted)
    .map(x => btn(x.mon.key, `${MON[k].zh}${x.p != null ? `有 ${x.p}% 帶超級石` : '可能超級進化'}`))]);
  return (mine.length ? `<span class="meta">我方</span>${mine.map(k => btn(k)).join('')}` : '') + (opp.length ? `<span class="meta">對手</span>${oppBtns.join('')}` : '');
}
// 攻擊方／防守方各自的屬性篩選（不存網址，選好寶可夢就清掉）；有選屬性才列出符合的寶可夢
const calcPick = { atk: [], def: [] };
function calcListHTML(side) {
  const sel = calcPick[side];
  if (!sel.length) return '';
  const list = monsOfTypes(sel, team.fmt);
  return `<div class="b-label">有${sel.map(id => T[id].zh).join('＋')}屬性的寶可夢<span class="muted small">共 ${list.length} 隻${list.length ? `，依${FMT_ZH[team.fmt]}排名；點一下帶入` : ''}</span></div>`
    + (list.length ? `<div class="qpick">${list.map(m => `<button data-side="${side}" data-k="${m.key}">${m.zh}${chips(m.types)}</button>`).join('')}</div>`
      : '<p class="muted small b-intro">名單裡沒有這種屬性組合的寶可夢。</p>');
}
const hpPct = (v, hp) => Math.floor(v * 1000 / hp) / 10;
const stgText = v => v > 0 ? '+' + v : '−' + -v;
// 一句話總結 A 打 D：會被一擊打倒的招式，或最痛的一招（pre 放在句首；先制招式標出來，因為不看速度）
const mvName = k => `<b>${MOVES[k][0]}</b>${FLAG.priority.has(k) ? '（先制）' : ''}`;
function dmgSumHTML(A, D, { ok, kos, top }, pre = '') {
  return kos.length ? `<div class="c-sum bad">${pre}${D.zh}會被一擊打倒：${kos.map(x => `${mvName(x.k)} ${koText(x.r.ko).text}`).join('、')}</div>`
    : top ? `<div class="c-sum good">${pre}${D.zh}不會被一擊打倒；最痛的是 ${mvName(top.k)} ${hpPct(top.r.min, top.r.hp)}～${hpPct(top.r.max, top.r.hp)}%，${koText(top.r.ko).text}</div>`
    : ok.length ? `<div class="c-sum good">${pre}${A.zh}的招式對${D.zh}都沒有效果。</div>` : '';
}
function calcHTML() {
  // sa／sd：兩方套用的我方登錄配招（calcSet）：有填的特性、道具、招式、能力點數與性格用登錄的，沒填的照這頁的設定
  const A = MON[calc.atk], D = MON[calc.def], sa = calcSet('a'), sd = calcSet('d');
  const aab = sa?.ab || abOf(calc.atk, calc.aAb), dab = sd?.ab || abOf(calc.def, calc.dAb);
  const aItem = itemFor('a', sa, calc.atk, calc.aItem), dItem = itemFor('d', sd, calc.def, calc.dItem);
  const spA = sa && hasSpread(sa) ? { sp: sa.sp, nat: sa.nat } : {}, spD = sd && hasSpread(sd) ? { sp: sd.sp, nat: sd.nat } : {};
  const a = { key: calc.atk, inv: calc.ai, ...spA, st: { atk: calc.st[0], spa: calc.st[1] }, item: aItem, ab: aab, set: sa };
  const d = { key: calc.def, hp: calc.hi, inv: calc.di, ...spD, st: { def: calc.st[2], spd: calc.st[3] }, item: dItem, ab: dab };
  const hh = calc.hh && team.fmt === 'd';
  const o = { fmt: team.fmt, weather: calc.weather, crit: calc.crit, terrain: calc.terrain, hh, walls: calc.walls, burn: calc.burn };
  const fw = dmgRows(a, d, o, calc.extra), { use, ok, why } = fw;
  // 反擊＝防守方打攻擊方，和按「⇄ 對調」看到的一樣：特性跟著寶可夢、投資檔位不動（攻擊投資套在防守方、HP／防禦投資套在攻擊方），
  // 道具（對調後兩邊都能帶的只有講究圍巾，不影響傷害）、能力變化、加算招式、灼傷、幫助、牆不算；天氣、場地、急所照舊。
  // 套用登錄配招的一方，投資和道具照登錄的（道具是那隻自己帶的，反過來打也一樣）
  const bk = dmgRows({ key: calc.def, inv: calc.ai, ...spD, st: { atk: 0, spa: 0 }, item: itemFor('a', sd, calc.def, ''), ab: dab, set: sd },
    { key: calc.atk, hp: calc.hi, inv: calc.di, ...spA, st: { def: 0, spd: 0 }, item: itemFor('d', sa, calc.atk, ''), ab: aab }, { ...o, hh: false, walls: [], burn: false }, '');
  const sps = [spA, spD];
  const { spd, first } = speedPair(...SIDES.map((s, i) => ({ key: [calc.atk, calc.def][i], inv: [calc.sa, calc.sd][i], ...sps[i], st: calc.st[4 + i], item: [aItem, dItem][i],
    ab: [aab, dab][i], tw: calc.tw.includes(s), par: calc.par.includes(s), status: calc.par.includes(s) || (!i && calc.burn) })), { weather: calc.weather, terrain: calc.terrain, tr: calc.tr });
  const spdText = (m, i) => `${m.zh} <b>${spd[i].v}</b><span class="meta">（${[sps[i].sp ? `登錄配招 點數 ${sps[i].sp[5]}${NAT_ZH[natOf(sps[i].nat, 5)]}`
    : `投資 ${invName(SPE_INV, [calc.sa, calc.sd][i])}`, calc.st[4 + i] && `速度 ${stgText(calc.st[4 + i])}`, ...spd[i].notes].filter(Boolean).join('・')}）</span>`;
  // 上方的能力值（套用登錄配招時照登錄的點數與性格）
  const statAt = (m, x, i, inv) => { const [p, n] = invAt(x, i, inv); return statOf(m.bs[i], p, i, n); };
  const aname = spA.sp ? '登錄配招' : invName(ATK_INV, calc.ai), dname = spD.sp ? '登錄配招' : `HP ${invName(HP_INV, calc.hi)}・防禦／特防 ${invName(DEF_INV, calc.di)}`;
  const aItemZh = sa?.item || calc.aItem, dItemZh = sd?.item || calc.dItem;
  const stg = (v, zh) => v ? `<span>${zh} ${stgText(v)}</span>` : '';
  const row = ({ k, p, r }) => {
    const head = `<b>${MOVES[k][0]}</b>${chip(r.type)}${mtag(r.eff)}<span class="meta">${CAT_ZH[r.cat]} ${r.power}`
      + `${r.hits > 1 ? ` ×${r.hits} 下${r.hitNote ? `（${r.hitNote}）` : ''}` : ''}${r.stab > 4096 ? `・本系${r.stab > 6144 ? ' ×2' : ''}` : ''}`
      + `${r.spread ? '・範圍 ×0.75' : ''}${ALWAYS_CRIT.has(k) ? '・必定急所' : ''}${FLAG.priority.has(k) ? '・先制' : ''}・${p ? (sa?.moves.some(Boolean) ? '登錄' : `使用率 ${p}%`) : '加算'}</span>`;
    if (!r.eff) return `<div class="dmg"><div class="dmg-h">${head}<span class="ko">沒有效果${r.immuneBy ? `（${abilZh(r.immuneBy)}）` : r.blockedBy ? `（${r.blockedBy}）` : ''}</span></div></div>`;
    const lo = hpPct(r.min, r.hp), hi = hpPct(r.max, r.hp), kt = koText(r.ko);
    const extra = [...r.notes, r.berry && `${ITEMS[dItem][0]}減半第一下`, r.endured && `${ITEMS[r.endured]?.[0] || abilZh(r.endured)}撐住第一下`].filter(Boolean);
    return `<div class="dmg"><div class="dmg-h">${head}<span class="ko k${kt.n}">${kt.text}</span></div>`
      + `<div class="dmg-bar"><span style="width:${Math.min(100, lo)}%"></span><span class="rng" style="width:${Math.min(100, hi) - Math.min(100, lo)}%"></span></div>`
      + `<div class="meta">${lo}～${hi}%（${r.min}～${r.max}／HP ${r.hp}）${extra.map(s => '・' + s).join('')}</div></div>`;
  };
  // 提示：開天氣／場地的特性和目前天氣／場地不同、防守方有威嚇（攻擊方能力變化還沒調時）
  const hints = [[A, aab], [D, dab]].flatMap(([m, k]) => {
    const f = FIELD_SET[k], wx = ENTRY_WEATHER.includes(k), cur = wx ? calc.weather : calc.terrain;
    if (!(wx || ENTRY_TERRAIN.includes(k)) || f === cur) return [];
    return `<div class="x-line"><span class="x-msg">${m.zh}的${abilZh(k)}出場會變${FIELD_ZH[f]}，目前是${FIELD_ZH[cur] || (wx ? '無天氣' : '無場地')}</span>`
      + `<button class="mini" data-set${wx ? 'w' : 't'}="${f}">改成${FIELD_ZH[f]}</button></div>`;
  });
  const im = dab === 'intimidate' && intimidateOn(aab);
  if (im && !calc.st[0] && !calc.st[1]) {
    const txt = [im[0] && `攻擊 ${im[0] > 0 ? '+' : '−'}${Math.abs(im[0])}`, im[1] && `特攻 +${im[1]}`].filter(Boolean).join('、');
    hints.push(`<div class="x-line"><span class="x-msg">${D.zh}的${abilZh(dab)}出場會讓${A.zh}${txt}</span><button class="mini" data-im="${im.join('.')}">套用${txt}</button></div>`);
  }
  // 能力點數合計超過 66（每隻六項合計的上限）：攻擊方算攻擊／特攻＋速度，防守方算 HP＋防禦／特防＋速度（套用登錄點數的一方在隊伍分析提示，這裡不算）
  [['攻擊方', A, [['攻擊／特攻', calc.ai], ['速度', calc.sa]], spA], ['防守方', D, [['HP', calc.hi], ['防禦／特防', calc.di], ['速度', calc.sd]], spD]].forEach(([side, m, parts, sp]) => {
    if (sp.sp) return;
    const sum = parts.reduce((s, [, v]) => s + v[0], 0);
    if (sum > 66) hints.push(`<div class="x-line"><span class="x-msg">⚠ ${side}${m.zh}的能力點數 ${parts.map(([zh, v]) => `${zh} ${v[0]}`).join('＋')}＝${sum}，超過上限 66</span></div>`);
  });
  return `<div class="res-head">${A.zh}${chips(A.types)} → ${D.zh}${chips(D.types)}`
    + `<span class="muted small">（${[FMT_ZH[team.fmt], FIELD_ZH[calc.weather], FIELD_ZH[calc.terrain], calc.tr && '戲法空間', hh && '幫助', calc.burn && '灼傷',
      ...calc.walls.map(w => MOVES[w][0]), calc.crit && '急所'].filter(Boolean).join('・')}）</span></div>`
    + `<div class="bst">攻擊方（${aname}）<span>攻擊 <b>${statAt(A, a, 1, calc.ai)}</b></span><span>特攻 <b>${statAt(A, a, 3, calc.ai)}</b></span>`
    + `${stg(calc.st[0], '攻擊')}${stg(calc.st[1], '特攻')}${aab ? `<span>${abilZh(aab) || '固定特性'}</span>` : ''}${aItemZh ? `<span>${ITEMS[aItemZh][0]}</span>` : ''}</div>`
    + `<div class="bst">防守方（${dname}）<span>HP <b>${statAt(D, d, 0, calc.hi)}</b></span>`
    + `<span>防禦 <b>${statAt(D, d, 2, calc.di)}</b></span><span>特防 <b>${statAt(D, d, 4, calc.di)}</b></span>`
    + `${stg(calc.st[2], '防禦')}${stg(calc.st[3], '特防')}${dab ? `<span>${abilZh(dab) || '固定特性'}</span>` : ''}${dItemZh ? `<span>${ITEMS[dItemZh][0]}</span>` : ''}</div>`
    + hints.join('')
    + `<div class="c-sum info">速度：${spdText(A, 0)} ／ ${spdText(D, 1)} → `
    + `${first < 0 ? '同速，誰先動各 50%' : `<b>${first ? D.zh : A.zh}</b>先動${calc.tr ? '（戲法空間：速度慢的先動）' : ''}`}`
    + '（先制招式不看速度）</div>'
    + dmgSumHTML(A, D, fw)
    + (dmgSumHTML(D, A, bk, `反擊（${D.zh}打回來）：`)
      || `<div class="c-sum">反擊（${D.zh}打回來）：${bk.use.length ? '常用招式裡沒有能算傷害的攻擊招式。'
        : `${D.zh}在${FMT_ZH[team.fmt]}沒有 OP.GG 常用招式統計，按「⇄ 對調」後用「加算招式」選一招來算。`}</div>`)
    + (use.length ? '' : `<p class="muted small b-intro">${A.zh}在${FMT_ZH[team.fmt]}沒有 OP.GG 常用招式統計，用上面的「加算招式」選一招來算。</p>`)
    + ok.map(row).join('')
    + Object.entries(why).map(([w, ns]) => `<div class="x-line"><span class="x-msg">不算（${w}）：</span>${ns.join('、')}</div>`).join('')
    + '<p class="note">※ 公式照 Smogon damage-calc 的寶可夢冠軍版：Lv50、個體值 31，算進能力值與投資、本系 ×1.5、屬性相剋、亂數 85～100%（16 段）、'
    + '雙打範圍招式 ×0.75、天氣、急所 ×1.5、能力變化、特性、道具。投資套在這招用到的那項能力：物理招看攻擊打防禦、特殊招看特攻打特防（精神衝擊打防禦、撲擊用自己的防禦）；'
    + '「滿投資」＝能力點數 32，「＋性格」再 ×1.1；也可以在檔位旁直接輸入能力點數（每項 0～32，六項合計最多 66）並選性格'
    + '（＋性格 ×1.1、−性格 ×0.9；HP 沒有性格），超過 66 時結果上方會提示。上方能力值是投資後、能力變化前的數字。列出的招式是 OP.GG 常用招式裡的攻擊招式，依傷害由高到低排。'
    + '特性：超級進化用固定特性，其他預設用 OP.GG 使用率最高的，可在選單改；要看場上狀況的不算（如猛火、引火的強化、正電／負電、分析、大將、鬥爭心、畫皮），'
    + '毅力在勾「灼傷」時算（攻擊 ×1.5、不減半）。開天氣、開場地的特性和威嚇不會自動套用，結果上方會提示。破格會無視防守方的特性。電光束出招前特攻 +1 已算進去。'
    + '幫助（雙打才有）威力 ×1.5；灼傷時物理招式傷害 ×½。反射壁擋物理、光牆擋特殊、極光幕兩種都擋（不和前兩者疊加），單打 ×½、雙打 ×⅔；'
    + '急所、穿透無視牆，劈瓦、精神之牙、怒牛會先打破牆。場地：在地面上（不是飛行屬性、沒有飄浮）的攻擊方用電氣／青草／精神場地對應屬性的招式威力 ×1.3；'
    + '打在地面上的防守方時，薄霧場地讓龍招式、青草場地讓地震／重踏威力 ×½，精神場地擋下先制招式；大地波動、電力上升、廣域戰力、薄霧炸裂照場地改變威力或屬性，'
    + '草之毛皮在青草場地防禦 ×1.5。拍落當作對手有帶道具：第一下威力 ×1.5，道具被拍掉後連用不再加倍（超級進化帶的超級石拍不掉、不加倍；黏著每下都加倍）。'
    + '其他威力有條件會變的招式（如雜技、憤怒之拳）以基本威力計，噴火／噴水以 HP 全滿計。'
    + '幾擊＝連續用同一招幾次打倒，不含回復、吃剩的東西、文柚果；抗性樹果、多重鱗片只算第一下，氣勢披帶、結實只在 HP 全滿時撐住一下。'
    + '速度也照 Smogon 冠軍版：速度投資（預設 32＋性格，即最速）→ 能力變化 → 順風 ×2、葉綠素／悠游自如／撥沙／撥雪在對應天氣與衝浪之尾在電氣場地 ×2、'
    + '飛毛腿在麻痺或灼傷時 ×1.5、講究圍巾 ×1.5 → 麻痺 ×½（飛毛腿不減）；同速時誰先動各 50%。先制招式（標「先制」）不看速度；'
    + '勾「戲法空間」時速度慢的先動（同 Pokémon Showdown，同速仍各 50%、先制招式仍優先）；不含加速這類回合中的變化。'
    + `快選的「對手」會接著列出牠 OP.GG 道具統計有 ${ROLE_PCT}% 以上帶超級石的超級進化型態（同出戰選角的判斷）。`
    + '「反擊」＝防守方打攻擊方最痛的一招，和按「⇄ 對調」看到的相同：投資檔位不動'
    + '（上方的攻擊投資套在防守方、HP／防禦投資套在攻擊方），能力變化、道具、灼傷、幫助、牆不算。'
    + '選到「隊伍分析」登錄了配招的我方隊員時，預設套用登錄的招式、特性、道具、能力點數與性格（反擊也照登錄的投資與道具；沒填的欄位照這頁的設定），'
    + '列出的招式標「登錄」；對手剛好是同一隻（鏡像對戰）時，把那一方的「套用」關掉。</p>';
}
function renderCalc() {
  [['atk', 'aItem', 'a', '#cAtk', '#cAtkQ', '#cAItem', 'aAb', '#cAAb', ATK_REL], ['def', 'dItem', 'd', '#cDef', '#cDefQ', '#cDItem', 'dAb', '#cDAb', DEF_REL]]
    .forEach(([side, it, s, inp, q, sel, ab, abSel, rel]) => {
      if (calc[it] && !itemOK(s, calc[side], calc[it])) calc[it] = '';
      $(inp).innerHTML = calc[side] ? `${MON[calc[side]].zh}${chips(MON[calc[side]].types)}`
        : '<span class="muted small">還沒選；點下方我方／對手，或選屬性找寶可夢</span>';
      $(q).innerHTML = quickHTML(side);
      renderPick($(inp + 'P'), calcPick[side]);
      $(inp + 'L').innerHTML = calcListHTML(side);
      $(sel).innerHTML = itemOptions(s, calc[side], calc[it]);
      $(sel).disabled = !!MON[calc[side]]?.base;
      $(abSel).innerHTML = abilOptions(rel, calc[side], abOf(calc[side], calc[ab]));
      $(abSel).disabled = $(abSel).options.length < 2;
      // 我方登錄了配招：這一方多一列「套用」開關；套用時登錄的特性／道具鎖住選單顯示登錄的，有登錄能力點數或性格就收起投資檔位
      const own = teamSetOf(calc[side]), set = calcSet(s), row = $(s === 'a' ? '#cASet' : '#cDSet');
      row.hidden = !own;
      row.innerHTML = own ? `<span class="c-l">配招</span><label class="check"><input type="checkbox" data-useset="${s}"${set ? ' checked' : ''}> 套用隊伍分析登錄的配招</label>`
        + `<span class="muted small">${[own.moves.filter(Boolean).map(k => MOVES[k][0]).join('・'), hasSpread(own) && '能力點數與性格'].filter(Boolean).join('；')}</span>` : '';
      if (set?.item && !MON[calc[side]].base) {
        $(sel).innerHTML = `<option value="">登錄：${ITEMS[set.item][0]}${itemOK(s, calc[side], set.item) ? '' : '（不影響這裡的計算）'}</option>`;
        $(sel).disabled = true;
      }
      if (set?.ab) { $(abSel).innerHTML = `<option value="">登錄：${abilZh(set.ab) || set.ab}</option>`; $(abSel).disabled = true; }
      (s === 'a' ? ['cAi', 'cSa'] : ['cHi', 'cDi', 'cSd']).forEach(id => { $('#' + id).closest('.c-f').hidden = !!(set && hasSpread(set)); });
    });
  // 正在輸入的點數欄不覆寫（離開欄位時 change 會再重畫成實際的值）
  INVS.forEach(([k, id, list]) => {
    $('#' + id).innerHTML = segHTML(list, calc[k]);
    const num = document.querySelector(`[data-inv="${k}"]`), nat = document.querySelector(`[data-nat="${k}"]`);
    if (num !== document.activeElement) num.value = calc[k][0];
    if (nat) nat.value = calc[k][1];
  });
  calc.st.forEach((v, i) => { $('#cSt' + i).value = v; });
  $('#cExtra').value = calc.extra;
  $('#cW').innerHTML = [['', '無天氣'], ...WEATHERS.map(w => [w, FIELD_ZH[w]])].map(([w, zh]) => `<button data-w="${w}" aria-pressed="${calc.weather === w}">${zh}</button>`).join('');
  $('#cT').innerHTML = [['', '無場地'], ...TERRAINS.map(t => [t, FIELD_ZH[t]])].map(([t, zh]) => `<button data-t="${t}" aria-pressed="${calc.terrain === t}">${zh}</button>`).join('');
  $('#cCrit').checked = calc.crit;
  $('#cTR').checked = calc.tr;
  $('#cBurn').checked = calc.burn;
  $('#cHH').checked = calc.hh;
  $('#cHHw').hidden = team.fmt !== 'd';
  document.querySelectorAll('[data-wall]').forEach(c => { c.checked = calc.walls.includes(c.dataset.wall); });
  document.querySelectorAll('[data-tw]').forEach(c => { c.checked = calc.tw.includes(c.dataset.tw); });
  document.querySelectorAll('[data-par]').forEach(c => { c.checked = calc.par.includes(c.dataset.par); });
  document.querySelectorAll('#cFmt button').forEach(b => b.setAttribute('aria-pressed', b.dataset.fmt === team.fmt));
  $('#cResult').innerHTML = calc.atk && calc.def ? calcHTML()
    : '<p class="empty">選好攻擊方和防守方後，這裡會列出攻擊方常用攻擊招式打過去的傷害、佔防守方 HP 的比例，以及幾下會被打倒。</p>';
  saveState();
}
// 換寶可夢時清掉那一方的道具、選的特性和麻痺；換攻擊方也清掉加算招式和灼傷（灼傷、麻痺是那一隻的狀態；幫助、牆、順風、天氣、場地是場上的，留著）。
// 選好就清掉那一方的屬性篩選，收起清單
function setCalcMon(side, key) {
  calcPick[side] = [];
  if (calc[side] !== key) {
    calc[side] = key;
    if (side === 'atk') { calc.aItem = calc.aAb = calc.extra = ''; calc.burn = false; } else calc.dItem = calc.dAb = '';
    calc.par = calc.par.filter(s => s !== side[0]);
    calc.noSet = calc.noSet.filter(s => s !== side[0]);
  }
  renderCalc();
}
$('#p-calc').addEventListener('click', e => {
  const b = e.target.closest('button'), seg = b?.closest('.seg')?.id;
  if (!b) return;
  if (b.dataset.k) setCalcMon(b.dataset.side, b.dataset.k);
  else if (b.classList.contains('tbtn')) { toggleSel(calcPick[b.closest('.c-pick').dataset.side], b.dataset.id, 2); renderCalc(); }
  else if (INVS.some(x => x[1] === seg)) { const [k, , list] = INVS.find(x => x[1] === seg); calc[k] = list[+b.dataset.v].slice(0, 2); renderCalc(); }
  else if (seg === 'cW') { calc.weather = b.dataset.w; renderCalc(); }
  else if (seg === 'cT') { calc.terrain = b.dataset.t; renderCalc(); }
  else if (b.dataset.setw) { calc.weather = b.dataset.setw; renderCalc(); }
  else if (b.dataset.sett) { calc.terrain = b.dataset.sett; renderCalc(); }
  else if (b.dataset.im) { [calc.st[0], calc.st[1]] = b.dataset.im.split('.').map(Number); renderCalc(); }
  else if (b.dataset.st) { const i = +b.dataset.st, d = +b.dataset.d; calc.st[i] = d ? Math.max(-6, Math.min(6, calc.st[i] + d)) : 0; renderCalc(); }
});
$('#p-calc').addEventListener('change', e => {
  const id = e.target.id;
  if (/^cSt\d$/.test(id)) calc.st[+id[3]] = +e.target.value;
  else if (id === 'cAItem') calc.aItem = e.target.value;
  else if (id === 'cDItem') calc.dItem = e.target.value;
  else if (id === 'cAAb') calc.aAb = e.target.value;
  else if (id === 'cDAb') calc.dAb = e.target.value;
  else if (id === 'cExtra') calc.extra = e.target.value;
  else if (id === 'cCrit') calc.crit = e.target.checked;
  else if (id === 'cTR') calc.tr = e.target.checked;
  else if (id === 'cBurn') calc.burn = e.target.checked;
  else if (id === 'cHH') calc.hh = e.target.checked;
  else if (e.target.dataset.wall) calc.walls = WALLS.filter(w => w === e.target.dataset.wall ? e.target.checked : calc.walls.includes(w));
  else if (e.target.dataset.tw) calc.tw = SIDES.filter(s => s === e.target.dataset.tw ? e.target.checked : calc.tw.includes(s));
  else if (e.target.dataset.par) calc.par = SIDES.filter(s => s === e.target.dataset.par ? e.target.checked : calc.par.includes(s));
  else if (e.target.dataset.nat) calc[e.target.dataset.nat] = [calc[e.target.dataset.nat][0], +e.target.value];
  else if (e.target.dataset.useset) calc.noSet = SIDES.filter(s => s === e.target.dataset.useset ? !e.target.checked : calc.noSet.includes(s));
  else if (e.target.dataset.inv) e.target.value = calc[e.target.dataset.inv][0];
  else return;
  renderCalc();
});
// 能力點數：邊打邊算，夾在 0～32；清空時先不動，離開欄位（change）再重畫成目前的值
$('#p-calc').addEventListener('input', e => {
  const k = e.target.dataset.inv;
  if (!k || e.target.value === '') return;
  calc[k] = [Math.max(0, Math.min(32, Math.round(+e.target.value) || 0)), calc[k][1]];
  renderCalc();
});
$('#cFmt').addEventListener('click', setFmt);
// 對調：特性和速度相關的（速度投資、速度變化、麻痺、那一方的順風）跟著寶可夢走；道具只留換邊後還能帶的（兩邊都能帶的只有講究圍巾）；
// 攻擊／防禦類能力變化、加算招式和只屬於某一方的灼傷、幫助、牆清掉（天氣、場地、戲法空間留著）
$('#cSwap').addEventListener('click', () => {
  const [ai, di] = [calc.aItem, calc.dItem], flip = list => SIDES.filter(s => list.includes(s === 'a' ? 'd' : 'a'));
  [calc.atk, calc.def, calc.aAb, calc.dAb] = [calc.def, calc.atk, calc.dAb, calc.aAb];
  calc.aItem = itemOK('a', calc.atk, di) ? di : '';
  calc.dItem = itemOK('d', calc.def, ai) ? ai : '';
  calc.extra = '';
  [calc.sa, calc.sd] = [calc.sd, calc.sa];
  calc.st = [0, 0, 0, 0, calc.st[5], calc.st[4]];
  calc.tw = flip(calc.tw);
  calc.par = flip(calc.par);
  calc.noSet = flip(calc.noSet);
  calc.burn = calc.hh = false;
  calc.walls = [];
  renderCalc();
});
$('#cClear').addEventListener('click', () => { Object.assign(calc, structuredClone(CALC0)); calcPick.atk = []; calcPick.def = []; renderCalc(); });

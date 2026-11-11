// ---------- 對戰中 ----------
// 對戰時看場上雙方：我方每一招的傷害、能不能打倒、誰先動，對手先動又打得倒我方時警告；後排換上來打不打得贏（不預測對手出招）。
// 我方沿用隊伍分析（含登錄的配招），對手沿用出戰選角的 6 隻。
// me／opp：場上位置放的隊伍格子／對手格子索引（-1＝空；單打只用第 1 個位置）；sel：點下方寶可夢時要放進哪個位置；
// st：場上位置的能力變化 [攻擊, 防禦, 特攻, 特防, 速度]（換下場就清掉，同遊戲）；hp：我方各格剩下的 HP（null＝全滿）；ohp：對手各格剩下的 HP %；
// item：對手各格標的道具（空＝用預設 btOppItems、'-'＝沒有道具）；ab：對手各格選的特性（空＝用 defAbOf 的預設）；
// form：各格選的型態（空＝隊伍分析／出戰選角裡的那個，用來切換超級進化前後）；weather、terrain、tr 戲法空間、tw 有順風的一方（'me'／'opp'）；
// bring：我方這場帶的隊伍格子（null＝照出戰選角第 1 名組合，見 btBrought）；seen：對手各格出場過沒（放上場就標）；
// used：對手各格用過的招式 key（見 btOppSet）；osp：對手各格改過的能力點數／性格 { sp?, nat? }（沒改的那項照 OP.GG 最常見，null＝都沒改）；
// keys：記錄時各格的寶可夢 key（隊伍或對手換了寶可夢，那格的紀錄就清掉）
const BT_SIDES = ['me', 'opp'];
const BT_STATS = [['atk', '攻擊'], ['def', '防禦'], ['spa', '特攻'], ['spd', '特防'], ['spe', '速度']];
const btSt0 = () => [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
const battle0 = () => ({ me: [-1, -1], opp: [-1, -1], sel: { me: 0, opp: 0 }, st: { me: btSt0(), opp: btSt0() },
  hp: Array(6).fill(null), ohp: Array(6).fill(100), item: Array(6).fill(''), ab: Array(6).fill(''), form: { me: Array(6).fill(''), opp: Array(6).fill('') },
  weather: '', terrain: '', tr: false, tw: [], bring: null, seen: Array(6).fill(false), used: Array.from({ length: 6 }, () => []), osp: Array(6).fill(null),
  keys: { me: team.mons.slice(), opp: bring.opp.slice() } });
const battle = battle0();
// 特性選單上算「影響這裡的計算」的（傷害、速度都看）
const BT_REL = new Set([...ATK_REL, ...DEF_REL]);
// 場上幾隻：單打 1、雙打 2（同先發的數量）
const btN = () => LEAD_N[team.fmt];
const btList = side => side === 'me' ? team.mons : bring.opp;
const btKey = (side, i) => battle.form[side][i] || btList(side)[i];
// 格子 i 可以切換的型態（原型＋超級進化）；我方只有隊伍裡選了超級進化型態的能切回原型（一般型態登錄不了超級石）；不能切換回傳 []
function btForms(side, i) {
  const m0 = MON[btList(side)[i]];
  if (!m0) return [];
  const fam = MON[family(m0)], forms = side === 'me' ? (m0.base ? [fam, m0] : []) : [fam, ...megasOf(fam)];
  return forms.length > 1 ? forms : [];
}
// 隊伍或對手換了寶可夢：那格的紀錄清掉，在場上就下場；我方換了寶可夢時「這場帶的」改回照出戰選角
function syncBattle() {
  BT_SIDES.forEach(side => btList(side).forEach((k, i) => {
    if (battle.keys[side][i] === k) return;
    battle.keys[side][i] = k;
    battle.form[side][i] = '';
    if (side === 'me') { battle.hp[i] = null; battle.bring = null; }
    else { battle.ohp[i] = 100; battle.item[i] = ''; battle.ab[i] = ''; battle.seen[i] = false; battle.used[i] = []; battle.osp[i] = null; }
    battle[side].forEach((j, p) => { if (j === i) { battle[side][p] = -1; battle.st[side][p] = [0, 0, 0, 0, 0]; } });
  }));
}
// 我方這場帶的隊伍格子（只算挑了寶可夢的）：自己改過就照改的，不然照出戰選角第 1 名組合（bringPlan；還沒填對手就是全部）。
// 隊伍、配招、對手、單打／雙打沒變就不重算
const btPlan = { k: null, v: [] };
function btBrought() {
  const named = team.mons.map((k, i) => k ? i : -1).filter(i => i >= 0);
  if (battle.bring) return battle.bring.filter(i => team.mons[i]);
  const members = team.slots.map((s, i) => [s, i]).filter(([s]) => s.length), opps = bring.opp.filter(k => MON[k]).map(k => MON[k]);
  if (!opps.length) return named;
  const k = JSON.stringify([team.slots, team.mons, team.sets, bring.opp, team.fmt]);
  if (btPlan.k !== k) {
    const plan = bringPlan(members.map(([s, i]) => ({ defs: s, key: team.mons[i], set: team.sets[i] })), opps, team.fmt);
    Object.assign(btPlan, { k, v: plan.combos[0].idx.map(j => members[j][1]) });
  }
  return btPlan.v.filter(i => team.mons[i]);
}
// 對手各格實際算的道具：標了的照標的（'-'＝沒有道具），沒標的預設牠 OP.GG 最常帶的。同一隊不能帶重複的道具：
// 標了的先佔，其餘依使用率由高到低分配（同一顆給使用率高的那隻，另一隻改拿牠下一個常帶的）；超級進化帶自己的超級石（回傳 ''，不影響計算）。
// unset＝把這一格當成沒標（選單上顯示「預設是什麼」用）
function btOppItems(unset = -1) {
  const out = Array(6).fill(''), taken = new Set(), done = new Set();
  const free = i => bring.opp[i] && !MON[btKey('opp', i)].base, mark = i => i === unset ? '' : battle.item[i];
  bring.opp.forEach((k, i) => { const it = mark(i); if (free(i) && it && it !== '-') { out[i] = it; taken.add(it); } });
  bring.opp.flatMap((k, i) => free(i) && !mark(i) ? (useOf(btKey('opp', i), team.fmt)?.items || []).filter(([it]) => !isStone(it)).map(([it, p]) => ({ i, it, p })) : [])
    .sort((x, y) => y.p - x.p || x.i - y.i)
    .forEach(({ i, it }) => { if (!done.has(i) && !taken.has(it)) { out[i] = it; taken.add(it); done.add(i); } });
  return out;
}
// 對手格子 i（寶可夢 key）當成配招算的：招式＝用過的（標滿 4 招就只算這 4 招，不然再加上 OP.GG 常用招式）；
// 能力點數、性格＝改過的（osp），沒改的照 OP.GG 最常見（topSpread）。都沒有回傳 undefined（照 battler 的預設）
function btOppSet(i, key) {
  const used = battle.used[i], o = battle.osp[i], fmt = team.fmt;
  if (!used.length && !o) return undefined;
  const top = topSpread(key, fmt) || { sp: [0, 0, 0, 0, 0, 0], nat: [0, 0] }, common = (useOf(key, fmt)?.moves || []).map(([k]) => k);
  return { moves: used.length >= 4 ? used.slice(0, 4) : used.length ? [...used, ...common.filter(k => !used.includes(k))] : [], item: '', ab: '',
    sp: o?.sp || top.sp, nat: o?.nat || top.nat };
}
// 場上位置 p 的寶可夢（btUnit，帶那個位置的能力變化）；空的位置回傳 null
function btMon(side, p) {
  const i = battle[side][p];
  return i < 0 ? null : btUnit(side, i, battle.st[side][p]);
}
// 格子 i 的寶可夢：duel 用的 battler（我方照登錄的配招；對手套選的特性與 btOppItems 的道具、btOppSet），加上能力變化 st
// （s＝[攻擊, 防禦, 特攻, 特防, 速度]；後排換上場是 0）、目前 HP cur、順風 tw，另外帶 i 格子索引、H 最大 HP、pct 剩下的 HP %
function btUnit(side, i, s) {
  const key = btKey(side, i), fmt = team.fmt;
  // 我方登錄成超級進化、這場切回原型的，帶的是自己的超級石（不影響計算）
  const b = side === 'me' ? { ...battler(key, fmt, team.sets[i]), ...(key !== team.mons[i] && { item: '' }) }
    : { ...battler(key, fmt, btOppSet(i, key)), ab: defAbOf(key, fmt, battle.ab[i]), item: btOppItems()[i] };
  const H = hpOf(b), cur = side === 'me' ? Math.min(H, battle.hp[i] ?? H) : Math.ceil(H * battle.ohp[i] / 100);
  return { ...b, st: Object.fromEntries(BT_STATS.map(([k], n) => [k, s[n]])), cur, tw: battle.tw.includes(side),
    i, H, pct: side === 'me' ? hpPct(cur, H) : battle.ohp[i] };
}
// ----- 上方：場上位置、HP、能力變化、型態、對手的特性與道具 -----
const btHpText = (side, v, max) => !v ? '倒下' : side === 'me' ? `／${max}（${hpPct(v, max)}%）` : '%';
function btStHTML(side, p) {
  const s = battle.st[side][p];
  return '<div class="bt-sts">' + BT_STATS.map(([, zh], n) => `<span class="bt-st">${zh}`
    + `<button class="mini" data-bst="${side}.${p}.${n}" data-d="-1" aria-label="${zh} −1">−</button>`
    + `<b class="${s[n] > 0 ? 'up' : s[n] < 0 ? 'dn' : ''}">${s[n] ? stgText(s[n]) : '0'}</b>`
    + `<button class="mini" data-bst="${side}.${p}.${n}" data-d="1" aria-label="${zh} +1">＋</button></span>`).join('')
    + (s.some(Boolean) ? `<button class="mini" data-bst0="${side}.${p}">全部歸 0</button>` : '') + '</div>';
}
function btFormHTML(side, i) {
  const forms = btForms(side, i), cur = btKey(side, i);
  if (!forms.length) return '';
  return `<div class="c-f"><span class="c-l">型態</span><div class="seg">${forms.map(m => `<button data-bform="${side}.${i}" data-k="${m.key}" aria-pressed="${m.key === cur}">`
    + `${m.base ? (forms.length > 2 ? m.zh : '超級進化') : '沒進化'}</button>`).join('')}</div></div>`;
}
// 對手道具選單：第一項是預設（btOppItems 分配到的），再來是「沒有道具」；其他對手標了的道具不列（同一隊不能帶重複的道具），
// 超級石不列（超級進化在「型態」切換）；這隻 OP.GG 常帶的排前面，影響傷害或速度的附效果說明，其他的排後面
function btItemOptions(i, key) {
  if (MON[key].base) { const st = stoneOf(MON[key]); return `<option value="">${st ? ITEMS[st][0] : '專屬的超級石'}（超級進化固定）</option>`; }
  const taken = new Set(battle.item.filter((k, j) => k && k !== '-' && j !== i)), use = Object.fromEntries(useOf(key, team.fmt)?.items || []);
  const note = k => { const n = [DMG_ITEMS[k] && itemNote(DMG_ITEMS[k]), use[k] && `這隻 ${use[k]}% 帶`].filter(Boolean); return n.length ? `（${n.join('・')}）` : ''; };
  const opt = k => `<option value="${k}"${k === battle.item[i] ? ' selected' : ''}>${ITEMS[k][0]}${note(k)}</option>`;
  const list = Object.keys(ITEMS).filter(k => !isStone(k) && !taken.has(k));
  const top = list.filter(k => use[k]).sort((x, y) => use[y] - use[x]), rest = list.filter(k => !use[k]).sort((x, y) => !!DMG_ITEMS[y] - !!DMG_ITEMS[x]);
  const auto = btOppItems(i)[i];
  return `<option value="">預設：${auto ? ITEMS[auto][0] + note(auto) : '沒有可分配的常帶道具'}</option>`
    + `<option value="-"${battle.item[i] === '-' ? ' selected' : ''}>沒有道具（用掉了、被拍落）</option>`
    + (top.length ? `<optgroup label="這隻常帶">${top.map(opt).join('')}</optgroup>` : '') + `<optgroup label="${top.length ? '其他' : '道具'}">${rest.map(opt).join('')}</optgroup>`;
}
// 對手用過的招式：常用招式一招一個按鈕（點一下標用過／取消），不在清單裡的從「其他招式」選；標滿 4 招就只算這 4 招
function btUsedHTML(i, key) {
  const used = battle.used[i], common = (useOf(key, team.fmt)?.moves || []).map(([k]) => k), full = used.length >= 4;
  const rest = Object.keys(MOVES).filter(k => !common.includes(k) && !used.includes(k)).sort((x, y) => MOVES[x][0].localeCompare(MOVES[y][0], 'zh-Hant'));
  return `<div class="c-f"><span class="c-l">用過的招式</span><div class="bt-bench">`
    + [...new Set([...common, ...used])].map(k => `<button class="mini" data-bused="${i}" data-k="${k}" aria-pressed="${used.includes(k)}"`
      + `${full && !used.includes(k) ? ' disabled' : ''}>${MOVES[k][0]}</button>`).join('')
    + (full ? '' : `<select class="sel" data-bused-add="${i}" aria-label="其他招式"><option value="">其他招式…</option>${rest.map(k => `<option value="${k}">${MOVES[k][0]}</option>`).join('')}</select>`)
    + `</div><span class="meta">${used.length}／4${full ? '：只算這 4 招' : used.length ? '：沒標的照常用招式算' : '：照常用招式算；牠用了哪招就點，「打中」「實際」也會自動標'}</span></div>`;
}
// 對手的能力點數、性格：預設照 OP.GG 最常見（topSpread），可以改成 OP.GG 其他常見的（或從誰先動、實際傷害反推後套用）
function btSpreadHTML(i, key) {
  const use = useOf(key, team.fmt), top = topSpread(key, team.fmt), o = battle.osp[i] || {};
  if (!top) return '';
  const opt = (v, zh, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${zh}</option>`, nats = use.natures.map(([n]) => n.join('+'));
  return `<div class="c-f"><span class="c-l">能力點數</span><select class="sel" data-bosp="${i}" aria-label="能力點數"><option value="">OP.GG 最常見：${spText(top.sp)}</option>`
    + use.spreads.map(([sp, p]) => opt(sp.join('+'), `${spText(sp)}（${p}%）`, o.sp?.join('+'))).join('') + '</select></div>'
    + `<div class="c-f"><span class="c-l">性格</span><select class="sel" data-bonat="${i}" aria-label="性格"><option value="">OP.GG 最常見：${natText(top.nat)}</option>`
    + use.natures.map(([n, p]) => opt(n.join('+'), `${natText(n)}（${p}%）`, o.nat?.join('+'))).join('')
    + [[0, 0], ...NATURES].filter(n => !nats.includes(n.join('+'))).map(n => opt(n.join('+'), natText(n), o.nat?.join('+'))).join('') + '</select></div>';
}
function btPosHTML(side, p) {
  const i = battle[side][p], two = btN() > 1, me = side === 'me';
  const attr = `class="bt-pos${i < 0 ? ' empty' : ''}" data-side="${side}" data-p="${p}"${two ? ` aria-current="${battle.sel[side] === p}"` : ''}`;
  const tag = two ? `<span class="slot-n">位置 ${p + 1}</span>` : '';
  if (i < 0) return `<div ${attr}>${tag}<span>空的；點下方的寶可夢放上場</span></div>`;
  const b = btMon(side, p), m = MON[b.key], max = me ? b.H : 100, v = me ? b.cur : battle.ohp[i];
  const hp = `aria-label="剩下的 HP${me ? '' : ' %'}" min="0" max="${max}" step="1" value="${v}" data-bhp="${side}" data-i="${i}"`;
  const info = me ? `<div class="meta bt-info">${team.sets[i] ? '照登錄的配招' : '沒登錄配招，照預設'}・${abilZh(b.ab) || '沒有特性統計'}${b.item ? `・${ITEMS[b.item][0]}` : ''}</div>`
    : `<div class="c-f"><span class="c-l">特性</span><select class="sel" data-bab="${i}" aria-label="特性">${abilOptions(BT_REL, b.key, b.ab)}</select></div>`
      + `<div class="c-f"><span class="c-l">道具</span><select class="sel" data-bitem="${i}" aria-label="道具"${m.base ? ' disabled' : ''}>${btItemOptions(i, b.key)}</select></div>`
      + btSpreadHTML(i, b.key) + btUsedHTML(i, b.key);
  // 收起時的摘要：不是 0 的能力變化、特性、道具（對手另外標改過的點數、用過幾招）
  const s = battle.st[side][p], fold = `${side}.${p}`;
  const sum = [BT_STATS.map(([, zh], n) => s[n] ? `${zh} ${stgText(s[n])}` : '').filter(Boolean).join('・') || '能力變化都是 0', abilZh(b.ab),
    me ? b.item && ITEMS[b.item][0] : m.base ? '超級石' : b.item ? `${ITEMS[b.item][0]}${battle.item[i] ? '' : '（預設）'}` : '沒有道具',
    !me && battle.osp[i] && '點數／性格改過', !me && battle.used[i].length && `用過 ${battle.used[i].length} 招`].filter(Boolean).join('・');
  return `<div ${attr}><div class="bt-h">${tag}<b>${m.zh}</b>${chips(m.types)}<button class="mini bt-off" data-bout="${fold}">下場</button></div>`
    + btFormHTML(side, i)
    + `<div class="bt-hp"><span class="c-l">HP</span><input type="range" ${hp}><input type="number" class="sel c-num" inputmode="numeric" ${hp}>`
    + `<span class="meta bt-hpt">${btHpText(side, v, max)}</span></div>`
    + `<details class="bt-more" data-fold="${fold}"${btIsOpen(fold) ? ' open' : ''}><summary>${sum}</summary>${btStHTML(side, p)}${info}</details></div>`;
}
// 位置卡的能力變化、特性、道具可以收起：寬螢幕（並排顯示結果時）預設打開、窄螢幕預設收起，點過就照點的（不存網址）
const btFold = {};
const btIsOpen = k => k in btFold ? btFold[k] : matchMedia('(min-width: 901px)').matches;
$('#p-battle').addEventListener('toggle', e => { const k = e.target.dataset?.fold; if (k) btFold[k] = e.target.open; }, true);
// 下方的寶可夢按鈕（btShown）：場上的標起來，HP 不滿的標剩下多少、對手標了的道具
// 只列這場會出場的：我方列這場帶的（btBrought），對手出場過的滿了帶出場的隻數（單打 3、雙打 4）就不列其他的；在場上的一定列
function btShown(side) {
  const on = battle[side].slice(0, btN());
  if (side === 'me') { const b = btBrought(); return team.mons.map((k, i) => k && (b.includes(i) || on.includes(i))); }
  const all = battle.seen.filter((v, i) => v && bring.opp[i]).length >= BRING_N[team.fmt];
  return bring.opp.map((k, i) => !!k && (!all || battle.seen[i] || on.includes(i)));
}
// 猜對手帶誰（oppBringPlan，同出戰選角的「對手可能帶的」）；對手、我方隊伍、單打／雙打沒變就不重算
const btGuess = { k: null, v: null };
function btOppGuess() {
  const k = JSON.stringify([bring.opp, team.mons, team.fmt]);
  if (btGuess.k !== k) Object.assign(btGuess, { k, v: oppBringPlan(bring.opp, team.mons, team.fmt) });
  return btGuess.v;
}
// 對手還沒出場的猜誰：帶法依序找第一個包含所有出場過的；都還沒出場時連先發一起猜。出場過的滿了（或猜不了）回傳 ''
function btGuessText() {
  const g = btOppGuess();
  if (!g) return '';
  const seen = g.at.map((i, j) => battle.seen[i] ? j : -1).filter(j => j >= 0), nm = j => MON[btKey('opp', g.at[j])].zh;
  if (seen.length >= g.k) return '';
  if (!seen.length) return `猜會帶 ${g.combos[0].idx.map(nm).join('、')}，先發 ${g.pick.js.map(nm).join('、')}`;
  const c = g.combos.find(c => seen.every(j => c.idx.includes(j)));
  return c ? `猜還有 ${c.idx.filter(j => !seen.includes(j)).map(nm).join('、')}` : '';
}
// 「這場帶的」「對手出場過的」：收起時摘要列名字（對手另外列還沒出場的猜誰），點開可以改（點一下加入／拿掉）；我方自己改過的可以改回照出戰選角
function btPickHTML(side) {
  const me = side === 'me', list = btList(side), fold = 'pick.' + side;
  const has = me ? (b => i => b.includes(i))(btBrought()) : i => battle.seen[i];
  const names = list.map((k, i) => k && has(i) ? MON[btKey(side, i)].zh : '').filter(Boolean);
  const head = me ? `這場帶的（${battle.bring ? '自己選的' : bring.opp.some(Boolean) ? '照出戰選角第 1 名' : '還沒填對手，全部列出'}）`
    : `對手出場過的（${names.length}／${BRING_N[team.fmt]}，放上場就會標）`;
  const guess = me ? '' : btGuessText();
  return `<details class="bt-pick" data-fold="${fold}"${btFold[fold] ? ' open' : ''}><summary>${head}：${names.join('、') || '（還沒有）'}${guess ? `・${guess}` : ''}</summary><div class="bt-bench">`
    + list.map((k, i) => k ? `<button class="mini" data-bpick="${side}" data-i="${i}" aria-pressed="${has(i)}">${MON[btKey(side, i)].zh}</button>` : '').join('')
    + (me && battle.bring ? '<button class="mini" data-bpick0>改回照出戰選角</button>' : '') + '</div></details>';
}
function btBenchHTML(side) {
  const on = battle[side].slice(0, btN()), shown = btShown(side);
  return btList(side).map((k, i) => {
    if (!k || !shown[i]) return '';
    const key = btKey(side, i), v = side === 'me' ? battle.hp[i] : battle.ohp[i];
    const H = side === 'me' && v != null ? hpOf(battler(key, team.fmt, team.sets[i])) : 0;
    const hp = v === 0 ? '倒下' : side === 'me' ? (v == null || v >= H ? '' : `${hpPct(v, H)}%`) : v < 100 ? `${v}%` : '';
    const it = side === 'opp' && battle.item[i], sub = [hp, it && (it === '-' ? '沒道具' : ITEMS[it][0])].filter(Boolean).join('・');
    return `<button class="mini" data-bput="${side}" data-i="${i}" aria-pressed="${on.includes(i)}">${MON[key].zh}${sub ? `<span class="meta">${sub}</span>` : ''}</button>`;
  }).join('');
}
function btSideHTML(side) {
  const me = side === 'me', label = me ? '我方' : '對手';
  if (!btList(side).some(Boolean)) return `<div class="b-label">${label}</div><p class="muted small b-intro">`
    + `${me ? '先到「隊伍分析」挑好寶可夢（只選屬性的隊員沒有能力值，不能算）。' : '先到「出戰選角」填對手的 6 隻。'}</p>`;
  return `<div class="b-label">${label}<span class="muted small">${btN() > 1 ? '先點位置，再點下方的寶可夢換上場' : '點下方的寶可夢換上場'}</span></div>`
    + Array.from({ length: btN() }, (_, p) => btPosHTML(side, p)).join('')
    + `<div class="bt-bench" id="btBench-${side}">${btBenchHTML(side)}</div>` + btPickHTML(side);
}
// ----- 打了才知道：從實際傷害、誰先動反推對手的配置 -----
// 暫存（不存網址）：btEdit＝正在填「實際」的那一列（列的 id，見 btMoveRow）；btObs＝某組對位的比對結果 { pair, html }
let btEdit = null, btObs = null;
// 場上格子 i（side）現在的 btMon；不在場上回傳 null
const btAt = (side, i) => { const p = battle[side].slice(0, btN()).indexOf(i); return p < 0 ? null : btMon(side, p); };
// duel 用的速度資料（同 duel 的 spe）
const btSpe = b => ({ key: b.key, inv: b.speInv, sp: b.sp, nat: b.nat, st: b.st?.spe || 0, item: b.item, ab: b.ab, tw: !!b.tw });
// 對手 O（btMon）換一種配置 c { item（'-'＝沒有道具）, sp, nat }：最大 HP 跟著點數變，剩下的 HP 照原本的 % 換算
function btVariant(O, c) {
  const v = { ...O, ...(c.item != null && { item: c.item === '-' ? '' : c.item }), ...(c.sp && { sp: c.sp, nat: c.nat }) };
  v.H = hpOf(v); v.cur = Math.ceil(v.H * battle.ohp[O.i] / 100);
  return v;
}
// 對手 O 可能的其他配置裡，對得上觀察的（ok(對手配置) 為真）：先試只改一項（道具 items、或 OP.GG 常見的點數＋性格，
// 性格不降有投點數的那項），都對不上才試道具和點數性格一起改。依 OP.GG 使用率由高到低取前 3 個，每個 { item?, sp?, nat?, w, label }
function btFix(O, items, ok) {
  const use = useOf(O.key, team.fmt), top = topSpread(O.key, team.fmt), itemUse = Object.fromEntries(use?.items || []);
  const taken = new Set(battle.item.filter((k, j) => k && k !== '-' && j !== O.i));
  const its = [...new Set(items)].filter(k => k === '-' ? !!O.item : ITEMS[k] && !taken.has(k) && k !== O.item && !MON[O.key].base)
    .map(k => ({ item: k, w: itemUse[k] || 0.5, label: k === '-' ? '沒有道具' : `${ITEMS[k][0]}${itemUse[k] ? `（這隻 ${itemUse[k]}% 帶）` : ''}` }));
  const sps = top ? use.spreads.flatMap(([sp, p]) => [...use.natures, [[0, 0], 0]].filter(([n]) => !n[1] || !sp[n[1]])
    .filter(([n]) => sp.join() !== (O.sp || []).join() || n.join() !== (O.nat || []).join())
    .map(([n, q]) => ({ sp, nat: n, w: p * Math.max(q, 0.5), label: `點數 ${spText(sp)}・${natText(n)}（OP.GG ${p}%${q ? `／${q}%` : ''}）` }))) : [];
  const pick = list => list.filter(c => ok(btVariant(O, c))).sort((x, y) => y.w - x.w).filter((c, n, a) => a.findIndex(d => d.label === c.label) === n).slice(0, 3);
  const one = pick([...its, ...sps]);
  return one.length ? one : pick(its.flatMap(a => sps.map(b => ({ ...a, ...b, w: a.w * b.w, label: `${a.label}＋${b.label}` }))));
}
// 比對結果：不符合預測時列出可以套用的配置（按鈕帶對手格子與配置）；都對不上時說可能的原因 why
const btFixHTML = (i, fixes, why) => fixes.length
  ? '可能是：' + fixes.map(c => `<button class="mini" data-bfix="${i}"${c.item != null ? ` data-item="${c.item}"` : ''}`
    + `${c.sp ? ` data-sp="${c.sp.join('+')}" data-nat="${c.nat.join('+')}"` : ''}>套用 ${c.label}</button>`).join('')
  : `OP.GG 常見的道具、點數、性格都對不上（可能是${why}沒標）。`;
// 實際誰先動（oppFirst＝牠先動）：和預測對不上時，試對手帶／不帶講究圍巾、其他常見的點數性格
function btSpeedObs(M, O, f, oppFirst) {
  const fld = { weather: f.weather, terrain: f.terrain, tr: !!f.tr }, sp = v => speedPair(btSpe(M), btSpe(v), fld);
  const fits = v => { const s = sp(v).first; return s < 0 || (s === 1) === oppFirst; };
  const now = sp(O), tag = `（速度：${MON[M.key].zh} ${now.spd[0].v}／${MON[O.key].zh} ${now.spd[1].v}）`;
  if (fits(O)) return `<div class="c-sum good">✔ ${oppFirst ? '牠先動' : '我先動'}，和預測一樣${tag}</div>`;
  const items = oppFirst ? ['choice-scarf'] : (useOf(O.key, team.fmt)?.items || []).map(([k]) => k).filter(k => k !== 'choice-scarf' && !isStone(k)).slice(0, 2).concat('-');
  const fixes = btFix(O, items, v => fits(v) && sp(v).spd[1].v !== now.spd[1].v);
  return `<div class="c-sum bad">⚠ 實際${oppFirst ? '牠先動' : '我先動'}，牠比預測${oppFirst ? '快' : '慢'}${tag}；${btFixHTML(O.i, fixes, '能力變化、特性、場地或順風')}</div>`;
}
// 實際傷害：dir＝xy（我打牠）／yx（牠打我），招式 k，打完剩下 after（我方是 HP、對手是 %）。和預測（招式的最低～最高）比，
// 對不上時試對手的其他道具（牠打我：會讓這招變痛的攻擊道具；我打牠：這招屬性的抗性樹果）和常見的點數性格；
// 比預測痛時先看急所（crit）對不對得上（遊戲會顯示是不是急所，是的話不用改配置）
function btDmgObs(M, O, f, dir, k, after) {
  const row = (v, crit) => { const d = duel(M, v, { ...f, crit }); return (dir === 'xy' ? d.xy : d.yx).ok.find(x => x.k === k)?.r; };
  const r = row(O);
  if (!r) return '';
  // 實際傷害的範圍（%）：我方 HP 是準的；對手的 % 前後各算 ±1（畫面上的 % 是四捨五入過的）；打倒了只知道至少打掉剩下的
  const before = dir === 'xy' ? battle.ohp[O.i] : M.cur * 100 / M.H, got = dir === 'xy' ? before - after : (M.cur - after) * 100 / M.H;
  const lo = dir === 'xy' ? got - 1 : got - 0.01, hi = after <= 0 ? Infinity : dir === 'xy' ? got + 1 : got + 0.01;
  const fits = x => x && x.max * 100 / x.hp >= lo && x.min * 100 / x.hp <= hi;
  const mzh = MOVES[k][0], pred = `${hpPct(r.min, r.hp)}～${hpPct(r.max, r.hp)}%`, gotText = `${after <= 0 ? '至少 ' : ''}${Math.round(got * 10) / 10}%`;
  if (fits(r)) return `<div class="c-sum good">✔ ${mzh}實際扣了 ${gotText}，在預測 ${pred} 內</div>`;
  const more = r.max * 100 / r.hp < lo, ty = r.type, use = useOf(O.key, team.fmt);
  const items = dir === 'yx'
    ? [...Object.entries(DMG_ITEMS).filter(([, v]) => v.side.includes('a') && !v.mon && (v.type === ty || v.cat === r.cat || v.final || v.se && r.eff > 1)).map(([key]) => key),
      ...(use?.items || []).map(([key]) => key).filter(key => !isStone(key)).slice(0, 3), '-']
    : [...Object.entries(DMG_ITEMS).filter(([, v]) => v.berry === ty).map(([key]) => key), ...(use?.items || []).map(([key]) => key).filter(key => !isStone(key)).slice(0, 3), '-'];
  const fixes = btFix(O, items, v => fits(row(v)));
  const how = dir === 'yx' ? (more ? '牠打得比預測痛' : '牠打得比預測輕') : (more ? '牠比預測不耐打' : '牠比預測耐打');
  const cr = more && row(O, true), crit = cr && fits(cr) ? `急所的話是 ${hpPct(cr.min, cr.hp)}～${hpPct(cr.max, cr.hp)}%，對得上：這下是急所就不用改配置；不是急所的話，` : '';
  return `<div class="c-sum bad">⚠ ${mzh}實際扣了 ${gotText}，預測 ${pred}：${how}；${crit}${btFixHTML(O.i, fixes, '能力變化、特性或場地')}</div>`;
}
// ----- 下方：每一組對位（我方 × 對手）的結果 -----
// 一招一列：佔對方最大 HP 的 %、幾擊打倒（看剩下的 HP）。ctx：{ side 挨打的一方, i 挨打的格子, pair 對位 id「我方格子.對手格子」, dir xy／yx, used 對手用過這招 }
// 「打中」＝照平均傷害（最低、最高的平均）扣挨打那一方剩下的 HP；「實際」＝填打完剩下多少，扣血並和預測比對（btDmgObs）。
// 對手的招式按「打中」「實際」也會標成用過
function btMoveRow(x, ctx) {
  const r = x.r, id = `${ctx.pair}|${ctx.dir}|${x.k}`, attr = `class="bt-mv" data-pair="${ctx.pair}" data-dir="${ctx.dir}" data-k="${x.k}"`;
  if (!r.eff) return `<div ${attr}><b>${MOVES[x.k][0]}</b>${chip(r.type)}<span class="ko">沒有效果${r.immuneBy ? `（${abilZh(r.immuneBy)}）` : r.blockedBy ? `（${r.blockedBy}）` : ''}</span></div>`;
  const kt = koText(r.ko), tags = [FLAG.priority.has(x.k) && '先制', r.spread && '範圍 ×0.75',
    r.endured && `${ITEMS[r.endured]?.[0] || abilZh(r.endured)}撐住第一下`, r.berry && '樹果減半第一下', ctx.used && '✓用過'].filter(Boolean);
  const avg = Math.round((r.min + r.max) / 2), me = ctx.side === 'me';
  const cur = me ? Math.min(r.hp, battle.hp[ctx.i] ?? r.hp) : battle.ohp[ctx.i];
  return `<div ${attr}><b>${MOVES[x.k][0]}</b>${chip(r.type)}${mtag(r.eff)}<span class="bt-pct">${hpPct(r.min, r.hp)}～${hpPct(r.max, r.hp)}%</span>`
    + `${tags.length ? `<span class="meta">${tags.join('・')}</span>` : ''}<span class="ko k${kt.n}">${kt.text}</span>`
    + `<button class="mini bt-hit" data-bhit="${ctx.side}.${ctx.i}" data-dmg="${avg}"${r.endured ? ' data-end' : ''} title="照平均傷害扣掉約 ${hpPct(avg, r.hp)}%">打中</button>`
    + `<button class="mini bt-hit" data-bact="${id}" aria-pressed="${btEdit === id}" title="填打完剩下多少，和預測比對">實際</button>`
    + (btEdit === id ? `<div class="bt-act">打完剩下<input type="number" class="sel c-num" inputmode="numeric" min="0" max="${me ? r.hp : 100}" value="${cur}" data-bactv aria-label="打完剩下的 HP${me ? '' : ' %'}">`
      + `<span class="meta">${me ? `／${r.hp} HP` : '%'}</span><button class="mini" data-bactok="${id}">確定</button></div>` : '') + '</div>';
}
const btHit = x => `${mvName(x.k)} ${hpPct(x.r.min, x.r.hp)}～${hpPct(x.r.max, x.r.hp)}% ${koText(x.r.ko).text}`;
const btHits = xs => xs.slice(0, 2).map(btHit).join('、');
const btPri = xs => xs.filter(x => FLAG.priority.has(x.k));
function btPairHTML(M, O, f) {
  const mm = MON[M.key], om = MON[O.key];
  const head = tail => `<div class="bt-ph"><b>${mm.zh}</b><span class="meta">剩 ${M.pct}%</span><span>⇄</span><b>${om.zh}</b><span class="meta">剩 ${O.pct}%</span>${tail}</div>`;
  const pair = `${M.i}.${O.i}`, obsHTML = btObs?.pair === pair ? btObs.html : '';
  // 倒下了：「實際」打倒時的比對結果照樣顯示
  if (!M.cur || !O.cur) return `<div class="bt-pair">${head(`<span class="bt-ord">${!M.cur ? mm.zh : om.zh}倒下了</span>`)}${obsHTML}</div>`;
  const d = duel(M, O, f), kill = d.yx.kos, mine = d.xy.kos;
  const order = d.first < 0 ? '同速（各 50%）' : `${d.first ? om.zh : mm.zh}先動`;
  const spd = (i, b) => `${d.spd[i].v}${[b.st.spe && `速度 ${stgText(b.st.spe)}`, ...d.spd[i].notes].filter(Boolean).map(s => '・' + s).join('')}`;
  // 警告：對手先動（或同速）又一擊打得倒我方；先制招式不看速度。我方先動打得倒的另外標出來
  const lines = [], was = d.first !== 0 && kill.length > 0;
  const tie = d.first < 0 ? '同速（各 50%），' : '';
  if (was) lines.push(['bad', `⚠ ${tie}${om.zh}先動就打得倒${mm.zh}：${btHits(kill)}`]);
  else if (btPri(kill).length) lines.push(['bad', `⚠ ${om.zh}的先制招式打得倒${mm.zh}：${btHits(btPri(kill))}`]);
  if (d.first !== 1 && mine.length) lines.push(['good', `✔ ${tie}${mm.zh}先動就打得倒${om.zh}：${btHits(mine)}`]);
  else if (btPri(mine).length) lines.push(['good', `✔ 先制招式打得倒${om.zh}：${btHits(btPri(mine))}`]);
  const used = battle.used[O.i];
  const rows = (x, n, ctx) => x.ok.length ? x.ok.slice(0, n).map(m => btMoveRow(m, { ...ctx, used: ctx.dir === 'yx' && used.includes(m.k) })).join('')
    : `<div class="meta">${x.use.length ? '沒有能算傷害的攻擊招式' : '沒有招式資料'}</div>`;
  // 實際誰先動：點了和預測比對（btSpeedObs），結果顯示在下面
  const obs = `<span class="bt-obs"><span class="meta">實際：</span><button class="mini" data-bobs="${pair}" data-who="me">我先動</button>`
    + `<button class="mini" data-bobs="${pair}" data-who="opp">牠先動</button></span>`;
  return `<div class="bt-pair">${head(`<span class="bt-ord">${order}</span>`)}`
    + `<div class="meta">速度：${mm.zh} ${spd(0, M)}／${om.zh} ${spd(1, O)}${f.tr ? '（戲法空間：慢的先動）' : ''}${obs}</div>`
    + obsHTML
    + lines.map(([c, t]) => c ? `<div class="c-sum ${c}">${t}</div>` : `<div class="x-line"><span class="x-msg">${t}</span></div>`).join('')
    + `<div class="bt-sub">${mm.zh}打${om.zh}</div>${rows(d.xy, undefined, { side: 'opp', i: O.i, pair, dir: 'xy' })}`
    + Object.entries(d.xy.why).map(([w, ns]) => `<div class="x-line"><span class="x-msg">不算（${w}）：</span>${ns.join('、')}</div>`).join('')
    + `<div class="bt-sub">${om.zh}打${mm.zh}<span class="meta">（最痛的 3 招${used.length >= 4 ? '，只算用過的 4 招' : used.length ? `，用過 ${used.length} 招` : ''}）</span></div>`
    + `${rows(d.yx, 3, { side: 'me', i: M.i, pair, dir: 'yx' })}</div>`;
}
// ----- 換人：後排對上場上的對手 -----
// 後排＝這場帶的（btBrought）不在場上、還沒倒下的。每隻對上場上每隻對手看 matchup（同出戰選角的對位）：我方用目前剩下的 HP
// （換上場能力變化歸 0、我方順風照舊），對手用目前的 HP、能力變化和修正過的招式／道具／點數。
// ✔ 換上來先吃牠最痛的一招還打得贏、贏＝正面打得贏（場上的倒下後再補上，不用先吃一下）、⚠ 牠先動一下就打倒我、✘ 打不贏；依這個順序排
function btSwapHTML(opps, f) {
  const on = battle.me.slice(0, btN()), bench = btBrought().filter(i => !on.includes(i) && battle.hp[i] !== 0), alive = opps.filter(O => O.cur);
  if (!bench.length || !alive.length) return '';
  const n = x => x < 9 ? `${x} 下` : '四下打不倒', fmt = team.fmt;
  return `<div class="res-head">換人<span class="muted small">（後排換上來對上場上的對手）</span></div>`
    + alive.map(O => {
      const om = MON[O.key];
      const rows = bench.map(i => {
        const M = btUnit('me', i, [0, 0, 0, 0, 0]), mm = MON[M.key], who = `<b>${mm.zh}</b><span class="meta">剩 ${M.pct}%</span>`;
        if (!useOf(M.key, fmt, M.set)?.moves.length || !useOf(O.key, fmt, O.set)?.moves.length) return [4, `<div class="x-line">${who}<span class="x-msg">沒有招式資料，不能算</span></div>`];
        const r = matchup(M, O, f), big = r.big && MOVES[r.big][0], left = r.left > 0 ? `剩 ${hpPct(r.left, M.H)}%` : '會倒';
        const [rank, v, c, why] = r.sw ? [0, '✔', 'm2', big ? `換上來吃${big}${left}，還打得贏` : '換上來也打得贏（牠沒有打得痛的招式）']
          : r.head ? [1, '贏', 'm1', `正面打得贏，但換上來吃${big}${left}${r.left > 0 ? '就打不贏' : ''}：等場上的倒下再補上`]
          : r.ohko ? [3, '⚠', 'mh', `牠先動一下就打倒${mm.zh}`] : [2, '✘', 'mh', '打不贏'];
        return [rank, `<div class="x-line"><span class="mtag ${c}">${v}</span>${who}<span>${why}</span>`
          + `<span class="meta">${r.first < 0 ? '同速' : r.first ? '牠先動' : '我先動'}（速度 ${r.spd.join('／')}）・我 ${n(r.me)}、牠 ${n(r.opp)}</span></div>`];
      });
      return `<div class="bt-pair"><div class="bt-ph"><span>對上</span><b>${om.zh}</b><span class="meta">剩 ${O.pct}%</span></div>`
        + rows.map((x, k) => [...x, k]).sort((x, y) => x[0] - y[0] || x[2] - y[2]).map(x => x[1]).join('') + '</div>';
    }).join('');
}
function btResultHTML() {
  const f = { fmt: team.fmt, weather: battle.weather, terrain: battle.terrain, tr: battle.tr };
  const on = side => Array.from({ length: btN() }, (_, p) => btMon(side, p)).filter(Boolean), mine = on('me'), opps = on('opp');
  // 我方場上空著（倒下後換下場）也列換人
  const swap = opps.length ? btSwapHTML(opps, f) : '';
  if (!opps.length || !mine.length && !swap) return '<p class="empty">雙方都有寶可夢上場後，這裡會列出我方每一招打過去的傷害、能不能打倒、誰先動，對手先動又打得倒我方時會警告，後排換上來打不打得贏也會列出來。</p>';
  return `<div class="res-head">場上對位<span class="muted small">（${[FMT_ZH[team.fmt], FIELD_ZH[battle.weather], FIELD_ZH[battle.terrain], battle.tr && '戲法空間',
    ...battle.tw.map(s => s === 'me' ? '我方順風' : '對手順風')].filter(Boolean).join('・')}）</span></div>`
    + mine.map(M => opps.map(O => btPairHTML(M, O, f)).join('')).join('') + swap
    + '<p class="note">※ 我方照「隊伍分析」登錄的招式、特性、道具、能力點數與性格算，沒登錄的欄位和對手都照「傷害計算」的預設：'
    + '能力點數與性格用 OP.GG 最常見的（沒有統計的攻擊／特攻 32＋性格、速度 32＋性格、HP／防禦／特防 0）、'
    + '特性用 OP.GG 最常見的（對手的特性可在上方改；超級進化用固定特性）。'
    + '對手的道具預設 OP.GG 最常帶的，看到實際道具就在選單改（用掉或被拍落選「沒有道具」）。同一隊不能帶重複的道具：'
    + '標了的先算，沒標的依使用率由高到低分配，同一顆給使用率高的那隻、另一隻改拿牠下一個常帶的；其他對手標了的道具選單也不列。'
    + '% 是佔對方最大 HP 的比例；「一擊」「二擊」是連用同一招打掉對方剩下的 HP（對手剩下的 % 換算成 HP 時無條件進位），'
    + '不是全滿時氣勢披帶、結實、多重鱗片沒有作用。招式看登錄的或 OP.GG 常用招式裡的攻擊招式，依傷害由高到低排。'
    + '先動看實際速度（能力變化、順風 ×2、戲法空間、講究圍巾、天氣／場地加速特性）；同速各 50%，先制招式不看速度。能力變化換下場就清掉。'
    + '雙打的範圍招式一律以打到兩隻（×0.75）計；噴火／噴水以 HP 全滿計。不含灼傷、麻痺、牆、幫助、隊友與出場特性（如威嚇，請自己調能力變化）。'
    + '「打中」照那一招的平均傷害（最低、最高的平均）扣挨打那一方剩下的 HP（HP 全滿時氣勢披帶、結實撐住剩 1），實際扣多少看遊戲畫面再拉 HP 調整。'
    + '打了才知道：「實際」填遊戲裡打完剩下多少（我方 HP、對手 %），扣血並和預測比對；「實際：我先動／牠先動」和預測的速度比對。'
    + '對不上時會試對手的其他配置，列出對得上的（依 OP.GG 使用率排，最多 3 個），點「套用」就改成那樣算：'
    + '牠打得比預測痛／輕試會讓那招變痛的道具（屬性強化、力量頭帶／博識眼鏡、生命寶珠、達人帶、寶石）或其他常見點數性格，'
    + '牠比預測耐打／不耐打試那招屬性的抗性樹果或其他常見點數性格，牠比預測快／慢試講究圍巾或其他常見點數性格（同一隊不重複的道具照舊）。'
    + '對手的 % 前後各差 1% 內都算對得上；比預測痛時會先看急所（×1.5，不計攻擊方的能力下降、防守方的能力上升）對不對得上，'
    + '遊戲顯示這下是急所就不用改配置；能力變化、特性、場地沒標也會讓結果不同。'
    + '換人：後排（這場帶的、不在場上、還沒倒下）換上來對上場上每隻對手，算法同「出戰選角」的對位表：✔＝換上來先吃牠最痛的一招還打得贏、'
    + '贏＝正面打得贏（場上的倒下後再補上，不用先吃一下）、⚠＝打不贏又會被牠先動一下打倒、✘＝其他打不贏的；'
    + '我方用目前剩下的 HP（換上場能力變化歸 0），對手用目前的 HP、能力變化和修正過的招式、道具、點數。'
    + '對手按「打中」「實際」的招式會標成用過，也可以在上方「用過的招式」自己點；標滿 4 招就只算這 4 招，沒滿照常用招式算。'
    + '下方只列這場會出場的：我方列「這場帶的」（預設照出戰選角第 1 名組合，可以點開改），對手出場過的到了帶出場的隻數（單打 3、雙打 4）就不列其他的。'
    + '「對手出場過的」後面的「猜」照「出戰選角」的「對手可能帶的」：還沒有出場的猜帶法和先發，有出場的就從包含出場過的帶法裡挑第一種，只是參考。</p>';
}
function renderBattle() {
  syncBattle();
  BT_SIDES.forEach(side => { $('#bt-' + side).innerHTML = btSideHTML(side); });
  document.querySelectorAll('#p-battle [data-bab]').forEach(s => { s.disabled = s.options.length < 2; });
  $('#btW').innerHTML = [['', '無天氣'], ...WEATHERS.map(w => [w, FIELD_ZH[w]])].map(([w, zh]) => `<button data-bw="${w}" aria-pressed="${battle.weather === w}">${zh}</button>`).join('');
  $('#btT').innerHTML = [['', '無場地'], ...TERRAINS.map(t => [t, FIELD_ZH[t]])].map(([t, zh]) => `<button data-bf="${t}" aria-pressed="${battle.terrain === t}">${zh}</button>`).join('');
  $('#btTR').checked = battle.tr;
  document.querySelectorAll('[data-btw]').forEach(c => { c.checked = battle.tw.includes(c.dataset.btw); });
  document.querySelectorAll('#btFmt button').forEach(b => b.setAttribute('aria-pressed', b.dataset.fmt === team.fmt));
  $('#btResult').innerHTML = btResultHTML();
  saveState();
}
// 放上場：放進選中的位置（原本在別的位置就移過來），那個位置的能力變化清掉，再跳到下一個空位置；已在場上就只選中牠的位置。對手放上場就標出場過
function btPut(side, i) {
  const n = btN(), at = battle[side].indexOf(i);
  if (side === 'opp') battle.seen[i] = true;
  if (at >= 0 && at < n) { battle.sel[side] = at; return; }
  const p = Math.min(battle.sel[side], n - 1);
  battle[side] = battle[side].map(j => j === i ? -1 : j);
  battle[side][p] = i;
  battle.st[side][p] = [0, 0, 0, 0, 0];
  const next = battle[side].findIndex((j, q) => q < n && j < 0);
  if (next >= 0) battle.sel[side] = next;
}
// 點位置（雙打）選中它；按鈕照各自的動作改完重畫。點到選單、輸入欄時只換選中的框，不重畫（免得選單被關掉、輸入被打斷）
$('#p-battle').addEventListener('click', e => {
  const b = e.target.closest('button'), pos = e.target.closest('.bt-pos'), d = b?.dataset || {};
  if (pos) {
    battle.sel[pos.dataset.side] = +pos.dataset.p;
    document.querySelectorAll(`.bt-pos[data-side="${pos.dataset.side}"][aria-current]`).forEach(el => el.setAttribute('aria-current', el === pos));
  }
  if (d.bput) btPut(d.bput, +d.i);
  else if (d.bst) { const [side, p, n] = d.bst.split('.'), s = battle.st[side][+p]; s[+n] = Math.max(-6, Math.min(6, s[+n] + +d.d)); }
  else if (d.bst0) { const [side, p] = d.bst0.split('.'); battle.st[side][+p] = [0, 0, 0, 0, 0]; }
  else if (d.bout) { const [side, p] = d.bout.split('.'); battle[side][+p] = -1; battle.st[side][+p] = [0, 0, 0, 0, 0]; }
  else if (d.bform) {
    // 對手超級進化後道具固定是超級石，看到的道具清掉
    const [side, i] = d.bform.split('.');
    battle.form[side][+i] = d.k === btList(side)[+i] ? '' : d.k;
    if (side === 'opp' && MON[d.k].base) battle.item[+i] = '';
  }
  else if (d.bw != null) battle.weather = d.bw;
  else if (d.bf != null) battle.terrain = d.bf;
  // 這場帶的／對手出場過的：點一下加入或拿掉（我方第一次改時從目前照出戰選角的名單開始改）
  else if (d.bpick === 'me') { const i = +d.i, b = btBrought(); battle.bring = b.includes(i) ? b.filter(j => j !== i) : [...b, i].sort((x, y) => x - y); }
  else if (d.bpick === 'opp') battle.seen[+d.i] = !battle.seen[+d.i];
  else if (d.bpick0 != null) battle.bring = null;
  // 打中：照平均傷害扣挨打那一方剩下的 HP（data-end：HP 全滿時氣勢披帶、結實撐住剩 1）；對手的招式標成用過
  else if (d.bhit) {
    const [side, s] = d.bhit.split('.'), i = +s, key = btKey(side, i);
    const H = hpOf(side === 'me' ? battler(key, team.fmt, team.sets[i]) : battler(key, team.fmt, btOppSet(i, key)));
    const cur = side === 'me' ? Math.min(H, battle.hp[i] ?? H) : Math.ceil(H * battle.ohp[i] / 100);
    const v = Math.max(cur === H && d.end != null ? 1 : 0, cur - +d.dmg);
    if (side === 'me') battle.hp[i] = v >= H ? null : v;
    else battle.ohp[i] = v ? Math.max(1, Math.round(v * 100 / H)) : 0;
    btMarkUsed(b.closest('.bt-mv'));
  }
  // 實際誰先動：和預測比對，結果顯示在那組對位
  else if (d.bobs) {
    const [mi, oi] = d.bobs.split('.').map(Number), M = btAt('me', mi), O = btAt('opp', oi);
    if (M && O) btObs = { pair: d.bobs, html: btSpeedObs(M, O, btField(), d.who === 'opp') };
  }
  // 實際傷害：點「實際」打開這一列的輸入欄（再點一次收起），填好按「確定」扣血、比對，對手的招式標成用過
  else if (d.bact) { btEdit = btEdit === d.bact ? null : d.bact; renderBattle(); document.querySelector('#btResult [data-bactv]')?.select(); return; }
  else if (d.bactok) {
    const [pair, dir, k] = d.bactok.split('|'), [mi, oi] = pair.split('.').map(Number), M = btAt('me', mi), O = btAt('opp', oi);
    const inp = b.closest('.bt-act')?.querySelector('[data-bactv]'), v = Math.round(Number(inp?.value));
    if (!M || !O || !inp || inp.value === '' || !Number.isFinite(v)) return;
    const after = Math.max(0, Math.min(dir === 'xy' ? 100 : M.H, v));
    btObs = { pair, html: btDmgObs(M, O, btField(), dir, k, after) };
    if (dir === 'xy') battle.ohp[oi] = after; else battle.hp[mi] = after >= M.H ? null : after;
    btMarkUsed(b.closest('.bt-mv'));
    btEdit = null;
  }
  // 套用反推出來的配置：道具（'-'＝沒有道具）、能力點數與性格
  else if (d.bfix) {
    const i = +d.bfix;
    if (d.item != null) battle.item[i] = d.item;
    if (d.sp) battle.osp[i] = { sp: d.sp.split('+').map(Number), nat: d.nat.split('+').map(Number) };
    btObs = null;
  }
  // 對手用過的招式：點一下標用過／取消（最多 4 招）
  else if (d.bused != null) {
    const u = battle.used[+d.bused];
    battle.used[+d.bused] = u.includes(d.k) ? u.filter(k => k !== d.k) : u.length < 4 ? [...u, d.k] : u;
  }
  else return;
  renderBattle();
});
// 場地（duel 的 f）
const btField = () => ({ fmt: team.fmt, weather: battle.weather, terrain: battle.terrain, tr: battle.tr });
// 對手打我方的那一列（dir yx）：那一招標成對手用過（最多 4 招）
function btMarkUsed(row) {
  if (row?.dataset.dir !== 'yx') return;
  const i = +row.dataset.pair.split('.')[1], u = battle.used[i];
  if (!u.includes(row.dataset.k) && u.length < 4) battle.used[i] = [...u, row.dataset.k];
}
// 「實際」的輸入欄按 Enter 等於按「確定」
$('#p-battle').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.bactv != null) { e.preventDefault(); e.target.closest('.bt-act').querySelector('[data-bactok]').click(); }
});
// HP 那一列（拉桿 t 所在）的拉桿、數字欄、說明改成 v；all＝連 t 自己也改（邊打字時不改正在打的那格）
function btHpRow(t, v, all) {
  const row = t.closest('.bt-hp');
  row.querySelectorAll('input').forEach(x => { if (all || x !== t) x.value = v; });
  row.querySelector('.bt-hpt').textContent = btHpText(t.dataset.bhp, v, +t.max);
}
// HP：拉桿和數字欄邊拉邊算，只更新同一列、下方按鈕與結果（不重畫上方，免得拉桿被打斷）
$('#p-battle').addEventListener('input', e => {
  const t = e.target, side = t.dataset.bhp;
  if (!side || t.value === '') return;
  const i = +t.dataset.i, max = +t.max, v = Math.max(0, Math.min(max, Math.round(+t.value) || 0));
  if (side === 'me') battle.hp[i] = v >= max ? null : v; else battle.ohp[i] = v;
  btHpRow(t, v, false);
  $('#btBench-' + side).innerHTML = btBenchHTML(side);
  $('#btResult').innerHTML = btResultHTML();
  saveState();
});
// 離開 HP 欄位時只把那一列改回實際存的值（清空或超出範圍時），不整個重畫：打完字直接點按鈕時，按鈕才不會被換掉而沒按到
$('#p-battle').addEventListener('change', e => {
  const t = e.target, d = t.dataset;
  if (d.bhp) { btHpRow(t, d.bhp === 'me' ? battle.hp[+d.i] ?? +t.max : battle.ohp[+d.i], true); return; }
  if (d.bab != null) battle.ab[+d.bab] = t.value;
  else if (d.bitem != null) battle.item[+d.bitem] = t.value;
  // 對手用過的招式（從「其他招式」加）、改能力點數／性格（選回第一項＝照 OP.GG 最常見）
  else if (d.busedAdd != null) { const u = battle.used[+d.busedAdd]; if (t.value && u.length < 4 && !u.includes(t.value)) battle.used[+d.busedAdd] = [...u, t.value]; }
  else if (d.bosp != null || d.bonat != null) {
    const i = +(d.bosp ?? d.bonat), o = { ...battle.osp[i], [d.bosp != null ? 'sp' : 'nat']: t.value ? t.value.split('+').map(Number) : undefined };
    battle.osp[i] = o.sp || o.nat ? o : null;
  }
  else if (t.id === 'btTR') battle.tr = t.checked;
  else if (d.btw) battle.tw = BT_SIDES.filter(s => s === d.btw ? t.checked : battle.tw.includes(s));
  else return;
  renderBattle();
});
$('#btFmt').addEventListener('click', setFmt);
$('#btClear').addEventListener('click', () => { Object.assign(battle, battle0()); renderBattle(); });

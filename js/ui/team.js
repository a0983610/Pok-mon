// ---------- 隊伍分析 ----------
// mons：每格選的寶可夢 key（只選屬性時為空字串）；sets：每格登錄的配招（見 useOf；沒登錄是 null，換寶可夢就清掉）；
// fmt：排名依據 s 單打、d 雙打
const team = { slots: [[], [], [], [], [], []], mons: ['', '', '', '', '', ''], sets: [null, null, null, null, null, null], cur: 0, fmt: 's' };
// 隊上成員 key → 登錄的配招（recommendMon、traitScan 用）
const teamSets = () => Object.fromEntries(team.mons.map((k, i) => [k, team.sets[i]]).filter(([k, s]) => k && s));
const FMT_ZH = { s: '單打', d: '雙打' };
const THREAT_N = 20;
const slotName = i => team.mons[i] ? MON[team.mons[i]].zh : team.slots[i].map(id => T[id].zh).join('/');
// 隊伍格子 [屬性, 格子索引] → 對位用的 { defs, atk }（answerOf 的格式）
const unitOf = ([s, i]) => ({ defs: s, atk: attacksOf(team.mons[i], s, team.fmt, team.sets[i]) });
const rankText = m => `${FMT_ZH[team.fmt]}${m.rank[team.fmt] ? ' #' + m.rank[team.fmt] : '無排名'}`;
// 目前格子的推薦，點了直接放進這格：屬性推薦前 5 名（空格推第一個屬性、已選一個就推第二個），再加推薦寶可夢前 5 名
function teamRecHTML(gaps, warnNow) {
  const base = team.slots[team.cur];
  if (base.length === 2 || team.mons[team.cur]) {
    return team.slots.some((s, i) => s.length < 2 && !team.mons[i]) ? '<p class="muted small">點還沒選滿的格子，看建議補什麼。</p>' : '';
  }
  const others = team.slots.filter((s, i) => i !== team.cur && s.length);
  const units = team.slots.map((s, i) => [s, i]).filter(([s, i]) => i !== team.cur && s.length).map(unitOf);
  const names = ids => ids.map(id => T[id].zh).join('、');
  const delta = r => {
    const fixed = gaps.filter(g => !r.gaps.includes(g)), added = r.gaps.filter(g => !gaps.includes(g));
    return `<span>缺口 <b>${gaps.length} → ${r.gaps.length}</b>` + (fixed.length ? `・補上 ${names(fixed)}` : '')
      + (added.length ? `・新增 ${names(added)}` : '') + (warnNow || r.warn ? `・⚠ <b>${warnNow} → ${r.warn}</b>` : '') + '</span>';
  };
  return `<h3>第 ${team.cur + 1} 隻${base.length ? '的第二屬性' : ''}推薦</h3>`
    + `<p class="muted small b-intro">依加入後隊伍的 ⚠ 數、缺口數由少到多排序，同分再比這隻自己弱點少、抵抗多；點一下直接加入${base.length ? '（這隻是單屬性就不用選，直接點下一格）' : ''}。</p><div class="b-rec">`
    + recommendMember(others, base).slice(0, 5).map((r, i) => `<button data-add="${r.id}"><span class="rank">${i + 1}</span>${chips(r.defs)}${delta(r)}</button>`).join('')
    + `</div><h3>第 ${team.cur + 1} 隻推薦寶可夢</h3>`
    + `<p class="muted small b-intro">從名單${base.length ? `裡有${T[base[0]].zh}屬性的` : ''}寶可夢挑，依序比：①搭配──能解決幾個「隊伍特性與場地招式」的提醒`
    + '（隊上有戲法空間時，慢的攻擊手也算），扣掉會新增的；②能補上幾個「隊伍角色」缺的角色，加上能當幾隻「沒解」熱門威脅的對策；'
    + `③是不是 OP.GG 上隊上成員的常見隊友（搭配、角色、隊友要隊上已有挑了寶可夢的隊員）；④加入後隊伍的 ⚠ 數、缺口數；⑤${FMT_ZH[team.fmt]}排名。點一下直接放進這格。</p><div class="b-rec">`
    + recommendMon(others, base, team.fmt, team.mons.filter(Boolean), units, teamSets()).slice(0, 5).map((r, i) => `<button data-mon="${r.mon.key}"><span class="rank">${i + 1}</span>`
      + `${recInfo(r)}${delta(r)}<span class="meta">攻擊 ${r.mon.bs[1]}・特攻 ${r.mon.bs[3]}・${rankText(r.mon)}</span></button>`).join('')
    + '</div>';
}
// 推薦寶可夢的說明：角色標籤、補什麼（角色、搭配）、對策（原本沒解的熱門威脅）、常見隊友、會新增的搭配提醒
const recInfo = r => `<b>${r.mon.zh}</b>${chips(r.mon.types)}${r.role ? roleTags(r.role) : `<span class="meta">${FMT_ZH[team.fmt]}沒有統計</span>`}`
  + (r.fills.length || r.fix.length ? `<span class="fill">補：${[...new Set([...r.fills.map(n => n.zh + byText(needBy(r.role, n))), ...r.fix.map(fixText)])].join('、')}</span>` : '')
  + (r.threats.length ? `<span class="fill">對策：${r.threats.map(t => t.zh).join('、')}</span>` : '')
  + (r.mates.length ? `<span class="meta">常和 ${r.mates.map(k => MON[k].zh).join('、')} 同隊</span>` : '')
  + (r.add.length ? `<span class="meta">⚠ 搭配：${[...new Set(r.add.map(warnShort))].join('、')}</span>` : '');
// 隊伍總評：把搭配、缺的角色、沒解的熱門威脅、屬性弱點集中列出，每條附可以補的寶可夢，最後是下一隻建議。
// 候選都是放進第一個空格時 recommendMon 的結果（同一份排序），每條取前 3；6 隻都有屬性時不推薦
function summaryHTML(members) {
  const fmt = team.fmt, fz = FMT_ZH[fmt];
  const slots = members.filter(([, i]) => team.mons[i]).map(([, i]) => i), named = slots.map(i => team.mons[i]);
  const units = members.map(unitOf), slot = team.slots.findIndex(s => !s.length), sets = teamSets();
  const recs = slot >= 0 ? recommendMon(members.map(([s]) => s), [], fmt, named, units, sets) : [];
  // cands：[[推薦項目, 按鈕上的補充說明]...]
  const picks = cands => slot < 0 || !cands.length ? '' : '<span class="x-msg">可以補：</span>'
    + cands.slice(0, 3).map(([r, note]) => `<button class="mini" data-mon="${r.mon.key}">${r.mon.zh}${note ? `<span class="meta">${note}</span>` : ''}</button>`).join('');
  const line = (label, body, cands = []) => `<div class="issue"><span class="need no">${label}</span><span>${body}</span>${picks(cands)}</div>`;
  const out = [];
  // 搭配：靠天氣／場地沒人開、戲法空間偏快可以靠加人補；兩種天氣、無關天氣、順風＋戲法空間要換人才解得掉
  (named.length ? traitScan(named, fmt, sets).warns : []).forEach(w => {
    const who = w.h ? `${slots[w.h.j] + 1} ${MON[named[w.h.j]].zh}：` : '';
    const cands = w.kind === 'need' ? recs.filter(r => r.fix.some(f => f.w.id === w.id))
      : w.kind === 'trfast' ? recs.filter(r => r.fix.some(f => f.w.kind === 'trslow')) : [];
    out.push(line('⚠ 搭配', who + warnShort(w) + (['two', 'nowx', 'twtr'].includes(w.kind) ? '（要換掉其中一隻）' : ''), cands.map(r => [r])));
  });
  lackNeeds(named.map(k => roleOf(k, fmt, sets[k])).filter(Boolean), fmt).forEach(n =>
    out.push(line('✘ 缺角色', n.zh, recs.filter(r => r.fills.includes(n)).map(r => [r]))));
  const none = threatCheck(units, fmt, THREAT_N).filter(t => !t.level).map(t => t.mon);
  if (none.length) out.push(line('✘ 熱門威脅沒解', none.map(m => m.zh).join('、'),
    recs.filter(r => r.threats.length).sort((x, y) => y.threats.length - x.threats.length).map(r => [r, `${r.threats.length} 隻`])));
  const rows = teamProfile(members.map(([s]) => s)), warn = rows.filter(r => r.warn), gaps = teamGaps(rows);
  if (warn.length || gaps.length) out.push(line('⚠ 屬性',
    [warn.length && `要注意 ${warn.map(r => T[r.atk].zh).join('、')}`, gaps.length && `缺口 ${gaps.map(id => T[id].zh).join('、')}`].filter(Boolean).join('；'),
    recs.filter(r => r.warn < warn.length || r.gaps.length < gaps.length).sort((x, y) => x.warn - y.warn || x.gaps.length - y.gaps.length)
      .map(r => [r, `缺口 ${gaps.length}→${r.gaps.length}`])));
  return `<div class="res-head">隊伍總評<span class="muted small">（${fz}；${members.length} 隻，其中 ${named.length} 隻挑了寶可夢）</span></div>`
    + (out.length ? out.join('') : '<p class="b-sum">✔ 目前沒有明顯問題。</p>')
    + (slot < 0 ? '<p class="muted small b-intro">6 隻都選了；要換人的話，點格子後重新選屬性、挑其他寶可夢就能換掉。</p>'
      : `<h3>下一隻（第 ${slot + 1} 隻）建議</h3><div class="b-rec">`
        + recs.slice(0, 3).map((r, i) => `<button data-mon="${r.mon.key}"><span class="rank">${i + 1}</span>${recInfo(r)}<span class="meta">${rankText(r.mon)}</span></button>`).join('')
        + '</div>')
    + `<p class="note">※ 問題整理自下面各卡片（隊伍角色、隊伍特性與場地招式、弱點總表、熱門威脅檢查）；「可以補」和「下一隻建議」`
    + `都是放進第 ${slot + 1 || '—'} 隻（第一個空格）時的推薦，排序方式同弱點總表下的「推薦寶可夢」，點一下直接放進去。</p>`;
}
// 隊伍角色：挑了寶可夢的隊員依常用招式判斷角色、列出常用招式與效果，並對照 NEEDS 標出隊伍還缺什麼
const MAIN_ZH = { phys: '物攻', spec: '特攻', sup: '輔助' };
const CAT_ZH = { physical: '物理', special: '特殊', status: '變化' };
const roleTags = r => `<span class="role ${r.main}">${MAIN_ZH[r.main]}</span>` + r.tags.map(t => `<span class="rtag">${ROLE[t.id].zh}</span>`).join('');
const byText = by => by.length ? `（${by.map(([zh, p]) => `${zh} ${p}%`).join('、')}）` : '';
// 六項種族值＋合計；攻擊、特攻較高的那項上色，看得出這隻打得多痛
const STAT_ZH = ['HP', '攻擊', '防禦', '特攻', '特防', '速度'];
const statsHTML = m => `<div class="bst">${m.bs.map((v, k) => `<span${(k === 1 || k === 3) && v === Math.max(m.bs[1], m.bs[3]) ? ' class="hi"' : ''}>`
  + `${STAT_ZH[k]} <b>${v}</b></span>`).join('')}<span>合計 <b>${m.bs.reduce((s, v) => s + v, 0)}</b></span></div>`;
// OP.GG 常帶道具（前 3；登錄的不標使用率）與常見隊友（前 6）；fams 是隊上成員的家族，已在隊上的隊友標 ✔
const kitHTML = (use, fams) => use.items.length || use.mates.length ? '<div class="bst">'
  + (use.items.length ? `<span>道具 ${use.items.slice(0, 3).map(([k, p]) => `<b>${ITEMS[k]?.[0] ?? k}</b>` + (use.reg?.items ? '（登錄）' : ` ${p}%`)).join('・')}</span>` : '')
  + (use.mates.length ? `<span>常見隊友 ${use.mates.slice(0, 6).map(k => fams.includes(family(MON[k])) ? `<b>✔${MON[k].zh}</b>` : MON[k].zh).join('・')}</span>` : '')
  + '</div>' : '';
// 常用招式（摘要列前 5 招）、特性、超級進化後特性、道具的完整清單與效果（r 是 roleOf 的結果；我方登錄的欄位標「登錄」、不標使用率）；
// 隊伍角色和出戰選角的對手情報共用
const useDetailsHTML = r => {
  const g = r.use.reg || {}, pc = (p, reg) => reg ? '登錄' : p + '%';
  return `<details class="mv"><summary>${g.moves ? '登錄' : '常用'}：${r.use.moves.slice(0, 5).map(([k, p]) => MOVES[k][0] + (g.moves ? '' : ` ${p}%`)).join('・')}`
    + `${r.use.moves.length > 5 ? '…' : ''}（點開看效果）</summary>`
    + r.use.moves.map(([k, p]) => {
      const [zh, ty, cat, pow, eff] = MOVES[k];
      return `<div class="mv-row"><span class="mv-p">${pc(p, g.moves)}</span><b>${zh}</b>${chip(ty)}<span class="meta">${CAT_ZH[cat]}${pow ? ' 威力 ' + pow : ''}</span><span class="mv-e">${eff}</span></div>`;
    }).join('')
    + r.use.abils.map(([k, p]) => `<div class="mv-row"><span class="mv-p">${pc(p, g.abils)}</span><b>特性：${ABILS[k][0]}</b><span class="mv-e">${ABILS[k][1]}</span></div>`).join('')
    + r.mega.map(k => `<div class="mv-row"><span class="mv-p">固定</span><b>超級進化後特性：${ABILS[k][0]}</b><span class="mv-e">${ABILS[k][1]}</span></div>`).join('')
    + r.use.items.filter(([k]) => ITEMS[k]).map(([k, p]) => `<div class="mv-row"><span class="mv-p">${pc(p, g.items)}</span><b>道具：${ITEMS[k][0]}</b><span class="mv-e">${ITEMS[k][1]}</span></div>`).join('')
    + '</details>';
};
function roleHTML(members) {
  const fz = FMT_ZH[team.fmt];
  const rows = members.map(([, i]) => ({ i, key: team.mons[i], r: team.mons[i] ? roleOf(team.mons[i], team.fmt, team.sets[i]) : null }));
  const fams = rows.filter(x => x.key).map(x => family(MON[x.key]));
  const roles = rows.map(x => x.r).filter(Boolean), lack = lackNeeds(roles, team.fmt);
  const cnt = k => roles.filter(r => r.main === k).length;
  const who = n => rows.filter(x => x.r && needBy(x.r, n)).map(x => x.i + 1).join('、');
  const names = (list, dict) => list.filter(k => dict[k]).map(k => dict[k][0]).join('、');
  return `<div class="res-head">隊伍角色<span class="muted small">（依${fz}常用招式；${roles.length} 隻有資料）</span></div>`
    + (roles.length
      ? `<p class="b-sum">物攻 <b>${cnt('phys')}</b> 隻・特攻 <b>${cnt('spec')}</b> 隻・輔助 <b>${cnt('sup')}</b> 隻</p>`
        + `<div class="x-line"><span class="x-msg">${fz}隊伍該有：</span>${NEEDS[team.fmt].map(n => lack.includes(n)
          ? `<span class="need no">✘ ${n.zh}</span>` : `<span class="need ok">✔ ${n.zh}（${who(n)}）</span>`).join('')}</div>`
      : '<p class="muted small b-intro">挑了寶可夢後，才會判斷角色、標出隊伍還缺什麼。</p>')
    + rows.map(({ i, key, r }) => {
      if (!key) return `<div class="mrole"><div class="mrole-h"><b>${i + 1}</b>${chips(team.slots[i])}<span class="meta">只選屬性，沒有招式資料</span></div></div>`;
      const head = `<div class="mrole"><div class="mrole-h"><b>${i + 1} ${MON[key].zh}</b>`;
      if (!r) return `${head}<span class="meta">${fz}沒有統計資料</span></div>${statsHTML(MON[key])}</div>`;
      return `${head}${roleTags(r)}<span class="meta">${r.use.reg?.moves ? '登錄配招' : '平均帶'} 物攻 ${r.phys.toFixed(1)}・特攻 ${r.spec.toFixed(1)}・輔助 ${r.sup.toFixed(1)} 招`
        + `${MON[key].base ? `・沿用${MON[MON[key].base].zh}的統計` : ''}</span></div>${statsHTML(MON[key])}${kitHTML(r.use, fams)}${useDetailsHTML(r)}</div>`;
    }).join('')
    + `<details class="b-more" style="margin-top:10px"><summary>角色怎麼判斷</summary><p class="note">`
    + `依 OP.GG ${fz}統計的常用招式與特性（${MONS_DATE} 擷取，只收使用率 5% 以上）判斷，超級進化沿用原型的統計，再加上超級進化後的固定特性（算 100%，和原型常用特性相同的只算一次）。`
    + `物攻／特攻／輔助＝平均帶幾招該類招式（使用率加總 ÷ 100；輔助類特性如威嚇也算一招），最多的那類就是這隻的角色，輔助同分算輔助。`
    + '在上方格子登錄了配招的隊員，登錄的招式、特性、道具當成使用率 100%（不標使用率），沒填的欄位照 OP.GG 統計。'
    + `功能標籤要使用率 ${ROLE_PCT}% 以上才標，打 ★ 的算輔助招：<br>`
    + ROLES.map(r => `<b>${r.sup ? '★' : ''}${r.zh}</b>：${names(r.moves, MOVES)}${r.abils && names(r.abils, ABILS) ? '；特性 ' + names(r.abils, ABILS) : ''}`).join('<br>')
    + `<br>「隊伍該有」＝物攻、特攻輸出各一，加上${fz}排名前 30 名裡至少兩成有的功能。`
    + '<br>道具、常見隊友也是 OP.GG 的統計（道具只收使用率 5% 以上；隊友是 OP.GG「隊友」名單的前幾名，標 ✔ 的已在隊上）。</p></details>';
}
// 隊伍特性與場地招式：挑了寶可夢的隊員依常用特性、招式（使用率 ROLE_PCT% 以上，同功能標籤）分類，再做搭配檢查；只看我方。
// 清單可含目前資料還沒有的特性／招式（如薄霧製造者、沙暴），之後更新資料出現了就會算進去
const NO_WEATHER = ['cloud-nine', 'air-lock'];
// abils＝特性、moves＝招式（資料裡特性和招式的 key 不重複）
const TRAIT_CATS = [
  { zh: '開天氣',   abils: ['drought', 'drizzle', 'sand-stream', 'sand-spit', 'snow-warning'],
    moves: ['sunny-day', 'rain-dance', 'sandstorm', 'snowscape', 'chilly-reception'] },
  { zh: '開場地',   abils: ['electric-surge', 'grassy-surge', 'misty-surge', 'psychic-surge', 'seed-sower'],
    moves: ['electric-terrain', 'grassy-terrain', 'misty-terrain', 'psychic-terrain'] },
  { zh: '反先制',   abils: ['armor-tail', 'queenly-majesty', 'dazzling', 'psychic-surge'], moves: ['psychic-terrain', 'quick-guard'] },
  { zh: '抗威嚇',   abils: ['inner-focus', 'oblivious', 'own-tempo', 'scrappy', 'guard-dog', 'clear-body', 'full-metal-body', 'white-smoke',
      'hyper-cutter', 'mirror-armor', 'defiant', 'competitive', 'contrary'] },
  { zh: '威嚇',     abils: ['intimidate'] },
  { zh: '先制特性', abils: ['prankster', 'gale-wings', 'triage'] },
  { zh: '無關天氣', abils: NO_WEATHER },
  { zh: '順風',     moves: ['tailwind'] },
  { zh: '戲法空間', moves: ['trick-room'] },
  { zh: '光牆／反射壁／極光幕', moves: ['reflect', 'light-screen', 'aurora-veil'] },
  { zh: '廣域／快速防守', moves: ['wide-guard', 'quick-guard'] },
];
// FIELD_SET＝開天氣／場地的特性或招式 → 開出哪種；FIELD_NEED＝只在某天氣／場地才有效果的特性或招式 → 需要哪種
// （乾燥皮膚、收穫這類不靠天氣也有效果的不算）
const FIELD_ZH = { sun: '晴天', rain: '下雨', sand: '沙暴', snow: '下雪', electric: '電氣場地', grassy: '青草場地', misty: '薄霧場地', psychic: '精神場地' };
const WEATHERS = ['sun', 'rain', 'sand', 'snow'], TERRAINS = ['electric', 'grassy', 'misty', 'psychic'];
const FIELD_SET = { drought: 'sun', drizzle: 'rain', 'sand-stream': 'sand', 'sand-spit': 'sand', 'snow-warning': 'snow',
  'electric-surge': 'electric', 'grassy-surge': 'grassy', 'misty-surge': 'misty', 'psychic-surge': 'psychic', 'seed-sower': 'grassy',
  'sunny-day': 'sun', 'rain-dance': 'rain', sandstorm: 'sand', snowscape: 'snow', 'chilly-reception': 'snow',
  'electric-terrain': 'electric', 'grassy-terrain': 'grassy', 'misty-terrain': 'misty', 'psychic-terrain': 'psychic' };
const FIELD_NEED = { chlorophyll: 'sun', 'solar-power': 'sun', 'leaf-guard': 'sun', 'swift-swim': 'rain', 'rain-dish': 'rain', hydration: 'rain',
  'sand-rush': 'sand', 'sand-force': 'sand', 'sand-veil': 'sand', 'slush-rush': 'snow', 'ice-body': 'snow', 'snow-cloak': 'snow',
  'surge-surfer': 'electric', 'grass-pelt': 'grassy', 'aurora-veil': 'snow' };
// 特性／招式的中文名；fieldTag＝名稱和天氣／場地不同時才補註，例如「大晴天（晴天）」，「電氣場地」就不重複
const zhOf = k => (ABILS[k] || MOVES[k])[0];
const fieldTag = k => { const f = FIELD_SET[k] || FIELD_NEED[k]; return f && FIELD_ZH[f] !== zhOf(k) ? FIELD_ZH[f] : ''; };
// 隊員 keys（寶可夢 key 陣列，j 是索引）在 fmt 的常用特性／招式與搭配檢查，隊伍卡片和推薦寶可夢共用：
//   mine＝有統計的隊員 { j, list: [key, 使用率, 超級進化後, 是招式]... }（原型的常用特性與招式，超級進化再加上固定的特性，算 100%，沒有中文說明的略過）
//   has(abils, moves)＝常用特性在 abils、常用招式在 moves 裡的項目 { j, k, p, mega, move }（使用率 ROLE_PCT% 以上）
//   set＝開天氣／場地的項目；warns＝搭配提醒 { id（推薦時比較加入前後用）, kind, ... }。sets：隊員 key → 登錄的配招（見 useOf）
function traitScan(keys, fmt, sets = {}) {
  const mine = keys.map((key, j) => {
    const m = MON[key], use = useOf(key, fmt, sets[key]);
    return { j, list: [...(use?.abils || []).map(([k, p]) => [k, p, false, false, use.reg?.abils]), ...m.megaAbils.filter(k => ABILS[k]).map(k => [k, 100, true]),
      ...(use?.moves || []).map(([k, p]) => [k, p, false, true, use.reg?.moves])] };
  }).filter(x => x.list.length);
  // reg＝這項是登錄的（不標使用率）
  const has = (abils = [], moves = []) => mine.flatMap(({ j, list }) => list.filter(([k, p, , move]) => p >= ROLE_PCT && (move ? moves : abils).includes(k))
    .map(([k, p, mega, move, reg]) => ({ j, k, p, mega, move, reg })));
  // 搭配檢查：靠天氣／場地的特性或招式沒人開、同時會開兩種天氣（或場地）、無關天氣抵消隊友的天氣、順風和戲法空間同隊、戲法空間但隊員偏快
  const setKeys = Object.keys(FIELD_SET), needKeys = Object.keys(FIELD_NEED);
  const set = has(setKeys, setKeys), need = has(needKeys, needKeys), warns = [];
  // 一隻只有一個特性：自己的特性開、自己的特性又要用不算；有一邊是招式就算
  need.forEach(h => {
    const f = FIELD_NEED[h.k];
    if (!set.some(s => FIELD_SET[s.k] === f && (s.j !== h.j || s.move || h.move))) warns.push({ id: `need:${h.j}:${h.k}`, kind: 'need', h, f });
  });
  [['天氣', f => WEATHERS.includes(f)], ['場地', f => !WEATHERS.includes(f)]].forEach(([zh, isKind]) => {
    const fs = [...new Set(set.map(s => FIELD_SET[s.k]))].filter(isKind);
    if (fs.length > 1) warns.push({ id: 'two:' + zh, kind: 'two', zh, fs });
  });
  const wxUse = [...set.filter(s => WEATHERS.includes(FIELD_SET[s.k])), ...need.filter(h => WEATHERS.includes(FIELD_NEED[h.k]))];
  has(NO_WEATHER).forEach(h => {
    if (wxUse.some(x => x.j !== h.j)) warns.push({ id: `nowx:${h.j}`, kind: 'nowx', h });
  });
  const tw = has([], ['tailwind']), tr = has([], ['trick-room']);
  if (tw.length && tr.length) warns.push({ id: 'twtr', kind: 'twtr', tw, tr });
  // 戲法空間：隊員比熱門前 THREAT_N 的一半以上快（看速度種族值，同速度線），超過一半這樣就提醒
  if (tr.length) {
    const top = topMons(fmt, THREAT_N);
    const fast = keys.map((_, j) => j).filter(j => top.filter(t => t.spe < MON[keys[j]].spe).length * 2 >= top.length);
    if (fast.length * 2 > keys.length) warns.push({ id: 'trfast', kind: 'trfast', fast, n: keys.length });
  }
  return { mine, has, set, warns };
}
// 推薦寶可夢用的搭配提醒短句
const warnShort = w => ({ need: () => `${zhOf(w.h.k)}沒有${FIELD_ZH[w.f]}`, two: () => `兩種${w.zh}`, nowx: () => '無關天氣抵消天氣',
  twtr: () => '順風＋戲法空間', trfast: () => '戲法空間下偏快' })[w.kind]();
// 推薦寶可夢補上的搭配（recommendMon 的 fix 項目），例如「開晴天（超級進化後日照）」「戲法空間下先動（速度 30）」
const fixText = ({ w, by, spe }) => w.kind === 'need'
  ? `開${FIELD_ZH[w.f]}（${by.map(h => (h.mega ? '超級進化後' : '') + zhOf(h.k) + (h.mega ? '' : ` ${h.p}%`)).join('、')}）`
  : w.kind === 'trslow' ? `戲法空間下先動（速度 ${spe}）` : warnShort(w);
function traitHTML(members) {
  const fz = FMT_ZH[team.fmt];
  const named = members.filter(([, i]) => team.mons[i]).map(([, i]) => i);
  const { mine, has, warns } = traitScan(named.map(i => team.mons[i]), team.fmt, teamSets());
  const who = j => `${named[j] + 1} ${MON[team.mons[named[j]]].zh}`, whoList = hs => hs.map(h => who(h.j)).join('、');
  // 依隊員合併成「1 噴火龍（日照 96%・晴天）」；超級進化的隊員的特性分「出場時」（原型的常用特性）和「超級進化後」
  const abText = h => (h.move ? '' : h.mega ? '超級進化後 ' : MON[team.mons[named[h.j]]].base ? '出場時 ' : '') + zhOf(h.k) + (h.mega || h.reg ? '' : ` ${h.p}%`)
    + (h.k in FIELD_SET && fieldTag(h.k) ? '・' + fieldTag(h.k) : '');
  const label = hs => [...new Set(hs.map(h => h.j))].map(j => `${who(j)}（${hs.filter(h => h.j === j).map(abText).join('、')}）`);
  const names = list => list.filter(k => ABILS[k] || MOVES[k]).map(k => zhOf(k) + (fieldTag(k) ? `（${fieldTag(k)}）` : '')).join('、');
  const head = `<div class="res-head">隊伍特性與場地招式<span class="muted small">（依${fz}常用特性與招式；${mine.length} 隻有資料）</span></div>`;
  if (!mine.length) return head + `<p class="muted small b-intro">${named.length ? `挑了寶可夢的隊員在${fz}都沒有統計資料。`
    : '挑了寶可夢後，才會依常用特性與招式標出誰會開天氣、開場地、順風、戲法空間、反先制、抗威嚇等。'}</p>`;
  const text = w => ({
    need: () => `${label([w.h])[0]}只在${FIELD_ZH[w.f]}有效果，隊上沒有隊友或招式會開${FIELD_ZH[w.f]}`,
    two: () => `隊上會開 ${w.fs.length} 種${w.zh}（${w.fs.map(f => FIELD_ZH[f]).join('、')}），後出場的會蓋掉先開的${w.zh}`,
    nowx: () => `${label([w.h])[0]}在場時天氣沒有效果，會抵消隊友的天氣`,
    twtr: () => `隊上同時有順風（${whoList(w.tw)}）和戲法空間（${whoList(w.tr)}）：順風讓我方速度 ×2、戲法空間讓慢的先動，一起開會互相衝突`,
    trfast: () => `隊上有戲法空間，但 ${w.n} 隻裡有 ${w.fast.length} 隻比${fz}熱門前 ${THREAT_N} 的一半以上快（${w.fast.map(who).join('、')}），戲法空間下反而會比較晚動`,
  })[w.kind]();

  return head
    + TRAIT_CATS.map(c => {
      const l = label(has(c.abils, c.moves));
      return `<div class="x-line"><span class="x-msg">${c.zh}：</span>${l.length ? l.map(s => `<span class="rtag">${s}</span>`).join('') : '<span class="none">（無）</span>'}</div>`;
    }).join('')
    + `<div class="x-line"><span class="x-msg">搭配檢查：</span>${warns.length ? '' : '<span class="none">（沒有問題）</span>'}</div>`
    + warns.map(w => `<div class="x-line"><span>⚠ ${text(w)}</span></div>`).join('')
    + `<details class="b-more" style="margin-top:10px"><summary>怎麼分類、怎麼檢查</summary><p class="note">`
    + `依 OP.GG ${fz}統計的常用特性與招式（${MONS_DATE} 擷取），使用率 ${ROLE_PCT}% 以上才算；登錄了配招的隊員照登錄的算（不標使用率）。`
    + '超級進化的隊員，特性分兩段：「出場時」是原型的常用特性（出場還沒超級進化），「超級進化後」是超級進化固定的特性。<br>'
    + TRAIT_CATS.map(c => `<b>${c.zh}</b>：${[c.abils && names(c.abils), c.moves && (c.abils ? '招式 ' : '') + names(c.moves)].filter(Boolean).join('；')}`).join('<br>')
    + `<br><b>搭配檢查</b>：${names(Object.keys(FIELD_NEED))}只在括號裡的天氣／場地有效果，隊上沒有隊友或招式會開就提醒`
    + '（一隻只有一個特性，自己的特性開、自己的特性又要用不算）；乾燥皮膚、收穫這類不靠天氣也有效果的不算。'
    + '同時會開兩種天氣（或兩種場地）、或有無關天氣又有隊友靠天氣，也會提醒。'
    + `順風和戲法空間在同一隊會提醒；有戲法空間，但一半以上的隊員比${fz}熱門前 ${THREAT_N} 的一半以上快（只比速度種族值），也會提醒。`
    + '精神場地只保護在地面上的寶可夢不被先制招式攻擊。</p></details>';
}
// 屬性篩選（隊伍分析、出戰選角、傷害計算共用）：屬性都符合的寶可夢，依 fmt 排名（沒排名的排後面，超級進化再排後面）
const monsOfTypes = (sel, fmt) => MONS.filter(m => sel.every(t => m.types.includes(t)))
  .sort((x, y) => !!x.base - !!y.base || (x.rank[fmt] || Infinity) - (y.rank[fmt] || Infinity));
// 目前格子選了屬性、還沒挑寶可夢時，列出屬性都符合的寶可夢讓使用者挑：同家族已在其他格子的不列；
// 全部列出（沒有打字搜尋，截斷的話單屬性又沒排名的會選不到），角色只在有排名時標（同 recommendMon）
function typeListHTML() {
  const sel = team.slots[team.cur];
  if (!sel.length || team.mons[team.cur]) return '';
  const fams = team.mons.filter((k, i) => k && i !== team.cur).map(k => family(MON[k]));
  const list = monsOfTypes(sel, team.fmt).filter(m => !fams.includes(family(m)));
  const meta = m => {
    const r = m.rank[team.fmt] && roleOf(m.key, team.fmt);
    return (m.rank[team.fmt] ? `#${m.rank[team.fmt]}` : '無排名') + (r ? '・' + MAIN_ZH[r.main] : '');
  };
  return `<div class="b-label">有${sel.map(id => T[id].zh).join('＋')}屬性的寶可夢<span class="muted small">共 ${list.length} 隻`
    + `${list.length ? `，依${FMT_ZH[team.fmt]}排名；點一下放進第 ${team.cur + 1} 隻` : ''}</span></div>`
    + (list.length
      ? `<div class="qpick">${list.map(m => `<button data-mon="${m.key}">${m.zh}${chips(m.types)}<span class="meta">${meta(m)}</span></button>`).join('')}</div>`
      : '<p class="muted small b-intro">名單裡沒有這種屬性組合的寶可夢；只選屬性也能看屬性分析。</p>');
}
// 目前格子挑了寶可夢時的配招登錄（team.sets，見 useOf）：4 招、特性、道具（超級進化的特性固定、道具固定是超級石，不能選；
// 一般型態的道具不列超級石，要超級進化就在格子選超級進化型態）、6 項能力點數、性格。
// 招式／特性／道具選單先列這隻在 fmt 的 OP.GG 常用（依使用率），其他依中文名排；資料只收得到任一隻寶可夢使用率 5% 以上的招式／特性／道具，
// 也不檢查這隻學不學得會。性格是「↑哪項・↓哪項」（攻擊～速度，HP 沒有性格）
const NATURES = [1, 2, 3, 4, 5].flatMap(u => [1, 2, 3, 4, 5].filter(d => d !== u).map(d => [u, d]));
function setEditorHTML() {
  const i = team.cur, key = team.mons[i];
  if (!key) return '';
  const m = MON[key], s = team.sets[i] || emptySet(), use = useOf(key, team.fmt), fz = FMT_ZH[team.fmt];
  const opt = (v, zh, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${zh}</option>`;
  const opts = (dict, common, cur, ok = () => true) => {
    const top = common.map(([k]) => k).filter(k => dict[k] && ok(k));
    const rest = Object.keys(dict).filter(k => !top.includes(k) && ok(k)).sort((x, y) => dict[x][0].localeCompare(dict[y][0], 'zh-Hant'));
    return opt('', '（未填）', cur) + (top.length ? `<optgroup label="${fz}常用">${top.map(k => opt(k, dict[k][0], cur)).join('')}</optgroup>` : '')
      + `<optgroup label="${top.length ? '其他' : '全部'}">${rest.map(k => opt(k, dict[k][0], cur)).join('')}</optgroup>`;
  };
  const sum = s.sp.reduce((a, v) => a + v, 0), nat = s.nat[0] ? s.nat.join('+') : '';
  return `<div class="set-ed"><div class="b-label">第 ${i + 1} 隻 ${m.zh} 的配招<span class="muted small">沒填的欄位照 OP.GG ${fz}統計；登錄後隊伍分析、出戰選角都照這份判斷</span></div>`
    + `<div class="c-f"><span class="c-l">招式</span>${s.moves.map((k, n) => `<select class="sel" data-mv="${n}" aria-label="招式 ${n + 1}">${opts(MOVES, use?.moves || [], k)}</select>`).join('')}</div>`
    + `<div class="c-f"><span class="c-l">特性</span>${m.base ? `<span>${m.megaAbils.map(abilZh).join('、')}<span class="meta">（超級進化後固定）</span></span>`
      : `<select class="sel" data-ab aria-label="特性">${opts(ABILS, use?.abils || [], s.ab)}</select>`}</div>`
    + `<div class="c-f"><span class="c-l">道具</span>${m.base ? `<span>${stoneOf(m) ? ITEMS[stoneOf(m)][0] : '專屬的超級石'}<span class="meta">（超級進化固定）</span></span>`
      : `<select class="sel" data-it aria-label="道具">${opts(ITEMS, use?.items || [], s.item, k => !isStone(k))}</select>`}</div>`
    + `<div class="c-f"><span class="c-l">能力點數</span><div class="c-sts">${STAT_ZH.map((zh, n) => `<span class="c-st"><label for="tSp${n}">${zh}</label>`
      + `<input type="number" class="sel c-num" id="tSp${n}" data-sp="${n}" min="0" max="32" step="1" value="${s.sp[n]}"></span>`).join('')}`
    + `<span class="${sum > 66 ? 'x-msg' : 'muted small'}">${sum > 66 ? '⚠ ' : ''}合計 ${sum}／66${sum > 66 ? '，超過上限' : ''}</span></div></div>`
    + `<div class="c-f"><span class="c-l">性格</span><select class="sel" data-nat aria-label="性格">${opt('', '不加減', nat)}`
    + NATURES.map(([u, d]) => opt(`${u}+${d}`, `${STAT_ZH[u]} ↑・${STAT_ZH[d]} ↓`, nat)).join('') + '</select></div>'
    + `<div class="c-f"><button class="mini" data-setclear${team.sets[i] ? '' : ' disabled'}>清除配招</button></div></div>`;
}
// 實戰：OP.GG 對手 m 的敗於／勝於名單裡有我方挑了寶可夢的隊員（named 是格子索引，同家族算）；
// 兩份名單都有的不列（名單依次數排，兩隻都熱門時常常兩邊都上榜，看不出誰剋誰）。熱門威脅和出戰選角共用
function realHTML(m, named) {
  const u = useOf(m.key, team.fmt);
  const pick = (keys, other) => named.filter(i => keys.includes(family(MON[team.mons[i]])) && !other.includes(family(MON[team.mons[i]])))
    .map(i => `${i + 1} ${MON[team.mons[i]].zh}`).join('、');
  const lose = u ? pick(u.lose, u.win) : '', win = u ? pick(u.win, u.lose) : '';
  return lose || win ? `<span class="who">實戰：${[lose && `牠常敗給 ${lose}`, win && `牠常打倒 ${win}`].filter(Boolean).join('・')}</span>` : '';
}
// 對手的攻擊（monUnit 的 atk）寫成「地震、龍尾、流星群」；沒有統計看本系的寫「本系龍」
const oppAtkText = u => u.atk.length ? u.atk.map(a => a.zh || `本系${T[a.ty].zh}`).join('、') : '（沒有常用攻擊招式）';
// 熱門威脅：沒解的排前面，同一級再依排名
function threatHTML(members) {
  const units = members.map(unitOf);
  const list = threatCheck(units, team.fmt, THREAT_N)
    .sort((x, y) => x.level - y.level || x.mon.rank[team.fmt] - y.mon.rank[team.fmt]);
  const who = idx => idx.length ? idx.map(j => `${members[j][1] + 1} ${slotName(members[j][1])}`).join('、') : '（無）';
  // 剋得到的隊員附上用哪招，例如「1 烈咬陸鯊（地震）」；看本系的寫「本系」。牠可能超級進化時，列出能剋其中任一型態的招式
  const whoHit = (idx, defsList) => idx.length ? idx.map(j => `${members[j][1] + 1} ${slotName(members[j][1])}（`
    + [...new Set(units[j].atk.filter(a => defsList.some(ts => eff(a.ty, ts) >= 2)).map(a => a.zh || '本系'))].join('、') + '）').join('、') : '（無）';
  const LV = ['✘ 沒解', '△ 半解', '✔ 有解'], cnt = [0, 1, 2].map(l => list.filter(t => t.level === l).length);
  const named = members.filter(([, i]) => team.mons[i]).map(([, i]) => i);
  return `<div class="res-head">熱門威脅檢查<span class="muted small">（${FMT_ZH[team.fmt]}排名前 ${THREAT_N}）</span></div>`
    + `<p class="b-sum">沒解 <b>${cnt[0]}</b> 隻、半解 <b>${cnt[1]}</b> 隻、有解 <b>${cnt[2]}</b> 隻。</p>`
    + list.map(t => {
      const mg = megaInfo(t.mon, team.fmt).filter(x => x.counted);
      return `<div class="threat lv${t.level}"><span class="lv">${LV[t.level]}</span><span class="meta">#${t.mon.rank[team.fmt]}</span>`
        + `<b>${t.mon.zh}</b>${chips(t.mon.types)}${mg.length ? `<span class="who">可能超級進化：${megaText(mg)}</span>` : ''}`
        + `<span class="who">牠的攻擊：${oppAtkText(monUnit(t.mon, team.fmt))}</span>`
        + `<span class="who">不怕牠：${who(t.safe)}・招式剋牠：${whoHit(t.hit, [t.mon.types, ...mg.map(x => x.mon.types)])}</span>${realHTML(t.mon, named)}</div>`;
    }).join('')
    + `<p class="note">※「不怕牠」＝牠${FMT_ZH[team.fmt]}常帶的攻擊招式打這隻都 ×1 以下；「招式剋牠」＝這隻${FMT_ZH[team.fmt]}常帶的攻擊招式能對牠效果絕佳。`
    + `兩邊算法相同：同屬性的攻擊招式使用率加總 ${ROLE_PCT}% 以上才算這個屬性（如龍尾、流星群各 28%，加起來 56% 就算龍），`
    + '擊掌奇襲、冰凍之風這類輔助用的攻擊招式和固定傷害、反擊類招式不算；只選屬性或沒有統計的看本系。'
    + '有解＝同一隻兩者兼具，半解＝只有其中一種。'
    + `「可能超級進化」＝OP.GG 道具統計有 ${ROLE_PCT}% 以上帶這顆超級石的型態（沒有道具統計的每種都算），「不怕」「剋」要對進化前後每種型態都成立才算。`
    + '招式屬性以招式本身的屬性計（氣象球、妖精皮膚等會改變屬性的不另算）；'
    + `不含特性、道具、能力值；排名與常用招式為 OP.GG 統計（${MONS_DATE} 擷取）。`
    + '「實戰」＝OP.GG 這隻的「敗於」「勝於」前 10 名裡有我方隊員（超級進化看原型）；名單依次數排，熱門寶可夢容易上榜，'
    + '兩份名單都有的不列，只供參考，不影響有解／沒解。</p>';
}
// 速度線：我方（挑了寶可夢的才有速度）和熱門寶可夢依速度種族值由快到慢排，同速時我方排前面。
// 熱門寶可夢常帶超級石的（megaInfo 算進去的），超級進化型態另列一行；比幾隻快／慢時取進化前後較快的
// 帶講究圍巾的使用率（OP.GG 道具統計）；超級進化要帶超級石，不標
// 帶講究圍巾的比例（set＝我方登錄的配招，登錄了道具就看登錄的）
const scarf = (m, set) => {
  const u = m.base ? null : useOf(m.key, team.fmt, set), p = u?.items.find(([k]) => k === 'choice-scarf')?.[1];
  return p ? `・講究圍巾${u.reg?.items ? '（登錄）' : ` ${p}%`}` : '';
};
function speedHTML(members) {
  const top = topMons(team.fmt, THREAT_N), megas = new Map(top.map(m => [m, megaInfo(m, team.fmt).filter(x => x.counted)]));
  const fastest = m => Math.max(m.spe, ...megas.get(m).map(x => x.mon.spe));
  const mine = members.filter(([, i]) => team.mons[i]).map(([, i]) => ({ i, mon: MON[team.mons[i]] }));
  const rows = [...mine, ...top.flatMap(mon => [{ mon }, ...megas.get(mon).map(x => ({ mon: x.mon, p: x.p, mega: true }))])]
    .sort((x, y) => y.mon.spe - x.mon.spe || (y.i != null) - (x.i != null) || x.mon.rank[team.fmt] - y.mon.rank[team.fmt]);
  return `<div class="res-head">速度線<span class="muted small">（速度種族值：我方＋${FMT_ZH[team.fmt]}排名前 ${THREAT_N}）</span></div>`
    + mine.map(({ i, mon }) => {
      const n = f => top.filter(t => f(fastest(t), mon.spe)).length;
      return `<div class="x-line"><b>${i + 1} ${mon.zh}</b><span class="x-msg">速度 ${mon.spe}：比 ${n((t, m) => t < m)} 隻快、`
        + `同速 ${n((t, m) => t === m)} 隻、比 ${n((t, m) => t > m)} 隻慢</span></div>`;
    }).join('')
    + (members.some(([, i]) => !team.mons[i]) ? '<p class="muted small b-intro">只選屬性的格子沒有速度資料，挑了寶可夢才會列進速度線。</p>' : '')
    + `<div style="margin-top:8px">${rows.map(x => `<div class="spd${x.i != null ? ' me' : ''}"><b class="v">${x.mon.spe}</b><b>${x.mon.zh}</b>${chips(x.mon.types)}`
      + `<span class="meta">${x.i != null ? `我方第 ${x.i + 1} 隻` : `#${x.mon.rank[team.fmt]}`}`
      + `${x.mega ? `・超級進化${x.p != null ? `（帶超級石 ${x.p}%）` : ''}` : ''}${scarf(x.mon, x.i != null ? team.sets[x.i] : undefined)}</span></div>`).join('')}</div>`
    + '<p class="note">※ 只比速度種族值，不含性格、能力投資、道具、特性與場地（如順風、戲法空間）；'
    + '種族值相同時實際誰快要看投資，所以算同速。我方超級進化看超級進化後的速度；'
    + `熱門寶可夢 OP.GG 道具統計有 ${ROLE_PCT}% 以上帶超級石的，超級進化型態另列一行（標「超級進化」），上方「比幾隻快／慢」取進化前後較快的那個。`
    + `「講究圍巾 N%」＝OP.GG ${FMT_ZH[team.fmt]}統計有 N% 的人帶講究圍巾（速度 ×1.5），帶的話實際會更快；超級進化要帶超級石，不標。</p>`;
}
function renderTeam() {
  $('#tSlots').innerHTML = team.slots.map((s, i) => `<button class="slot" data-i="${i}" aria-pressed="${i === team.cur}"><span class="slot-n">第 ${i + 1} 隻</span>`
    + `${team.mons[i] ? `<span class="slot-name">${MON[team.mons[i]].zh}</span>` : ''}${s.length ? chips(s) : '<span class="muted small">空</span>'}`
    + `${team.sets[i] ? '<span class="muted small">已登錄配招</span>' : ''}</button>`).join('');
  renderPick($('#tPick'), team.slots[team.cur]);
  $('#tList').innerHTML = typeListHTML() || setEditorHTML();
  document.querySelectorAll('#tFmt button').forEach(b => b.setAttribute('aria-pressed', b.dataset.fmt === team.fmt));

  const members = team.slots.map((s, i) => [s, i]).filter(([s]) => s.length);
  $('#tSum').innerHTML = members.length ? summaryHTML(members)
    : '<p class="empty">選好隊員後，這裡會集中列出隊伍的問題（搭配、缺的角色、沒解的熱門威脅、屬性弱點），每條附可以補的寶可夢，並建議下一隻選誰。</p>';
  $('#tRole').innerHTML = members.length ? roleHTML(members)
    : '<p class="empty">挑好隊員的寶可夢後，這裡會依 OP.GG 常用招式判斷每隻是物攻、特攻輸出還是輔助，列出常用招式與效果，並標出隊伍還缺哪些角色。</p>';
  $('#tTrait').innerHTML = members.length ? traitHTML(members)
    : '<p class="empty">挑好隊員的寶可夢後，這裡會依 OP.GG 常用特性與招式標出誰會開天氣、開場地、順風、戲法空間、反先制、抗威嚇等，並做搭配檢查。</p>';
  if (!members.length) {
    $('#tResult').innerHTML = '<p class="empty">選好隊員後，這裡會列出整隊被各屬性打的倍率，標出共同弱點與缺口，並建議下一隻補什麼屬性、哪隻寶可夢。</p>';
    $('#tThreat').innerHTML = `<p class="empty">選好隊員後，這裡會檢查${FMT_ZH[team.fmt]}排名前 ${THREAT_N} 的熱門寶可夢，看隊伍有沒有人能應付。</p>`;
  } else {
    const sg = stabGaps(members.map(([s]) => s));
    $('#tThreat').innerHTML = threatHTML(members);
    const rows = teamProfile(members.map(([s]) => s)), warn = rows.filter(r => r.warn), gaps = teamGaps(rows);
    const sym = { 4: '4', 2: '2', 1: '', 0.5: '½', 0.25: '¼', 0: '0' };
    let h = '<thead><tr><th class="corner">攻擊 ↓<br>隊員 →</th>'
      + members.map(([s, i]) => `<th><span class="tcol"><span class="slot-n">${i + 1}</span><span class="duo">`
        + `${s.map(id => `<span class="vchip" style="${style(id)}">${T[id].zh}</span>`).join('')}</span></span></th>`).join('')
      + '<th class="cnt">怕</th><th class="cnt">抗</th></tr></thead><tbody>';
    rows.forEach(r => {
      h += `<tr><th><span class="chip rchip" style="${style(r.atk)}">${T[r.atk].zh}</span></th>`
        + r.ms.map(m => `<td class="${MCLS[m]}" title="${fmt(m)} ${MSG(m)}">${sym[m]}</td>`).join('')
        + `<td class="cnt${r.warn ? ' warn' : ''}">${r.warn ? '⚠' : ''}${r.weak}</td><td class="cnt">${r.resist}</td></tr>`;
    });
    $('#tResult').innerHTML = `<div class="res-head">隊伍弱點總表<span class="muted small">（${members.length} 隻）</span></div>`
      + (warn.length
        ? `<div class="x-line"><span class="x-msg">要注意：</span>${warn.map(r => chip(r.atk, `${r.weak}怕/${r.resist}抗`)).join('')}</div>`
        : '<p class="muted small b-intro">沒有 3 隻以上都怕、或 2 隻以上怕又沒人抗的屬性。</p>')
      + `<div class="x-line"><span class="x-msg">缺口（有人怕、沒人抗）：</span>${gaps.length ? gaps.map(id => chip(id)).join('') : '<span class="none">（無）</span>'}</div>`
      + `<div class="x-line"><span class="x-msg">本系打不出效果絕佳：</span>${sg.length ? sg.map(id => chip(id)).join('') : '<span class="none">（無）</span>'}</div>`
      + teamRecHTML(gaps, warn.length)
      + `<div class="mwrap cover" style="margin-top:10px"><table class="matrix team">${h}</tbody></table></div>`
      + '<p class="note">※ 怕＝受到 ×2 以上；抗＝×½ 以下（含沒有效果）。⚠ 標示 3 隻以上都怕，或 2 隻以上怕又沒人抗的屬性。本系＝隊員自己的屬性。'
      + '弱點總表只算屬性，不含特性；推薦的雙屬性組合不一定有對應寶可夢。推薦寶可夢的角色與搭配依常用招式、特性判斷（見「隊伍角色」「隊伍特性與場地招式」），不看能力值。</p>';
  }
  $('#tSpeed').innerHTML = speedHTML(members);
  saveState();
}
// 把屬性加進目前格子（手動改屬性就不再算是名單上的寶可夢）；留在這格，讓使用者從 typeListHTML 的清單挑寶可夢
function pickTeamType(id) {
  team.mons[team.cur] = '';
  team.sets[team.cur] = null;
  toggleSel(team.slots[team.cur], id, 2);
  renderTeam();
}
// 把寶可夢放進目前格子，再跳到後面的空格
function pickTeamMon(key) {
  if (team.mons[team.cur] !== key) team.sets[team.cur] = null;
  team.slots[team.cur] = MON[key].types.slice();
  team.mons[team.cur] = key;
  const n = team.slots.findIndex((x, i) => i > team.cur && !x.length);
  if (n >= 0) team.cur = n;
  renderTeam();
}
$('#monsDate').textContent = MONS_DATE + ' 擷取';
// 單打／雙打：隊伍分析的排名依據、出戰選角的帶幾隻和傷害計算的常用招式、範圍招式共用
function setFmt(e) {
  const b = e.target.closest('button[data-fmt]');
  if (b) { team.fmt = b.dataset.fmt; renderTeam(); renderBring(); renderCalc(); }
}
$('#tFmt').addEventListener('click', setFmt);
$('#tSlots').addEventListener('click', e => {
  const b = e.target.closest('.slot');
  if (b) { team.cur = +b.dataset.i; renderTeam(); }
});
$('#tPick').addEventListener('click', e => {
  const b = e.target.closest('.tbtn');
  if (b) pickTeamType(b.dataset.id);
});
$('#tList').addEventListener('click', e => {
  const b = e.target.closest('[data-mon]');
  if (b) pickTeamMon(b.dataset.mon);
  if (e.target.closest('[data-setclear]')) { team.sets[team.cur] = null; renderTeam(); }
});
// 配招登錄：同一招選到另一格時，原本那格清掉；點數限 0～32；什麼都沒填就當沒登錄
$('#tList').addEventListener('change', e => {
  const el = e.target, d = el.dataset, i = team.cur;
  if (!el.closest('.set-ed') || !team.mons[i]) return;
  const s = structuredClone(team.sets[i] || emptySet());
  if (d.mv != null) s.moves = s.moves.map((k, n) => n === +d.mv ? el.value : k === el.value ? '' : k);
  else if (d.ab != null) s.ab = el.value;
  else if (d.it != null) s.item = el.value;
  else if (d.sp != null) { const v = Math.round(Number(el.value)); s.sp[+d.sp] = Number.isFinite(v) ? Math.max(0, Math.min(32, v)) : 0; }
  else if (d.nat != null) s.nat = el.value ? el.value.split('+').map(Number) : [0, 0];
  team.sets[i] = setFilled(s) ? s : null;
  renderTeam();
});
$('#tResult').addEventListener('click', e => {
  const b = e.target.closest('[data-add], [data-mon]');
  if (b) b.dataset.mon ? pickTeamMon(b.dataset.mon) : pickTeamType(b.dataset.add);
});
// 隊伍總評的推薦都是放進第一個空格
$('#tSum').addEventListener('click', e => {
  const b = e.target.closest('[data-mon]'), k = team.slots.findIndex(s => !s.length);
  if (b && k >= 0) { team.cur = k; pickTeamMon(b.dataset.mon); }
});
$('#tClear').addEventListener('click', () => { team.slots = team.slots.map(() => []); team.mons = team.mons.map(() => ''); team.sets = team.sets.map(() => null); team.cur = 0; renderTeam(); });

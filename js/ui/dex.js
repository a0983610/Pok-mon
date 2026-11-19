// ---------- 圖鑑 ----------
// 選一隻寶可夢看：種族值、特性、屬性相剋（只看屬性）、其他型態、Showdown 天梯使用數據（使用率、特性、道具、招式、點數＋性格、超級進化比例、
// 常見隊友、剋星）、學得到的招式，和「帶進傷害計算」。單打／雙打跟著隊伍分析（team.fmt）。
// key：看的寶可夢（網址 dx）；pick：清單的屬性篩選（同出戰選角：沒選屬性列排名前 DEX_QUICK，選了列全部屬性都符合的）
const dex = { key: '', pick: [] };
const DEX_QUICK = 30;
// 招式／特性的資料：常用的在 MOVES／ABILS，只有可學的在 LEARN_MOVES／LEARN_ABILS（格式相同）
const dexMove = k => MOVES[k] || LEARN_MOVES[k];
const dexAbil = k => ABILS[k] || LEARN_ABILS[k] || (ABIL_ZH[k] && [ABIL_ZH[k], '']);
function renderDexList() {
  renderPick($('#dPick'), dex.pick);
  const sel = dex.pick, list = monsOfTypes(sel, team.fmt).filter(m => sel.length || !m.base && m.rank[team.fmt]);
  const shown = sel.length ? list : list.slice(0, DEX_QUICK);
  $('#dList').innerHTML = (sel.length
    ? `<div class="b-label">有${sel.map(id => T[id].zh).join('＋')}屬性的寶可夢<span class="muted small">共 ${list.length} 隻${list.length ? `，依${FMT_ZH[team.fmt]}排名` : ''}</span></div>`
    : `<div class="b-label">${FMT_ZH[team.fmt]}排名前 ${DEX_QUICK}<span class="muted small">不在這裡就點上方屬性篩選（選 1～2 個）；超級進化在原型的「其他型態」</span></div>`)
    + (shown.length ? `<div class="qpick">${shown.map(m => `<button data-dk="${m.key}" aria-pressed="${m.key === dex.key}">${m.zh}${chips(m.types)}`
      + `<span class="meta">${m.rank[team.fmt] ? `#${m.rank[team.fmt]}` : '無排名'}</span></button>`).join('')}</div>`
      : '<p class="muted small">名單裡沒有這種屬性組合的寶可夢。</p>');
}
// 有效種族值：合計扣掉攻擊、特攻較低的那項（通常只用其中一種攻擊；2026-11-19 使用者要的）
const dexEffText = m => {
  const [a, c] = [m.bs[1], m.bs[3]], tot = m.bs.reduce((s, v) => s + v, 0);
  return `有效 ${tot - Math.min(a, c)}，扣掉${a === c ? `攻擊特攻同為 ${a}` : a < c ? `較低的攻擊 ${a}` : `較低的特攻 ${c}`}`;
};
// 種族值長條（200 以上畫滿）：HP／攻擊／防禦、特攻／特防、速度三種顏色
const dexStatsHTML = m => `<div class="dx-sub">種族值（合計 ${m.bs.reduce((s, v) => s + v, 0)}・${dexEffText(m)}）</div><div class="dx-st">`
  + m.bs.map((v, k) => `<span>${STAT_ZH[k]}</span><b>${v}</b><span class="dx-bar${k === 5 ? ' spe' : k >= 3 ? ' sp' : ''}"><i style="width:${Math.min(100, v / 2)}%"></i></span>`).join('') + '</div>';
// 特性：超級進化是固定的特性；其他列可能的特性（LEARN，超級進化沿用原型的）。都附效果說明
function dexAbilsHTML(m) {
  const keys = m.base ? m.megaAbils : (LEARN[m.key] || '').split('|')[1]?.split(' ').filter(Boolean) || [];
  return `<div class="dx-sub">特性${m.base ? '（超級進化後固定）' : ''}</div>`
    + (keys.length ? keys.map(k => { const a = dexAbil(k); return `<div class="dx-row"><b>${a?.[0] || k}</b>${a?.[1] ? `<span class="meta">${a[1]}</span>` : ''}</div>`; }).join('')
      : '<p class="muted small">沒有特性資料</p>');
}
// 屬性相剋（防守，只看屬性、不算特性）：依倍率分組
function dexTypeHTML(m) {
  const groups = [[4, '4 倍'], [2, '2 倍'], [0.5, '½ 倍'], [0.25, '¼ 倍'], [0, '無效']]
    .map(([v, zh]) => [zh, IDS.filter(a => eff(a, m.types) === v)]).filter(([, ids]) => ids.length);
  return '<div class="dx-sub">屬性相剋<span class="muted small">（被打的倍率，只看屬性、沒算特性）</span></div>'
    + groups.map(([zh, ids]) => `<div class="dx-row"><span class="dx-l">${zh}</span><span class="dx-chips">${ids.map(id => chip(id)).join('')}</span></div>`).join('');
}
// 同家族的其他型態（原型、超級進化）：按鈕附這個形式的使用率
function dexFormsHTML(m) {
  const fam = MON[family(m)], forms = [fam, ...megasOf(fam)].filter(x => x !== m);
  if (!forms.length) return '';
  const pct = x => USAGE[x.key]?.[team.fmt]?.pct;
  return '<div class="dx-sub">其他型態</div><div class="dx-chips">'
    + forms.map(x => `<button class="mini" data-dk="${x.key}">${x.zh}${pct(x) != null ? `<span class="meta">${pct(x)}%</span>` : ''}</button>`).join('') + '</div>';
}
// 統計清單 [[key, %]...] 寫成「名稱 %・名稱 %」（dict 查中文名）
const dexUseList = (list, dict) => list.filter(([k]) => dict(k)).map(([k, p]) => `${dict(k)[0]} <span class="meta">${p}%</span>`).join('、');
// 招式清單 [[key, %]...]：名稱可以點，跳到下面「學得到的招式」那一行看效果（見 dexLearnHTML、點擊處理）
const dexMoveBtns = list => list.filter(([k]) => dexMove(k)).map(([k, p]) => `<button class="dx-mv" data-dmv="${k}" title="看效果">${dexMove(k)[0]}</button> <span class="meta">${p}%</span>`).join('、');
// 寶可夢清單 [[家族 key, %]...] 寫成可以點的按鈕（點了看那隻）
const dexMonBtns = list => `<div class="dx-chips">${list.filter(([k]) => MON[k]).map(([k, p]) => `<button class="mini" data-dk="${k}">${MON[k].zh}<span class="meta">${p}%</span></button>`).join('')}</div>`;
// Showdown 天梯使用數據（team.fmt）：沒有自己的統計時說明（超級進化沿用原型的不列，避免看成這個型態的數字）
function dexUseHTML(m) {
  const fmt = team.fmt, u = USAGE[m.key]?.[fmt], fz = FMT_ZH[fmt];
  const seg = `<div class="seg" id="dFmt" aria-label="對戰形式">${['s', 'd'].map(f => `<button data-fmt="${f}" aria-pressed="${f === fmt}">${FMT_ZH[f]}</button>`).join('')}</div>`;
  const head = `<div class="dx-sub dx-uh">天梯使用數據<span class="muted small">（Showdown ${USAGE_SRC.month}・${fz}${u?.pct != null ? `，使用率 ${u.pct}%` : ''}）</span>${seg}</div>`;
  const megas = u?.megas.length ? `<div class="dx-row"><span class="dx-l">超級進化</span>${dexMonBtns(u.megas)}<span class="meta">佔全家族的比例</span></div>` : '';
  if (!u?.moves.length) return head + `<p class="muted small">這個型態在${fz}沒有統計（Showdown 上沒人用，或是都帶超級石超級進化了）。</p>` + megas;
  // 原型的隊友、剋星看家族裡最常見的型態（見 mons-data.js 的說明）
  const fam = MON[family(m)], forms = [fam, ...megasOf(fam)].filter(x => USAGE[x.key]?.[fmt]?.pct != null);
  const dom = forms.sort((x, y) => USAGE[y.key][fmt].pct - USAGE[x.key][fmt].pct)[0];
  const domNote = !m.base && dom && dom !== m ? `<span class="muted small">（看家族裡最常見的${dom.zh}）</span>` : '';
  const sets = u.sets.slice(0, 3).map(([v, p], n) => `<div class="dx-row"><span class="dx-l">配點 ${n + 1}</span><span>${natText(v.slice(6, 8))}｜${spText(v.slice(0, 6))} <span class="meta">${p}%</span></span></div>`).join('');
  const abils = m.base ? `${m.megaAbils.map(k => dexAbil(k)?.[0] || k).join('、')} <span class="meta">超級進化後固定</span>` : dexUseList(u.abils, dexAbil);
  return head
    + `<div class="dx-row"><span class="dx-l">特性</span><span>${abils}</span></div>`
    + `<div class="dx-row"><span class="dx-l">道具</span><span>${dexUseList(u.items, k => ITEMS[k]) || '<span class="meta">沒有 5% 以上的</span>'}</span></div>`
    + `<div class="dx-row"><span class="dx-l">招式</span><span>${dexMoveBtns(u.moves)} <span class="meta">（點名稱看效果）</span></span></div>`
    + sets + megas
    + (u.mateP.length ? `<div class="dx-sub">常見隊友<span class="muted small">（同隊率，點了看那隻）</span>${domNote}</div>${dexMonBtns(u.mateP)}` : '')
    + (u.loseP.length ? `<div class="dx-sub">剋星<span class="muted small">（遇到時，這隻被打倒或被逼換下的比例）</span>${domNote}</div>${dexMonBtns(u.loseP)}` : '')
    + '<p class="muted small">只收使用率 5% 以上的特性、道具、招式；配點是能力點數＋性格的組合（前 3 種）。'
    + '剋星照 Smogon 的分數排（比例減 4 倍誤差，碰面次數少、說不準的排後面），所以 % 不一定由大到小。</p>';
}
// 學得到的招式（LEARN，超級進化沿用原型的）：攻擊招式（屬性順序、威力高的在前，括號是分類和威力）與變化招式，各收在一個摺疊裡。
// OP.GG 的可學招式有缺（例如閃焰王牌的火焰球），家族任一型態在 Showdown 天梯（單打或雙打）用過的招式也一起列，上面的招式點了才找得到那一行
function dexLearnHTML(m) {
  const fam = MON[family(m)], used = [fam, ...megasOf(fam)].flatMap(x => ['s', 'd'].flatMap(f => (USAGE[x.key]?.[f]?.moves || []).map(([k]) => k)));
  const keys = [...new Set([...((LEARN[fam.key] || '').split('|')[0] || '').split(' '), ...used])].filter(k => dexMove(k));
  if (!keys.length) return '';
  const atk = keys.filter(k => dexMove(k)[2] !== 'status').sort((x, y) => IDS.indexOf(dexMove(x)[1]) - IDS.indexOf(dexMove(y)[1]) || (dexMove(y)[3] || 0) - (dexMove(x)[3] || 0));
  const sup = keys.filter(k => dexMove(k)[2] === 'status').sort((x, y) => dexMove(x)[0].localeCompare(dexMove(y)[0], 'zh-Hant'));
  const row = k => { const [zh, ty, cat, pow, e] = dexMove(k); return `<div class="mv-row" data-mv="${k}">${chip(ty)}<b>${zh}</b><span class="meta">${CAT_ZH[cat]}${pow ? ' ' + pow : ''}</span><span class="mv-e">${e}</span></div>`; };
  return `<details class="b-more dx-learn"><summary>學得到的攻擊招式（${atk.length} 招，括號是物理／特殊和威力）</summary>${atk.map(row).join('')}</details>`
    + `<details class="b-more dx-learn"><summary>學得到的變化招式（${sup.length} 招）</summary>${sup.map(row).join('')}</details>`;
}
function renderDexCard() {
  const m = MON[dex.key];
  if (!m) { $('#dCard').innerHTML = '<p class="empty">點上方清單選一隻寶可夢，這裡會列出種族值、特性、屬性相剋、Showdown 天梯的使用數據與學得到的招式。</p>'; return; }
  const u = USAGE[m.key]?.[team.fmt];
  $('#dCard').innerHTML = `<div class="dx-head">${m.zh}${chips(m.types)}<span class="meta">${m.bs.join(' / ')}・合計 ${m.bs.reduce((s, v) => s + v, 0)}`
    + `・${FMT_ZH[team.fmt]}${m.rank[team.fmt] ? ` #${m.rank[team.fmt]}` : '無排名'}${u?.pct != null ? `・使用 ${u.pct}%` : ''}</span></div>`
    + `<div class="dx-grid"><div>${dexStatsHTML(m)}${dexAbilsHTML(m)}${dexTypeHTML(m)}${dexFormsHTML(m)}</div>`
    + `<div>${dexUseHTML(m)}${dexLearnHTML(m)}<div class="dx-chips dx-go"><button class="mini" data-dca="atk">帶進傷害計算當攻擊方</button>`
    + '<button class="mini" data-dca="def">帶進傷害計算當防守方</button></div></div></div>';
}
function renderDex() {
  renderDexList();
  renderDexCard();
  saveState();
}
$('#dPick').addEventListener('click', e => {
  const b = e.target.closest('.tbtn');
  if (b) { toggleSel(dex.pick, b.dataset.id, 2); renderDexList(); }
});
// 清單、其他型態、隊友、剋星的按鈕都換成看那隻（捲到卡片頂端）；單打／雙打同隊伍分析一起切；帶進傷害計算後切過去；
// 使用數據的招式名稱：打開下面學得到的招式那個摺疊、捲到那一行、底色閃一下
$('#p-dex').addEventListener('click', e => {
  const k = e.target.closest('[data-dk]')?.dataset.dk;
  if (k && MON[k]) { dex.key = k; renderDex(); $('#dCard').scrollIntoView({ block: 'start' }); return; }
  const mv = e.target.closest('[data-dmv]')?.dataset.dmv, row = mv && $('#dCard').querySelector(`.mv-row[data-mv="${mv}"]`);
  if (row) {
    row.closest('details').open = true;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('dx-hit');
    void row.offsetWidth;
    row.classList.add('dx-hit');
    return;
  }
  if (e.target.closest('#dFmt')) { setFmt(e); return; }
  const side = e.target.closest('[data-dca]')?.dataset.dca;
  if (side && MON[dex.key]) { setCalcMon(side, dex.key); showTab('calc'); $('#p-calc').scrollIntoView({ block: 'start' }); }
});

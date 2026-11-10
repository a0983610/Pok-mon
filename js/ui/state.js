// ---------- 狀態存網址＋本機（可存書籤、重新整理不清空） ----------
// 格式：#分頁?m=招式,招式&t=屬性,屬性&a=特性&p=隊員1屬性.屬性,@寶可夢key,...&f=d（雙打，單打不寫）&o=對手寶可夢key,...
//   &ps=隊員 1 的配招,隊員 2 的配招,...（每格「招式+招式+招式+招式.道具.特性.HP+攻擊+防禦+特攻+特防+速度 的能力點數.↑能力+↓能力」，沒登錄的空白）
//   傷害計算：ca=攻擊方key&cd=防守方key&ce=攻擊方投資.HP投資.防禦投資.攻擊方速度投資.防守方速度投資（每個是能力點數，＋性格接 +、−性格接 -；
//   舊網址的 cv 是快選檔位的索引，讀得到但不再寫）
//   &cs=攻擊.特攻.防禦.特防.攻擊方速度.防守方速度能力變化&ci=攻擊方道具.防守方道具&cb=攻擊方特性.防守方特性&cw=天氣&cc=1（急所）&cx=加算招式
//   &ct=場地&ch=1（幫助）&cl=牆.牆&cn=1（灼傷）&cg=有順風的一方（a.d）&cz=麻痺的一方（a.d）&cr=1（戲法空間）（和預設相同的不寫）
const STATE_KEY = 'pkmn-champions-state';
function stateQuery() {
  const q = [];
  if (build.moves.length) q.push('m=' + build.moves.join(','));
  if (build.types.length) q.push('t=' + build.types.join(','));
  if (build.ab) q.push('a=' + build.ab);
  const p = team.slots.map((s, i) => team.mons[i] ? '@' + team.mons[i] : s.join('.'));
  while (p.length && !p[p.length - 1]) p.pop();
  if (p.length) q.push('p=' + p.join(','));
  const ps = team.sets.map((s, i) => team.mons[i] && s ? [s.moves.join('+'), s.item, s.ab, s.sp.join('+'), s.nat.join('+')].join('.') : '');
  while (ps.length && !ps[ps.length - 1]) ps.pop();
  if (ps.length) q.push('ps=' + ps.join(','));
  if (team.fmt === 'd') q.push('f=d');
  const o = bring.opp.slice();
  while (o.length && !o[o.length - 1]) o.pop();
  if (o.length) q.push('o=' + o.join(','));
  if (calc.atk) q.push('ca=' + calc.atk);
  if (calc.def) q.push('cd=' + calc.def);
  const ce = c => INVS.map(([k]) => c[k][0] + (c[k][1] === 11 ? '+' : c[k][1] === 9 ? '-' : '')).join('.');
  if (ce(calc) !== ce(CALC0)) q.push('ce=' + ce(calc));
  if (calc.st.some(Boolean)) q.push('cs=' + calc.st.join('.'));
  if (calc.aItem || calc.dItem) q.push('ci=' + calc.aItem + '.' + calc.dItem);
  if (calc.aAb || calc.dAb) q.push('cb=' + calc.aAb + '.' + calc.dAb);
  if (calc.weather) q.push('cw=' + calc.weather);
  if (calc.crit) q.push('cc=1');
  if (calc.extra) q.push('cx=' + calc.extra);
  if (calc.terrain) q.push('ct=' + calc.terrain);
  if (calc.hh) q.push('ch=1');
  if (calc.walls.length) q.push('cl=' + calc.walls.join('.'));
  if (calc.burn) q.push('cn=1');
  if (calc.tw.length) q.push('cg=' + calc.tw.join('.'));
  if (calc.par.length) q.push('cz=' + calc.par.join('.'));
  if (calc.tr) q.push('cr=1');
  return q.join('&');
}
const stateHash = () => { const q = stateQuery(); return '#' + curTab + (q ? '?' + q : ''); };
function saveState() {
  try { history.replaceState(null, '', stateHash()); } catch (e) { /* file:// 某些瀏覽器不允許 */ }
  try { localStorage.setItem(STATE_KEY, stateQuery()); } catch (e) { /* 無痕或封鎖儲存時略過 */ }
}
// 網址 ps 的一格 → 寶可夢 key 的配招（見 useOf）：資料裡沒有的招式／道具／特性、超出範圍的點數不收，超級進化的特性是固定的也不收，
// 性格要 ↑↓ 兩項都有才收；什麼都沒填就是 null（沒登錄）
function parseSet(s, key) {
  const [mv = '', item = '', ab = '', sp = '', nat = ''] = s.split('.');
  const num = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : 0; };
  const ms = mv.split('+'), pts = sp.split('+'), ns = nat.split('+').map(v => num(v, 1, 5));
  const set = { moves: [0, 1, 2, 3].map(n => Object.hasOwn(MOVES, ms[n] || '') ? ms[n] : ''), item: Object.hasOwn(ITEMS, item) ? item : '',
    ab: !MON[key].base && (Object.hasOwn(ABILS, ab) || Object.hasOwn(ABIL_ZH, ab)) ? ab : '',
    sp: [0, 1, 2, 3, 4, 5].map(n => num(pts[n], 0, 32)), nat: ns[0] && ns[1] ? [ns[0], ns[1]] : [0, 0] };
  return set.moves.some(Boolean) || set.item || set.ab || set.sp.some(Boolean) || set.nat[0] ? set : null;
}
function loadState(q) {
  const kv = Object.fromEntries(q.split('&').map(s => s.split('=')));
  const ids = (s, sep, max) => [...new Set((s || '').split(sep).filter(id => IDS.includes(id)))].slice(0, max);
  build.moves = ids(kv.m, ',', 4);
  build.types = ids(kv.t, ',', 2);
  build.ab = Object.hasOwn(AB, kv.a || '') ? kv.a : '';
  (kv.p || '').split(',').slice(0, 6).forEach((s, i) => {
    const m = s[0] === '@' && MON[s.slice(1)];
    team.slots[i] = m ? m.types.slice() : ids(s, '.', 2);
    team.mons[i] = m ? m.key : '';
  });
  const ps = (kv.ps || '').split(',');
  team.sets = team.mons.map((k, i) => k ? parseSet(ps[i] || '', k) : null);
  team.fmt = kv.f === 'd' ? 'd' : 's';
  (kv.o || '').split(',').slice(0, 6).forEach((k, i) => { bring.opp[i] = MON[k] ? k : ''; });
  calc.atk = MON[kv.ca] ? kv.ca : '';
  calc.def = MON[kv.cd] ? kv.cd : '';
  // 投資：先看 ce（點數＋性格），沒有就看舊網址的 cv（快選檔位索引，更舊的只有前 3 個），都沒有用預設；cs 舊網址只有前 4 個，缺的用 0
  const ce = (kv.ce || '').split('.'), cv = (kv.cv ? kv.cv.split('.') : []).map(Number);
  INVS.forEach(([k, , list, nat], i) => {
    const m = /^(\d{1,2})([+-]?)$/.exec(ce[i] || '');
    calc[k] = m && +m[1] <= 32 ? [+m[1], nat && m[2] ? (m[2] === '+' ? 11 : 9) : 10] : list[cv[i]] ? list[cv[i]].slice(0, 2) : CALC0[k].slice();
  });
  const st = (kv.cs || '').split('.').map(Number);
  calc.st = CALC0.st.map((_, i) => Number.isInteger(st[i]) && Math.abs(st[i]) <= 6 ? st[i] : 0);
  const [ia, id] = (kv.ci || '').split('.');
  calc.aItem = itemOK('a', calc.atk, ia) ? ia : '';
  calc.dItem = itemOK('d', calc.def, id) ? id : '';
  // 特性只要是資料裡有的 key 就收，實際用哪個由 abOf 依這隻的常用特性決定
  const [ba, bd] = (kv.cb || '').split('.'), abKey = k => ABILS[k] || ABIL_ZH[k] ? k : '';
  calc.aAb = abKey(ba);
  calc.dAb = abKey(bd);
  calc.weather = WEATHERS.includes(kv.cw) ? kv.cw : '';
  calc.crit = kv.cc === '1';
  calc.extra = CALC_MOVES.includes(kv.cx) ? kv.cx : '';
  calc.terrain = TERRAINS.includes(kv.ct) ? kv.ct : '';
  calc.hh = kv.ch === '1';
  calc.walls = WALLS.filter(w => (kv.cl || '').split('.').includes(w));
  calc.burn = kv.cn === '1';
  calc.tw = SIDES.filter(s => (kv.cg || '').split('.').includes(s));
  calc.par = SIDES.filter(s => (kv.cz || '').split('.').includes(s));
  calc.tr = kv.cr === '1';
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  try { await navigator.clipboard.writeText(location.href.split('#')[0] + stateHash()); b.textContent = '已複製 ✓'; }
  catch (err) { b.textContent = '請直接複製網址列'; }
  setTimeout(() => { b.textContent = '複製連結'; }, 1500);
});

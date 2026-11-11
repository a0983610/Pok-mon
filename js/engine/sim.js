// 計算引擎：資料與純邏輯，不碰 DOM（畫面在 js/ui/）
// ---------- 對戰模擬（單打：6 選 3，雙方每回合同時出招） ----------
// 只算攻擊招式的傷害，加上招式本身附帶的效果：使用限制、自己的能力變化、反作用力與吸血（含生命寶珠）、打完換人。
// 輔助招式、異常狀態、追加效果（畏縮、降對手能力等）、天氣場地、出場特性（威嚇等）、命中率（當全中）都不算。
// 各表的資料來源寫在表的上方；Showdown＝Pokémon Showdown 的 data/moves.ts、sim/battle-actions.ts、sim/battle.ts。

// 先制等級（Showdown priority；Smogon damage-calc 冠軍版 CHAMPIONS_PATCH 沒改），不在表上的是 0
const SIM_PRI = { 'fake-out': 3, 'upper-hand': 3, 'extreme-speed': 2, feint: 2, 'first-impression': 2, accelerock: 1, 'aqua-jet': 1,
  'bullet-punch': 1, 'ice-shard': 1, 'jet-punch': 1, 'mach-punch': 1, 'quick-attack': 1, 'shadow-sneak': 1, 'sucker-punch': 1,
  'vacuum-wave': 1, 'water-shuriken': 1, 'beak-blast': -3, avalanche: -4, 'circle-throw': -6, 'dragon-tail': -6 };
// 容易擊中要害（急所等級 +1）的招式（Showdown critRatio 2）；必定急所的看 damageCalc（ALWAYS_CRIT）
const SIM_HICRIT = new Set(['air-cutter', 'aqua-cutter', 'blaze-kick', 'crabhammer', 'cross-chop', 'cross-poison', 'drill-run', 'leaf-blade',
  'night-slash', 'psycho-cut', 'shadow-claw', 'slash', 'snipe-shot', 'stone-edge', 'triple-arrows']);
// 急所機率依急所等級（GameWith「急所の確率と効果」：0＝1/24、+1＝1/8、+2＝1/2、+3 以上必定）；特性超幸運、道具焦點鏡各 +1
const SIM_CRIT_P = [1 / 24, 1 / 8, 1 / 2, 1];
// 打中後自己的能力變化（Showdown self.boosts／selfBoost／機率 100% 的 secondary.self；淘金潮照冠軍版 CHAMPIONS_PATCH 是特攻 −2）；
// 機率性的（原始之力、彗星拳、火之舞等）不算。致命針刺打倒對手時攻擊 +3（Showdown onAfterMoveSecondarySelf）另外處理
const SIM_SELF = { 'draco-meteor': { spa: -2 }, overheat: { spa: -2 }, 'leaf-storm': { spa: -2 }, 'make-it-rain': { spa: -2 },
  'armor-cannon': { def: -1, spd: -1 }, 'close-combat': { def: -1, spd: -1 }, 'headlong-rush': { def: -1, spd: -1 },
  superpower: { atk: -1, def: -1 }, 'clanging-scales': { def: -1 }, 'hammer-arm': { spe: -1 }, 'ice-hammer': { spe: -1 },
  'scale-shot': { def: -1, spe: 1 }, 'torch-song': { spa: 1 }, 'psyshield-bash': { def: 1 },
  'aqua-step': { spe: 1 }, 'aura-wheel': { spe: 1 }, 'flame-charge': { spe: 1 }, 'rapid-spin': { spe: 1 }, trailblaze: { spe: 1 } };
const SIM_STAT_ZH = { atk: '攻擊', def: '防禦', spa: '特攻', spd: '特防', spe: '速度' };
// 反作用力：打出的傷害 × 比例，四捨五入、至少 1（Showdown recoil、calcRecoilDamage）；特性堅硬腦袋、魔法防守不受。
// 鐵蹄光線不管有沒有打中都扣自己最大 HP 的一半（四捨五入，Showdown mindBlownRecoil）
const SIM_RECOIL = { 'brave-bird': [33, 100], 'double-edge': [33, 100], 'flare-blitz': [33, 100], 'volt-tackle': [33, 100],
  'wave-crash': [33, 100], 'wood-hammer': [33, 100], 'head-smash': [1, 2], 'light-of-ruin': [1, 2], 'wild-charge': [1, 4] };
// 吸血：回復打出的傷害 × 比例，四捨五入、至少 1（Showdown drain）
const SIM_DRAIN = { 'bitter-blade': [1, 2], 'drain-punch': [1, 2], 'giga-drain': [1, 2], 'horn-leech': [1, 2], 'leech-life': [1, 2],
  'matcha-gotcha': [1, 2], 'parabolic-charge': [1, 2], 'draining-kiss': [3, 4] };
// 使用限制（Showdown）：擊掌奇襲、迎頭一擊只有上場後第一回合能用（onTry）；大爆炸、自爆、薄霧炸裂用了就倒下（selfdestruct always）；
// 破壞光線等打中後下一回合不能動（recharge）；日光束、日光刃（要晴天）、電光束（要下雨）、挖洞、潛靈奇襲先蓄力一回合（charge；
// 模擬沒有天氣，所以都要蓄力；挖洞、潛靈奇襲蓄力時打不到；電光束蓄力時特攻 +1）；預知未來兩回合後才打中；急速折返等打完換人（selfSwitch）
const SIM_FIRST = new Set(['fake-out', 'first-impression']);
const SIM_BOOM = new Set(['explosion', 'self-destruct', 'misty-explosion']);
const SIM_RECHARGE = new Set(['hyper-beam', 'giga-impact', 'hydro-cannon', 'rock-wrecker', 'meteor-assault']);
const SIM_CHARGE = new Set(['solar-beam', 'solar-blade', 'electro-shot', 'dig', 'phantom-force']);
const SIM_HIDE = new Set(['dig', 'phantom-force']);
const SIM_PIVOT = new Set(['u-turn', 'volt-switch', 'flip-turn']);
// 威力隨自己剩下的 HP：資料的威力 × 剩下 HP ÷ 最大 HP，取整、至少 1（Showdown basePowerCallback）
const SIM_HPBP = new Set(['eruption', 'water-spout']);
// 一場最多幾回合（到了算平手）、往前算的時候簡單規則最多再打幾回合
const SIM_MAX_TURN = 100, SIM_LOOK = 40;

// 上場的一隻：key 這場的型態、set 配招（只用能算傷害的招式；沒有招式就用 OP.GG 前 4 招 defaultSet）、item 道具（沒給照 battler）、s 哪一方。
// 能力點數、性格、特性同 battler；其餘是場上狀態：hp、item（會被打掉、用掉）、st 能力變化、lock 講究圍巾鎖住的招式、chg 蓄力中的招式、
// hide 蓄力時打不到、rech 下一回合要休息、in 第幾回合上場（擊掌奇襲用）、kos 打倒幾隻、out 有沒有上過場
function simMon(key, set, item, s, fmt) {
  const b = battler(key, fmt, set), use = set?.moves.some(Boolean) ? set : defaultSet(key, fmt), max = hpOf(b);
  return { id: `${s}:${key}`, key, b, moves: [...new Set((use?.moves || []).filter(k => k && MOVES[k] && canCalc(k)))], max, hp: max,
    item: item ?? b.item, st: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, lock: '', chg: '', hide: false, rech: false, in: -1, kos: 0, out: false };
}
// 照 bringPlan 的結果 plan 帶出場（mems 是傳給 bringPlan 的隊員 { key, set, item }）：第 1 名組合、先發排第一；
// 一場只能超級進化一隻，不進化的以原型上場、沒有道具（同出戰選角）
function simBring(plan, mems, s, fmt) {
  const best = plan.combos[0], lead = plan.pick.js[0];
  return [lead, ...best.idx.filter(j => j !== lead)].map(j => {
    const x = mems[j], down = !!plan.alt[j] && best.evo != null && j !== best.evo;
    return simMon(down ? MON[x.key].base : x.key, x.set, down ? '' : x.item, s, fmt);
  });
}
// 對手一隊（寶可夢 key，超級進化不帶道具）照 OP.GG 使用率分配道具、同一隊不重複（同「對戰中」對手道具：使用率高的先拿）
function simItems(keys, fmt) {
  const out = keys.map(() => ''), taken = new Set(), done = new Set();
  keys.flatMap((k, i) => MON[k].base ? [] : (useOf(k, fmt)?.items || []).filter(([it]) => !isStone(it)).map(([it, p]) => ({ i, it, p })))
    .sort((x, y) => y.p - x.p || x.i - y.i)
    .forEach(({ i, it }) => { if (!done.has(i) && !taken.has(it)) { out[i] = it; taken.add(it); done.add(i); } });
  return out;
}
// 雙方帶誰：我方 mine（[{ key, set }]，隊伍分析挑了寶可夢的）照 bringPlan 選（對手照填的型態看）；對手 oppKeys（6 格以內的寶可夢 key）
// 當成也用 bringPlan 選（oppBringPlan：超級石過半的當超級進化，看不到我方配招），配招照 OP.GG 常見（defaultSet）、道具不重複（simItems）。
// 回傳 [我方, 對手]，每方 { plan bringPlan 的結果, keys 隊員 key, mons 帶出場的（simMon，先發排第一）}；有一方是空的回傳 null
function simSides(mine, oppKeys, fmt) {
  const opps = oppKeys.filter(k => MON[k]);
  if (!mine.length || !opps.length) return null;
  const my = bringPlan(mine.map(x => ({ defs: MON[x.key].types, key: x.key, set: x.set })), opps.map(k => MON[k]), fmt);
  const op = oppBringPlan(opps, mine.map(x => x.key), fmt), keys = op.mems.map(x => x.key), items = simItems(keys, fmt);
  const oppMems = keys.map((k, j) => ({ key: k, set: defaultSet(k, fmt), item: items[j] }));
  return [{ plan: my, keys: mine.map(x => x.key), mons: simBring(my, mine, 0, fmt) }, { plan: op, keys, mons: simBring(op, oppMems, 1, fmt) }];
}
// 從 fmt 排名前 n 隨機挑 6 隻（不含超級進化、不重複）
function simRandTeam(fmt, n, rnd) {
  const pool = topMons(fmt, n).map(m => m.key);
  for (let i = 0; i < Math.min(6, pool.length); i++) { const j = i + Math.floor(rnd() * (pool.length - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 6);
}
// 計算快取：同一組對戰可以共用（id 是「哪一方:寶可夢 key」，同一方同一隻的配招固定）
const simCtx = fmt => ({ fmt, memo: new Map(), spd: new Map() });

const simAct = (st, s) => st.sd[s].mons[st.sd[s].act];
const simBench = (st, s) => st.sd[s].mons.map((m, i) => m.hp > 0 && i !== st.sd[s].act ? i : -1).filter(i => i >= 0);
const simDead = (st, s) => st.sd[s].mons.every(m => m.hp <= 0);
const simOver = st => simDead(st, 0) || simDead(st, 1);
const simNeed = (st, s) => simAct(st, s).hp <= 0 && simBench(st, s).length > 0;
const simName = (st, s, M = simAct(st, s)) => `${s ? '對手' : '我方'}${MON[M.key].zh}`;
const simPct = (v, max) => Math.round(Math.max(0, v) / max * 100);
const simClone = st => ({ sd: st.sd.map(x => ({ act: x.act, mons: x.mons.map(m => ({ ...m, st: { ...m.st } })) })), turn: st.turn,
  fut: st.fut.map(f => ({ ...f })), idle: st.idle, log: null });

// A 打 D 用招式 k 的 damageCalc（crit 急所）；結果依會影響傷害的狀態快取（D 剩下的 HP 只看滿不滿：氣勢披帶、結實、多重鱗片）
function simCalc(ctx, A, D, k, crit) {
  const bp = SIM_HPBP.has(k) ? Math.max(1, Math.floor(MOVES[k][3] * A.hp / A.max)) : undefined;
  // 電光束蓄力時已經特攻 +1，damageCalc 又會在出招前 +1，所以先扣回來
  const spa = A.st.spa - (CHARGE_SPA.has(k) ? 1 : 0), full = D.hp >= D.max;
  const key = [A.id, A.item, A.st.atk, spa, D.id, D.item, D.st.def, D.st.spd, full, k, crit, bp].join('|');
  let r = ctx.memo.get(key);
  if (!r) {
    const a = A.b, d = D.b;
    r = damageCalc({ key: A.key, inv: a.atkInv, sp: a.sp, nat: a.nat, st: { atk: A.st.atk, spa }, item: A.item, ab: a.ab },
      { key: D.key, hp: d.hp, inv: d.defInv, sp: d.sp, nat: d.nat, st: { def: D.st.def, spd: D.st.spd }, item: D.item, ab: d.ab, cur: full ? undefined : D.hp },
      k, { fmt: ctx.fmt, weather: '', crit, terrain: '', hh: false, walls: [], burn: false, bp });
    r = r.skip || !r.eff ? { eff: 0 } : { eff: r.eff, crit: r.crit, rolls: r.rolls, later: r.later, endured: r.endured, berry: r.berry };
    ctx.memo.set(key, r);
  }
  return r;
}
// 這一下要用的亂數表：拍落打沒有道具的對手時沒有加成（damageCalc 的 later）
const simRolls = (r, D, k) => k === 'knock-off' && !D.item ? r.later : r.rolls;
// 期望傷害（各下的 16 個亂數取平均加總；氣勢披帶、結實撐住時最多打到剩 1）
function simExp(ctx, A, D, k) {
  const r = simCalc(ctx, A, D, k, false);
  if (!r.eff) return 0;
  const e = simRolls(r, D, k).reduce((t, xs) => t + xs.reduce((a, x) => a + x, 0) / 16, 0);
  return r.endured && D.hp >= D.max ? Math.min(e, D.hp - 1) : e;
}
function simSpeed(ctx, M) {
  const key = [M.id, M.item, M.st.spe].join('|');
  if (!ctx.spd.has(key)) {
    const b = M.b;
    ctx.spd.set(key, speedOf({ key: M.key, inv: b.speInv, sp: b.sp, nat: b.nat, st: M.st.spe, item: M.item, ab: b.ab, tw: false }, { weather: '', terrain: '' }).v);
  }
  return ctx.spd.get(key);
}
function simBoost(st, s, M, d) {
  const ch = Object.entries(d).map(([k, v]) => { const was = M.st[k]; M.st[k] = Math.max(-6, Math.min(6, was + v)); return [k, M.st[k] - was]; }).filter(([, v]) => v);
  if (st.log && ch.length) st.log.push(`　${simName(st, s, M)}${ch.map(([k, v]) => `${SIM_STAT_ZH[k]} ${v > 0 ? '+' : '−'}${Math.abs(v)}`).join('、')}`);
}
// 換上第 i 隻：換下來的能力變化、鎖招、蓄力都清掉
function simSwitch(st, s, i) {
  const side = st.sd[s], O = side.mons[side.act];
  Object.assign(O, { st: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, lock: '', chg: '', hide: false, rech: false });
  side.act = i;
  Object.assign(side.mons[i], { in: st.turn, out: true });
  if (st.log) st.log.push(`　${s ? '對手' : '我方'}換上${MON[side.mons[i].key].zh}（HP ${simPct(side.mons[i].hp, side.mons[i].max)}%）`);
}
// 一方這回合能做的：招式（講究圍巾鎖住的那招；擊掌奇襲、迎頭一擊要上場後第一回合）、換人（後排還站著的）。
// 要休息的、蓄力中的只能照做、不能換人；招式都不能用又不能換人時是 none（什麼都不做）。
// 連續 SIM_IDLE 回合雙方都沒扣血也沒換人時，打不到對手場上那隻的招式不能選（模擬沒有每回合變動的效果，雙方都出無效招式會原地空轉）；
// 只剩這種招式又不能換人就照舊
const SIM_IDLE = 2;
function simOpts(ctx, st, s) {
  const M = simAct(st, s);
  if (M.rech) return [{ t: 'rech' }];
  if (M.chg) return [{ t: 'mv', k: M.chg }];
  let mv = (M.lock ? [M.lock] : M.moves).filter(k => !SIM_FIRST.has(k) || M.in === st.turn).map(k => ({ t: 'mv', k }));
  const sw = simBench(st, s).map(i => ({ t: 'sw', i }));
  if (st.idle >= SIM_IDLE) {
    const T = simAct(st, 1 - s), hit = mv.filter(o => simCalc(ctx, M, T, o.k, false).eff);
    if (hit.length || sw.length) mv = hit;
  }
  const all = [...mv, ...sw];
  return all.length ? all : [{ t: 'none' }];
}
// s 這方的 M 用招式 k 打對手場上那隻；oa＝對手這回合的選擇、oDone＝對手已經出過招或換了一隻（突襲、快手還擊會失敗）；
// rnd 亂數（null＝期望值：傷害取平均、不會急所）；pick(st, s) 打完換人時換上誰
function simMove(ctx, st, s, k, oa, oDone, rnd, pick) {
  const M = simAct(st, s), T = simAct(st, 1 - s), L = st.log, me = simName(st, s), tn = simName(st, 1 - s), mz = MOVES[k][0];
  if (M.item === 'choice-scarf' && !M.lock) M.lock = k;
  if (SIM_CHARGE.has(k) && M.chg !== k) {
    Object.assign(M, { chg: k, hide: SIM_HIDE.has(k) });
    if (L) L.push(`　${me}用${mz}：蓄力，下一回合才攻擊`);
    if (k === 'electro-shot') simBoost(st, s, M, { spa: 1 });
    return;
  }
  Object.assign(M, { chg: '', hide: false });
  const fail = why => { if (L) L.push(`　${me}用${mz}，但失敗了（${why}）`); };
  if (k === 'sucker-punch' && (oDone || oa.t !== 'mv')) return fail('對手沒有要出攻擊招式');
  if (k === 'upper-hand' && (oDone || oa.t !== 'mv' || !(SIM_PRI[oa.k] > 0))) return fail('對手沒有要出先制招式');
  if (k === 'future-sight') {
    if (st.fut.some(f => f.s === 1 - s)) return fail('已經在預知未來');
    st.fut.push({ s: 1 - s, t: 3, src: { ...M, st: { ...M.st } } });
    if (L) L.push(`　${me}用${mz}：兩回合後打中`);
    return;
  }
  if (SIM_BOOM.has(k)) M.hp = 0;
  let dealt = -1;
  if (T.hide) { if (L) L.push(`　${me}用${mz}，但打不到（${tn}${T.chg === 'dig' ? '在地底' : '消失了'}）`); }
  else {
    let r = simCalc(ctx, M, T, k, false);
    if (!r.eff) { if (L) L.push(`　${me}用${mz}，對${tn}沒有效果`); }
    else {
      const crit = !r.crit && !!rnd && rnd() < SIM_CRIT_P[Math.min(3, SIM_HICRIT.has(k) + (M.b.ab === 'super-luck') + (M.item === 'scope-lens'))];
      if (crit) r = simCalc(ctx, M, T, k, true);
      let dmg = simRolls(r, T, k).reduce((t, xs) => t + (rnd ? xs[Math.floor(rnd() * 16)] : xs.reduce((a, x) => a + x, 0) / 16), 0), held = '';
      if (r.endured && T.hp >= T.max && dmg >= T.hp) {
        dmg = T.hp - 1;
        held = r.endured === 'sturdy' ? abilZh('sturdy') : ITEMS[r.endured][0];
        if (r.endured === T.item) T.item = '';
      }
      dealt = Math.min(dmg, T.hp);
      T.hp -= dealt;
      if (r.berry) T.item = '';
      if (k === 'knock-off' && T.item && !MON[T.key].base && T.b.ab !== 'sticky-hold' && M.hp > 0) T.item = '';
      if (L) L.push(`　${me}用${mz}${r.crit ? '（急所）' : ''} → ${tn} −${simPct(dealt, T.max)}%（剩 ${simPct(T.hp, T.max)}%）`
        + (held ? `，靠${held}撐住` : '') + (T.hp <= 0 ? `，${tn}倒下` : ''));
      if (T.hp <= 0) M.kos++;
      const dr = SIM_DRAIN[k], rc = SIM_RECOIL[k];
      if (dr && dealt > 0 && M.hp > 0) {
        const v = Math.min(M.max - M.hp, Math.max(1, Math.round(dealt * dr[0] / dr[1])));
        M.hp += v;
        if (L && v) L.push(`　${me}吸取 +${simPct(v, M.max)}%`);
      }
      if (rc && dealt > 0 && M.hp > 0 && !['rock-head', 'magic-guard'].includes(M.b.ab)) {
        const v = Math.max(1, Math.round(dealt * rc[0] / rc[1]));
        M.hp -= v;
        if (L) L.push(`　${me}反作用力 −${simPct(v, M.max)}%`);
      }
      if (M.item === 'life-orb' && dealt > 0 && M.hp > 0 && M.b.ab !== 'magic-guard') {
        M.hp -= Math.max(1, Math.floor(M.max / 10));
        if (L) L.push(`　${me}生命寶珠 −10%`);
      }
      if (M.hp > 0 && SIM_SELF[k]) simBoost(st, s, M, SIM_SELF[k]);
      if (M.hp > 0 && k === 'fell-stinger' && T.hp <= 0) simBoost(st, s, M, { atk: 3 });
      if (SIM_RECHARGE.has(k)) M.rech = true;
    }
  }
  if (k === 'steel-beam' && M.hp > 0) {
    M.hp -= Math.round(M.max / 2);
    if (L) L.push(`　${me}自己受到傷害 −50%`);
  }
  if (M.hp <= 0) { M.hp = 0; if (L) L.push(`　${me}倒下`); }
  if (SIM_PIVOT.has(k) && dealt >= 0 && M.hp > 0 && !simOver(st) && simBench(st, s).length) simSwitch(st, s, pick(st, s));
}
// 一回合：acts[s] 是雙方的選擇（simOpts 的一項）。先換人，再依先制等級、速度出招（同速：有 rnd 抽，沒有看 tie 誰先）；
// 最後算預知未來。倒下的補位不在這裡（見 simReplace／simPlay）。idle＝連續幾回合雙方都沒扣血也沒換人（見 simOpts）。
// 回傳這回合有沒有同速決定先後
function simTurn(ctx, st, acts, rnd, tie, pick) {
  const was = JSON.stringify(st.sd.map(x => [x.act, x.mons.map(m => m.hp)]));
  st.turn++;
  if (st.log) st.log.push(`第 ${st.turn} 回合`);
  [0, 1].forEach(s => { if (acts[s].t === 'sw') simSwitch(st, s, acts[s].i); });
  [0, 1].forEach(s => {
    if (acts[s].t !== 'rech') return;
    simAct(st, s).rech = false;
    if (st.log) st.log.push(`　${simName(st, s)}要休息一回合`);
  });
  const start = st.sd.map(x => x.act), mv = [0, 1].filter(s => acts[s].t === 'mv');
  let order = mv, tied = false;
  if (mv.length === 2) {
    const pri = mv.map(s => SIM_PRI[acts[s].k] || 0), spd = mv.map(s => simSpeed(ctx, simAct(st, s)));
    const first = pri[0] !== pri[1] ? (pri[0] > pri[1] ? 0 : 1) : spd[0] !== spd[1] ? (spd[0] > spd[1] ? 0 : 1)
      : (tied = true, rnd ? (rnd() < 0.5 ? 0 : 1) : tie);
    order = [first, 1 - first];
  }
  const done = [false, false];
  order.forEach(s => {
    if (simOver(st) || st.sd[s].act !== start[s] || simAct(st, s).hp <= 0) return;
    simMove(ctx, st, s, acts[s].k, acts[1 - s], done[1 - s] || st.sd[1 - s].act !== start[1 - s], rnd, pick);
    done[s] = true;
  });
  st.fut.forEach(f => {
    if (--f.t || simOver(st)) return;
    const T = simAct(st, f.s);
    if (T.hp <= 0) return;
    const r = simCalc(ctx, f.src, T, 'future-sight', false);
    if (!r.eff) return;
    const d = Math.min(T.hp, r.rolls.reduce((t, xs) => t + (rnd ? xs[Math.floor(rnd() * 16)] : xs.reduce((a, x) => a + x, 0) / 16), 0));
    T.hp -= d;
    if (T.hp <= 0) T.hp = 0;
    if (st.log) st.log.push(`　預知未來打中${simName(st, f.s)} −${simPct(d, T.max)}%（剩 ${simPct(T.hp, T.max)}%）${T.hp <= 0 ? '，倒下' : ''}`);
  });
  st.fut = st.fut.filter(f => f.t > 0);
  st.idle = was === JSON.stringify(st.sd.map(x => [x.act, x.mons.map(m => m.hp)])) ? (st.idle || 0) + 1 : 0;
  return tied;
}
// 局面對我方（第 0 方）的分數：一方全倒＝±1，再加上贏的一方剩下 HP 比例的一半；雙方同時全倒或還沒分出勝負＝雙方剩下 HP 比例差的一半
function simValue(st) {
  const frac = s => st.sd[s].mons.reduce((t, m) => t + Math.max(0, m.hp) / m.max, 0) / st.sd[s].mons.length;
  const [a, b] = [frac(0), frac(1)], d0 = simDead(st, 0), d1 = simDead(st, 1);
  return d1 && !d0 ? 1 + a / 2 : d0 && !d1 ? -1 - b / 2 : (a - b) / 2;
}
// ---------- 簡單規則（往前算之後的局面用） ----------
// 出招：期望傷害（打不倒時佔對方最大 HP 的比例）最高的招式，打得倒的再加 1、用先制打得倒的再加 0.5；
// 要蓄力、要休息的打不倒時只算一半；自爆類扣掉自己剩下的 HP（打不倒再扣 1）；快手還擊不預判（算 0）。
// 只有招式都打不動對手（如講究圍巾鎖在對方免疫的招式）時才換人
function simGreedyAct(ctx, st, s) {
  const opts = simOpts(ctx, st, s), mv = opts.filter(o => o.t === 'mv'), sw = () => ({ t: 'sw', i: simGreedyPick(ctx, st, s) });
  if (!mv.length) return opts[0].t === 'sw' ? sw() : opts[0];
  const M = simAct(st, s), T = simAct(st, 1 - s);
  let best = mv[0], bv = -Infinity;
  mv.forEach(o => {
    const k = o.k, e = k === 'upper-hand' ? 0 : simExp(ctx, M, T, k), ko = e >= T.hp;
    let v = Math.min(e, T.hp) / T.max + (ko ? 1 + ((SIM_PRI[k] || 0) > 0 ? 0.5 : 0) : 0);
    if (!ko && ((SIM_CHARGE.has(k) && M.chg !== k) || SIM_RECHARGE.has(k))) v /= 2;
    if (SIM_BOOM.has(k)) v -= M.hp / M.max + (ko ? 0 : 1);
    if (v > bv) { bv = v; best = o; }
  });
  return bv <= 0 && opts.some(o => o.t === 'sw') ? sw() : best;
}
// 補位、打完換人：後排每隻和對手場上那隻一對一（雙方最痛一招的期望傷害、速度）：打得贏的優先、再比打完剩下的 HP；
// 打不贏的比倒下前能打掉對方多少。對手場上那隻也倒了就挑剩下 HP 比例最高的
function simGreedyPick(ctx, st, s) {
  const bench = simBench(st, s), T = simAct(st, 1 - s);
  if (bench.length < 2) return bench[0];
  const score = i => {
    const M = st.sd[s].mons[i];
    if (T.hp <= 0) return M.hp / M.max;
    const dm = Math.max(0, ...M.moves.map(k => simExp(ctx, M, T, k))), dt = Math.max(0, ...T.moves.map(k => simExp(ctx, T, M, k)));
    const n1 = dm ? Math.ceil(T.hp / dm) : Infinity, n2 = dt ? Math.ceil(M.hp / dt) : Infinity, fast = simSpeed(ctx, M) > simSpeed(ctx, T);
    if (n1 < n2 || (n1 === n2 && fast && n1 < Infinity)) return 2 + Math.max(0, M.hp - dt * (fast ? n1 - 1 : n1)) / M.max;
    return Math.min(1, dm * (n2 === Infinity ? 9 : n2) / T.hp);
  };
  return bench.map(i => [i, score(i)]).sort((x, y) => y[1] - x[1])[0][0];
}
// 倒下的補位（兩方都倒時都換）：picks[s] 是 { t: 'sw', i } 或 { t: 'pass' }
function simReplace(st, picks) {
  [0, 1].forEach(s => { if (picks[s].t === 'sw') simSwitch(st, s, picks[s].i); });
}
// 從局面 st 用簡單規則雙方打下去（最多再 SIM_LOOK 回合），回傳 simValue
function simRollout(ctx, st) {
  const end = st.turn + SIM_LOOK, pick = (c, s) => simGreedyPick(ctx, c, s);
  while (!simOver(st) && st.turn < end) {
    if (simNeed(st, 0) || simNeed(st, 1)) simReplace(st, [0, 1].map(s => simNeed(st, s) ? { t: 'sw', i: pick(st, s) } : { t: 'pass' }));
    simTurn(ctx, st, [0, 1].map(s => simGreedyAct(ctx, st, s)), null, 0, pick);
  }
  return simValue(st);
}
// ---------- 往前算一回合互相防 ----------
// 兩人同時出招、一方得分＝另一方失分的賽局 v（我方是列、要大；對手是欄、要小）的混合策略：雙方各自「對手怎麼應對都最不吃虧」的出法，
// 可能是幾種選擇按比例混著出（只固定出一種，會被對手抓到而雙方都不敢動，例如互相怕換人就一直原地空轉）。
// 用虛擬對局（fictitious play）求：從各自只出一種的最保守選擇開始，雙方輪流對「對方到目前為止的出法比例」出最好的一招，
// 次數比例收斂到均衡；不到 SIM_MIX_MIN 的當雜訊去掉。回傳 [我方各選擇的機率, 對手各選擇的機率]
const SIM_FP_N = 400, SIM_MIX_MIN = 0.03;
function simMix(v) {
  const m = v.length, n = v[0].length, rc = Array(m).fill(0), cc = Array(n).fill(0), rs = Array(m).fill(0), cs = Array(n).fill(0);
  const argBy = (xs, better) => xs.reduce((b, x, i) => better(x, xs[b]) ? i : b, 0);
  let i = argBy(v.map(r => Math.min(...r)), (x, y) => x > y), j = argBy(v[0].map((_, c) => Math.max(...v.map(r => r[c]))), (x, y) => x < y);
  for (let t = 0; t < SIM_FP_N; t++) {
    rc[i]++; cc[j]++;
    // rs[r]＝列 r 對欄目前出法的總分、cs[c]＝欄 c 對列目前出法的總分
    v.forEach((r, a) => { rs[a] += r[j]; });
    v[i].forEach((x, c) => { cs[c] += x; });
    i = argBy(rs, (x, y) => x > y);
    j = argBy(cs, (x, y) => x < y);
  }
  const norm = c => { const p = c.map(x => x / SIM_FP_N).map(x => x < SIM_MIX_MIN ? 0 : x), t = p.reduce((a, x) => a + x, 0); return p.map(x => x / t); };
  return [norm(rc), norm(cc)];
}
// phase 'turn'：雙方這回合的每種選擇組合（simOpts）都用期望值試算這一回合（同速時兩種先後各算一半），之後用簡單規則打完，得到對我方的分數；
// phase 'replace'：倒下的那方每種補位（另一方 pass，兩方都倒就兩方都選）同樣試算。
// 雙方照 simMix 的比例抽一種（rnd 抽；沒給 rnd 取機率最高的）。回傳 [我方, 對手] 的選擇
function simDecide(ctx, st, phase, rnd) {
  const optsOf = s => phase === 'turn' ? simOpts(ctx, st, s) : simNeed(st, s) ? simBench(st, s).map(i => ({ t: 'sw', i })) : [{ t: 'pass' }];
  const A = optsOf(0), B = optsOf(1);
  if (A.length === 1 && B.length === 1) return [A[0], B[0]];
  const pick = (c, s) => simGreedyPick(ctx, c, s);
  const run = (acts, tie) => {
    const c = simClone(st);
    const tied = phase === 'turn' ? simTurn(ctx, c, acts, null, tie, pick) : (simReplace(c, acts), false);
    return [simRollout(ctx, c), tied];
  };
  const v = A.map(a => B.map(b => {
    const [x, tied] = run([a, b], 0);
    return tied ? (x + run([a, b], 1)[0]) / 2 : x;
  }));
  const draw = p => {
    if (!rnd) return p.indexOf(Math.max(...p));
    let x = rnd();
    const i = p.findIndex(q => (x -= q) < 0);
    return i < 0 ? p.findLastIndex(q => q > 0) : i;
  };
  const [pa, pb] = simMix(v);
  return [A[draw(pa)], B[draw(pb)]];
}
// 打一場：sides 是 simSides 的結果（帶出場的隻會複製一份，不改到 sides）；rnd 亂數；log＝要不要逐回合紀錄。
// 雙方每回合、每次補位都用 simDecide（照比例用 rnd 抽）；打完換人換上誰用簡單規則（simGreedyPick）。
// 回傳 { res 1 我方贏／-1 輸／0 平手（同時全倒或打滿 SIM_MAX_TURN 回合）, turns, mons [我方, 對手] 帶出場的（kos、hp、max、out）, log }
function simPlay(ctx, sides, rnd, log) {
  const st = { sd: sides.map(x => ({ act: 0, mons: x.mons.map(m => ({ ...m, st: { ...m.st } })) })), turn: 0, fut: [], idle: 0, log: log ? [] : null };
  st.sd.forEach(x => Object.assign(x.mons[0], { in: 0, out: true }));
  if (st.log) st.log.push(`先發：我方${MON[simAct(st, 0).key].zh}、對手${MON[simAct(st, 1).key].zh}`);
  const pick = (c, s) => simGreedyPick(ctx, c, s);
  while (!simOver(st) && st.turn < SIM_MAX_TURN) {
    simTurn(ctx, st, simDecide(ctx, st, 'turn', rnd), rnd, 0, pick);
    if (!simOver(st) && (simNeed(st, 0) || simNeed(st, 1))) simReplace(st, simDecide(ctx, st, 'replace', rnd));
  }
  const d0 = simDead(st, 0), d1 = simDead(st, 1), res = d1 && !d0 ? 1 : d0 && !d1 ? -1 : 0;
  if (st.log) st.log.push(res > 0 ? '我方贏' : res < 0 ? '我方輸' : d0 ? '雙方同時全倒，平手' : `打滿 ${SIM_MAX_TURN} 回合，平手`);
  return { res, turns: st.turn, mons: st.sd.map(x => x.mons), log: st.log };
}

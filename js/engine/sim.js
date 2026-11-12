// 計算引擎：資料與純邏輯，不碰 DOM（畫面在 js/ui/）
// ---------- 對戰模擬（單打：6 選 3，雙方每回合同時出招） ----------
// 算攻擊招式的傷害與招式本身附帶的效果（使用限制、自己的能力變化、反作用力與吸血、打完換人），
// 加上輔助招（強化、守住、回復、異常狀態、撒菱、擾亂，見 SIM_SUP）與相關的道具、特性、回合結束效果，以及 PP（照 OP.GG 冠軍版的 PP，用完只能掙扎）。
// 不算：攻擊招式的機率性追加效果（畏縮、灼傷、降能力…）、天氣場地、威嚇以外的出場特性、命中率（當全中）。
// 各表的資料來源寫在表的上方；Showdown＝Pokémon Showdown 的 data/moves.ts、conditions.ts、items.ts、abilities.ts、
// sim/battle-actions.ts、sim/battle.ts，冠軍版改過的照 data/mods/champions/（conditions.ts、moves.ts、abilities.ts）。

// 先制等級（Showdown priority；Smogon damage-calc 冠軍版 CHAMPIONS_PATCH 沒改），不在表上的是 0；輔助招的寫在 SIM_SUP 的 p
const SIM_PRI = { 'fake-out': 3, 'upper-hand': 3, 'extreme-speed': 2, feint: 2, 'first-impression': 2, accelerock: 1, 'aqua-jet': 1,
  'bullet-punch': 1, 'ice-shard': 1, 'jet-punch': 1, 'mach-punch': 1, 'quick-attack': 1, 'shadow-sneak': 1, 'sucker-punch': 1,
  'vacuum-wave': 1, 'water-shuriken': 1, 'beak-blast': -3, avalanche: -4, counter: -5, 'mirror-coat': -5, 'circle-throw': -6, 'dragon-tail': -6 };
// 固定傷害（damageCalc 不算，這裡自己算；Showdown data/moves.ts）：地球上投、黑夜魔影＝等級（冠軍版 Lv50）、憤怒門牙＝對手剩下 HP 的一半、
// 蠻幹＝對手剩下的 HP 減自己的（對手沒比較多就失敗）、搏命＝自己剩下的 HP（打完自己倒下）。屬性免疫照算（如幽靈不吃地球上投），不算本系、相剋、急所
const SIM_FIXED = { 'seismic-toss': () => 50, 'night-shade': () => 50, 'super-fang': (M, T) => Math.max(1, Math.floor(T.hp / 2)),
  endeavor: (M, T) => T.hp - M.hp, 'final-gambit': M => M.hp };
// 反擊類：這回合被對手打的傷害 × 倍數還回去（雙倍奉還只還物理、鏡面反射只還特殊，先制 −5；金屬爆炸都還、×1.5，要比對手晚出招）；
// 這回合沒被打到就失敗（Showdown counter／mirrorcoat／metalburst）
const SIM_REACT = { counter: { cat: 'physical', x: 2 }, 'mirror-coat': { cat: 'special', x: 2 }, 'metal-burst': { cat: '', x: 1.5 } };
// 容易擊中要害（急所等級 +1）的招式（Showdown critRatio 2）；必定急所的看 damageCalc（ALWAYS_CRIT）
const SIM_HICRIT = new Set(['air-cutter', 'aqua-cutter', 'blaze-kick', 'crabhammer', 'cross-chop', 'cross-poison', 'drill-run', 'leaf-blade',
  'night-slash', 'psycho-cut', 'shadow-claw', 'slash', 'snipe-shot', 'stone-edge', 'triple-arrows']);
// 急所機率依急所等級（GameWith「急所の確率と効果」：0＝1/24、+1＝1/8、+2＝1/2、+3 以上必定）；特性超幸運、道具焦點鏡各 +1、聚氣 +2
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
// 吸血：回復打出的傷害 × 比例，四捨五入、至少 1（Showdown drain）；道具大根莖 ×1.3（5324/4096，Showdown bigroot）
const SIM_DRAIN = { 'bitter-blade': [1, 2], 'drain-punch': [1, 2], 'giga-drain': [1, 2], 'horn-leech': [1, 2], 'leech-life': [1, 2],
  'matcha-gotcha': [1, 2], 'parabolic-charge': [1, 2], 'draining-kiss': [3, 4] };
// 使用限制（Showdown）：擊掌奇襲、迎頭一擊只有上場後第一回合能用（onTry）；大爆炸、自爆、薄霧炸裂用了就倒下（selfdestruct always）；
// 破壞光線等打中後下一回合不能動（recharge）；日光束、日光刃（要晴天）、電光束（要下雨）、挖洞、潛靈奇襲先蓄力一回合（charge；
// 模擬沒有天氣，所以都要蓄力；挖洞、潛靈奇襲蓄力時打不到；電光束蓄力時特攻 +1）；預知未來兩回合後才打中；急速折返等打完換人（selfSwitch）；
// 龍尾、巴投打中後強制對手換人（forceSwitch）；高速旋轉、晶光轉轉打中後清掉自己這邊的撒菱類（onAfterHit）
const SIM_FIRST = new Set(['fake-out', 'first-impression']);
const SIM_BOOM = new Set(['explosion', 'self-destruct', 'misty-explosion']);
const SIM_RECHARGE = new Set(['hyper-beam', 'giga-impact', 'hydro-cannon', 'rock-wrecker', 'meteor-assault']);
const SIM_CHARGE = new Set(['solar-beam', 'solar-blade', 'electro-shot', 'dig', 'phantom-force']);
const SIM_HIDE = new Set(['dig', 'phantom-force']);
const SIM_PIVOT = new Set(['u-turn', 'volt-switch', 'flip-turn']);
const SIM_PHAZE = new Set(['dragon-tail', 'circle-throw']);
const SIM_SPIN = new Set(['rapid-spin', 'mortal-spin']);
// 威力隨自己剩下的 HP：資料的威力 × 剩下 HP ÷ 最大 HP，取整、至少 1（Showdown basePowerCallback）
const SIM_HPBP = new Set(['eruption', 'water-spout']);
// 輔助招（Showdown data/moves.ts，冠軍版有改的照 mods/champions）：kind 效果種類；p 先制等級；tgt＝目標是對手場上那隻；
// f＝會被守住擋（protect 旗標；王者盾牌不擋輔助招）；r＝會被魔法鏡反彈（reflectable）；sub＝穿透替身（bypasssub 或聲音）；pw＝粉末（草屬性、防塵免疫）
//   boost 自己的能力變化 b｜prot 守住類（how：protect／kings 王者盾牌：接觸的攻擊 −1｜spiky 尖刺防守：接觸的扣 1/8｜bunker 碉堡：接觸的中毒｜endure 挺住）
//   heal 回復一半（沒有天氣，光合作用等也是一半）｜wish 祈願：下回合結束回復使用者最大 HP 一半｜split 分擔痛楚｜rest 睡覺：全滿、睡 2 回合
//   sap 吸取力量：回復對手的攻擊值、對手攻擊 −1｜seed 寄生種子：每回合吸 1/8｜hwish 治癒之願：自己倒下，換上來的回滿、治好異常
//   status 異常狀態 x（toxic-thread 另外速度 −2，冠軍版）｜yawn 哈欠：下回合結束睡著｜hazard 撒菱類 h（層數上限 max）
//   defog 清除濃霧：清掉雙方撒菱類、對手的牆｜tidy 大掃除：清掉雙方撒菱類與替身、攻擊速度 +1
//   encore 再來一次 3 回合（冠軍版：對手這回合還沒出招就立刻改成那招，已經出過就多 1 回合）｜taunt 挑釁 3 回合（對手已出招多 1 回合）
//   subst 替身：扣 1/4、替身 HP 1/4｜screen 牆 5 回合（光之黏土 8；極光幕要下雪，見 simFutile）｜phaze 吼叫、吹飛：強制對手換人（隨機）
//   haze 黑霧：雙方能力變化歸零｜debuff 降對手能力 d｜shot 拋下狠話：降對手能力後換人｜memento 臨別禮物：降對手能力後自己倒下
//   drum 腹鼓：扣一半、攻擊 +6｜soul 魂舞烈音爆：扣 33%、全能力 +1｜retreat 背水一戰：全能力 +1、不能換人｜curse 詛咒（非幽靈：攻防 +1 速度 −1；
//   幽靈：扣一半、對手每回合扣 1/4）｜focus 聚氣：急所 +2｜charge 充電：特防 +1、下一招電屬性威力 ×2
const SIM_ALL1 = { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 };
const SIM_FOE = { tgt: 1, f: 1, r: 1 };
const SIM_SUP = {
  'swords-dance': { kind: 'boost', b: { atk: 2 } }, 'nasty-plot': { kind: 'boost', b: { spa: 2 } }, 'calm-mind': { kind: 'boost', b: { spa: 1, spd: 1 } },
  'dragon-dance': { kind: 'boost', b: { atk: 1, spe: 1 } }, 'quiver-dance': { kind: 'boost', b: { spa: 1, spd: 1, spe: 1 } },
  'shell-smash': { kind: 'boost', b: { def: -1, spd: -1, atk: 2, spa: 2, spe: 2 } }, 'bulk-up': { kind: 'boost', b: { atk: 1, def: 1 } },
  'iron-defense': { kind: 'boost', b: { def: 2 } }, 'acid-armor': { kind: 'boost', b: { def: 2 } }, shelter: { kind: 'boost', b: { def: 2 } },
  'cotton-guard': { kind: 'boost', b: { def: 3 } }, 'cosmic-power': { kind: 'boost', b: { def: 1, spd: 1 } }, coil: { kind: 'boost', b: { atk: 1, def: 1 } },
  amnesia: { kind: 'boost', b: { spd: 2 } }, growth: { kind: 'boost', b: { atk: 1, spa: 1 } }, agility: { kind: 'boost', b: { spe: 2 } },
  'shift-gear': { kind: 'boost', b: { spe: 2, atk: 1 } }, 'belly-drum': { kind: 'drum', b: { atk: 12 } }, 'clangorous-soul': { kind: 'soul', b: SIM_ALL1 },
  'no-retreat': { kind: 'retreat', b: SIM_ALL1 }, curse: { kind: 'curse', sub: 1 }, 'focus-energy': { kind: 'focus' }, charge: { kind: 'charge', b: { spd: 1 } },
  'tidy-up': { kind: 'tidy', b: { atk: 1, spe: 1 } },
  protect: { kind: 'prot', p: 4, how: 'protect' }, detect: { kind: 'prot', p: 4, how: 'protect' }, 'kings-shield': { kind: 'prot', p: 4, how: 'kings' },
  'spiky-shield': { kind: 'prot', p: 4, how: 'spiky' }, 'baneful-bunker': { kind: 'prot', p: 4, how: 'bunker' }, endure: { kind: 'prot', p: 4, how: 'endure' },
  recover: { kind: 'heal' }, 'slack-off': { kind: 'heal' }, 'milk-drink': { kind: 'heal' }, roost: { kind: 'heal' }, synthesis: { kind: 'heal' },
  'morning-sun': { kind: 'heal' }, moonlight: { kind: 'heal' }, wish: { kind: 'wish' }, rest: { kind: 'rest' }, 'healing-wish': { kind: 'hwish' },
  'pain-split': { kind: 'split', tgt: 1, f: 1 }, 'strength-sap': { kind: 'sap', ...SIM_FOE }, 'leech-seed': { kind: 'seed', ...SIM_FOE },
  'will-o-wisp': { kind: 'status', x: 'brn', ...SIM_FOE }, toxic: { kind: 'status', x: 'tox', ...SIM_FOE }, 'thunder-wave': { kind: 'status', x: 'par', ...SIM_FOE },
  glare: { kind: 'status', x: 'par', ...SIM_FOE }, hypnosis: { kind: 'status', x: 'slp', ...SIM_FOE }, 'sleep-powder': { kind: 'status', x: 'slp', pw: 1, ...SIM_FOE },
  'toxic-thread': { kind: 'status', x: 'psn', d: { spe: -2 }, ...SIM_FOE }, yawn: { kind: 'yawn', ...SIM_FOE },
  'stealth-rock': { kind: 'hazard', h: 'sr', max: 1, r: 1 }, spikes: { kind: 'hazard', h: 'spikes', max: 3, r: 1 },
  'toxic-spikes': { kind: 'hazard', h: 'tspikes', max: 2, r: 1 }, 'sticky-web': { kind: 'hazard', h: 'web', max: 1, r: 1 },
  defog: { kind: 'defog', f: 1, r: 1, sub: 1 },
  encore: { kind: 'encore', sub: 1, ...SIM_FOE }, taunt: { kind: 'taunt', sub: 1, ...SIM_FOE }, substitute: { kind: 'subst' },
  reflect: { kind: 'screen' }, 'light-screen': { kind: 'screen' }, 'aurora-veil': { kind: 'screen' },
  roar: { kind: 'phaze', p: -6, tgt: 1, r: 1, sub: 1 }, whirlwind: { kind: 'phaze', p: -6, tgt: 1, r: 1, sub: 1 }, haze: { kind: 'haze' },
  charm: { kind: 'debuff', d: { atk: -2 }, ...SIM_FOE }, 'feather-dance': { kind: 'debuff', d: { atk: -2 }, ...SIM_FOE },
  'eerie-impulse': { kind: 'debuff', d: { spa: -2 }, ...SIM_FOE }, 'fake-tears': { kind: 'debuff', d: { spd: -2 }, ...SIM_FOE },
  'baby-doll-eyes': { kind: 'debuff', d: { atk: -1 }, p: 1, ...SIM_FOE }, 'string-shot': { kind: 'debuff', d: { spe: -2 }, ...SIM_FOE },
  'parting-shot': { kind: 'shot', d: { atk: -1, spa: -1 }, sub: 1, ...SIM_FOE }, memento: { kind: 'memento', d: { atk: -2, spa: -2 }, tgt: 1, f: 1 },
};
const SIM_STATUS_ZH = { brn: '灼傷', par: '麻痺', psn: '中毒', tox: '劇毒', slp: '睡眠' };
const SIM_HAZ_ZH = { sr: '隱形岩', spikes: '撒菱', tspikes: '毒菱', web: '黏黏網' };
// 一場最多幾回合（到了算平手）、往前算的時候簡單規則最多再打幾回合
const SIM_MAX_TURN = 100, SIM_LOOK = 40;
const SIM_ST0 = () => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });

// 上場的一隻：key 這場的型態、set 配招（能算傷害的攻擊招式與 SIM_SUP 有的輔助招；沒有招式就用 OP.GG 前 4 招 defaultSet）、
// item 道具（沒給照 battler）、s 哪一方。能力點數、性格、特性同 battler；其餘是場上狀態：hp、item（會被打掉、用掉）、st 能力變化、
// lock 講究圍巾鎖住的招式、chg 蓄力中的招式、hide 蓄力時打不到、rech 下一回合要休息、in 第幾回合上場（擊掌奇襲用）、kos 打倒幾隻、
// out 有沒有上過場、status 異常狀態（tox 劇毒累積、slp 還要睡幾次）、v 換下場就清掉的狀態（sub 替身 HP、taunt、enc／encK 再來一次、seed、
// curse、yawn、focus、charge、trap、prot／endure／stall／protUsed 守住類）、last 上一次用的招式（再來一次用）、pp 各招剩下的 PP（OP.GG 冠軍版的 PP）
// 能算的招式：damageCalc 算得了的攻擊招式、固定傷害與反擊類（SIM_FIXED／SIM_REACT）、SIM_SUP 的輔助招；其他（一擊必殺、看體重的、變身…）不列
const simCanUse = k => canCalc(k) || !!SIM_FIXED[k] || !!SIM_REACT[k] || !!SIM_SUP[k];
function simMon(key, set, item, s, fmt) {
  const b = battler(key, fmt, set), use = set?.moves.some(Boolean) ? set : defaultSet(key, fmt), max = hpOf(b);
  const moves = [...new Set((use?.moves || []).filter(k => k && MOVES[k] && simCanUse(k)))];
  return { id: `${s}:${key}`, key, b, moves, max, hp: max, item: item ?? b.item, st: SIM_ST0(), lock: '', chg: '', hide: false, rech: false, in: -1, kos: 0,
    out: false, status: '', tox: 0, slp: 0, v: {}, last: '', pp: Object.fromEntries(moves.map(k => [k, MOVES[k][5] ?? Infinity])) };
}
// 掙扎（招式都沒 PP、或剩下的都不能選時；Showdown struggle）：威力 50 的物理接觸招式，沒有屬性（onModifyMove 改成 ???：對誰都 ×1、沒有本系），
// 自己扣最大 HP 的 1/4（四捨五入，struggleRecoil 是 directDamage，魔法防守、堅硬腦袋擋不了）。不在 OP.GG 資料裡，傷害自己算：
// 基礎傷害 ⌊⌊22 × 50 × 攻擊 ÷ 防禦⌋ ÷ 50⌋ + 2（Lv50）→ 亂數 85～100% → 灼傷減半（毅力不減）→ 反射壁／極光幕 ×½；道具、特性的修正不算、不會急所
const SIM_STRUGGLE = 'struggle';
const simCat = k => k === SIM_STRUGGLE ? 'physical' : MOVES[k][2];
const simMoveZh = k => k === SIM_STRUGGLE ? '掙扎' : MOVES[k][0];
function simStruggleDmg(st, A, D, rnd) {
  const [asp, anat] = invAt(A.b, 1, A.b.atkInv), [dsp, dnat] = invAt(D.b, 2, D.b.defInv);
  const atk = stageStat(statOf(MON[A.key].bs[1], asp, 1, anat), A.st.atk), def = stageStat(statOf(MON[D.key].bs[2], dsp, 2, dnat), D.st.def);
  const base = Math.floor(Math.floor(22 * 50 * atk / def) / 50) + 2, scr = st.sd[+D.id[0]].scr;
  let d = Math.floor(base * (rnd ? 85 + Math.floor(rnd() * 16) : 92.5) / 100);
  if (A.status === 'brn' && A.b.ab !== 'guts') d = Math.floor(d / 2);
  if (scr.reflect || scr['aurora-veil']) d = Math.floor(d / 2);
  return Math.max(1, d);
}
// 照 bringPlan 的結果 plan 的帶法 c（combos 的一項）帶出場（mems 是傳給 bringPlan 的隊員 { key, set, item }），先發 lead 排第一；
// 一場只能超級進化一隻，不進化的以原型上場、沒有道具（同出戰選角）
function simBring(plan, mems, s, fmt, c, lead) {
  return [lead, ...c.idx.filter(j => j !== lead)].map(j => {
    const x = mems[j], down = !!plan.alt[j] && c.evo != null && j !== c.evo;
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
// 出戰選角對我方的建議：mine（[{ key, set, slot 隊伍格子 }]，隊伍分析挑了寶可夢的）對上對手 oppKeys 的 bringPlan 第 1 名帶法；
// 回傳 { slots 帶的格子（先發排第一）, evo 超級進化的格子（組合裡超級進化不到 2 隻是 -1）}；有一方是空的回傳 null
function simMyPlan(mine, oppKeys, fmt) {
  const opps = oppKeys.filter(k => MON[k]);
  if (!mine.length || !opps.length) return null;
  const plan = bringPlan(mine.map(x => ({ defs: MON[x.key].types, key: x.key, set: x.set })), opps.map(k => MON[k]), fmt), best = plan.combos[0], lead = plan.pick.js[0];
  return { slots: [lead, ...best.idx.filter(j => j !== lead)].map(j => mine[j].slot), evo: best.evo == null ? -1 : mine[best.evo].slot };
}
// 我方帶出場的：mine 裡格子 slots 的（先發排第一），配招照登錄的；一場只能超級進化一隻：帶了 2 隻以上超級進化時只有 evo 那格進化
// （evo 不在裡面就是第一隻超級進化），其他以原型上場、沒有道具
function simMySide(mine, slots, evo, fmt) {
  const xs = slots.map(i => mine.find(m => m.slot === i)), megas = xs.filter(x => MON[x.key].base).map(x => x.slot);
  const up = megas.includes(evo) ? evo : megas[0];
  return xs.map(x => { const down = !!MON[x.key].base && x.slot !== up; return simMon(down ? MON[x.key].base : x.key, x.set, down ? '' : undefined, 0, fmt); });
}
// 對手的每一種帶法：對手 oppKeys（6 格以內）當成也用出戰選角的方法選（oppBringPlan：看得到我方 6 隻 myKeys、看不到配招；超級石過半的當超級進化），
// 每種帶法（6 選 3 是 20 種）的先發照它對這種帶法的挑法（leadOf）；配招照 OP.GG 常見（defaultSet）、道具同一隊不重複（simItems）。
// 回傳 [{ rank 這種帶法在對手建議裡排第幾, mons 帶出場的（simMon，先發排第一）}...]（照 rank 排）；沒有對手回傳 []
function simOppScenarios(oppKeys, myKeys, fmt) {
  const op = oppBringPlan(oppKeys, myKeys, fmt);
  if (!op) return [];
  const keys = op.mems.map(x => x.key), items = simItems(keys, fmt), mems = keys.map((k, j) => ({ key: k, set: defaultSet(k, fmt), item: items[j] }));
  return op.combos.map((c, r) => ({ rank: r + 1, mons: simBring(op, mems, 1, fmt, c, op.leadOf(c).js[0]) }));
}
// 一步一步推演的對手（只看得到先發）：oppKeys 每一格當成的型態、配招、道具同 simOppScenarios。回傳 { mems 每一格的 { key, set, item }（沒填的格子 null）,
// guess(lead) 先發是第 lead 格時猜的帶法 { slots [lead, 後排...], evo 超級進化的格子（沒有是 -1）}（「對手可能帶的」帶法裡會派這隻先發（leadOf）、
// 排名最高那種；沒有一種會派牠先發就取帶法裡有這隻、排名最高的）}；有一方是空的回傳 null
function simOppRoster(oppKeys, myKeys, fmt) {
  const op = oppBringPlan(oppKeys, myKeys, fmt);
  if (!op) return null;
  const keys = op.mems.map(x => x.key), items = simItems(keys, fmt), mems = oppKeys.map(() => null);
  op.at.forEach((i, j) => { mems[i] = { key: keys[j], set: defaultSet(keys[j], fmt), item: items[j] }; });
  const guess = lead => {
    const j0 = op.at.indexOf(lead), c = op.combos.find(c => c.idx.includes(j0) && op.leadOf(c).js[0] === j0) || op.combos.find(c => c.idx.includes(j0));
    return c ? { slots: [lead, ...c.idx.filter(j => j !== j0).map(j => op.at[j])], evo: c.evo == null ? -1 : op.at[c.evo] } : null;
  };
  return { mems, guess };
}
// 推演的對手一隻：roster（simOppRoster）第 i 格，down＝不超級進化（以原型上場、沒有道具）；加上 slot（對手第幾格）
const simOppMon = (roster, i, down, fmt) => { const x = roster.mems[i];
  return Object.assign(simMon(down ? MON[x.key].base : x.key, x.set, down ? '' : x.item, 1, fmt), { slot: i }); };
// 推演的對手帶出場的：格子 slots（先發排第一）；同 simMySide 一場只能超級進化一隻：evo 那格（不在裡面就是第一隻能超級進化的）進化
function simOppSide(roster, slots, evo, fmt) {
  const megas = slots.filter(i => MON[roster.mems[i].key].base), up = megas.includes(evo) ? evo : megas[0];
  return slots.map(i => simOppMon(roster, i, !!MON[roster.mems[i].key].base && i !== up, fmt));
}
// 計算快取：同一組對戰可以共用（id 是「哪一方:寶可夢 key」，同一方同一隻的配招固定）
const simCtx = fmt => ({ fmt, memo: new Map(), spd: new Map() });

const simAct = (st, s) => st.sd[s].mons[st.sd[s].act];
const simBench = (st, s) => st.sd[s].mons.map((m, i) => m.hp > 0 && i !== st.sd[s].act ? i : -1).filter(i => i >= 0);
const simDead = (st, s) => st.sd[s].mons.every(m => m.hp <= 0);
const simOver = st => simDead(st, 0) || simDead(st, 1);
// 倒下的順序（ft，同時全倒時判勝負用）：HP 變 0 的地方都要呼叫
const simFaint = (st, M) => { if (M.hp <= 0 && !M.ft) M.ft = st.seq = (st.seq || 0) + 1; };
// 贏的一方（0／1；還沒分出勝負是 -1）：雙方同時全倒時最後倒下的那方贏（第五世代起，Showdown checkWin 的 faintData.target.side），
// 例如打倒對手最後一隻後被反作用力打倒的算贏、大爆炸同歸於盡的算輸（使用者先倒下）
function simWinner(st) {
  const d0 = simDead(st, 0), d1 = simDead(st, 1);
  if (d0 && d1) { const last = st.sd.map(x => Math.max(0, ...x.mons.map(m => m.ft || 0))); return last[0] > last[1] ? 0 : 1; }
  return d1 ? 0 : d0 ? 1 : -1;
}
const simNeed = (st, s) => simAct(st, s).hp <= 0 && simBench(st, s).length > 0;
const simName = (st, s, M = simAct(st, s)) => `${s ? '對手' : '我方'}${MON[M.key].zh}`;
const simPct = (v, max) => Math.round(Math.max(0, v) / max * 100);
const simLog = (st, t) => { if (st.log) st.log.push('　' + t); };
const simSide0 = mons => ({ act: 0, mons, haz: { sr: 0, spikes: 0, tspikes: 0, web: 0 }, scr: {}, wish: null, hwish: false });
const simCloneMon = m => ({ ...m, st: { ...m.st }, v: { ...m.v }, pp: { ...m.pp } });
const simClone = st => ({ sd: st.sd.map(x => ({ ...x, mons: x.mons.map(simCloneMon), haz: { ...x.haz }, scr: { ...x.scr }, wish: x.wish && { ...x.wish } })),
  turn: st.turn, fut: st.fut.map(f => ({ ...f })), idle: st.idle, seq: st.seq, log: null });
const simTypes = M => MON[M.key].types;
// 在地面上（撒菱、毒菱、黏黏網用）：不是飛行屬性、沒有飄浮、沒帶氣球（Showdown isGrounded）
const simGround = M => !simTypes(M).includes('flying') && M.b.ab !== 'levitate' && M.item !== 'air-balloon';
// 這一招的先制等級：SIM_PRI 或輔助招的 p；特性惡作劇之心讓輔助招 +1（Showdown prankster）
const simPri = (M, k) => (SIM_PRI[k] ?? SIM_SUP[k]?.p ?? 0) + (SIM_SUP[k] && M.b.ab === 'prankster' ? 1 : 0);

// A 打 D 用招式 k 的 damageCalc（crit 急所）；結果依會影響傷害的狀態快取（D 剩下的 HP 只看滿不滿：氣勢披帶、結實、多重鱗片）。
// D 那一方的牆、A 灼傷（特性毅力有異常狀態就照 damageCalc 的灼傷算，攻擊 ×1.5、不減半）、充電（電屬性威力 ×2）也算進去
function simCalc(ctx, st, A, D, k, crit) {
  const pw = MOVES[k][3], dSide = st.sd[+D.id[0]];
  const bp = SIM_HPBP.has(k) ? Math.max(1, Math.floor(pw * A.hp / A.max)) : A.v.charge && MOVES[k][1] === 'electric' ? pw * 2 : undefined;
  // 電光束蓄力時已經特攻 +1，damageCalc 又會在出招前 +1，所以先扣回來
  const spa = A.st.spa - (CHARGE_SPA.has(k) ? 1 : 0), full = D.hp >= D.max;
  const burn = A.status === 'brn' || (A.b.ab === 'guts' && !!A.status), walls = Object.keys(dSide.scr);
  // 撲擊看自己的防禦變化、欺詐看對手的攻擊變化，都要進快取的鍵
  const key = [A.id, A.item, A.st.atk, spa, A.st.def, burn, D.id, D.item, D.st.def, D.st.spd, D.st.atk, full, walls.join('.'), k, crit, bp].join('|');
  let r = ctx.memo.get(key);
  if (!r) {
    const a = A.b, d = D.b;
    r = damageCalc({ key: A.key, inv: a.atkInv, sp: a.sp, nat: a.nat, st: { atk: A.st.atk, spa, def: A.st.def }, item: A.item, ab: a.ab },
      { key: D.key, hp: d.hp, inv: d.defInv, sp: d.sp, nat: d.nat, st: { def: D.st.def, spd: D.st.spd, atk: D.st.atk }, item: D.item, ab: d.ab,
        cur: full ? undefined : D.hp, atkInv: d.atkInv },
      k, { fmt: ctx.fmt, weather: '', crit, terrain: '', hh: false, walls, burn, bp });
    r = r.skip || !r.eff ? { eff: 0 } : { eff: r.eff, type: r.type, crit: r.crit, rolls: r.rolls, later: r.later, endured: r.endured, berry: r.berry };
    ctx.memo.set(key, r);
  }
  return r;
}
// 這一下要用的亂數表：拍落打沒有道具的對手時沒有加成（damageCalc 的 later）
const simRolls = (r, D, k) => k === 'knock-off' && !D.item ? r.later : r.rolls;
// 固定傷害、反擊類這一下的結果（同 simCalc 的格式：eff 有沒有效果、rolls／later 16 個一樣的傷害、endured 氣勢披帶或結實撐住；fixed 標記）。
// 反擊類用 D 這回合打 A 的傷害（A.v.got，見 simMove）；exp＝估期望值（往前算用）：還沒被打，就用 D 對 A 同類招式裡最痛一招的期望傷害、A 撐得住才算；
// 失敗（反擊類沒被打到、蠻幹對手 HP 沒比較多）的 eff 是 0，fail 寫原因
function simFixed(ctx, st, A, D, k, exp) {
  const ty = MOVES[k][1], rc = SIM_REACT[k];
  if (!eff(ty, simTypes(D))) return { eff: 0 };
  let d;
  if (rc) {
    const g = A.v.got, ok = x => !rc.cat || x === rc.cat;
    const base = g?.turn === st.turn && ok(g.cat) ? g.dmg
      : exp ? Math.max(0, ...D.moves.filter(k2 => !SIM_SUP[k2] && !SIM_REACT[k2] && ok(simCat(k2))).map(k2 => simExp(ctx, st, D, A, k2)).filter(x => x < A.hp)) : 0;
    if (!base) return { eff: 0, fail: '這回合沒有被打到' };
    d = Math.floor(base * rc.x);
  } else d = SIM_FIXED[k](A, D);
  if (d <= 0) return { eff: 0, fail: '對手的 HP 沒有比較多' };
  const endured = D.hp >= D.max && d >= D.hp ? (D.item === 'focus-sash' ? D.item : D.b.ab === 'sturdy' ? 'sturdy' : '') : '';
  const rolls = [Array(16).fill(d)];
  return { eff: 1, crit: false, rolls, later: rolls, endured, berry: false, fixed: true };
}
// 這一招打 D 的計算：固定傷害、反擊類用 simFixed，其他用 simCalc
const simHit = (ctx, st, A, D, k, crit, exp) => SIM_FIXED[k] || SIM_REACT[k] ? simFixed(ctx, st, A, D, k, exp) : simCalc(ctx, st, A, D, k, crit);
// 期望傷害（各下的 16 個亂數取平均加總；氣勢披帶、結實撐住時最多打到剩 1）；輔助招是 0
function simExp(ctx, st, A, D, k) {
  if (SIM_SUP[k]) return 0;
  if (k === SIM_STRUGGLE) return simStruggleDmg(st, A, D, null);
  const r = simHit(ctx, st, A, D, k, false, true);
  if (!r.eff) return 0;
  const e = simRolls(r, D, k).reduce((t, xs) => t + xs.reduce((a, x) => a + x, 0) / 16, 0);
  return r.endured && D.hp >= D.max ? Math.min(e, D.hp - 1) : e;
}
function simSpeed(ctx, M) {
  const key = [M.id, M.item, M.st.spe, M.status].join('|');
  if (!ctx.spd.has(key)) {
    const b = M.b;
    ctx.spd.set(key, speedOf({ key: M.key, inv: b.speInv, sp: b.sp, nat: b.nat, st: M.st.spe, item: M.item, ab: b.ab, tw: false,
      par: M.status === 'par', status: !!M.status }, { weather: '', terrain: '' }).v);
  }
  return ctx.spd.get(key);
}
// 扣血、回血（間接的：反作用力、撒菱、殘血…；magic＝特性魔法防守能擋；Showdown damage／heal 取整、至少 1）；扣完看文柚果
function simHurt(st, s, M, v, why, magic = true) {
  if (M.hp <= 0 || v <= 0 || (magic && M.b.ab === 'magic-guard')) return 0;
  const d = Math.min(M.hp, Math.max(1, Math.floor(v)));
  M.hp -= d;
  simFaint(st, M);
  simLog(st, `${simName(st, s, M)}${why} −${simPct(d, M.max)}%（剩 ${simPct(M.hp, M.max)}%）${M.hp <= 0 ? '，倒下' : ''}`);
  simSitrus(st, s, M);
  return d;
}
function simHeal(st, s, M, v, why) {
  if (M.hp <= 0 || M.hp >= M.max || v <= 0) return 0;
  const h = Math.min(M.max - M.hp, Math.max(1, Math.floor(v)));
  M.hp += h;
  simLog(st, `${simName(st, s, M)}${why} +${simPct(h, M.max)}%（${simPct(M.hp, M.max)}%）`);
  return h;
}
// 文柚果：HP 一半以下時回復 1/4（Showdown sitrusberry）
function simSitrus(st, s, M) {
  if (M.hp > 0 && M.item === 'sitrus-berry' && M.hp <= M.max / 2) { M.item = ''; simHeal(st, s, M, M.max / 4, '吃了文柚果'); }
}
// 能力變化 d：foe＝造成的一方（對手造成的才看恆淨之軀、鏡甲、不服輸、好勝）；唱反調反過來；白色香草把降低的恢復（用掉）。回傳有沒有變
function simBoost(st, s, M, d, foe) {
  if (M.hp <= 0) return false;
  let ch = Object.entries(d).map(([k, v]) => [k, M.b.ab === 'contrary' ? -v : v]);
  if (foe != null) {
    if (M.b.ab === 'clear-body') ch = ch.filter(([, v]) => v > 0);
    if (M.b.ab === 'mirror-armor') {
      const back = ch.filter(([, v]) => v < 0);
      ch = ch.filter(([, v]) => v > 0);
      if (back.length) simBoost(st, foe, simAct(st, foe), Object.fromEntries(back), s);
    }
  }
  const done = ch.map(([k, v]) => { const was = M.st[k]; M.st[k] = Math.max(-6, Math.min(6, was + v)); return [k, M.st[k] - was]; }).filter(([, v]) => v);
  if (done.length) simLog(st, `${simName(st, s, M)}${done.map(([k, v]) => `${SIM_STAT_ZH[k]} ${v > 0 ? '+' : '−'}${Math.abs(v)}`).join('、')}`);
  if (foe != null && done.some(([, v]) => v < 0)) {
    if (M.b.ab === 'defiant') simBoost(st, s, M, { atk: 2 });
    if (M.b.ab === 'competitive') simBoost(st, s, M, { spa: 2 });
  }
  if (M.item === 'white-herb' && Object.values(M.st).some(v => v < 0)) {
    Object.keys(M.st).forEach(k => { if (M.st[k] < 0) M.st[k] = 0; });
    M.item = '';
    simLog(st, `${simName(st, s, M)}用白色香草把降低的能力恢復`);
  }
  return done.length > 0;
}
// M 會不會陷入異常狀態 x（屬性、特性免疫；src＝造成的寶可夢，特性腐蝕能讓毒、鋼屬性中毒）
function simCanStatus(M, x, src) {
  const ty = simTypes(M), ab = M.b.ab;
  if (M.hp <= 0 || M.status || ab === 'purifying-salt') return false;
  if (x === 'brn') return !ty.includes('fire') && !['water-veil', 'water-bubble', 'thermal-exchange'].includes(ab);
  if (x === 'par') return !ty.includes('electric') && ab !== 'limber';
  if (x === 'slp') return !['insomnia', 'vital-spirit', 'sweet-veil'].includes(ab);
  return (!(ty.includes('poison') || ty.includes('steel')) || src?.b.ab === 'corrosion') && ab !== 'immunity';
}
// 陷入異常狀態：睡眠照冠軍版 2～3 回合（mods/champions/conditions.ts：[2, 3, 3] 抽一個，期望值模式取 3）；
// 木子果（任何異常）、零餘果（睡眠）馬上治好；特性同步把灼傷、麻痺、中毒傳回給對手。回傳成功與否
function simStatus(st, s, M, x, rnd, src) {
  if (!simCanStatus(M, x, src)) return false;
  Object.assign(M, { status: x, tox: 0, slp: x === 'slp' ? (rnd ? [2, 3, 3][Math.floor(rnd() * 3)] : 3) : 0 });
  simLog(st, `${simName(st, s, M)}陷入${SIM_STATUS_ZH[x]}狀態`);
  if (M.item === 'lum-berry' || (x === 'slp' && M.item === 'chesto-berry')) {
    simLog(st, `${simName(st, s, M)}吃了${ITEMS[M.item][0]}，治好了`);
    Object.assign(M, { status: '', item: '' });
  } else if (M.b.ab === 'synchronize' && src && src.hp > 0 && x !== 'slp') simStatus(st, 1 - s, src, x, rnd, M);
  return true;
}
// 換上第 i 隻：換下來的（還站著的）特性再生力回 1/3、自然回復治好異常（冠軍版），能力變化與換下場就清掉的狀態都清掉，
// 上一次用的招式也清掉（Showdown switchIn 對換下場的呼叫 clearVolatile，裡面 lastMove = null；所以換回來還沒出招時再來一次會失敗）；
// 換上來的：劇毒累積重算、治癒之願回滿，再踩撒菱類
// late＝出場特性（威嚇）先不發動，等雙方都換上來再一起發動（倒下後同時補位，見 simReplace）
function simSwitch(st, s, i, rnd, late = false) {
  const side = st.sd[s], O = side.mons[side.act];
  if (O.hp > 0 && O.b.ab === 'regenerator') simHeal(st, s, O, O.max / 3, '換下場時再生力');
  if (O.hp > 0 && O.b.ab === 'natural-cure') O.status = '';
  Object.assign(O, { st: SIM_ST0(), lock: '', chg: '', hide: false, rech: false, v: {}, last: '' });
  side.act = i;
  const M = side.mons[i];
  Object.assign(M, { in: st.turn, out: true, tox: 0 });
  simLog(st, `${s ? '對手' : '我方'}換上${MON[M.key].zh}（HP ${simPct(M.hp, M.max)}%）`);
  if (side.hwish && (M.hp < M.max || M.status)) {
    Object.assign(M, { hp: M.max, status: '' });
    side.hwish = false;
    simLog(st, `${simName(st, s, M)}受到治癒之願，回滿`);
  }
  const h = side.haz, ty = simTypes(M), ground = simGround(M);
  // 隱形岩：最大 HP × 岩石屬性倍率 / 8；撒菱：1～3 層 1/8、1/6、1/4；毒菱：1 層中毒、2 層劇毒，毒屬性踩到就收掉、鋼屬性沒事；黏黏網：速度 −1
  if (h.sr) simHurt(st, s, M, M.max * eff('rock', ty) / 8, '被隱形岩打到');
  if (h.spikes && ground) simHurt(st, s, M, [0, 3, 4, 6][h.spikes] * M.max / 24, '踩到撒菱');
  if (h.tspikes && ground && M.hp > 0) {
    if (ty.includes('poison')) { h.tspikes = 0; simLog(st, `${simName(st, s, M)}收掉了毒菱`); }
    else if (!ty.includes('steel')) simStatus(st, s, M, h.tspikes > 1 ? 'tox' : 'psn', rnd, null);
  }
  if (h.web && ground && M.hp > 0) simBoost(st, s, M, { spe: -1 }, 1 - s);
  if (!late) simIntimidate(st, s, M);
}
// 威嚇（出場特性）：s 這方的 M 出場時，對手場上那隻照 intimidateOn 改攻擊／特攻（同出戰選角的對位：不吃威嚇的特性不降，
// 不服輸、好勝等反而上升）；對手場上那隻倒下了就沒有作用。降了能力的帶白色香草就恢復（用掉）
function simIntimidate(st, s, M) {
  const T = simAct(st, 1 - s);
  if (M.hp <= 0 || M.b.ab !== 'intimidate' || T.hp <= 0) return;
  const e = intimidateOn(T.b.ab), who = `${simName(st, s, M)}的威嚇：${simName(st, 1 - s)}`;
  if (!e) return simLog(st, `${who}不受影響`);
  const done = [['atk', e[0]], ['spa', e[1]]].filter(([, v]) => v)
    .map(([k, v]) => { const was = T.st[k]; T.st[k] = Math.max(-6, Math.min(6, was + v)); return [k, T.st[k] - was]; }).filter(([, v]) => v);
  simLog(st, `${who}${done.map(([k, v]) => `${SIM_STAT_ZH[k]} ${v > 0 ? '+' : '−'}${Math.abs(v)}`).join('、') || '能力已經到底'}`);
  if (T.item === 'white-herb' && Object.values(T.st).some(v => v < 0)) {
    Object.keys(T.st).forEach(k => { if (T.st[k] < 0) T.st[k] = 0; });
    T.item = '';
    simLog(st, `${simName(st, 1 - s)}用白色香草把降低的能力恢復`);
  }
}
// 第 t 方被吹走（吼叫、吹飛、龍尾、巴投）換上誰：照亂數從後排抽一隻；期望值模式取後排第一隻，推演畫面指定了實際換上的（st.pin，見 simStep）就用那隻
const simPhazeTo = (st, t, rnd) => { const bench = simBench(st, t); return rnd ? bench[Math.floor(rnd() * bench.length)] : bench.includes(st.pin?.[t]) ? st.pin[t] : bench[0]; };
// 一定會失敗、或只會害到自己的輔助招（不列入選擇）：能力到頂、HP 全滿還回復、對手已經有異常／免疫、撒菱類滿層、牆還在、對手有替身而招式穿不過、
// 對手特性黃金之軀（擋輔助招）、魔法鏡（會反彈回來）、惡作劇之心的輔助招打惡屬性…
function simFutile(st, s, k) {
  const x = SIM_SUP[k];
  if (!x) return false;
  const side = st.sd[s], M = simAct(st, s), T = simAct(st, 1 - s), tSide = st.sd[1 - s], tb = T.b.ab;
  const capped = (P, d) => Object.entries(d).every(([st_, v]) => ((P.b.ab === 'contrary' ? -v : v) > 0 ? P.st[st_] >= 6 : P.st[st_] <= -6));
  if (x.tgt && (T.hp <= 0 || tb === 'good-as-gold' || (T.v.sub && !x.sub) || (M.b.ab === 'prankster' && simTypes(T).includes('dark')))) return true;
  if (x.r && tb === 'magic-bounce') return true;
  const bare = !Object.values(side.haz).some(Boolean) && !Object.values(tSide.haz).some(Boolean);
  switch (x.kind) {
    case 'boost': case 'tidy': return capped(M, x.b) && (x.kind !== 'tidy' || bare);
    case 'drum': return M.hp <= M.max / 2 || M.st.atk >= 6;
    case 'soul': return M.hp <= M.max * 33 / 100 || capped(M, x.b);
    case 'retreat': return !!M.v.trap;
    case 'curse': return simTypes(M).includes('ghost') ? T.hp <= 0 || !!T.v.curse : capped(M, { atk: 1, def: 1 });
    case 'focus': return !!M.v.focus;
    case 'charge': return !!M.v.charge;
    case 'heal': return M.hp >= M.max;
    case 'wish': return !!side.wish;
    case 'rest': return M.status === 'slp' || M.hp >= M.max || ['insomnia', 'vital-spirit'].includes(M.b.ab);
    case 'hwish': return !simBench(st, s).length;
    case 'split': return M.hp >= T.hp;
    case 'sap': return T.st.atk <= -6;
    case 'seed': return simTypes(T).includes('grass') || !!T.v.seed;
    case 'status':
      if (x.pw && (simTypes(T).includes('grass') || tb === 'overcoat')) return true;
      if (k === 'thunder-wave' && eff('electric', simTypes(T)) === 0) return true;
      return !simCanStatus(T, x.x, M) && (!x.d || capped(T, x.d));
    case 'yawn': return !simCanStatus(T, 'slp', M) || !!T.v.yawn;
    case 'hazard': return tSide.haz[x.h] >= x.max;
    case 'defog': return bare && !Object.keys(tSide.scr).length;
    case 'encore': return !T.last || !!T.v.enc || T.last === 'encore' || !T.moves.includes(T.last) || !(T.pp[T.last] > 0);
    case 'taunt': return !!T.v.taunt || tb === 'oblivious';
    case 'subst': return !!M.v.sub || M.hp <= M.max / 4;
    case 'screen': return !!side.scr[k] || (k === 'aurora-veil' && M.b.ab !== 'snow-warning');
    case 'phaze': return !simBench(st, 1 - s).length;
    case 'haze': return [M, T].every(P => Object.values(P.st).every(v => !v));
    case 'debuff': return capped(T, x.d) || tb === 'clear-body';
    case 'shot': return capped(T, x.d) && !simBench(st, s).length;
    default: return false;
  }
}
// 一方這回合能做的：招式（再來一次鎖住的那招；講究圍巾鎖住的那招（圍巾被拍落就解除，Showdown choicelock）；PP 用完的、被挑釁時的輔助招不能選；
// 擊掌奇襲、迎頭一擊要上場後第一回合；一定失敗的輔助招不列，見 simFutile）、換人（後排還站著的；背水一戰不能換）。
// 能選的招式（有 PP、沒被挑釁擋）一招都沒有時只能掙扎（或換人）；要休息的、蓄力中的只能照做、不能換人；
// 招式都會失敗又不能換人時是 none（什麼都不做）。
// 連續 SIM_IDLE 回合雙方都沒扣血也沒換人時，打不到對手場上那隻的攻擊招式不能選（不然雙方都出無效招式會原地空轉）；只剩這種招式又不能換人就照舊
const SIM_IDLE = 2;
function simOpts(ctx, st, s) {
  const M = simAct(st, s), T = simAct(st, 1 - s);
  if (M.rech) return [{ t: 'rech' }];
  if (M.chg) return [{ t: 'mv', k: M.chg }];
  const ks = M.v.enc && M.moves.includes(M.v.encK) && M.pp[M.v.encK] > 0 ? [M.v.encK] : M.lock && M.item === 'choice-scarf' ? [M.lock] : M.moves;
  const can = ks.filter(k => M.pp[k] > 0 && !(M.v.taunt && SIM_SUP[k]));
  let mv = !can.length ? [{ t: 'mv', k: SIM_STRUGGLE }]
    : can.filter(k => (!SIM_FIRST.has(k) || M.in === st.turn) && !simFutile(st, s, k)).map(k => ({ t: 'mv', k }));
  const sw = M.v.trap ? [] : simBench(st, s).map(i => ({ t: 'sw', i }));
  if (st.idle >= SIM_IDLE) {
    const hit = mv.filter(o => SIM_SUP[o.k] || o.k === SIM_STRUGGLE || simHit(ctx, st, M, T, o.k, false, true).eff);
    if (hit.length || sw.length) mv = hit;
  }
  const all = [...mv, ...sw];
  return all.length ? all : [{ t: 'none' }];
}
// s 這方的 M 用輔助招 k（SIM_SUP）；oa＝對手這回合的選擇、oWill＝對手這回合還會出招（守住類要對手還沒動才成功；再來一次、挑釁看這個）；
// bounced＝被魔法鏡反彈回來的（不再反彈、不看惡作劇之心）
function simSupport(st, s, k, oa, oWill, rnd, pick, bounced) {
  const x = SIM_SUP[k], M = simAct(st, s), T = simAct(st, 1 - s), side = st.sd[s], tSide = st.sd[1 - s];
  const me = simName(st, s), tn = simName(st, 1 - s), mz = MOVES[k][0];
  const say = t => simLog(st, `${me}用${mz}${t}`), fail = why => say(`，但失敗了（${why}）`);
  if (x.tgt && T.hp <= 0) return fail('沒有目標');
  if (x.tgt && T.hide) return fail(`${tn}${T.chg === 'dig' ? '在地底' : '消失了'}`);
  if (x.f && T.v.prot && T.v.prot !== 'kings') return say(`，被${tn}擋下`);
  if (x.r && !bounced && T.b.ab === 'magic-bounce') { say(`，被${tn}的魔法鏡反彈`); return simSupport(st, 1 - s, k, null, false, rnd, pick, true); }
  if (x.tgt && T.b.ab === 'good-as-gold') return fail(`${tn}的黃金之軀`);
  if (x.tgt && !bounced && M.b.ab === 'prankster' && simTypes(T).includes('dark')) return fail('惡屬性不受惡作劇之心的招式影響');
  if (x.tgt && T.v.sub && !x.sub) return fail(`${tn}有替身`);
  const herb = () => { if (T.item === 'mental-herb') { delete T.v.taunt; delete T.v.enc; delete T.v.encK; T.item = ''; simLog(st, `${tn}用心靈香草解除了`); } };
  switch (x.kind) {
    case 'boost': case 'charge': case 'focus':
      if (simFutile(st, s, k)) return fail('沒有效果');
      say('');
      if (x.kind === 'charge') M.v.charge = true;
      if (x.kind === 'focus') M.v.focus = true;
      if (x.b) simBoost(st, s, M, x.b);
      return;
    case 'drum': case 'soul': case 'retreat':
      if (simFutile(st, s, k)) return fail('HP 不夠或能力已經到頂');
      say('');
      if (x.kind === 'retreat') M.v.trap = true;
      else simHurt(st, s, M, x.kind === 'drum' ? M.max / 2 : M.max * 33 / 100, '削減自己的 HP', false);
      simBoost(st, s, M, x.b);
      return;
    case 'curse':
      if (!simTypes(M).includes('ghost')) { say(''); simBoost(st, s, M, { spe: -1, atk: 1, def: 1 }); return; }
      if (T.hp <= 0 || T.v.curse) return fail('對手已經被詛咒');
      say('');
      T.v.curse = true;
      simHurt(st, s, M, M.max / 2, '削減自己的 HP', false);
      return;
    case 'tidy':
      say('');
      st.sd.forEach(sd => { Object.keys(sd.haz).forEach(h => { sd.haz[h] = 0; }); simAct(st, st.sd.indexOf(sd)).v.sub = 0; });
      simBoost(st, s, M, x.b);
      return;
    case 'prot': {
      // Showdown stall：第一次必定成功，連續使用成功率 1/3、1/9…（期望值模式當失敗）；自己是這回合最後行動的會失敗（queue.willAct）
      const ok = oWill && (!M.v.stall || (!!rnd && rnd() < 1 / M.v.stall));
      if (!ok) { delete M.v.stall; return fail(oWill ? '連續使用' : '對手已經行動'); }
      M.v.stall = M.v.stall ? M.v.stall * 3 : 3;
      M.v.protUsed = true;
      if (x.how === 'endure') M.v.endure = true; else M.v.prot = x.how;
      return say('');
    }
    case 'heal':
      if (M.hp >= M.max) return fail('HP 已經全滿');
      say('');
      simHeal(st, s, M, Math.round(M.max / 2), '回復');
      return;
    case 'wish':
      if (side.wish) return fail('已經在祈願');
      side.wish = { t: 2, hp: Math.floor(M.max / 2) };
      return say('：下一回合結束時回復');
    case 'rest':
      if (simFutile(st, s, k)) return fail('HP 全滿或已經睡著');
      Object.assign(M, { status: 'slp', slp: 3, tox: 0, hp: M.max });
      say('：HP 回滿、睡著了');
      if (M.item === 'lum-berry' || M.item === 'chesto-berry') { simLog(st, `${me}吃了${ITEMS[M.item][0]}，醒來了`); Object.assign(M, { status: '', item: '' }); }
      return;
    case 'hwish':
      if (!simBench(st, s).length) return fail('沒有可以換上的');
      say('：自己倒下，換上來的會回滿');
      M.hp = 0;
      simFaint(st, M);
      side.hwish = true;
      return;
    case 'split': {
      const avg = Math.floor((T.hp + M.hp) / 2) || 1;
      say(`：雙方 HP 平分（${tn} ${simPct(T.hp, T.max)}%→${simPct(Math.min(avg, T.max), T.max)}%、自己 ${simPct(M.hp, M.max)}%→${simPct(Math.min(avg, M.max), M.max)}%）`);
      T.hp = Math.min(avg, T.max);
      M.hp = Math.min(avg, M.max);
      return;
    }
    case 'sap': {
      if (T.st.atk <= -6) return fail('對手攻擊已經最低');
      // 回復量＝對手含能力變化的攻擊能力值（Showdown getStat('atk', false, true)）
      const [sp, nat] = invAt(T.b, 1, T.b.atkInv), atk = stageStat(statOf(MON[T.key].bs[1], sp, 1, nat), T.st.atk);
      say('');
      simHeal(st, s, M, M.item === 'big-root' ? pokeRound(atk * 5324 / 4096) : atk, '吸取力量');
      simBoost(st, 1 - s, T, { atk: -1 }, s);
      return;
    }
    case 'seed':
      if (simTypes(T).includes('grass') || T.v.seed) return fail('沒有效果');
      T.v.seed = true;
      return say(`：${tn}被種下種子`);
    case 'status':
      if (x.pw && (simTypes(T).includes('grass') || T.b.ab === 'overcoat')) return fail('沒有效果');
      if (k === 'thunder-wave' && eff('electric', simTypes(T)) === 0) return fail('沒有效果');
      say('');
      if (!simStatus(st, 1 - s, T, x.x, rnd, M) && !x.d) simLog(st, `${tn}沒有陷入${SIM_STATUS_ZH[x.x]}狀態`);
      if (x.d) simBoost(st, 1 - s, T, x.d, s);
      return;
    case 'yawn':
      if (!simCanStatus(T, 'slp', M) || T.v.yawn) return fail('沒有效果');
      T.v.yawn = 2;
      return say(`：${tn}打起瞌睡，下一回合結束會睡著`);
    case 'hazard':
      if (tSide.haz[x.h] >= x.max) return fail('已經撒滿了');
      tSide.haz[x.h]++;
      return say(`：在${s ? '我方' : '對手'}場地撒下${SIM_HAZ_ZH[x.h]}${x.max > 1 ? `（${tSide.haz[x.h]} 層）` : ''}`);
    case 'defog':
      st.sd.forEach(sd => Object.keys(sd.haz).forEach(h => { sd.haz[h] = 0; }));
      tSide.scr = {};
      return say('：清掉雙方的撒菱類和對手的牆');
    case 'encore':
      if (simFutile(st, s, k)) return fail('沒有可以重複的招式');
      Object.assign(T.v, { enc: 3, encK: T.last });
      if (oWill && oa?.t === 'mv') oa.k = T.last; else T.v.enc++;
      say(`：${tn}只能用${MOVES[T.last][0]}`);
      return herb();
    case 'taunt':
      if (T.v.taunt || T.b.ab === 'oblivious') return fail('沒有效果');
      T.v.taunt = oWill ? 3 : 4;
      say(`：${tn}不能用輔助招`);
      return herb();
    case 'subst':
      if (M.v.sub || M.hp <= M.max / 4) return fail('已經有替身或 HP 不夠');
      M.hp -= Math.floor(M.max / 4);
      M.v.sub = Math.floor(M.max / 4);
      return say(`：做出替身（剩 ${simPct(M.hp, M.max)}%）`);
    case 'screen':
      if (simFutile(st, s, k)) return fail(k === 'aurora-veil' && !side.scr[k] ? '沒有下雪' : '已經有了');
      side.scr[k] = M.item === 'light-clay' ? 8 : 5;
      return say(`：${side.scr[k]} 回合`);
    case 'phaze': {
      const bench = simBench(st, 1 - s);
      if (!bench.length) return fail('對手沒有可以換的');
      say('');
      simSwitch(st, 1 - s, simPhazeTo(st, 1 - s, rnd), rnd);
      return;
    }
    case 'haze':
      say('：雙方能力變化歸零');
      [M, T].forEach(P => { P.st = SIM_ST0(); });
      return;
    case 'debuff':
      say('');
      if (!simBoost(st, 1 - s, T, x.d, s)) simLog(st, `${tn}的能力沒有變化`);
      return;
    case 'shot': {
      say('');
      const ok = simBoost(st, 1 - s, T, x.d, s) || T.b.ab === 'mirror-armor';
      if (ok && M.hp > 0 && simBench(st, s).length && !simOver(st)) simSwitch(st, s, pick(st, s), rnd);
      return;
    }
    case 'memento':
      say('：自己倒下');
      simBoost(st, 1 - s, T, x.d, s);
      M.hp = 0;
      simFaint(st, M);
      return;
  }
}
// 被守住類擋下的接觸招式：王者盾牌攻擊 −1、尖刺防守扣 1/8、碉堡中毒（Showdown kingsshield／spikyshield／banefulbunker）
function simProtHit(st, s, M, T, rnd) {
  if (T.v.prot === 'kings') simBoost(st, s, M, { atk: -1 }, 1 - s);
  if (T.v.prot === 'spiky') simHurt(st, s, M, M.max / 8, '被尖刺防守刺傷');
  if (T.v.prot === 'bunker') simStatus(st, s, M, 'psn', rnd, T);
}
// 掙扎（傷害見 simStruggleDmg）：接觸招式，會被守住類擋、打在替身上、被氣勢披帶／結實／挺住撐住，接觸懲罰照算；最後自己扣 1/4
function simStruggle(st, s, M, T, rnd) {
  const me = simName(st, s), tn = simName(st, 1 - s);
  if (T.hp <= 0) simLog(st, `${me}用掙扎，但沒有目標`);
  else if (T.hide) simLog(st, `${me}用掙扎，但打不到`);
  else if (T.v.prot) { simLog(st, `${me}用掙扎，被${tn}擋下`); simProtHit(st, s, M, T, rnd); }
  else if (T.v.sub > 0) {
    T.v.sub -= Math.min(simStruggleDmg(st, M, T, rnd), T.v.sub);
    simLog(st, `${me}用掙扎 → 打在${tn}的替身上${T.v.sub <= 0 ? '，替身消失了' : ''}`);
    if (T.v.sub <= 0) delete T.v.sub;
  } else {
    let d = simStruggleDmg(st, M, T, rnd), held = '';
    if (d >= T.hp && T.hp >= T.max && (T.item === 'focus-sash' || T.b.ab === 'sturdy')) { d = T.hp - 1; held = T.item === 'focus-sash' ? ITEMS[T.item][0] : abilZh('sturdy'); if (T.item === 'focus-sash') T.item = ''; }
    else if (T.v.endure && d >= T.hp) { d = T.hp - 1; held = '挺住'; }
    const dd = Math.min(d, T.hp);
    T.hp -= dd;
    simFaint(st, T);
    if (dd > 0) T.v.got = { turn: st.turn, cat: 'physical', dmg: dd };
    const pop = T.item === 'air-balloon' && d > 0;
    if (pop) T.item = '';
    simLog(st, `${me}用掙扎 → ${tn} −${simPct(d, T.max)}%（剩 ${simPct(T.hp, T.max)}%）${held ? `，靠${held}撐住` : ''}${pop ? '，氣球破了' : ''}${T.hp <= 0 ? `，${tn}倒下` : ''}`);
    if (T.hp <= 0) M.kos++;
    if (T.item === 'rocky-helmet') simHurt(st, s, M, M.max / 6, '被凸凸頭盔刺傷');
    if (T.b.ab === 'rough-skin') simHurt(st, s, M, M.max / 8, '被粗糙皮膚刺傷');
    simSitrus(st, 1 - s, T);
  }
  simHurt(st, s, M, Math.round(M.max / 4), '受到掙扎的反作用力', false);
}
// s 這方的 M 用招式 k 打對手場上那隻；oa＝對手這回合的選擇、oWill＝對手這回合還會出招（突襲、快手還擊、守住類、再來一次看這個）；
// rnd 亂數（null＝期望值：傷害取平均、不會急所、麻痺不會不能動）；pick(st, s) 打完換人、被吹走時換上誰
function simMove(ctx, st, s, k, oa, oWill, rnd, pick) {
  const M = simAct(st, s), me = simName(st, s), mz = simMoveZh(k);
  if (M.status === 'slp') {
    M.slp -= M.b.ab === 'early-bird' ? 2 : 1;
    if (M.slp > 0) return simLog(st, `${me}睡著了`);
    M.status = '';
    simLog(st, `${me}醒來了`);
  }
  // 麻痺：冠軍版 1/8 不能動（mods/champions/conditions.ts）
  if (M.status === 'par' && rnd && rnd() < 1 / 8) return simLog(st, `${me}麻痺了，不能動`);
  if (M.v.taunt && SIM_SUP[k]) return simLog(st, `${me}被挑釁，不能用${mz}`);
  const T = simAct(st, 1 - s), tn = simName(st, 1 - s);
  M.last = k;
  if (k === SIM_STRUGGLE) return simStruggle(st, s, M, T, rnd);
  // PP：出招就扣 1（失敗也扣；睡著、麻痺不能動、被挑釁擋下的不扣；蓄力招第二回合不扣）；對手特性壓迫感、而且這招是打對手的（攻擊招式、
  // 打對手的輔助招、撒菱類）多扣 1（Showdown deductPP、pressure onDeductPP）
  if (M.chg !== k) {
    const foe = !SIM_SUP[k] || SIM_SUP[k].tgt || ['hazard', 'defog'].includes(SIM_SUP[k].kind);
    M.pp[k] = Math.max(0, M.pp[k] - 1 - (foe && T.hp > 0 && T.b.ab === 'pressure' ? 1 : 0));
  }
  if (M.item === 'choice-scarf' && !M.lock) M.lock = k;
  if (SIM_SUP[k]) return simSupport(st, s, k, oa, oWill, rnd, pick, false);
  if (SIM_CHARGE.has(k) && M.chg !== k) {
    Object.assign(M, { chg: k, hide: SIM_HIDE.has(k) });
    simLog(st, `${me}用${mz}：蓄力，下一回合才攻擊`);
    if (k === 'electro-shot') simBoost(st, s, M, { spa: 1 });
    return;
  }
  Object.assign(M, { chg: '', hide: false });
  const fail = why => simLog(st, `${me}用${mz}，但失敗了（${why}）`);
  if (k === 'sucker-punch' && (!oWill || simCat(oa.k) === 'status')) return fail('對手沒有要出攻擊招式');
  if (k === 'upper-hand' && (!oWill || simCat(oa.k) === 'status' || simPri(T, oa.k) <= 0)) return fail('對手沒有要出先制招式');
  if (k === 'future-sight') {
    if (st.fut.some(f => f.s === 1 - s)) return fail('已經在預知未來');
    st.fut.push({ s: 1 - s, t: 3, src: simCloneMon(M) });
    simLog(st, `${me}用${mz}：兩回合後打中`);
    return;
  }
  // 自爆類：先倒下才打（Showdown selfdestruct always 在出招前 faint），同時全倒時算對手最後倒下
  if (SIM_BOOM.has(k)) { M.hp = 0; simFaint(st, M); }
  const contact = FLAG.contact.has(k) && M.b.ab !== 'long-reach';
  let dealt = -1;
  if (T.hp <= 0) fail('沒有目標');
  else if (T.hide) simLog(st, `${me}用${mz}，但打不到（${tn}${T.chg === 'dig' ? '在地底' : '消失了'}）`);
  else if (T.v.prot && k !== 'phantom-force' && k !== 'feint') {
    simLog(st, `${me}用${mz}，被${tn}擋下`);
    if (contact) simProtHit(st, s, M, T, rnd);
  } else {
    if (T.v.prot) { delete T.v.prot; simLog(st, `${me}的${mz}打破了守住`); }
    let r = simHit(ctx, st, M, T, k, false, false);
    if (!r.eff) r.fail ? fail(r.fail) : simLog(st, `${me}用${mz}，對${tn}沒有效果`);
    else {
      const rank = SIM_HICRIT.has(k) + (M.b.ab === 'super-luck') + (M.item === 'scope-lens') + (M.v.focus ? 2 : 0);
      if (!r.fixed && !r.crit && rnd && rnd() < SIM_CRIT_P[Math.min(3, rank)]) r = simCalc(ctx, st, M, T, k, true);
      // 寶石：這招屬性的寶石打出去就用掉（只加成一次）
      const gem = DMG_ITEMS[M.item]?.gem && DMG_ITEMS[M.item].type === r.type ? M.item : '';
      let dmg = simRolls(r, T, k).reduce((t, xs) => t + (rnd ? xs[Math.floor(rnd() * 16)] : xs.reduce((a, x) => a + x, 0) / 16), 0), held = '';
      // 替身：聲音招式、特性穿透打得穿；打在替身上的不會有接觸懲罰、拍落、強制換人
      const subbed = T.v.sub > 0 && !FLAG.sound.has(k) && M.b.ab !== 'infiltrator';
      if (subbed) {
        dealt = Math.min(dmg, T.v.sub);
        T.v.sub -= dealt;
        simLog(st, `${me}用${mz}${r.crit ? '（急所）' : ''} → 打在${tn}的替身上${T.v.sub <= 0 ? '，替身消失了' : ''}`);
        if (T.v.sub <= 0) delete T.v.sub;
      } else {
        if (r.endured && T.hp >= T.max && dmg >= T.hp) {
          dmg = T.hp - 1;
          held = r.endured === 'sturdy' ? abilZh('sturdy') : ITEMS[r.endured][0];
          if (r.endured === T.item) T.item = '';
        } else if (T.v.endure && dmg >= T.hp) { dmg = T.hp - 1; held = '挺住'; }
        dealt = Math.min(dmg, T.hp);
        T.hp -= dealt;
        simFaint(st, T);
        // 這回合被打的傷害（反擊類用）；抗性樹果用掉；氣球被打中就破；拍落打掉道具
        if (dealt > 0) T.v.got = { turn: st.turn, cat: simCat(k), dmg: dealt };
        if (r.berry) T.item = '';
        const pop = T.item === 'air-balloon' && dealt > 0;
        if (pop || (k === 'knock-off' && T.item && !MON[T.key].base && T.b.ab !== 'sticky-hold' && M.hp > 0)) T.item = '';
        simLog(st, `${me}用${mz}${r.crit ? '（急所）' : ''} → ${tn} −${simPct(dealt, T.max)}%（剩 ${simPct(T.hp, T.max)}%）`
          + (held ? `，靠${held}撐住` : '') + (pop ? '，氣球破了' : '') + (T.hp <= 0 ? `，${tn}倒下` : ''));
        if (T.hp <= 0) M.kos++;
      }
      if (gem) { M.item = ''; simLog(st, `${me}的${ITEMS[gem][0]}用掉了`); }
      // 搏命：打完自己倒下
      if (k === 'final-gambit' && M.hp > 0) { M.hp = 0; simFaint(st, M); simLog(st, `${me}倒下`); }
      // 吸血在扣血當下（Showdown spreadDamage），接觸懲罰在那之後
      const dr = SIM_DRAIN[k], rc = SIM_RECOIL[k];
      if (dr && dealt > 0) { const v = Math.max(1, Math.round(dealt * dr[0] / dr[1])); simHeal(st, s, M, M.item === 'big-root' ? pokeRound(v * 5324 / 4096) : v, '吸取'); }
      if (!subbed) {
        // 接觸懲罰：凸凸頭盔扣 1/6、粗糙皮膚扣 1/8（Showdown rockyhelmet／roughskin，打倒也算）
        if (contact && T.item === 'rocky-helmet') simHurt(st, s, M, M.max / 6, '被凸凸頭盔刺傷');
        if (contact && T.b.ab === 'rough-skin') simHurt(st, s, M, M.max / 8, '被粗糙皮膚刺傷');
        simSitrus(st, 1 - s, T);
      }
      if (M.item === 'shell-bell' && dealt > 0) simHeal(st, s, M, dealt / 8, '貝殼之鈴');
      if (rc && dealt > 0 && M.b.ab !== 'rock-head') simHurt(st, s, M, Math.max(1, Math.round(dealt * rc[0] / rc[1])), '受到反作用力');
      // 生命寶珠：每次攻擊扣最大 HP 的 1/10（Showdown lifeorb）
      if (M.item === 'life-orb' && dealt > 0) simHurt(st, s, M, M.max / 10, '生命寶珠');
      if (M.hp > 0 && SIM_SELF[k]) simBoost(st, s, M, SIM_SELF[k]);
      if (M.hp > 0 && k === 'fell-stinger' && T.hp <= 0) simBoost(st, s, M, { atk: 3 });
      if (SIM_RECHARGE.has(k)) M.rech = true;
      if (SIM_SPIN.has(k) && M.hp > 0) {
        if (k === 'mortal-spin' && !subbed) simStatus(st, 1 - s, T, 'psn', rnd, M);
        if (Object.values(st.sd[s].haz).some(Boolean)) { Object.keys(st.sd[s].haz).forEach(h => { st.sd[s].haz[h] = 0; }); simLog(st, `${me}清掉了自己場地的撒菱類`); }
        delete M.v.seed;
      }
      if (MOVES[k][1] === 'electric') delete M.v.charge;
      if (SIM_PHAZE.has(k) && !subbed && T.hp > 0 && simBench(st, 1 - s).length && !simOver(st)) simSwitch(st, 1 - s, simPhazeTo(st, 1 - s, rnd), rnd);
    }
  }
  if (k === 'steel-beam' && M.hp > 0) simHurt(st, s, M, Math.round(M.max / 2), '自己受到傷害', false);
  if (M.hp <= 0 && SIM_BOOM.has(k)) { M.hp = 0; simLog(st, `${me}倒下`); }
  if (SIM_PIVOT.has(k) && dealt >= 0 && M.hp > 0 && !simOver(st) && simBench(st, s).length) simSwitch(st, s, pick(st, s), rnd);
}
// 回合結束（Showdown onResidualOrder 的順序）：預知未來、祈願、蛻皮、吃剩的東西、寄生種子、中毒、灼傷、詛咒、挑釁／再來一次／哈欠倒數、牆倒數；
// 守住類這回合沒用的連續計數歸零。殘血傷害照 Showdown：灼傷 1/16、中毒 1/8、劇毒 n/16（換下場重算、最多 15/16）、寄生種子 1/8、詛咒 1/4，
// 特性魔法防守不受、毒療改成回 1/8
function simEnd(ctx, st, rnd) {
  st.fut.forEach(f => {
    if (--f.t || simOver(st)) return;
    const T = simAct(st, f.s);
    if (T.hp <= 0) return;
    const r = simCalc(ctx, st, f.src, T, 'future-sight', false);
    if (!r.eff) return;
    const d = Math.min(T.hp, r.rolls.reduce((t, xs) => t + (rnd ? xs[Math.floor(rnd() * 16)] : xs.reduce((a, x) => a + x, 0) / 16), 0));
    T.hp -= d;
    simFaint(st, T);
    simLog(st, `預知未來打中${simName(st, f.s)} −${simPct(d, T.max)}%（剩 ${simPct(T.hp, T.max)}%）${T.hp <= 0 ? '，倒下' : ''}`);
    simSitrus(st, f.s, T);
  });
  st.fut = st.fut.filter(f => f.t > 0);
  st.sd.forEach((side, s) => {
    if (!side.wish || --side.wish.t) return;
    simHeal(st, s, simAct(st, s), side.wish.hp, '祈願實現');
    side.wish = null;
  });
  const each = f => [0, 1].forEach(s => { const M = simAct(st, s); if (M.hp > 0 && !simOver(st)) f(M, s); });
  each((M, s) => { if (M.b.ab === 'shed-skin' && M.status && rnd && rnd() < 0.33) { M.status = ''; simLog(st, `${simName(st, s)}靠蛻皮治好了`); } });
  each((M, s) => { if (M.item === 'leftovers') simHeal(st, s, M, M.max / 16, '吃剩的東西'); });
  each((M, s) => {
    const O = simAct(st, 1 - s);
    if (!M.v.seed || O.hp <= 0) return;
    const d = simHurt(st, s, M, M.max / 8, '被寄生種子吸取');
    if (d) simHeal(st, 1 - s, O, O.item === 'big-root' ? pokeRound(d * 5324 / 4096) : d, '寄生種子');
  });
  each((M, s) => {
    if (M.status !== 'psn' && M.status !== 'tox') return;
    if (M.status === 'tox') M.tox = Math.min(15, M.tox + 1);
    if (M.b.ab === 'poison-heal') simHeal(st, s, M, M.max / 8, '毒療');
    else simHurt(st, s, M, M.status === 'tox' ? Math.max(1, Math.floor(M.max / 16)) * M.tox : M.max / 8, '受到毒的傷害');
  });
  each((M, s) => { if (M.status === 'brn') simHurt(st, s, M, M.max / 16, '受到灼傷的傷害'); });
  each((M, s) => { if (M.v.curse) simHurt(st, s, M, M.max / 4, '受到詛咒'); });
  each((M, s) => {
    if (M.v.taunt && !--M.v.taunt) delete M.v.taunt;
    if (M.v.enc && (!--M.v.enc || !(M.pp[M.v.encK] > 0))) { delete M.v.enc; delete M.v.encK; }
    if (M.v.yawn && !--M.v.yawn) { delete M.v.yawn; simStatus(st, s, M, 'slp', rnd, null); }
  });
  st.sd.forEach(side => Object.keys(side.scr).forEach(w => { if (!--side.scr[w]) delete side.scr[w]; }));
  st.sd.forEach(side => side.mons.forEach(m => {
    delete m.v.prot; delete m.v.endure;
    if (!m.v.protUsed) delete m.v.stall;
    delete m.v.protUsed;
  }));
}
// 一回合：acts[s] 是雙方的選擇（simOpts 的一項；會複製一份，再來一次改對手的招式不影響呼叫端）。先換人，再依先制等級、速度出招
// （同速：有 rnd 抽，沒有看 tie 誰先），最後回合結束（simEnd）。倒下的補位不在這裡（見 simReplace／simPlay）。
// idle＝連續幾回合雙方都沒扣血也沒換人（見 simOpts）。回傳這回合有沒有同速決定先後
function simTurn(ctx, st, acts0, rnd, tie, pick) {
  const snap = () => JSON.stringify(st.sd.map(x => [x.act, x.mons.map(m => m.hp)])), was = snap(), acts = acts0.map(a => ({ ...a }));
  st.turn++;
  if (st.log) st.log.push(`第 ${st.turn} 回合`);
  [0, 1].forEach(s => { if (acts[s].t === 'sw') simSwitch(st, s, acts[s].i, rnd); });
  [0, 1].forEach(s => {
    if (acts[s].t !== 'rech') return;
    simAct(st, s).rech = false;
    simLog(st, `${simName(st, s)}要休息一回合`);
  });
  const start = st.sd.map(x => x.act), mv = [0, 1].filter(s => acts[s].t === 'mv' && simAct(st, s).hp > 0);
  let order = mv, tied = false;
  if (mv.length === 2) {
    const pri = mv.map(s => simPri(simAct(st, s), acts[s].k)), spd = mv.map(s => simSpeed(ctx, simAct(st, s)));
    const first = pri[0] !== pri[1] ? (pri[0] > pri[1] ? 0 : 1) : spd[0] !== spd[1] ? (spd[0] > spd[1] ? 0 : 1)
      : (tied = true, rnd ? (rnd() < 0.5 ? 0 : 1) : tie);
    order = [first, 1 - first];
  }
  const done = [false, false];
  order.forEach(s => {
    if (simOver(st) || st.sd[s].act !== start[s] || simAct(st, s).hp <= 0) return;
    const o = 1 - s, oWill = !done[o] && acts[o].t === 'mv' && st.sd[o].act === start[o] && simAct(st, o).hp > 0;
    simMove(ctx, st, s, acts[s].k, acts[o], oWill, rnd, pick);
    done[s] = true;
  });
  if (!simOver(st)) simEnd(ctx, st, rnd);
  st.idle = was === snap() ? (st.idle || 0) + 1 : 0;
  return tied;
}
// 局面對我方（第 0 方）的分數：分出勝負（simWinner）＝±1，再加上贏的一方剩下 HP 比例的一半；還沒分出勝負＝雙方剩下 HP 比例差的一半
function simValue(st) {
  const frac = s => st.sd[s].mons.reduce((t, m) => t + Math.max(0, m.hp) / m.max, 0) / st.sd[s].mons.length;
  const [a, b] = [frac(0), frac(1)], w = simWinner(st);
  return w === 0 ? 1 + a / 2 : w === 1 ? -1 - b / 2 : (a - b) / 2;
}
// ---------- 簡單規則（往前算之後的局面用） ----------
// 出招：攻擊招式看期望傷害（打不倒時佔對方最大 HP 的比例），打得倒的再加 1、用先制打得倒的再加 0.5；要蓄力、要休息的打不倒時只算一半；
// 自爆類扣掉自己剩下的 HP（打不倒再扣 1）；快手還擊不預判（算 0）；對手有替身時只算打替身的一半。輔助招見 simGreedySup。
// 只有招式都沒用（如講究圍巾鎖在對方免疫的招式）時才換人
function simGreedyAct(ctx, st, s) {
  const opts = simOpts(ctx, st, s), mv = opts.filter(o => o.t === 'mv'), sw = () => ({ t: 'sw', i: simGreedyPick(ctx, st, s) });
  if (!mv.length) return opts[0].t === 'sw' ? sw() : opts[0];
  const M = simAct(st, s), T = simAct(st, 1 - s);
  const dt = Math.max(0, ...T.moves.map(k => simExp(ctx, st, T, M, k))), dm = Math.max(0, ...M.moves.map(k => simExp(ctx, st, M, T, k)));
  let best = mv[0], bv = -Infinity;
  mv.forEach(o => {
    const k = o.k;
    let v;
    if (SIM_SUP[k]) v = simGreedySup(st, s, M, T, k, dt, dm);
    else {
      const e = k === 'upper-hand' ? 0 : simExp(ctx, st, M, T, k), sub = T.v.sub > 0 && !FLAG.sound.has(k) && M.b.ab !== 'infiltrator', ko = !sub && e >= T.hp;
      v = sub ? Math.min(e, T.v.sub) / T.max / 2 : Math.min(e, T.hp) / T.max + (ko ? 1 + (simPri(M, k) > 0 ? 0.5 : 0) : 0);
      if (!ko && ((SIM_CHARGE.has(k) && M.chg !== k) || SIM_RECHARGE.has(k))) v /= 2;
      if (SIM_BOOM.has(k)) v -= M.hp / M.max + (ko ? 0 : 1);
    }
    if (v > bv) { bv = v; best = o; }
  });
  return bv <= 0 && opts.some(o => o.t === 'sw') ? sw() : best;
}
// 簡單規則的輔助招（一定失敗的已經不在選項裡）：打得倒對手就不用；dt＝對手對我最痛一招的期望傷害、dm＝我對對手最痛一招的期望傷害。
// 強化攻擊／特攻／速度：對手打我不到剩下 HP 的 35%、自己還沒強化超過 +3 時 0.6（只強化防禦的 0.3）；回復：HP 一半以下、對手一下打不掉一半時 0.7；
// 祈願：HP 六成以下 0.4；異常、哈欠、寄生種子：我兩下打不倒對手時 0.5（睡眠類 0.65、寄生 0.4）；撒菱類：對手還有後排、我不怕被打時 0.45；
// 牆：對手打得痛（兩成以上）時 0.4；吼叫、黑霧：對手強化合計 +2 以上時 0.8；其他 0（只有往前算一回合時才會選）
function simGreedySup(st, s, M, T, k, dt, dm) {
  const x = SIM_SUP[k], safe = dt < M.hp * 0.35;
  if (dm >= T.hp) return 0;
  switch (x.kind) {
    case 'boost': case 'soul': case 'retreat': case 'drum': {
      const off = Object.entries(x.b).some(([st_, v]) => v > 0 && st_ !== 'def' && st_ !== 'spd');
      return !safe || M.st.atk + M.st.spa + M.st.spe > 3 ? 0 : off ? 0.6 : 0.3;
    }
    case 'heal': case 'rest': return M.hp / M.max < 0.5 && dt < M.max / 2 ? 0.7 : 0;
    case 'wish': return M.hp / M.max < 0.6 ? 0.4 : 0;
    case 'status': case 'yawn': return dm * 2 < T.hp ? (x.x === 'slp' || x.kind === 'yawn' ? 0.65 : 0.5) : 0;
    case 'seed': return dm * 2 < T.hp ? 0.4 : 0;
    case 'hazard': return simBench(st, 1 - s).length && safe ? 0.45 : 0;
    case 'screen': return dt > M.max * 0.2 ? 0.4 : 0;
    case 'phaze': case 'haze': return T.st.atk + T.st.spa + T.st.spe >= 2 ? 0.8 : 0;
    default: return 0;
  }
}
// 補位、打完換人：後排每隻和對手場上那隻一對一（雙方最痛一招的期望傷害、速度）：打得贏的優先、再比打完剩下的 HP；
// 打不贏的比倒下前能打掉對方多少。對手場上那隻也倒了就挑剩下 HP 比例最高的
function simGreedyPick(ctx, st, s) {
  const bench = simBench(st, s), T = simAct(st, 1 - s);
  if (bench.length < 2) return bench[0];
  const score = i => {
    const M = st.sd[s].mons[i];
    if (T.hp <= 0) return M.hp / M.max;
    const dm = Math.max(0, ...M.moves.map(k => simExp(ctx, st, M, T, k))), dt = Math.max(0, ...T.moves.map(k => simExp(ctx, st, T, M, k)));
    const n1 = dm ? Math.ceil(T.hp / dm) : Infinity, n2 = dt ? Math.ceil(M.hp / dt) : Infinity, fast = simSpeed(ctx, M) > simSpeed(ctx, T);
    if (n1 < n2 || (n1 === n2 && fast && n1 < Infinity)) return 2 + Math.max(0, M.hp - dt * (fast ? n1 - 1 : n1)) / M.max;
    return Math.min(1, dm * (n2 === Infinity ? 9 : n2) / T.hp);
  };
  return bench.map(i => [i, score(i)]).sort((x, y) => y[1] - x[1])[0][0];
}
// 倒下的補位（兩方都倒時都換）：picks[s] 是 { t: 'sw', i } 或 { t: 'pass' }；雙方都換上來後才發動威嚇（兩邊同時補位時互相都吃得到）
function simReplace(st, picks, rnd) {
  const sw = [0, 1].filter(s => picks[s].t === 'sw');
  sw.forEach(s => simSwitch(st, s, picks[s].i, rnd, true));
  sw.forEach(s => simIntimidate(st, s, simAct(st, s)));
}
// 從局面 st 用簡單規則雙方打下去（最多再 SIM_LOOK 回合），回傳 simValue；rnd＝照亂數打（樹搜尋用），沒給用期望值。
// 補位換上來又被撒菱類打倒的再補（補到有人站著才開打）；期望值打時同速輪流誰先：每次打下去換一邊起頭（ctx.flip）、之後每回合再輪流
// （不然一律我方先，評估會偏向我方；只看回合單雙也不行，樹搜尋往下打大多從同一個回合開始，會固定偏向一方）
function simRollout(ctx, st, rnd = null) {
  const end = st.turn + SIM_LOOK, pick = (c, s) => simGreedyPick(ctx, c, s), f = ctx.flip = (ctx.flip || 0) ^ 1;
  while (!simOver(st) && st.turn < end) {
    while (!simOver(st) && (simNeed(st, 0) || simNeed(st, 1))) simReplace(st, [0, 1].map(s => simNeed(st, s) ? { t: 'sw', i: pick(st, s) } : { t: 'pass' }), rnd);
    if (simOver(st)) break;
    simTurn(ctx, st, [0, 1].map(s => simGreedyAct(ctx, st, s)), rnd, (st.turn + f) & 1, pick);
  }
  return simValue(st);
}
// 這個階段一方能做的：phase 'turn' 是 simOpts；'replace'（有人倒下要補位）是倒下那方的後排，另一方 pass
const simPhaseOpts = (ctx, st, s, phase) => phase === 'turn' ? simOpts(ctx, st, s) : simNeed(st, s) ? simBench(st, s).map(i => ({ t: 'sw', i })) : [{ t: 'pass' }];
// ---------- 樹搜尋（往下打到分出勝負） ----------
// 雙方同時出招的蒙地卡羅樹搜尋（decoupled UCT、開放迴圈）：每次從目前局面複製一份沿樹往下，每一層雙方各自用 UCB1 挑選擇
// （平均分數 + SIM_UCB_C × √(ln 這層次數 ÷ 這個選擇的次數)，沒試過的先試），照亂數打這一回合（或補位）；走到樹上沒有的局面就新增一層，
// 再用簡單規則以期望值打到分出勝負（最多 SIM_LOOK 回合；用亂數打雜訊太大），把分數（simValue 換成 0～1；對手用 1 減它）加回路上每一層雙方選的選擇。
// 傷害亂數、急所、麻痺等在樹裡每次重抽，同一層對應的局面每次可能不同（開放迴圈），所以每層只記「選擇 → 次數、總分」，能選的選擇每次重算。
// iters 次後用根節點上「我方出 X、對手出 Y」各組合的平均分數解混合策略（simMix），雙方照比例抽一種（沒給 rnd 取機率最高的）。
// 比較（2026-11-11，隨機兩隊各打兩場交換決策方式）：照被試次數決定出招、或打到底也用亂數時，和往前算一回合差不多強；
// 改成上面的做法後，每步 200／400／800 次對往前算一回合的勝率 57.5%（80 場）／60%（100 場）／68.7%（99 場分出勝負）
const SIM_UCB_C = 0.7;
const simKey = o => o.t === 'mv' ? o.k : o.t === 'sw' ? 'sw' + o.i : o.t;
const simNode = () => ({ n: 0, s: [new Map(), new Map()], ch: new Map(), j: new Map() });
function simUcb(nd, s, opts) {
  const ln = Math.log(Math.max(1, nd.n));
  let best = opts[0], bv = -Infinity;
  for (const o of opts) {
    const e = nd.s[s].get(simKey(o));
    if (!e) return o;
    const v = e.w / e.n + SIM_UCB_C * Math.sqrt(ln / e.n);
    if (v > bv) { bv = v; best = o; }
  }
  return best;
}
// 樹搜尋一步：回傳 [我方, 對手] 的選擇；stats＝要不要附上 out.stats＝{ opts 雙方的選擇, v 各組合的平均分數（0～1，我方角度）、
// win 各組合我方的勝率（打到最後贏 1、輸 0、沒分出勝負 0.5 的平均；沒試過是 null）、n 各組合試的次數, p 雙方的出招比例 }（給畫面、統計用）；
// uniform＝根節點不用 UCB1、輪流試每一格（樹狀圖要每一格的勝率都有差不多的次數）
function simSearch(ctx, st, phase, iters, rnd, stats, uniform) {
  const opts = [0, 1].map(s => simPhaseOpts(ctx, st, s, phase));
  if (!stats && opts[0].length === 1 && opts[1].length === 1) return [opts[0][0], opts[1][0]];
  const root = simNode(), rr = rnd || Math.random, pick = (c, s) => simGreedyPick(ctx, c, s), m = opts[0].length;
  for (let it = 0; it < iters; it++) {
    const c = simClone(st), path = [];
    let nd = root, ph = phase;
    while (!simOver(c) && c.turn < SIM_MAX_TURN) {
      const acts = uniform && nd === root ? [opts[0][it % m], opts[1][Math.floor(it / m) % opts[1].length]]
        : [0, 1].map(s => simUcb(nd, s, simPhaseOpts(ctx, c, s, ph)));
      const ka = simKey(acts[0]), kb = simKey(acts[1]);
      path.push([nd, ka, kb]);
      if (ph === 'turn') simTurn(ctx, c, acts, rr, 0, pick); else simReplace(c, acts, rr);
      ph = simNeed(c, 0) || simNeed(c, 1) ? 'replace' : 'turn';
      const next = nd.ch.get(ka + '|' + kb);
      if (!next) { nd.ch.set(ka + '|' + kb, simNode()); break; }
      nd = next;
    }
    const r = (simRollout(ctx, c, null) + 1.5) / 3;
    for (const [n, ka, kb] of path) {
      n.n++;
      [[0, ka, r], [1, kb, 1 - r]].forEach(([s, k, w]) => { const e = n.s[s].get(k); if (e) { e.n++; e.w += w; } else n.s[s].set(k, { n: 1, w }); });
    }
    // 勝負：simValue 1 以上＝我方贏（r ≥ 5/6）、−1 以下＝輸（r ≤ 1/6），中間是還沒分出勝負
    const k = r >= 5 / 6 ? 1 : r <= 1 / 6 ? 0 : 0.5;
    if (path.length) { const jk = path[0][1] + '|' + path[0][2], e = root.j.get(jk); if (e) { e.n++; e.w += r; e.k += k; } else root.j.set(jk, { n: 1, w: r, k }); }
  }
  // 根節點各組合的平均分數（沒試過的組合用雙方各自的平均補：我方那招的平均與 1 減對手那招的平均取中間）
  const mean = (s, o) => { const e = root.s[s].get(simKey(o)); return e ? e.w / e.n : 0.5; };
  const cell = (a, b) => root.j.get(simKey(a) + '|' + simKey(b));
  const v = opts[0].map(a => opts[1].map(b => { const e = cell(a, b); return e ? e.w / e.n : (mean(0, a) + 1 - mean(1, b)) / 2; }));
  const p = simMix(v), out = [0, 1].map(s => opts[s][simDraw(p[s], rnd)]);
  if (stats) out.stats = { opts, v, n: opts[0].map(a => opts[1].map(b => cell(a, b)?.n || 0)),
    win: opts[0].map(a => opts[1].map(b => { const e = cell(a, b); return e ? e.k / e.n : null; })), p };
  return out;
}
// 一場的開頭局面：sides＝[我方, 對手]，每方 { mons 帶出場的（simMon，先發排第一）}（會複製一份）；先發都在場上
function simStart(sides, log) {
  const st = { sd: sides.map(x => simSide0(x.mons.map(simCloneMon))), turn: 0, fut: [], idle: 0, log: log ? [] : null };
  st.sd.forEach(x => Object.assign(x.mons[0], { in: 0, out: true }));
  // 先發雙方同時出場：各自的威嚇都打對方（同出戰選角的正面對打）
  [0, 1].forEach(s => simIntimidate(st, s, simAct(st, s)));
  return st;
}
// 這個局面接下來是哪個階段：'over' 分出勝負（或打滿回合）、'replace' 有人倒下要補位、'turn' 選這回合的招式
const simPhase = st => simOver(st) || st.turn >= SIM_MAX_TURN ? 'over' : simNeed(st, 0) || simNeed(st, 1) ? 'replace' : 'turn';
// 樹狀圖的一層：局面 st 每一格「我方出 X × 對手出 Y」用樹搜尋平均試（共 iters 次），回傳 simSearch 的 stats 加上 phase
function simView(ctx, st, iters) {
  const phase = simPhase(st);
  return phase === 'over' ? { phase } : { phase, ...simSearch(ctx, st, phase, iters, null, true, true).stats };
}
// 樹狀圖往下一步：照期望值打 acts 這一回合（或補位）；pin[s]＝第 s 方被迫換人（打完換人、拋下狠話、被吹走）時實際換上的（沒給、或那隻不能換上就照簡單規則／後排第一隻）。
// 回傳 { st 新局面, log 這一步的紀錄, forced [我方, 對手]：這一步被迫換了人的話，是開始時還站著、可能換上來的（不含原本該在場上那隻），沒有是 null }（不改到原本的 st）
function simStep(ctx, st, acts, pin) {
  const c = simClone(st), phase = simPhase(st);
  c.log = [];
  c.pin = pin;
  const pick = (x, s) => simBench(x, s).includes(pin?.[s]) ? pin[s] : simGreedyPick(ctx, x, s);
  if (phase === 'turn') { if (simTurn(ctx, c, acts, null, 0, pick)) c.log.splice(1, 0, '　（雙方同速，實際各 50%；這一步照我方先動推，實戰對手先動的話按「改成實戰的結果」改 HP）'); }
  else simReplace(c, acts, null);
  const forced = [0, 1].map(s => {
    const was = acts[s].t === 'sw' ? acts[s].i : st.sd[s].act;
    return c.sd[s].act === was ? null : st.sd[s].mons.map((m, i) => m.hp > 0 && i !== was ? i : -1).filter(i => i >= 0);
  });
  const log = c.log;
  c.log = null;
  delete c.pin;
  return { st: c, log, forced };
}
// 照機率 p 抽一個索引（沒給 rnd 取機率最高的）
function simDraw(p, rnd) {
  if (!rnd) return p.indexOf(Math.max(...p));
  let x = rnd();
  const i = p.findIndex(q => (x -= q) < 0);
  return i < 0 ? p.findLastIndex(q => q > 0) : i;
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
  const A = simPhaseOpts(ctx, st, 0, phase), B = simPhaseOpts(ctx, st, 1, phase);
  if (A.length === 1 && B.length === 1) return [A[0], B[0]];
  const pick = (c, s) => simGreedyPick(ctx, c, s);
  const run = (acts, tie) => {
    const c = simClone(st);
    const tied = phase === 'turn' ? simTurn(ctx, c, acts, null, tie, pick) : (simReplace(c, acts, null), false);
    return [simRollout(ctx, c), tied];
  };
  const v = A.map(a => B.map(b => {
    const [x, tied] = run([a, b], 0);
    return tied ? (x + run([a, b], 1)[0]) / 2 : x;
  }));
  const [pa, pb] = simMix(v);
  return [A[simDraw(pa, rnd)], B[simDraw(pb, rnd)]];
}
// 打一場：sides＝[我方, 對手]，每方 { mons 帶出場的（simMySide／simOppScenarios 的 mons，先發排第一）}（會複製一份，不改到 sides）；
// rnd 亂數；log＝要不要逐回合紀錄。
// opt：{ algo 決策方式 'tree' 樹搜尋（simSearch，iters 次）／'ply1' 往前算一回合（simDecide），可以給 [我方, 對手] 各用一種；預設 'ply1' }。
// 雙方每回合、每次補位都照決策方式選（照比例用 rnd 抽）；打完換人、被吹走換上誰用簡單規則（simGreedyPick）。
// 回傳 { res 1 我方贏／-1 輸（同時全倒看 simWinner）／0 平手（打滿 SIM_MAX_TURN 回合）, turns, mons [我方, 對手] 帶出場的（kos、hp、max、out）, log }
function simPlay(ctx, sides, rnd, log, opt = {}) {
  const st = simStart(sides, log);
  if (st.log) st.log.unshift(`先發：我方${MON[simAct(st, 0).key].zh}、對手${MON[simAct(st, 1).key].zh}`);
  const pick = (c, s) => simGreedyPick(ctx, c, s), algo = [].concat(opt.algo || 'ply1');
  const by = (a, phase) => a === 'tree' ? simSearch(ctx, st, phase, opt.iters || 200, rnd) : simDecide(ctx, st, phase, rnd);
  const decide = phase => algo.length < 2 || algo[0] === algo[1] ? by(algo[0], phase) : [by(algo[0], phase)[0], by(algo[1], phase)[1]];
  while (!simOver(st) && st.turn < SIM_MAX_TURN) {
    simTurn(ctx, st, decide('turn'), rnd, 0, pick);
    // 補位換上來又被撒菱類打倒的再補（補到有人站著才打下一回合）
    while (!simOver(st) && (simNeed(st, 0) || simNeed(st, 1))) simReplace(st, decide('replace'), rnd);
  }
  const w = simWinner(st), res = w === 0 ? 1 : w === 1 ? -1 : 0, both = simDead(st, 0) && simDead(st, 1);
  if (st.log) st.log.push((both ? `雙方同時全倒，最後倒下的是${w ? '對手' : '我方'}，` : '') + (res > 0 ? '我方贏' : res < 0 ? '我方輸' : `打滿 ${SIM_MAX_TURN} 回合，平手`));
  return { res, turns: st.turn, mons: st.sd.map(x => x.mons), log: st.log };
}

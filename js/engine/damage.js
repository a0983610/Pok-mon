// 計算引擎：資料與純邏輯，不碰 DOM（畫面在 js/ui/）
// ---------- 傷害計算 ----------
// 寶可夢冠軍固定 Lv50、個體值 31，用能力點數（每項 0～32、合計 66，1 點＝能力值 +1）代替努力值。
// 能力值：HP＝種族值＋能力點數＋75；其他＝⌊(種族值＋能力點數＋20)×性格⌋（GameWith「対戦の用語一覧」，
//   和 Smogon damage-calc stats.ts 的 calcStatChampions 相同）。nat 是性格倍率 ×10（9／10／11），用整數算免得有小數誤差
const statOf = (base, sp, i, nat = 10) => i ? Math.floor((base + sp + 20) * nat / 10) : base + sp + 75;
// 以下照 Smogon damage-calc 寶可夢冠軍版（mechanics/champions.ts、mechanics/util.ts）的順序與取整：
// 威力修正 → 攻擊／防禦（能力變化、道具、天氣）→ 基礎傷害 → 範圍招式 ×0.75 → 天氣 → 急所 ×1.5
// → 亂數 85～100%（16 段）→ 本系 ×1.5 → 屬性相剋 → 最終修正（道具、樹果）
const pokeRound = n => n % 1 > 0.5 ? Math.ceil(n) : Math.floor(n);
// 4096 制倍率依序連乘（每乘一次四捨五入），再夾在 lo～hi
const chainMods = (mods, lo, hi) => Math.max(lo, Math.min(hi, mods.reduce((M, m) => (M * m + 2048) >> 12, 4096)));
// 能力變化 st（−6～+6）後的能力值
const stageStat = (s, st) => st >= 0 ? Math.floor(s * (2 + st) / 2) : Math.floor(s * 2 / (2 - st));
// 雙打時同時打對面兩隻（或場上全部）的招式，傷害 ×0.75（Smogon moves.ts 的 target 是 allAdjacent／allAdjacentFoes，取本資料有的）
const SPREAD = new Set(['air-cutter', 'blizzard', 'boomburst', 'brutal-swing', 'bulldoze', 'burning-jealousy', 'clanging-scales', 'dazzling-gleam',
  'discharge', 'earthquake', 'electroweb', 'eruption', 'explosion', 'heat-wave', 'hyper-voice', 'icy-wind', 'lava-plume', 'make-it-rain',
  'matcha-gotcha', 'misty-explosion', 'mortal-spin', 'muddy-water', 'overdrive', 'parabolic-charge', 'rock-slide', 'self-destruct', 'sludge-wave',
  'snarl', 'sparkling-aria', 'struggle-bug', 'surf', 'water-spout']);
// 連續攻擊：[打幾下, 說明]（Smogon moves.ts 的 multihit）；2～5 下的照 Smogon 預設以 3 下計，三旋擊威力每下 20、40、60
const VAR_HITS = '2～5 下，以 3 下計';
const HITS = { 'dragon-darts': [2], 'dual-wingbeat': [2], 'twin-beam': [2], 'triple-axel': [3, '威力 20→40→60'], 'population-bomb': [10, '最多 10 下，以全中計'],
  'bullet-seed': [3, VAR_HITS], 'icicle-spear': [3, VAR_HITS], 'pin-missile': [3, VAR_HITS], 'rock-blast': [3, VAR_HITS], 'scale-shot': [3, VAR_HITS], 'water-shuriken': [3, VAR_HITS] };
// 特殊招式但打對手防禦的（Smogon 的 overrideDefensiveStat）；撲擊用自己的防禦當攻擊
const HIT_DEF = new Set(['psyshock', 'psystrike', 'secret-sword']);
// 不算的攻擊招式與原因；威力是 null 的（看體重、HP、速度，或固定傷害、一擊必殺）也不算
const NO_CALC = { 'foul-play': '用對手的攻擊計算' };
const canCalc = k => MOVES[k][2] !== 'status' && MOVES[k][3] != null && !NO_CALC[k];
// 必定急所的招式（說明寫「必定／一定會擊中要害」，同 Smogon moves.ts 的 willCrit）
const ALWAYS_CRIT = new Set(Object.keys(MOVES).filter(k => /(必定|一定)會?擊中要害/.test(MOVES[k][4])));
// 出招前先提高 1 段特攻的招式（Smogon champions.ts）
const CHARGE_SPA = new Set(['electro-shot', 'meteor-beam']);
// 招式標記，給特性判斷用（Smogon moves.ts 寶可夢冠軍版＝朱紫資料再套冠軍修正，取本資料有的攻擊招式）：
// contact 接觸、punch 拳、bite 咬、bullet 球和彈、sound 聲音、pulse 波動、slicing 切斬、recoil 有反作用力或撞牆傷害、secondary 有追加效果、priority 先制
const FLAG = Object.fromEntries(Object.entries({
  contact: 'accelerock acrobatics aerial-ace aqua-jet aqua-step avalanche bite bitter-blade blaze-kick body-press body-slam brave-bird brick-break '
    + 'brutal-swing bug-bite bullet-punch ceaseless-edge circle-throw close-combat comeuppance counter covet crabhammer cross-chop cross-poison crunch '
    + 'darkest-lariat dig dire-claw double-edge double-shock dragon-claw dragon-rush dragon-tail drain-punch draining-kiss drill-peck drill-run '
    + 'dual-wingbeat dynamic-punch endeavor extreme-speed fake-out fell-stinger fire-fang fire-punch first-impression flail flame-charge flare-blitz '
    + 'flip-turn flying-press foul-play giga-impact glaive-rush grass-knot grassy-glide guillotine gyro-ball hammer-arm head-smash headlong-rush '
    + 'heat-crash heavy-slam high-horsepower high-jump-kick horn-drill horn-leech ice-fang ice-hammer ice-punch ice-spinner infestation iron-head '
    + 'iron-tail jaw-lock jet-punch knock-off kowtow-cleave last-resort leaf-blade leech-life liquidation low-kick lunge mach-punch mega-kick megahorn '
    + 'meteor-mash mortal-spin night-slash nuzzle outrage payback phantom-force play-rough poison-fang poison-jab population-bomb power-trip '
    + 'power-whip psychic-fangs psyshield-bash quick-attack rage-fist raging-bull rapid-spin razor-shell reversal sacred-sword shadow-claw '
    + 'shadow-punch shadow-sneak slash snap-trap solar-blade spirit-break steel-roller stomping-tantrum stone-axe storm-throw sucker-punch '
    + 'super-fang supercell-slam superpower temper-flare thrash throat-chop thunder-fang thunder-punch trailblaze triple-axel trop-kick u-turn '
    + 'upper-hand volt-tackle waterfall wave-crash wild-charge wood-hammer x-scissor zen-headbutt',
  punch: 'bullet-punch double-shock drain-punch dynamic-punch fire-punch hammer-arm headlong-rush ice-hammer ice-punch jet-punch mach-punch '
    + 'meteor-mash rage-fist shadow-punch thunder-punch',
  bite: 'bite crunch fire-fang ice-fang jaw-lock poison-fang psychic-fangs thunder-fang',
  bullet: 'acid-spray aura-sphere beak-blast bullet-seed energy-ball focus-blast gyro-ball pollen-puff pyro-ball rock-blast rock-wrecker seed-bomb '
    + 'shadow-ball sludge-bomb syrup-bomb weather-ball zap-cannon',
  sound: 'alluring-voice boomburst bug-buzz clanging-scales hyper-voice overdrive psychic-noise round snarl sparkling-aria torch-song',
  pulse: 'aura-sphere dark-pulse dragon-pulse terrain-pulse water-pulse',
  slicing: 'aerial-ace air-cutter air-slash aqua-cutter bitter-blade ceaseless-edge cross-poison dire-claw dragon-claw kowtow-cleave leaf-blade '
    + 'night-slash population-bomb psycho-cut razor-shell sacred-sword shadow-claw slash solar-blade stone-axe x-scissor',
  recoil: 'brave-bird double-edge flare-blitz head-smash light-of-ruin volt-tackle wave-crash wild-charge wood-hammer high-jump-kick supercell-slam',
  secondary: 'acid-spray air-slash alluring-voice ancient-power apple-acid aqua-step aura-wheel barb-barrage bite bitter-malice blaze-kick blizzard '
    + 'body-slam bug-buzz bulldoze burning-jealousy ceaseless-edge charge-beam cross-poison crunch dark-pulse dire-claw discharge dragon-rush '
    + 'drum-beating dynamic-punch earth-power electroweb energy-ball extrasensory fake-out fiery-dance fire-blast fire-fang fire-punch flame-charge '
    + 'flamethrower flare-blitz flash-cannon focus-blast grav-apple gunk-shot heat-wave hurricane ice-beam ice-fang ice-punch icicle-crash icy-wind '
    + 'infernal-parade iron-head iron-tail lava-plume liquidation lumina-crash lunge matcha-gotcha meteor-mash moonblast mortal-spin mountain-gale '
    + 'mud-shot muddy-water mystical-fire night-daze nuzzle play-rough poison-fang poison-jab psychic psychic-noise psyshield-bash pyro-ball '
    + 'rapid-spin razor-shell rock-slide rock-tomb salt-cure scald scorching-sands shadow-ball shell-side-arm sludge-bomb sludge-wave snarl '
    + 'sparkling-aria spirit-break spirit-shackle stone-axe struggle-bug syrup-bomb throat-chop thunder thunder-fang thunder-punch thunderbolt '
    + 'torch-song trailblaze triple-arrows trop-kick upper-hand volt-tackle water-pulse waterfall zap-cannon zen-headbutt',
  priority: 'accelerock aqua-jet bullet-punch extreme-speed fake-out feint first-impression ice-shard jet-punch mach-punch quick-attack shadow-sneak '
    + 'sucker-punch upper-hand vacuum-wave water-shuriken',
}).map(([f, s]) => [f, new Set(s.split(' '))]));
// 特性，效果與倍率照 Smogon champions.ts。超級進化專屬、ABILS（一般寶可夢的 OP.GG 詳細頁）裡沒有的中文名依神奇寶貝百科「特性列表」
const ABIL_ZH = { aerilate: '飛行皮膚', dragonize: '龍皮膚', eelevate: '鰻鰻高升', 'mega-sol': '超級日光', 'fire-mane': '火焰鬃毛',
  'aura-guard': '波導防護', 'parental-bond': '親子愛', 'fairy-aura': '妖精氣場' };
const abilZh = k => ABILS[k]?.[0] || ABIL_ZH[k] || '';
// 寶可夢 key 在 fmt 實際用的特性：超級進化用固定特性；其他用選的 cur，沒選或不在這隻的常用特性裡就用使用率最高的；沒有統計回傳 ''
function defAbOf(key, fmt, cur = '') {
  const m = MON[key];
  if (!m) return '';
  if (m.base) return m.megaAbils[0] || '';
  const list = useOf(key, fmt)?.abils || [];
  return list.some(([k]) => k === cur) ? cur : list[0]?.[0] || '';
}
// 一般屬性招式變成這個屬性、威力 ×1.2
const ATE = { aerilate: 'flying', pixilate: 'fairy', refrigerate: 'ice', dragonize: 'dragon' };
// 防守方特性讓這個屬性的招式沒有效果
const ABIL_IMMUNE = { levitate: 'ground', eelevate: 'ground', 'earth-eater': 'ground', 'flash-fire': 'fire', 'water-absorb': 'water',
  'storm-drain': 'water', 'dry-skin': 'water', 'volt-absorb': 'electric', 'lightning-rod': 'electric', 'motor-drive': 'electric', 'sap-sipper': 'grass' };
// 場上有這些特性時天氣沒有作用
const WEATHER_OFF = ['cloud-nine', 'air-lock'];
// 這裡會算到的特性（選單標示用；開天氣和威嚇在畫面上另外提示）
const ATK_ABILS = new Set(['aerilate', 'pixilate', 'refrigerate', 'dragonize', 'liquid-voice', 'adaptability', 'protean', 'libero', 'scrappy',
  'mold-breaker', 'skill-link', 'parental-bond', 'huge-power', 'pure-power', 'hustle', 'water-bubble', 'fire-mane', 'solar-power', 'technician',
  'mega-launcher', 'strong-jaw', 'steely-spirit', 'sharpness', 'fairy-aura', 'sheer-force', 'sand-force', 'tough-claws', 'punk-rock', 'reckless',
  'iron-fist', 'sniper', 'mega-sol', 'unaware', 'long-reach', ...WEATHER_OFF, 'drought', 'drizzle', 'sand-stream', 'snow-warning',
  'guts', 'infiltrator', 'levitate', 'electric-surge', 'grassy-surge', 'misty-surge', 'psychic-surge']);
const DEF_ABILS = new Set([...Object.keys(ABIL_IMMUNE), 'bulletproof', 'soundproof', 'queenly-majesty', 'armor-tail', 'thick-fat', 'heatproof',
  'water-bubble', 'purifying-salt', 'fur-coat', 'multiscale', 'filter', 'solid-rock', 'fluffy', 'aura-guard', 'punk-rock', 'shell-armor',
  'battle-armor', 'sturdy', 'unaware', 'ripen', 'fairy-aura', ...WEATHER_OFF, 'drought', 'drizzle', 'sand-stream', 'snow-warning', 'intimidate',
  'grass-pelt', 'electric-surge', 'grassy-surge', 'misty-surge', 'psychic-surge', 'sticky-hold']);
// 場地（算法在 damageCalc，照 Smogon 冠軍版）：在地面上（不是飛行屬性、沒有飄浮）的攻擊方用該屬性招式威力 ×1.3；
// 打在地面上的防守方時，薄霧場地龍招式、青草場地地震／重踏威力 ×½，精神場地擋先制招式；大地波動有場地時變成對應屬性、威力 ×2
const TERRAIN_TYPE = { electric: 'electric', grassy: 'grass', misty: 'fairy', psychic: 'psychic' };
// 會先打破反射壁／光牆／極光幕再算傷害的招式（Smogon champions.ts）
const WALL_BREAK = new Set(['brick-break', 'psychic-fangs', 'raging-bull']);
// 天氣（算法在 damageCalc）：晴天火 ×1.5、水 ×½；下雨水 ×1.5、火 ×½；沙暴岩石屬性特防 ×1.5；下雪冰屬性防禦 ×1.5；
// 氣象球有天氣時變成對應屬性、威力 ×2；日光束／日光刃在下雨、沙暴、下雪時威力 ×½
const WB_TYPE = { sun: 'fire', rain: 'water', sand: 'rock', snow: 'ice' };
// 影響傷害的道具（只收 ITEMS 裡有的，也就是 OP.GG 有人帶的），從說明文字判斷效果，倍率照 Smogon 冠軍版：
// 攻擊方 side a：屬性強化道具該屬性威力 ×1.2（4915）、力量頭帶／博識眼鏡物理／特殊威力 ×1.1（4505）、寶石該屬性威力 ×1.3（5325）、
//   生命寶珠 ×1.3（5324）、達人帶效果絕佳時 ×1.2（4915）、電氣球皮卡丘攻擊特攻 ×2；
// 防守方 side d：抗性樹果受到效果絕佳的該屬性招式傷害減半（只擋第一下）、氣勢披帶 HP 全滿時撐住會倒下的一擊（剩 1 HP）；
// 兩邊都能帶 side ad：講究圍巾速度 ×1.5（不影響傷害，算在 speedOf）
const TYPE_BY_ZH = Object.fromEntries(TYPES.map(t => [t.zh, t.id]));
const DMG_ITEMS = {};
Object.entries(ITEMS).forEach(([k, [, e]]) => {
  let m;
  if ((m = e.match(/^(.+?)屬性招式威力會變為1\.2倍/)) && TYPE_BY_ZH[m[1]]) DMG_ITEMS[k] = { side: 'a', type: TYPE_BY_ZH[m[1]], bp: 4915 };
  else if ((m = e.match(/^(物理|特殊)招式威力會變為1\.1倍/))) DMG_ITEMS[k] = { side: 'a', cat: m[1] === '物理' ? 'physical' : 'special', bp: 4505 };
  else if ((m = e.match(/^(.+?)屬性的寶石/)) && TYPE_BY_ZH[m[1]]) DMG_ITEMS[k] = { side: 'a', type: TYPE_BY_ZH[m[1]], bp: 5325, gem: true };
  else if ((m = e.match(/^受到效果絕佳的(.+?)屬性招式時，傷害會減半/)) && TYPE_BY_ZH[m[1]]) DMG_ITEMS[k] = { side: 'd', berry: TYPE_BY_ZH[m[1]] };
});
[['life-orb', { side: 'a', final: 5324 }], ['expert-belt', { side: 'a', se: 4915 }], ['light-ball', { side: 'a', mon: 'pikachu', atk: 8192 }],
  ['focus-sash', { side: 'd', sash: true }], ['choice-scarf', { side: 'ad', spe: 6144 }]].forEach(([k, v]) => { if (ITEMS[k]) DMG_ITEMS[k] = v; });
// 投資＝[能力點數 0～32, 性格 ×10（9 −性格／10／11 ＋性格）]，套在這招用到的那項能力（物理看攻擊／防禦、特殊看特攻／特防）；
// 下面是快選檔位 [能力點數, 性格 ×10, 名稱]，也可以在畫面上自己輸入點數、選性格（HP 沒有性格）
const ATK_INV = [[0, 10, '無投資'], [32, 10, '滿投資'], [32, 11, '滿投資＋性格']];
const HP_INV = [[0, 10, '0'], [32, 10, '32']];
const DEF_INV = [[0, 10, '0'], [32, 10, '32'], [32, 11, '32＋性格']];
const SPE_INV = DEF_INV;
// 投資的名稱：和快選檔位一樣就用檔位名稱，不然寫「點數 20＋性格」
const NAT_ZH = { 9: '−性格', 10: '', 11: '＋性格' };
const invName = (list, [sp, nat]) => list.find(([s, n]) => s === sp && n === nat)?.[2] || `點數 ${sp}${NAT_ZH[nat]}`;
// 我方登錄的配招：x.sp＝6 項能力點數 [HP, 攻擊, 防禦, 特攻, 特防, 速度]、x.nat＝性格 [↑能力索引, ↓能力索引]（1～5；有 0 或兩個相同＝不加減）。
// 第 i 項能力的投資 [點數, 性格 ×10]；x 沒有 sp 時用 inv（傷害計算分頁的投資檔位）
const natOf = ([u, d] = [], i) => u && d && u !== d ? (i === u ? 11 : i === d ? 9 : 10) : 10;
const invAt = (x, i, inv) => x.sp ? [x.sp[i], natOf(x.nat, i)] : inv;
// 速度（照 Smogon util.ts 的 getFinalSpeed，冠軍版）：速度能力值 → 能力變化 → 順風 ×2、天氣／場地加速特性 ×2（不然飛毛腿在異常狀態時 ×1.5）、
// 講究圍巾 ×1.5 連乘後四捨五入 → 麻痺 ×½（飛毛腿不減）。SPE_ABILS：特性 → 要的天氣或場地（衝浪之尾看電氣場地）
const SPE_ABILS = { chlorophyll: 'sun', 'swift-swim': 'rain', 'sand-rush': 'sand', 'slush-rush': 'snow', 'surge-surfer': 'electric' };
// s：{ key, inv 速度投資 [點數, 性格]（或 sp／nat，見 invAt）, st 速度能力變化, item, ab 特性, tw 順風, par 麻痺, status 有異常狀態（麻痺或灼傷） }；
// f：{ weather（已扣掉無關天氣／氣閘）, terrain }。回傳 { v 速度, notes 有作用的修正 }
function speedOf(s, f) {
  const [sp, nat] = invAt(s, 5, s.inv), notes = [], mods = [];
  let v = stageStat(statOf(MON[s.key].bs[5], sp, 5, nat), s.st);
  if (s.tw) { mods.push(8192); notes.push('順風 ×2'); }
  const need = SPE_ABILS[s.ab];
  if (need && need === (need === 'electric' ? f.terrain : f.weather)) { mods.push(8192); notes.push(`${abilZh(s.ab)} ×2`); }
  else if (s.ab === 'quick-feet' && s.status) { mods.push(6144); notes.push(`${abilZh(s.ab)} ×1.5`); }
  if (DMG_ITEMS[s.item]?.spe) { mods.push(DMG_ITEMS[s.item].spe); notes.push(`${ITEMS[s.item][0]} ×1.5`); }
  v = pokeRound(v * chainMods(mods, 410, 131172) / 4096);
  if (s.par && s.ab !== 'quick-feet') { v = Math.floor(v * 50 / 100); notes.push('麻痺 ×½'); }
  return { v, notes };
}
// 雙方速度與誰先動：x、y 是 speedOf 的 s，f：{ weather, terrain, tr 戲法空間 }；天氣被無關天氣／氣閘擋掉時加速特性也不算（同 damageCalc）。
// 回傳 spd [x 的, y 的]（speedOf 的結果）、first 0＝x 先動、1＝y 先動、-1＝同速（各 50%）；戲法空間時速度慢的先動，先制招式不看這個
function speedPair(x, y, f) {
  const weather = [x.ab, y.ab].some(k => WEATHER_OFF.includes(k)) ? '' : f.weather;
  const spd = [x, y].map(s => speedOf(s, { weather, terrain: f.terrain }));
  return { spd, first: spd[0].v === spd[1].v ? -1 : (spd[0].v > spd[1].v) !== !!f.tr ? 0 : 1 };
}
// 攻擊方 a：{ key, inv 投資 [點數, 性格], st { atk, spa } 能力變化, item, ab 特性 }；防守方 d：{ key, hp／inv 投資 [點數, 性格], st { def, spd }, item, ab, cur 目前剩下的 HP（沒給＝全滿） }
// （投資也可以改給 sp／nat，見 invAt；a 另外可帶 set 給 dmgRows 用登錄的招式）；
// o：{ fmt 's'／'d', weather, crit, terrain, hh 幫助, walls 防守方的牆, burn 攻擊方灼傷 }（必定急所的招式不管 crit 都算急所）。不算的招式回傳 { skip 原因 }；
// 沒有效果的回傳 eff 0（沒有 hp 以後的欄位；immuneBy＝讓招式無效的防守方特性，blockedBy＝其他原因的說明，如精神場地擋先制）；
// 其餘回傳 hp 防守方最大 HP、min／max 用一次的傷害（多段攻擊是各下加總）、ko[n] 連用 n＋1 次打掉剩下 HP 的機率（n＝0～3）、stab 本系倍率（4096 制）、
// endured 撐住了會倒下的第一下的氣勢披帶或結實（道具／特性 key）、berry 抗性樹果有減半、notes 有作用的特性與招式效果。
// d.cur 比最大 HP 少時，氣勢披帶、結實、多重鱗片（都要 HP 全滿）沒有作用
function damageCalc(a, d, mk, o) {
  const [, mtype, cat, power0] = MOVES[mk];
  if (NO_CALC[mk]) return { skip: NO_CALC[mk] };
  if (power0 == null) return { skip: '威力會變動或固定傷害' };
  const A = MON[a.key], D = MON[d.key], aab = a.ab || '', notes = new Set();
  const use = k => { notes.add(abilZh(k)); return true; };
  // 破格無視防守方的特性（Smogon 列的可無視特性涵蓋這裡用到的，只有妖精氣場、熟成不在其中）
  const dab = aab === 'mold-breaker' && !['fairy-aura', 'ripen'].includes(d.ab) ? '' : d.ab || '';
  if (d.ab && !dab && DEF_ABILS.has(d.ab)) notes.add(`${abilZh(aab)}無視${abilZh(d.ab)}`);
  const offBy = [aab, d.ab].find(k => WEATHER_OFF.includes(k)), wthr = offBy ? '' : o.weather;
  if (offBy && o.weather) notes.add(`${abilZh(offBy)}讓天氣沒有作用`);
  // 在地面上：不是飛行屬性、沒有飄浮（Smogon isGrounded；重力、黑色鐵球、氣球不在可選的道具裡，不用看）
  const terr = o.terrain || '', aGround = !A.types.includes('flying') && aab !== 'levitate', dGround = !D.types.includes('flying') && dab !== 'levitate';
  // 招式屬性：氣象球隨天氣（超級日光當晴天）、大地波動隨場地、皮膚類把一般招式變屬性（氣象球、大地波動不會）、濕潤之聲把聲音招式變水
  let type = mtype, power = power0, ate = false;
  if (mk === 'weather-ball') {
    const w = aab === 'mega-sol' ? use(aab) && 'sun' : wthr;
    if (w) { type = WB_TYPE[w]; power *= 2; }
  } else if (mk === 'terrain-pulse') {
    if (terr && aGround) { type = TERRAIN_TYPE[terr]; power *= 2; notes.add(`${FIELD_ZH[terr]}：變${T[type].zh}屬性、威力 ×2`); }
  } else if (ATE[aab] && type === 'normal') ate = use(aab) && (type = ATE[aab]);
  else if (aab === 'liquid-voice' && FLAG.sound.has(mk)) type = use(aab) && 'water';
  if (mk === 'rising-voltage' && terr === 'electric' && dGround) { power *= 2; notes.add(`${FIELD_ZH[terr]}威力 ×2`); }
  let [hits, hitNote] = HITS[mk] || [1], pb = false;
  if (aab === 'skill-link' && hitNote === VAR_HITS) [hits, hitNote] = [5, use(aab) && `${abilZh(aab)}固定 5 下`];
  // 廣域戰力在精神場地（攻擊方在地面上）變成打所有對手
  const spread = o.fmt === 'd' && (SPREAD.has(mk) || (mk === 'expanding-force' && terr === 'psychic' && aGround));
  if (aab === 'parental-bond' && hits === 1 && !spread) [hits, hitNote, pb] = [2, use(aab) && `${abilZh(aab)}：第 2 下傷害 ¼`, true];
  const scrappy = aab === 'scrappy' && (type === 'normal' || type === 'fighting') && D.types.includes('ghost') && use(aab);
  const r = { type, cat, power, hits, hitNote, spread, eff: eff(type, scrappy ? D.types.filter(t => t !== 'ghost') : D.types),
    crit: (o.crit || ALWAYS_CRIT.has(mk)) && !(['shell-armor', 'battle-armor'].includes(dab) && use(dab)) };
  if (ABIL_IMMUNE[dab] === type || (dab === 'bulletproof' && FLAG.bullet.has(mk)) || (dab === 'soundproof' && FLAG.sound.has(mk))
    || (['queenly-majesty', 'armor-tail'].includes(dab) && FLAG.priority.has(mk))) [r.eff, r.immuneBy] = [0, dab];
  else if (r.eff && terr === 'psychic' && dGround && FLAG.priority.has(mk)) [r.eff, r.blockedBy] = [0, `${FIELD_ZH.psychic}擋先制招式`];
  if (!r.eff) return r;
  // 本系 ×1.5；變幻自如／自由者每招都算本系；適應力本系再 +0.5
  const own = A.types.includes(type);
  r.stab = 4096 + (own || (['protean', 'libero'].includes(aab) && use(aab)) ? 2048 : 0) + (aab === 'adaptability' && own && use(aab) ? 2048 : 0);
  const ai = mk === 'body-press' ? 2 : cat === 'physical' ? 1 : 3, di = cat === 'physical' || HIT_DEF.has(mk) ? 2 : 4;
  const [asp, anat] = invAt(a, ai, a.inv), [dsp, dnat] = invAt(d, di, d.inv);
  const ait = DMG_ITEMS[a.item] || {}, dit = DMG_ITEMS[d.item] || {};
  r.hp = statOf(D.bs[0], invAt(d, 0, d.hp)[0], 0);
  // 剩下的 HP need：沒給 cur 或不少於最大 HP 都算全滿
  const full = !(d.cur < r.hp), need = full ? r.hp : Math.max(1, d.cur);
  // 能力變化：急所時不計攻擊方的下降、防守方的上升；對方是天然就不計
  let ast = ai === 1 ? a.st.atk : ai === 3 ? a.st.spa : 0;
  if (CHARGE_SPA.has(mk) && ai === 3) {
    ast = Math.max(-6, Math.min(6, ast + (aab === 'contrary' ? -1 : 1)));
    notes.add(aab === 'contrary' ? `出招前特攻 −1（${abilZh(aab)}）` : '出招前特攻 +1');
  }
  const dst = di === 2 ? d.st.def : d.st.spd;
  let atk = statOf(A.bs[ai], asp, ai, anat);
  if (ast && !(r.crit && ast < 0) && !(dab === 'unaware' && use(dab))) atk = stageStat(atk, ast);
  if (aab === 'hustle' && cat === 'physical' && use(aab)) atk = pokeRound(atk * 3 / 2);
  const atMods = [];
  if ((aab === 'solar-power' && wthr === 'sun' && cat === 'special') || (aab === 'guts' && o.burn && cat === 'physical')
    || (aab === 'fire-mane' && type === 'fire')) atMods.push(use(aab) && 6144);
  else if ((aab === 'water-bubble' && type === 'water') || (['huge-power', 'pure-power'].includes(aab) && cat === 'physical')) atMods.push(use(aab) && 8192);
  if ((dab === 'thick-fat' && (type === 'fire' || type === 'ice')) || (dab === 'water-bubble' && type === 'fire') || (dab === 'purifying-salt' && type === 'ghost')
    || (dab === 'heatproof' && type === 'fire')) atMods.push(use(dab) && 2048);
  if (ait.atk && family(A) === ait.mon) atMods.push(ait.atk);
  atk = Math.max(1, pokeRound(atk * chainMods(atMods, 410, 131072) / 4096));
  let def = statOf(D.bs[di], dsp, di, dnat);
  if (dst && !(r.crit && dst > 0) && !(aab === 'unaware' && use(aab))) def = stageStat(def, dst);
  if (aab !== 'mega-sol' && ((wthr === 'sand' && di === 4 && D.types.includes('rock')) || (wthr === 'snow' && di === 2 && D.types.includes('ice')))) def = pokeRound(def * 3 / 2);
  // 打防禦時：草之毛皮（青草場地）×1.5、毛皮大衣 ×2
  const dfMod = di !== 2 ? 0 : dab === 'grass-pelt' && terr === 'grassy' ? 6144 : dab === 'fur-coat' ? 8192 : 0;
  if (dfMod && use(dab)) def = Math.max(1, pokeRound(def * dfMod / 4096));
  const contact = FLAG.contact.has(mk) && aab !== 'long-reach';
  // 場地對威力的修正：招式本身（廣域戰力、薄霧炸裂 ×1.5）、在地面上的攻擊方該屬性 ×1.3、打在地面上的防守方減半
  const tMove = aGround && ((mk === 'expanding-force' && terr === 'psychic') || (mk === 'misty-explosion' && terr === 'misty'));
  const tBoost = aGround && terr !== 'misty' && TERRAIN_TYPE[terr] === type;
  const tCut = dGround && ((terr === 'misty' && type === 'dragon') || (terr === 'grassy' && (mk === 'earthquake' || mk === 'bulldoze')));
  if (tMove) notes.add(`${FIELD_ZH[terr]}威力 ×1.5`);
  if (tBoost) notes.add(`${FIELD_ZH[terr]} ×1.3`);
  if (tCut) notes.add(`${FIELD_ZH[terr]}威力 ×½`);
  // 拍落：防守方有道具時威力 ×1.5（Smogon champions.ts）；超級進化帶的是自己的超級石，不算。一般寶可夢幾乎都帶道具，當作有帶；
  // 第一下就把道具拍掉，之後連用不再加倍（黏著拍不掉，每下都加倍）
  const knock = mk === 'knock-off' && !D.base, keep = knock && dab === 'sticky-hold';
  if (knock) notes.add(keep ? `${abilZh(dab)}拍不掉道具，每下威力 ×1.5` : '第一下威力 ×1.5（對手有道具）');
  // 威力修正（依 Smogon 的順序；技術高手看這一下的威力 p；first＝整場第一下）
  const bpModsOf = (p, first) => {
    const m = [];
    if (tMove || (knock && (first || keep))) m.push(6144);
    else if ((mk === 'solar-beam' || mk === 'solar-blade') && ['rain', 'sand', 'snow'].includes(wthr) && aab !== 'mega-sol') m.push(2048);
    if (o.hh) m.push(6144);
    if (tBoost) m.push(5325);
    if (tCut) m.push(2048);
    if ((aab === 'technician' && p <= 60) || (aab === 'mega-launcher' && FLAG.pulse.has(mk)) || (aab === 'strong-jaw' && FLAG.bite.has(mk))
      || (aab === 'steely-spirit' && type === 'steel') || (aab === 'sharpness' && FLAG.slicing.has(mk))) m.push(use(aab) && 6144);
    if (type === 'fairy' && (aab === 'fairy-aura' || dab === 'fairy-aura')) m.push(use('fairy-aura') && 5448);
    if ((aab === 'sheer-force' && (FLAG.secondary.has(mk) || mk === 'electro-shot')) || (aab === 'sand-force' && wthr === 'sand' && ['rock', 'ground', 'steel'].includes(type))
      || (aab === 'tough-claws' && contact) || (aab === 'punk-rock' && FLAG.sound.has(mk))) m.push(use(aab) && 5325);
    if (ate) m.push(4915);
    if ((aab === 'reckless' && FLAG.recoil.has(mk)) || (aab === 'iron-fist' && FLAG.punch.has(mk))) m.push(use(aab) && 4915);
    if (dab === 'dry-skin' && type === 'fire') m.push(use(dab) && 5120);
    if (ait.bp && (ait.type ? ait.type === type : ait.cat === cat)) m.push(ait.bp);
    return m;
  };
  // 天氣：超級日光讓自己的招式都當晴天（下雨也不會強化水招式）
  const sunny = wthr === 'sun' || aab === 'mega-sol';
  const wx = (sunny && type === 'fire') || (wthr === 'rain' && aab !== 'mega-sol' && type === 'water') ? 6144
    : (sunny && type === 'water') || (wthr === 'rain' && type === 'fire') ? 2048 : 0;
  if (wx && aab === 'mega-sol' && wthr !== 'sun') use(aab);
  r.berry = dit.berry === type && r.eff > 1;
  // 牆：物理看反射壁、特殊看光牆，極光幕兩種都擋且不和它們疊加；單打 ×½、雙打 ×2732/4096。
  // 劈瓦等招式先打破、穿透無視、急所無視
  const wallKey = ['aurora-veil', cat === 'physical' ? 'reflect' : 'light-screen'].find(w => o.walls.includes(w));
  let wall = 0;
  if (wallKey) {
    const wz = MOVES[wallKey][0];
    if (WALL_BREAK.has(mk)) notes.add(`先打破${wz}`);
    else if (aab === 'infiltrator') notes.add(`${abilZh(aab)}無視${wz}`);
    else if (r.crit) notes.add(`急所無視${wz}`);
    else { wall = o.fmt === 'd' ? 2732 : 2048; notes.add(`${wz} ×${o.fmt === 'd' ? '⅔' : '½'}`); }
  }
  // 灼傷：物理招式傷害減半（毅力不減半，攻擊反而 ×1.5，算在上面的攻擊修正）
  const burned = o.burn && cat === 'physical' && aab !== 'guts';
  if (burned) notes.add('灼傷 ×½');
  // 最終修正；first＝整場第一下（多重鱗片、樹果只算這下）
  const finalModsOf = first => {
    const m = [];
    if (wall) m.push(wall);
    if (aab === 'sniper' && r.crit) m.push(use(aab) && 6144);
    if (dab === 'multiscale' && full && first) m.push(use(dab) && 2048);
    if ((dab === 'fluffy' || dab === 'aura-guard') && contact) m.push(use(dab) && 2048);
    else if (dab === 'punk-rock' && FLAG.sound.has(mk)) m.push(use(dab) && 2048);
    if (['solid-rock', 'filter'].includes(dab) && r.eff > 1) m.push(use(dab) && 3072);
    if (dab === 'fluffy' && type === 'fire') m.push(use(dab) && 8192);
    if (ait.se && r.eff > 1) m.push(ait.se);
    else if (ait.final) m.push(ait.final);
    if (first && r.berry) m.push(dab === 'ripen' && use(dab) ? 1024 : 2048);
    return m;
  };
  // 威力 p 打一下的 16 個亂數傷害（由小到大）；child＝親子愛的第 2 下（傷害 ¼）
  const rollsOf = (p, first, child) => {
    const bp = Math.max(1, pokeRound(p * chainMods(bpModsOf(p, first), 41, 2097152) / 4096));
    let b = Math.floor(Math.floor(22 * bp * atk / def) / 50 + 2);
    if (spread) b = pokeRound(b * 3072 / 4096);
    if (child) b = pokeRound(b * 1024 / 4096);
    if (wx) b = pokeRound(b * wx / 4096);
    if (r.crit) b = Math.floor(b * 1.5);
    const fm = chainMods(finalModsOf(first), 41, 131072);
    return Array.from({ length: 16 }, (_, i) => {
      let x = Math.floor(b * (85 + i) / 100);
      if (r.stab !== 4096) x = x * r.stab / 4096;
      x = Math.floor(pokeRound(x) * r.eff);
      if (burned) x = Math.floor(x / 2);
      return pokeRound(Math.max(1, x * fm / 4096));
    });
  };
  const pw = h => mk === 'triple-axel' ? 20 * (h + 1) : power;
  const first = Array.from({ length: hits }, (_, h) => rollsOf(pw(h), !h, pb && h === 1));
  const later = r.berry || (dab === 'multiscale' && full) || (knock && !keep) ? Array.from({ length: hits }, (_, h) => rollsOf(pw(h), false, pb && h === 1)) : first;
  r.min = first.reduce((s, x) => s + x[0], 0);
  r.max = first.reduce((s, x) => s + x[15], 0);
  // 氣勢披帶、結實：HP 全滿時整場第一下最多打到剩 1 HP
  const endure = !full ? '' : dit.sash ? d.item : dab === 'sturdy' ? dab : '';
  r.endured = endure && hits === 1 && r.max >= r.hp ? endure : '';
  // 累計傷害的機率分布（超過剩下 HP 的都併在剩下 HP）
  let dist = new Map([[0, 1]]);
  r.ko = [0, 1, 2, 3].map(n => {
    (n ? later : first).forEach((rs, h) => {
      const xs = endure && !n && !h ? rs.map(x => Math.min(x, r.hp - 1)) : rs, nd = new Map();
      dist.forEach((p, v) => xs.forEach(x => { const s = Math.min(need, v + x); nd.set(s, (nd.get(s) || 0) + p / 16); }));
      dist = nd;
    });
    return dist.get(need) || 0;
  });
  r.notes = [...notes].filter(Boolean);
  return r;
}
// 幾擊打倒：ko 是 damageCalc 的 ko
const NUM_ZH = ['一', '二', '三', '四'];
function koText(ko) {
  const n = ko.findIndex(p => p > 1e-9);
  if (n < 0) return { n: 5, text: '四擊打不倒' };
  if (ko[n] > 1 - 1e-9) return { n: n + 1, text: `確定${NUM_ZH[n]}擊` };
  return { n: n + 1, text: `亂數${NUM_ZH[n]}擊（${Math.min(99.9, Math.max(0.1, Math.round(ko[n] * 1000) / 10))}%）` };
}
// 攻擊方 a 打防守方 d（damageCalc 的格式）：a 在 o.fmt 的常用攻擊招式（a.set 有登錄招式就用登錄的，見 useOf；再加 extra）逐招算，
// ok 依最大傷害排序、why 是不算的招式依原因分組；kos 會被一擊打倒的招式、top 最痛的一招
function dmgRows(a, d, o, extra) {
  const use = useOf(a.key, o.fmt, a.set)?.moves || [];
  const list = use.filter(([k]) => MOVES[k][2] !== 'status');
  if (extra && !list.some(([k]) => k === extra)) list.push([extra, 0]);
  const rows = list.map(([k, p]) => ({ k, p, r: damageCalc(a, d, k, o) }));
  const ok = rows.filter(x => !x.r.skip).sort((x, y) => (y.r.max || 0) - (x.r.max || 0)), why = {};
  rows.filter(x => x.r.skip).forEach(x => (why[x.r.skip] ||= []).push(MOVES[x.k][0]));
  return { use, ok, why, kos: ok.filter(x => x.r.ko?.[0] > 1e-9), top: ok.find(x => x.r.ko) };
}
// 對位的一方（出招表、對戰中共用）：寶可夢 key、fmt；set＝我方登錄的配招（對手不傳）。
// 沒登錄的欄位照傷害計算的預設（CALC0）：攻擊／特攻 32＋性格、速度 32＋性格、HP／防禦／特防 0、特性用 defAbOf；
// 道具：登錄了就用登錄的，沒有就帶 OP.GG 最常帶的（topItem，同傷害計算的預設）
function battler(key, fmt, set) {
  const sp = set && hasSpread(set) ? { sp: set.sp, nat: set.nat } : {};
  return { key, set, ab: set?.ab || defAbOf(key, fmt), item: set?.item || topItem(key, fmt), ...sp, atkInv: [32, 11], hp: [0, 10], defInv: [0, 10], speInv: [32, 11] };
}
// battler b 的最大 HP
const hpOf = b => statOf(MON[b.key].bs[0], invAt(b, 0, b.hp)[0], 0);
// 一對一對位：x、y 是 battler，對戰中另外帶 st { atk, def, spa, spd, spe } 能力變化、cur 目前剩下的 HP、tw 順風（沒給的當沒有、全滿）；
// f：{ fmt, weather, terrain, tr }（沒給的當沒有）；灼傷、麻痺、幫助、牆、開場特性都不算。
// 道具兩個方向都帶著（damageCalc 只讀這個方向用得到的效果，如攻擊方不看樹果）。
// 回傳 xy＝x 打 y、yx＝y 打 x（dmgRows 的結果）、spd／first（speedPair：first 0＝x 先動、1＝y 先動、-1＝同速）
function duel(x, y, f) {
  const o = { fmt: f.fmt, weather: f.weather || '', crit: false, terrain: f.terrain || '', hh: false, walls: [], burn: false };
  const st = (b, k) => b.st?.[k] || 0;
  const atk = b => ({ key: b.key, inv: b.atkInv, sp: b.sp, nat: b.nat, st: { atk: st(b, 'atk'), spa: st(b, 'spa') }, item: b.item, ab: b.ab, set: b.set });
  const def = b => ({ key: b.key, hp: b.hp, inv: b.defInv, sp: b.sp, nat: b.nat, st: { def: st(b, 'def'), spd: st(b, 'spd') }, item: b.item, ab: b.ab, cur: b.cur });
  const spe = b => ({ key: b.key, inv: b.speInv, sp: b.sp, nat: b.nat, st: st(b, 'spe'), item: b.item, ab: b.ab, tw: !!b.tw });
  return { xy: dmgRows(atk(x), def(y), o), yx: dmgRows(atk(y), def(x), o), ...speedPair(spe(x), spe(y), { weather: o.weather, terrain: o.terrain, tr: !!f.tr }) };
}

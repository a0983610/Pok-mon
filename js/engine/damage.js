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
// 不算的攻擊招式與原因；威力是 null 的（看 HP、速度，或固定傷害、一擊必殺）也不算（欺詐改成算了：用防守方的攻擊；看體重的見 WEIGHT_BP）
const NO_CALC = {};
// 看體重的招式（威力是 null，damageCalc 照體重算）：d＝看防守方的體重（打草結、踢倒），r＝看攻擊方 ÷ 防守方（重磅衝撞、高溫重壓）
const WEIGHT_BP = { 'grass-knot': 'd', 'low-kick': 'd', 'heavy-slam': 'r', 'heat-crash': 'r' };
const canCalc = k => MOVES[k][2] !== 'status' && (MOVES[k][3] != null || !!WEIGHT_BP[k]) && !NO_CALC[k];
// 寶可夢 key 的體重 kg（WEIGHT_KG，資料取自 Showdown）加特性與道具：重金屬 ×2、輕金屬 ×½、輕石 ×½（以 0.1 kg 為單位無條件捨去、至少 0.1；
// Smogon damage-calc util.ts 的 getWeight）；沒有資料回傳 0
function weightOf(key, ab, item) {
  let hg = Math.round((WEIGHT_KG[key] || 0) * 10);
  if (!hg) return 0;
  const f = ab === 'heavy-metal' ? 2 : ab === 'light-metal' ? 0.5 : 1;
  if (f !== 1) hg = Math.max(1, Math.trunc(hg * f));
  if (item === 'float-stone') hg = Math.max(1, Math.trunc(hg * 0.5));
  return hg / 10;
}
// 看體重的招式的威力（Smogon damage-calc 冠軍版 champions.ts，同 Showdown basePowerCallback）：
// 打草結、踢倒：防守方 200 kg 以上 120、100 以上 100、50 以上 80、25 以上 60、10 以上 40，不然 20；
// 重磅衝撞、高溫重壓：攻擊方是防守方的 5 倍以上 120、4 倍 100、3 倍 80、2 倍 60，不然 40
const weightBp = (k, wa, wd) => WEIGHT_BP[k] === 'd' ? (wd >= 200 ? 120 : wd >= 100 ? 100 : wd >= 50 ? 80 : wd >= 25 ? 60 : wd >= 10 ? 40 : 20)
  : (r => r >= 5 ? 120 : r >= 4 ? 100 : r >= 3 ? 80 : r >= 2 ? 60 : 40)(wa / wd);
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
  punch: 'bullet-punch drain-punch dynamic-punch fire-punch hammer-arm headlong-rush ice-hammer ice-punch jet-punch mach-punch '
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
// （辣椒噴發、飛出的內在物依 Bulbapedia 各特性頁的中文名；超級龍頭地鼠的 piercing-drill 查不到中文名，不列）
const ABIL_ZH = { aerilate: '飛行皮膚', dragonize: '龍皮膚', eelevate: '鰻鰻高升', 'mega-sol': '超級日光', 'fire-mane': '火焰鬃毛',
  'aura-guard': '波導防護', 'parental-bond': '親子愛', 'fairy-aura': '妖精氣場', 'spicy-spray': '辣椒噴發', 'innards-out': '飛出的內在物' };
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
  'guts', 'infiltrator', 'levitate', 'electric-surge', 'grassy-surge', 'misty-surge', 'psychic-surge', 'heavy-metal', 'light-metal']);
const DEF_ABILS = new Set([...Object.keys(ABIL_IMMUNE), 'bulletproof', 'soundproof', 'queenly-majesty', 'armor-tail', 'thick-fat', 'heatproof',
  'water-bubble', 'purifying-salt', 'fur-coat', 'multiscale', 'filter', 'solid-rock', 'fluffy', 'aura-guard', 'punk-rock', 'shell-armor',
  'battle-armor', 'sturdy', 'unaware', 'ripen', 'fairy-aura', ...WEATHER_OFF, 'drought', 'drizzle', 'sand-stream', 'snow-warning', 'intimidate',
  'grass-pelt', 'electric-surge', 'grassy-surge', 'misty-surge', 'psychic-surge', 'sticky-hold', 'heavy-metal', 'light-metal']);
// 看場上狀況的特性（傷害計算分頁不算，對戰中、對戰模擬才算；畫皮在出戰選角、隊伍分析的對位也算，見 damageCalc 的 a.pinch／a.fallen／d.disguise 與 duel 的 live）：
// PINCH_AB 猛火、激流、茂盛、蟲之預感＝HP 剩 1/3 以下時這個屬性的招式攻擊／特攻 ×1.5（Showdown blaze 等 onModifyAtk）；
// 大將＝出場時這一方倒下幾隻（最多 5），威力 ×1.1／1.2／1.3／1.4／1.5（Showdown supremeoverlord）；畫皮＝謎擬Ｑ還沒被揭穿時擋下一下攻擊、改扣最大 HP 的 1/8
const PINCH_AB = { blaze: 'fire', torrent: 'water', overgrow: 'grass', swarm: 'bug' };
const LIVE_ABILS = [...Object.keys(PINCH_AB), 'supreme-overlord', 'disguise'];
// 場地（算法在 damageCalc，照 Smogon 冠軍版）：在地面上（不是飛行屬性、沒有飄浮）的攻擊方用該屬性招式威力 ×1.3；
// 打在地面上的防守方時，薄霧場地龍招式、青草場地地震／重踏威力 ×½，精神場地擋先制招式；大地波動有場地時變成對應屬性、威力 ×2
const TERRAIN_TYPE = { electric: 'electric', grassy: 'grass', misty: 'fairy', psychic: 'psychic' };
// 天氣、場地的中文名（各分頁與對戰模擬的紀錄共用；模擬的背景計算只載入引擎，所以放這裡）
const FIELD_ZH = { sun: '晴天', rain: '下雨', sand: '沙暴', snow: '下雪', electric: '電氣場地', grassy: '青草場地', misty: '薄霧場地', psychic: '精神場地' };
// 出場時開天氣／場地的特性（Showdown abilities.ts onStart → field.setWeather／setTerrain；對位見 entryField，對戰模擬見 simFieldAb）
const WX_AB = { drought: 'sun', drizzle: 'rain', 'sand-stream': 'sand', 'snow-warning': 'snow' };
const TER_AB = { 'electric-surge': 'electric', 'grassy-surge': 'grassy', 'misty-surge': 'misty', 'psychic-surge': 'psychic' };
// 會先打破反射壁／光牆／極光幕再算傷害的招式（Smogon champions.ts）
const WALL_BREAK = new Set(['brick-break', 'psychic-fangs', 'raging-bull']);
// 天氣（算法在 damageCalc）：晴天火 ×1.5、水 ×½；下雨水 ×1.5、火 ×½；沙暴岩石屬性特防 ×1.5；下雪冰屬性防禦 ×1.5；
// 氣象球有天氣時變成對應屬性、威力 ×2；日光束／日光刃在下雨、沙暴、下雪時威力 ×½
const WB_TYPE = { sun: 'fire', rain: 'water', sand: 'rock', snow: 'ice' };
// 影響傷害的道具（只收 ITEMS 裡有的，也就是 OP.GG 有人帶的），從說明文字判斷效果，倍率照 Smogon 冠軍版：
// 攻擊方 side a：屬性強化道具該屬性威力 ×1.2（4915）、力量頭帶／博識眼鏡物理／特殊威力 ×1.1（4505）、寶石該屬性威力 ×1.3（5325）、
//   生命寶珠 ×1.3（5324）、達人帶效果絕佳時 ×1.2（4915）、電氣球皮卡丘攻擊特攻 ×2；
// 防守方 side d：抗性樹果受到效果絕佳的該屬性招式傷害減半（只擋第一下）、氣勢披帶 HP 全滿時撐住會倒下的一擊（剩 1 HP）、
//   氣球浮在空中：地面招式打不到、不吃場地（Showdown items.ts airballoon；被打中就破掉，對戰中自己標「沒有道具」，對戰模擬會打破）；
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
  ['focus-sash', { side: 'd', sash: true }], ['air-balloon', { side: 'd', balloon: true }], ['choice-scarf', { side: 'ad', spe: 6144 }]]
  .forEach(([k, v]) => { if (ITEMS[k]) DMG_ITEMS[k] = v; });
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
// s：{ key, inv 速度投資 [點數, 性格]（或 sp／nat，見 invAt）, st 速度能力變化, item, ab 特性, tw 順風, par 麻痺, status 有異常狀態（麻痺或灼傷），
//   unburden 輕裝發動中（對戰模擬：道具用掉或被拿掉後、沒有道具時 ×2，Showdown unburden onModifySpe） }；
// f：{ weather（已扣掉無關天氣／氣閘）, terrain }。回傳 { v 速度, notes 有作用的修正 }
function speedOf(s, f) {
  const [sp, nat] = invAt(s, 5, s.inv), notes = [], mods = [];
  let v = stageStat(statOf(MON[s.key].bs[5], sp, 5, nat), s.st);
  if (s.tw) { mods.push(8192); notes.push('順風 ×2'); }
  const need = SPE_ABILS[s.ab];
  if (need && need === (need === 'electric' ? f.terrain : f.weather)) { mods.push(8192); notes.push(`${abilZh(s.ab)} ×2`); }
  else if (s.ab === 'quick-feet' && s.status) { mods.push(6144); notes.push(`${abilZh(s.ab)} ×1.5`); }
  if (DMG_ITEMS[s.item]?.spe) { mods.push(DMG_ITEMS[s.item].spe); notes.push(`${ITEMS[s.item][0]} ×1.5`); }
  if (s.unburden && s.ab === 'unburden' && !s.item) { mods.push(8192); notes.push(`${abilZh(s.ab)} ×2`); }
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
// 攻擊方 a：{ key, inv 投資 [點數, 性格], st { atk, spa, def（撲擊用） } 能力變化, item, ab 特性 }；防守方 d：{ key, hp／inv 投資 [點數, 性格], st { def, spd, atk（欺詐用） }, item, ab,
// cur 目前剩下的 HP（沒給＝全滿）, atkInv 攻擊投資（欺詐用；沒有 sp 時才看） }
// （投資也可以改給 sp／nat，見 invAt；a 另外可帶 set 給 dmgRows 用登錄的招式）；d.noItem＝確定沒有道具（對戰中標了「沒有道具」：拍落不加成）；
// 看場上狀況的特性（LIVE_ABILS，沒給就不算）：a.pinch＝攻擊方 HP 剩 1/3 以下（PINCH_AB）、a.fallen＝攻擊方這一方倒下幾隻（大將）、
// d.disguise＝防守方的畫皮還沒被揭穿（這次的第一下沒有傷害、改扣 1/8，之後連用照常；回傳 disguise 標記）；
// 對戰模擬另外給：a.types／d.types＝場上現在的屬性（變幻自如、自由者換過；沒給照圖鑑）、a.ptUsed＝攻擊方的變幻自如／自由者這次上場已經發動過
// （發動過就只有現在的屬性算本系；沒發動過的這招出手前會變成招式的屬性，照樣算本系）、a.flashFire＝攻擊方的引火吸收過火屬性招式（火屬性招式攻擊／特攻 ×1.5）、
// d.glaive＝防守方用了巨劍突擊、還沒再出招（受到的傷害 ×2，Showdown glaiverush onSourceModifyDamage）；
// 雙打時 a.field／d.field＝攻擊方／防守方場上還站著幾隻（沒給當 2）：範圍招式實際只打到 1 隻時不減傷（Showdown battle-actions.ts：targets.length > 1 才 spreadHit）；
// o：{ fmt 's'／'d', weather, crit, terrain, hh 幫助, walls 防守方的牆, burn 攻擊方灼傷, bp 威力（對戰模擬給隨場上狀況變的，見 simVarBp；沒給照資料）,
//   last 攻擊方比防守方晚出招（特性分析；沒給當先出招）}
// （必定急所的招式不管 crit 都算急所）。不算的招式回傳 { skip 原因 }；
// 沒有效果的回傳 eff 0（沒有 hp 以後的欄位；immuneBy＝讓招式無效的防守方特性，blockedBy＝其他原因的說明，如精神場地擋先制）；
// 其餘回傳 hp 防守方最大 HP、min／max 用一次的傷害（多段攻擊是各下加總）、ko[n] 連用 n＋1 次打掉剩下 HP 的機率（n＝0～3）、stab 本系倍率（4096 制）、
// endured 撐住了會倒下的第一下的氣勢披帶或結實（道具／特性 key）、berry 抗性樹果有減半、notes 有作用的特性與招式效果、
// rolls／later 每一下的 16 個亂數傷害（rolls＝這次、later＝之後連用：樹果、多重鱗片、拍落第一下的加成沒了；對戰模擬抽亂數用）。
// d.cur 比最大 HP 少時，氣勢披帶、結實、多重鱗片（都要 HP 全滿）沒有作用
function damageCalc(a, d, mk, o) {
  const [, mtype, cat, bp0] = MOVES[mk];
  let power0 = o.bp ?? bp0;
  if (NO_CALC[mk]) return { skip: NO_CALC[mk] };
  if (power0 == null && !WEIGHT_BP[mk]) return { skip: '威力會變動或固定傷害' };
  const A = MON[a.key], D = MON[d.key], aab = a.ab || '', notes = new Set(), aTy = a.types || A.types, dTy = d.types || D.types;
  const use = k => { notes.add(abilZh(k)); return true; };
  // 破格無視防守方的特性（Smogon 列的可無視特性涵蓋這裡用到的，只有妖精氣場、熟成不在其中）
  const dab = aab === 'mold-breaker' && !['fairy-aura', 'ripen'].includes(d.ab) ? '' : d.ab || '';
  if (d.ab && !dab && DEF_ABILS.has(d.ab)) notes.add(`${abilZh(aab)}無視${abilZh(d.ab)}`);
  // 看體重的招式：威力照雙方體重（破格無視防守方的重金屬、輕金屬）；沒有體重資料不算
  if (power0 == null) {
    const wa = weightOf(a.key, aab, a.item), wd = weightOf(d.key, dab, d.item);
    if (!wd || (WEIGHT_BP[mk] === 'r' && !wa)) return { skip: '沒有體重資料' };
    power0 = weightBp(mk, wa, wd);
    notes.add(WEIGHT_BP[mk] === 'd' ? `${D.zh} ${wd} kg：威力 ${power0}` : `體重 ${wa}／${wd} kg：威力 ${power0}`);
  }
  const offBy = [aab, d.ab].find(k => WEATHER_OFF.includes(k)), wthr = offBy ? '' : o.weather;
  if (offBy && o.weather) notes.add(`${abilZh(offBy)}讓天氣沒有作用`);
  // 在地面上：不是飛行屬性、沒有飄浮、沒帶氣球（Smogon isGrounded；重力、黑色鐵球不在可選的道具裡，不用看）
  const terr = o.terrain || '', balloon = DMG_ITEMS[d.item]?.balloon;
  const aGround = !aTy.includes('flying') && aab !== 'levitate' && !DMG_ITEMS[a.item]?.balloon, dGround = !dTy.includes('flying') && dab !== 'levitate' && !balloon;
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
  // 廣域戰力在精神場地（攻擊方在地面上）變成打所有對手；實際打到的：對手場上的，地震這種打周圍全部的（all-other-pokemon）再加自己的隊友
  const hitN = (d.field ?? 2) + (MOVES[mk][8] === 'all-other-pokemon' ? (a.field ?? 2) - 1 : 0);
  const spread = o.fmt === 'd' && hitN > 1 && (SPREAD.has(mk) || (mk === 'expanding-force' && terr === 'psychic' && aGround));
  if (aab === 'parental-bond' && hits === 1 && !spread) [hits, hitNote, pb] = [2, use(aab) && `${abilZh(aab)}：第 2 下傷害 ¼`, true];
  const scrappy = aab === 'scrappy' && (type === 'normal' || type === 'fighting') && dTy.includes('ghost') && use(aab);
  // 冷凍乾燥對水屬性 ×2（Smogon util.ts getMoveEffectiveness：Freeze-Dry 打 Water 回傳 2）
  const dTypes = scrappy ? dTy.filter(t => t !== 'ghost') : dTy, dry = mk === 'freeze-dry' && dTypes.includes('water');
  if (dry) notes.add('冷凍乾燥對水屬性效果絕佳');
  const r = { type, cat, power, hits, hitNote, spread, eff: dry ? eff(type, dTypes.filter(t => t !== 'water')) * 2 : eff(type, dTypes),
    crit: (o.crit || ALWAYS_CRIT.has(mk)) && !(['shell-armor', 'battle-armor'].includes(dab) && use(dab)) };
  if (ABIL_IMMUNE[dab] === type || (dab === 'bulletproof' && FLAG.bullet.has(mk)) || (dab === 'soundproof' && FLAG.sound.has(mk))
    || (['queenly-majesty', 'armor-tail'].includes(dab) && FLAG.priority.has(mk))) [r.eff, r.immuneBy] = [0, dab];
  else if (r.eff && balloon && type === 'ground') [r.eff, r.blockedBy] = [0, `${ITEMS[d.item][0]}浮在空中`];
  else if (r.eff && terr === 'psychic' && dGround && FLAG.priority.has(mk)) [r.eff, r.blockedBy] = [0, `${FIELD_ZH.psychic}擋先制招式`];
  // 鐵滾輪沒有場地時失敗（Smogon champions.ts：Steel Roller && !field.terrain）
  else if (r.eff && mk === 'steel-roller' && !terr) [r.eff, r.blockedBy] = [0, '沒有場地時會失敗'];
  if (!r.eff) return r;
  // 本系 ×1.5；變幻自如／自由者每招都算本系（對戰模擬裡這次上場發動過的 a.ptUsed 就只看現在的屬性）；適應力本系再 +0.5
  const own = aTy.includes(type);
  r.stab = 4096 + (own || (['protean', 'libero'].includes(aab) && !a.ptUsed && use(aab)) ? 2048 : 0) + (aab === 'adaptability' && own && use(aab) ? 2048 : 0);
  const ai = mk === 'body-press' ? 2 : cat === 'physical' ? 1 : 3, di = cat === 'physical' || HIT_DEF.has(mk) ? 2 : 4;
  // 欺詐：攻擊用防守方的攻擊能力值與攻擊的能力變化（Showdown overrideOffensivePokemon 'target'）；防守方的攻擊投資看 d.sp，沒有再看 d.atkInv，都沒有算 0 點
  const foul = mk === 'foul-play';
  if (foul) notes.add(`用${D.zh}的攻擊計算`);
  const [asp, anat] = foul ? invAt(d, 1, d.atkInv || [0, 10]) : invAt(a, ai, a.inv), [dsp, dnat] = invAt(d, di, d.inv);
  const ait = DMG_ITEMS[a.item] || {}, dit = DMG_ITEMS[d.item] || {};
  r.hp = d.maxHp ?? statOf(D.bs[0], invAt(d, 0, d.hp)[0], 0);
  // 剩下的 HP need：沒給 cur 或不少於最大 HP 都算全滿
  const full = !(d.cur < r.hp), need = full ? r.hp : Math.max(1, d.cur);
  // 能力變化：急所時不計攻擊方的下降、防守方的上升；對方是天然就不計（撲擊看自己防禦的能力變化）
  let ast = (foul ? d.st.atk : ai === 1 ? a.st.atk : ai === 3 ? a.st.spa : a.st.def) || 0;
  if (CHARGE_SPA.has(mk) && ai === 3) {
    ast = Math.max(-6, Math.min(6, ast + (aab === 'contrary' ? -1 : 1)));
    notes.add(aab === 'contrary' ? `出招前特攻 −1（${abilZh(aab)}）` : '出招前特攻 +1');
  }
  const dst = di === 2 ? d.st.def : d.st.spd;
  let atk = statOf((foul ? D : A).bs[ai], asp, ai, anat);
  if (ast && !(r.crit && ast < 0) && !(dab === 'unaware' && use(dab))) atk = stageStat(atk, ast);
  if (aab === 'hustle' && cat === 'physical' && use(aab)) atk = pokeRound(atk * 3 / 2);
  const atMods = [];
  if ((aab === 'solar-power' && wthr === 'sun' && cat === 'special') || (aab === 'guts' && o.burn && cat === 'physical')
    || (aab === 'fire-mane' && type === 'fire')) atMods.push(use(aab) && 6144);
  else if ((aab === 'water-bubble' && type === 'water') || (['huge-power', 'pure-power'].includes(aab) && cat === 'physical')) atMods.push(use(aab) && 8192);
  if ((dab === 'thick-fat' && (type === 'fire' || type === 'ice')) || (dab === 'water-bubble' && type === 'fire') || (dab === 'purifying-salt' && type === 'ghost')
    || (dab === 'heatproof' && type === 'fire')) atMods.push(use(dab) && 2048);
  if (a.pinch && PINCH_AB[aab] === type) atMods.push(use(aab) && 6144);
  // 引火（Showdown flashfire 狀態 onModifyAtk／onModifySpA）：吸收過火屬性招式後自己的火屬性招式 ×1.5（對戰模擬給 a.flashFire）
  if (a.flashFire && aab === 'flash-fire' && type === 'fire') atMods.push(use(aab) && 6144);
  if (ait.atk && family(A) === ait.mon) atMods.push(ait.atk);
  atk = Math.max(1, pokeRound(atk * chainMods(atMods, 410, 131072) / 4096));
  let def = statOf(D.bs[di], dsp, di, dnat);
  if (dst && !(r.crit && dst > 0) && !(aab === 'unaware' && use(aab))) def = stageStat(def, dst);
  if (aab !== 'mega-sol' && ((wthr === 'sand' && di === 4 && dTy.includes('rock')) || (wthr === 'snow' && di === 2 && dTy.includes('ice')))) def = pokeRound(def * 3 / 2);
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
  // 拍落：防守方有道具時威力 ×1.5（Smogon champions.ts）；超級進化帶的是自己的超級石，不算。一般寶可夢幾乎都帶道具，當作有帶（標了確定沒有道具 noItem 的除外）；
  // 第一下就把道具拍掉，之後連用不再加倍（黏著拍不掉，每下都加倍）
  const knock = mk === 'knock-off' && !D.base && !d.noItem, keep = knock && dab === 'sticky-hold';
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
    // 分析：比對方晚出招 ×1.3（o.last；Showdown 是這回合場上其他寶可夢都出過招，Smogon champions.ts 同組 5325）
    if ((aab === 'sheer-force' && (FLAG.secondary.has(mk) || mk === 'electro-shot')) || (aab === 'sand-force' && wthr === 'sand' && ['rock', 'ground', 'steel'].includes(type))
      || (aab === 'tough-claws' && contact) || (aab === 'punk-rock' && FLAG.sound.has(mk)) || (aab === 'analytic' && o.last)) m.push(use(aab) && 5325);
    if (aab === 'supreme-overlord' && a.fallen > 0) m.push(use(aab) && [4096, 4506, 4915, 5325, 5734, 6144][Math.min(5, a.fallen)]);
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
    if (d.glaive) { m.push(8192); notes.add('巨劍突擊後受到的傷害 ×2'); }
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
  const rollsAll = isFirst => Array.from({ length: hits }, (_, h) => rollsOf(pw(h), isFirst && !h, pb && h === 1));
  // 畫皮（d.disguise：還沒被揭穿；破格無視）：這次的第一下沒有傷害，揭穿後扣最大 HP 的 1/8（Showdown disguise onDamage／onUpdate），之後連用照常；
  // 破掉畫皮的這一招整招都當效果普通（Showdown disguise onEffectiveness 的 neutral：連續攻擊揭穿後的幾下也是，效果絕佳／不好的修正、抗性樹果都不算）
  const disg = d.disguise && dab === 'disguise' && d.key === 'mimikyu';
  let first0;
  if (disg && r.eff !== 1) {
    const keep0 = { eff: r.eff, berry: r.berry };
    Object.assign(r, { eff: 1, berry: false });
    first0 = rollsAll(true);
    Object.assign(r, keep0);
  } else first0 = rollsAll(true);
  const later = disg || r.berry || (dab === 'multiscale' && full) || (knock && !keep) ? rollsAll(false) : first0;
  if (disg) { r.disguise = true; notes.add(`${abilZh(dab)}擋下第一下（改扣 1/8）${hits > 1 && r.eff !== 1 ? '，這招其他下照效果普通算' : ''}`); }
  const first = disg ? [Array(16).fill(Math.max(1, Math.floor(r.hp / 8))), ...first0.slice(1)] : first0;
  r.min = first.reduce((s, x) => s + x[0], 0);
  r.max = first.reduce((s, x) => s + x[15], 0);
  [r.rolls, r.later] = [first, later];
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
// o.top＝沒登錄招式時只算 OP.GG 使用率前幾招（含變化招式一起排，同預填的配招 defaultSet；對位 duel 給 4，傷害計算分頁不給＝全部常用招式）；
// ok 依最大傷害排序（同分再比之後連用的最大傷害：畫皮讓單發招式第一下都是 1/8）、why 是不算的招式依原因分組；kos 會被一擊打倒的招式、top 最痛的一招
function dmgRows(a, d, o, extra) {
  const use = useOf(a.key, o.fmt, a.set)?.moves || [];
  const pool = o.top && !a.set?.moves?.some(Boolean) ? byUse(use).slice(0, o.top) : use;
  const list = pool.filter(([k]) => MOVES[k][2] !== 'status');
  if (extra && !list.some(([k]) => k === extra)) list.push([extra, 0]);
  const rows = list.map(([k, p]) => ({ k, p, r: damageCalc(a, d, k, o) }));
  const laterMax = x => (x.r.later || []).reduce((s, rs) => s + rs[15], 0);
  const ok = rows.filter(x => !x.r.skip).sort((x, y) => (y.r.max || 0) - (x.r.max || 0) || laterMax(y) - laterMax(x)), why = {};
  rows.filter(x => x.r.skip).forEach(x => (why[x.r.skip] ||= []).push(MOVES[x.k][0]));
  return { use, ok, why, kos: ok.filter(x => x.r.ko?.[0] > 1e-9), top: ok.find(x => x.r.ko) };
}
// 對位的一方（出招表、對戰中共用）：寶可夢 key、fmt；set＝我方登錄的配招（對手不傳）。
// 能力點數與性格：登錄了就用登錄的，沒有就用 OP.GG 最常見的（topSpread，同傷害計算的預設），沒有統計才照傷害計算的固定投資（CALC0：
// 攻擊／特攻 32＋性格、速度 32＋性格、HP／防禦／特防 0）；特性：登錄的，沒有用 defAbOf；
// 道具：登錄了就用登錄的，沒有就帶 OP.GG 最常帶的（topItem，同傷害計算的預設）
function battler(key, fmt, set) {
  const sp = set && hasSpread(set) ? { sp: set.sp, nat: set.nat } : topSpread(key, fmt) || {};
  return { key, set, ab: set?.ab || defAbOf(key, fmt), item: set?.item || topItem(key, fmt), ...sp, atkInv: [32, 11], hp: [0, 10], defInv: [0, 10], speInv: [32, 11] };
}
// battler b 的最大 HP（變身來的有 maxHp：HP 照自己的，見 imposterVs）
const hpOf = b => b.maxHp ?? statOf(MON[b.key].bs[0], invAt(b, 0, b.hp)[0], 0);
// 特性變身者（百變怪）出場就變成對面那隻 y（Showdown abilities.ts imposter → pokemon.ts transformInto，冠軍版 mod 沒改；同對戰模擬的 simTransform）：
// 寶可夢、HP 以外的能力（含能力點數與性格）、特性、招式、能力變化照 y 的；HP（最大與剩下的）、道具、異常狀態、場上狀態、對戰中的格子資訊照自己的。
// 自己已經變身過、或 y 是變身來的不能變（兩隻百變怪：先變的變成另一隻百變怪，後變的失敗，兩邊都只有變身這招）；沒有 y 也不變。
// keepSt＝能力變化照自己的（對戰中已經在場上的：變身後的能力變化由使用者在位置卡調）；tfFrom＝變身前的寶可夢 key
function imposterVs(x, y, keepSt = false) {
  if (x.ab !== 'imposter' || x.tfFrom || !y || y.tfFrom) return x;
  return { ...y, tfFrom: x.key, maxHp: hpOf(x), cur: x.cur, item: x.item, noItem: x.noItem, status: x.status, walls: x.walls, field: x.field, tw: x.tw,
    i: x.i, H: x.H, pct: x.pct, st: keepSt ? x.st : y.st, live: x.live, fallen: x.fallen, bust: x.bust };
}
// 一對一對位：x、y 是 battler，對戰中另外帶 st { atk, def, spa, spd, spe } 能力變化、cur 目前剩下的 HP、tw 順風（沒給的當沒有、全滿）、
// noItem 確定沒有道具、field 這一方場上還站著幾隻（見 damageCalc）、status 異常狀態（'brn' 灼傷：物理招式減半，毅力不減反而攻擊 ×1.5；
// 'par' 麻痺：速度 ×½，飛毛腿不減反而 ×1.5）、walls 這一方的牆（反射壁、光牆、極光幕）；沒登錄招式的一方只算 OP.GG 使用率前 4 招（dmgRows 的 o.top，同預填的配招）；
// f：{ fmt, weather, terrain, tr, crit 雙方都急所（對戰中反推傷害用）, hh 幫助（兩個方向都 ×1.5，對戰中的對手組合用）}（沒給的當沒有）；
// 開場特性不在這裡算（出場開的天氣場地由呼叫端用 entryField 放進 f）。
// live＝對戰中：算看場上狀況的特性（LIVE_ABILS：猛火類看 cur、大將看 fallen 這一方倒下幾隻），沒給的（出戰選角、隊伍分析）不算；
// 畫皮不看 live：bust＝被揭穿了（對戰中照位置卡標的；沒給的雙方都剛出場，畫皮一定還在，換上來吃過一下的 matchup 會給 bust），變身來的畫皮不算。道具兩個方向都帶著（damageCalc 只讀這個方向用得到的效果，如攻擊方不看樹果）。
// 回傳 xy＝x 打 y、yx＝y 打 x（dmgRows 的結果）、spd／first（speedPair：first 0＝x 先動、1＝y 先動、-1＝同速）
function duel(x, y, f) {
  const o = { fmt: f.fmt, weather: f.weather || '', crit: !!f.crit, terrain: f.terrain || '', hh: !!f.hh, top: 4 };
  const st = (b, k) => b.st?.[k] || 0;
  const atk = b => ({ key: b.key, inv: b.atkInv, sp: b.sp, nat: b.nat, st: { atk: st(b, 'atk'), spa: st(b, 'spa'), def: st(b, 'def') }, item: b.item, ab: b.ab, set: b.set, field: b.field,
    pinch: !!b.live && (b.cur ?? hpOf(b)) <= hpOf(b) / 3, fallen: b.live ? b.fallen || 0 : 0 });
  const def = b => ({ key: b.key, hp: b.hp, inv: b.defInv, sp: b.sp, nat: b.nat, st: { def: st(b, 'def'), spd: st(b, 'spd'), atk: st(b, 'atk') }, item: b.item, ab: b.ab, cur: b.cur,
    noItem: b.noItem, field: b.field, atkInv: b.atkInv, maxHp: b.maxHp, disguise: !b.bust && !b.tfFrom });
  const spe = b => ({ key: b.key, inv: b.speInv, sp: b.sp, nat: b.nat, st: st(b, 'spe'), item: b.item, ab: b.ab, tw: !!b.tw, par: b.status === 'par', status: !!b.status });
  // a 打 d 這個方向：d 那一方的牆、a 灼傷（毅力有異常狀態就照灼傷的算法：攻擊 ×1.5、不減半，同對戰模擬）
  const dir = (a, d) => ({ ...o, walls: d.walls || [], burn: a.status === 'brn' || (a.ab === 'guts' && !!a.status) });
  // 分析看誰晚出招（damageCalc 的 o.last）：照 speedPair 的先後（含戲法空間），同速兩邊都算晚出招（同 Smogon 速度不比對方快就算），先制招式不看
  const sp = speedPair(spe(x), spe(y), { weather: o.weather, terrain: o.terrain, tr: !!f.tr });
  return { xy: dmgRows(atk(x), def(y), { ...dir(x, y), last: sp.first !== 0 }), yx: dmgRows(atk(y), def(x), { ...dir(y, x), last: sp.first !== 1 }), ...sp };
}
// dmgRows 的結果裡最快打倒對方的：n＝連用同一招幾下打倒（每招取打倒機率一半以上的次數，取最少的；四擊打不倒是 9）、
// pri＝有沒有先制招式也是 n 下打倒。擊掌奇襲、迎頭一擊只有上場後第一回合能用（FIRST_TURN），只算一下打倒的
const FIRST_TURN = new Set(['fake-out', 'first-impression']);
function fastestKO(rows) {
  const ns = rows.ok.map(x => { const h = x.r.ko ? x.r.ko.findIndex(p => p >= 0.5) + 1 || 9 : 9; return [FIRST_TURN.has(x.k) && h > 1 ? 9 : h, FLAG.priority.has(x.k)]; });
  const n = Math.min(9, ...ns.map(([h]) => h));
  return { n, pri: n < 9 && ns.some(([h, p]) => p && h === n) };
}
// 一對一誰先打倒誰：a 我方、b 對手（fastestKO），first 同 duel。幾下少的贏；一樣多時有先制招式的一方先出手，
// 都有或都沒有看速度（同速算我方沒贏）；雙方四擊都打不倒算沒贏
const winKO = (a, b, first) => a.n < 9 && (a.n < b.n || a.n === b.n && (a.pri !== b.pri ? a.pri : first === 0));
// 威嚇對攻擊方特性 ab 的效果 [攻擊變化, 特攻變化]，照 Smogon util.ts 的 checkIntimidate；不吃威嚇回傳 null（傷害計算、對戰中、出戰選角的對位共用）
function intimidateOn(ab) {
  if (['clear-body', 'white-smoke', 'hyper-cutter', 'full-metal-body', 'inner-focus', 'own-tempo', 'oblivious', 'scrappy'].includes(ab)) return null;
  if (['contrary', 'defiant', 'guard-dog'].includes(ab)) return [1, 0];
  return ab === 'simple' ? [-2, 0] : ab === 'competitive' ? [-1, 2] : [-1, 0];
}
// battler b 吃了特性是威嚇的 by 出場：照 intimidateOn 改 b 的攻擊／特攻能力變化（by 不是威嚇、或 b 不吃威嚇就原樣回傳）。
// 變身者（百變怪）照 Pokémon Showdown（對戰模擬實際打出來的紀錄）：先吃對面的威嚇再變身，能力變化抄成對面的，所以 b 是變身來的不降；
// 變身抄到的威嚇變完身會發動，所以 by 是變身來的照樣降（同對戰模擬 simImposter）
function intimidated(b, by) {
  const e = by.ab === 'intimidate' && !b.tfFrom && intimidateOn(b.ab);
  if (!e) return b;
  const c = (k, d) => Math.max(-6, Math.min(6, (b.st?.[k] || 0) + d));
  return { ...b, st: { ...b.st, atk: c('atk', e[0]), spa: c('spa', e[1]) } };
}
// 對位時出場特性開出來的天氣、場地（WX_AB、TER_AB）：x、y 是 battler（變身抄到的也會發動，同 Showdown 與對戰模擬）；雙方同時出場時照速度快的先發動，
// 慢的開的蓋掉先開的（Showdown battle-actions.ts runSwitch：fieldEvent('SwitchIn') 照速度排；field.ts setWeather 不同天氣直接蓋掉、同一種失敗），同速當 x 先；
// sw＝只有 x 剛出場（換上來：牠早就在場上，牠開的先在，x 開的再蓋掉）。回傳 { weather, terrain }（沒有是 ''）
function entryField(x, y, sw = false) {
  const v = b => speedOf({ key: b.key, inv: b.speInv, sp: b.sp, nat: b.nat, st: 0, item: b.item, ab: b.ab }, { weather: '', terrain: '' }).v;
  const f = { weather: '', terrain: '' }, order = sw ? [y, x] : v(x) >= v(y) ? [x, y] : [y, x];
  order.forEach(b => { if (WX_AB[b.ab]) f.weather = WX_AB[b.ab]; if (TER_AB[b.ab]) f.terrain = TER_AB[b.ab]; });
  return f;
}
// 出戰選角的一對一：x 我方、y 對手（battler；對戰中的換人另外帶 cur 等，同 duel），f 同 duel。回傳
//   head：正面對打（雙方全滿，有 cur 的照 cur）先打倒牠；sw：換上來先吃牠最痛的一招（最高傷害），剩下的 HP 對打還先打倒牠（換上來吃過一下，
//   氣勢披帶、多重鱗片就沒用了，畫皮也被揭穿）；ohko：沒贏、而且牠一下就打得倒我又比我先出手（速度或先制招式）；
//   first、spd（同 duel）、me／opp（fastestKO 的 n）、oppPri（牠的 opp 下有先制招式，單打改用模擬判斷時 duelVs 重算 ohko 用）、left 換上來吃過最痛的一招後剩下的 HP（0 以下＝會倒）、big 那一招（沒有會痛的招式是 ''）給畫面說明用
// f.intim：算出場特性威嚇（intimidated）。'both'＝正面對打時雙方都剛出場，各自的威嚇打對方（出戰選角、隊伍分析）；
// 'me'＝只有我方剛出場（對戰中的換人：對手早就在場上，牠的威嚇不會再觸發）；換上來吃一下那段也只有我方剛出場。沒給就不算。
// f.sw＝換上來那段的天氣、場地（entryField 的 sw；沒給同 f）
function matchup(x, y, f) {
  const yi = f.intim ? intimidated(y, x) : y, xi = f.intim === 'both' ? intimidated(x, y) : x, fs = f.sw ? { ...f, ...f.sw } : f;
  const d = duel(xi, yi, f), a = fastestKO(d.xy), b = fastestKO(d.yx), head = winKO(a, b, d.first);
  // 換上來：吃牠最痛的一招（這時只有我方的威嚇有作用）；剩下的 HP 比全滿少，正面都打不贏的換上來也當打不贏，不用再算
  const ds = xi === x && fs === f ? d : duel(x, yi, fs), cur = (x.cur ?? hpOf(x)) - Math.max(0, ...ds.yx.ok.map(r => r.r.max || 0));
  let sw = false;
  // 吃過一下：畫皮已經被揭穿
  if (head && cur > 0) { const d2 = duel({ ...x, cur, bust: true }, yi, fs); sw = winKO(fastestKO(d2.xy), fastestKO(d2.yx), d2.first); }
  return { head, sw, ohko: !head && b.n === 1 && (b.pri || d.first !== 0), first: d.first, spd: d.spd.map(s => s.v), me: a.n, opp: b.n, oppPri: b.pri,
    left: cur, big: ds.yx.ok[0]?.r.max ? ds.yx.ok[0].k : '' };
}

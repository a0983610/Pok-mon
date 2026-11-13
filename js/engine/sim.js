// 計算引擎：資料與純邏輯，不碰 DOM（畫面在 js/ui/）
// ---------- 對戰模擬（單打：6 選 3，雙方每回合同時出招） ----------
// 算攻擊招式的傷害與招式本身附帶的效果（使用限制、自己的能力變化、反作用力與吸血、打完換人、追加效果見 SIM_SEC）、命中率（見 simAcc），
// 加上輔助招（強化、守住、回復、異常狀態、撒菱、擾亂，見 SIM_SUP）與相關的道具、特性、回合結束效果，以及 PP（照 OP.GG 冠軍版的 PP，用完只能掙扎）。
// 看場上狀況的特性：猛火類、大將（simCalc）、畫皮（simDisguised）、加速、心情不定（simEnd）、踩影（simOpts）、變幻自如／自由者（simProtean）、
// 戰鬥切換（simStance）、吸收類（simAbsorb）、被打中發動的（simHitEffect、simOnHit）、超級日光（simWxOf）、複製（simTrace）、
// 自信過度與飛出的內在物（simKO）、危險迴避（simMove、simEnd）；威力會變的招式見 simVarBp。
// 不算：幻覺（雙方都看得到對方配招，沒有作用）；只做單打。
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
// 復仇同金屬爆炸（都還、×1.5；Showdown comeuppance damageCallback）
const SIM_REACT = { counter: { cat: 'physical', x: 2 }, 'mirror-coat': { cat: 'special', x: 2 }, 'metal-burst': { cat: '', x: 1.5 }, comeuppance: { cat: '', x: 1.5 } };
// 威力看場上狀況、damageCalc 算不了（資料沒有威力）的攻擊招式：威力在 simVarBp 算好再交給 damageCalc（o.bp）
const SIM_VARBP = new Set(['gyro-ball', 'reversal', 'flail', 'fling']);
// 投擲的威力（Showdown items 的 fling.basePower，資料裡有的道具；超級石都是 80 另外算，沒列的不能丟）；效果另見 simMove
const SIM_FLING = { 'air-balloon': 10, 'babiri-berry': 10, 'big-root': 10, 'binding-band': 30, 'black-belt': 30, 'black-glasses': 30, 'bright-powder': 10, charcoal: 30,
  'charti-berry': 10, 'chesto-berry': 10, 'choice-scarf': 10, 'chople-berry': 10, 'colbur-berry': 10, 'damp-rock': 60, 'eject-button': 30, 'electric-seed': 10,
  'expert-belt': 10, 'fairy-feather': 10, 'focus-band': 10, 'focus-sash': 10, 'grassy-seed': 10, 'haban-berry': 10, 'hard-stone': 100, 'heat-rock': 60, 'iron-ball': 130,
  'kasib-berry': 10, 'kings-rock': 30, leek: 60, leftovers: 10, 'leppa-berry': 10, 'life-orb': 30, 'light-ball': 30, 'light-clay': 30, 'lum-berry': 10, magnet: 30,
  'mental-herb': 10, 'metal-coat': 30, metronome: 30, 'miracle-seed': 30, 'muscle-band': 10, 'mystic-water': 30, 'never-melt-ice': 30, 'occa-berry': 10, 'passho-berry': 10,
  'poison-barb': 70, 'psychic-seed': 10, 'quick-claw': 80, 'red-card': 10, 'rindo-berry': 10, 'rocky-helmet': 60, 'roseli-berry': 10, 'scope-lens': 30, 'sharp-beak': 50,
  'shell-bell': 30, 'shuca-berry': 10, 'silk-scarf': 10, 'sitrus-berry': 10, 'smooth-rock': 10, 'soft-sand': 10, 'spell-tag': 30, 'terrain-extender': 60,
  'twisted-spoon': 30, 'white-herb': 10, 'wide-lens': 10, 'wise-glasses': 10, 'yache-berry': 10, 'zoom-lens': 10 };
const simFlingBp = it => !it ? 0 : isStone(it) ? 80 : SIM_FLING[it] || 0;
// 一擊必殺（Showdown data/moves.ts 的 ohko、sim/battle-actions.ts 的命中判定；冠軍版 mod 沒改）：命中率固定 30（不吃 simAcc 的修正，
// 雙方任一隻特性無防守就必中）；絕對零度不是冰屬性的用時命中率 20、打冰屬性沒有效果；特性結實不受影響（破格無視結實）；打中就倒下（氣勢披帶、挺住撐得住）。
// 照亂數打時抽中不中，期望值時算打掉剩下的 HP × 命中率
const SIM_OHKO = new Set(['fissure', 'horn-drill', 'sheer-cold', 'guillotine']);
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
const SIM_STAT_ZH = { atk: '攻擊', def: '防禦', spa: '特攻', spd: '特防', spe: '速度', acc: '命中', eva: '閃避' };
// 反作用力：打出的傷害 × 比例，四捨五入、至少 1（Showdown recoil、calcRecoilDamage）；特性堅硬腦袋、魔法防守不受。
// 鐵蹄光線不管有沒有打中都扣自己最大 HP 的一半（四捨五入，Showdown mindBlownRecoil）
const SIM_RECOIL = { 'brave-bird': [33, 100], 'double-edge': [33, 100], 'flare-blitz': [33, 100], 'volt-tackle': [33, 100],
  'wave-crash': [33, 100], 'wood-hammer': [33, 100], 'head-smash': [1, 2], 'light-of-ruin': [1, 2], 'wild-charge': [1, 4] };
// 吸血：回復打出的傷害 × 比例，四捨五入、至少 1（Showdown drain）；道具大根莖 ×1.3（5324/4096，Showdown bigroot）
const SIM_DRAIN = { 'bitter-blade': [1, 2], 'drain-punch': [1, 2], 'giga-drain': [1, 2], 'horn-leech': [1, 2], 'leech-life': [1, 2],
  'matcha-gotcha': [1, 2], 'parabolic-charge': [1, 2], 'draining-kiss': [3, 4] };
// 攻擊招式的追加效果（Showdown data/moves.ts 的 secondary／secondaries，冠軍版 mods/champions/moves.ts 改過的照改：鐵頭畏縮 20%、
// 月亮之力降特攻 10%、冷凍乾燥沒有追加效果、剋命爪 30% 隨機中毒／麻痺／睡眠；OP.GG 的資料缺幾招、也沒有冠軍版的修改，所以不用）。
// 每項：c 機率 %；s 對手陷入異常狀態（陣列＝隨機一種）、fl 對手畏縮、cf 對手混亂、d 對手的能力變化、me 自己的能力變化。
// 打在替身上、對手倒下時，對手那邊的不算、自己的照算；特性強行沒有追加效果（FLAG.secondary 的招式，威力 ×1.3 在 damageCalc）。
// 機率 100% 的自己能力變化（流水旋舞、蓄能焰襲等）寫在 SIM_SELF，晶光轉轉的中毒見 simMove。
// 特殊的追加效果寫在表的最後（鹽醃、精神噪音、地獄突刺、糖漿炸彈、魅誘之聲、妒火、縫影、泡影的詠歎調、降命中），處理見 simSecondary
const SIM_SEC = {
  'acid-spray': [{ c: 100, d: { spd: -2 } }], 'air-slash': [{ c: 30, fl: 1 }], 'ancient-power': [{ c: 10, me: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } }],
  'apple-acid': [{ c: 100, d: { spd: -1 } }], 'barb-barrage': [{ c: 50, s: 'psn' }], 'bite': [{ c: 30, fl: 1 }],
  'bitter-malice': [{ c: 100, d: { atk: -1 } }], 'blaze-kick': [{ c: 10, s: 'brn' }], 'blizzard': [{ c: 10, s: 'frz' }],
  'body-slam': [{ c: 30, s: 'par' }], 'bug-buzz': [{ c: 10, d: { spd: -1 } }], 'bulldoze': [{ c: 100, d: { spe: -1 } }],
  'charge-beam': [{ c: 70, me: { spa: 1 } }], 'cross-poison': [{ c: 10, s: 'psn' }], 'crunch': [{ c: 20, d: { def: -1 } }],
  'dark-pulse': [{ c: 20, fl: 1 }], 'dire-claw': [{ c: 30, s: ['psn', 'par', 'slp'] }], 'discharge': [{ c: 30, s: 'par' }],
  'dragon-rush': [{ c: 20, fl: 1 }], 'drum-beating': [{ c: 100, d: { spe: -1 } }], 'dynamic-punch': [{ c: 100, cf: 1 }],
  'earth-power': [{ c: 10, d: { spd: -1 } }], 'electroweb': [{ c: 100, d: { spe: -1 } }], 'energy-ball': [{ c: 10, d: { spd: -1 } }],
  'extrasensory': [{ c: 10, fl: 1 }], 'fake-out': [{ c: 100, fl: 1 }], 'fiery-dance': [{ c: 50, me: { spa: 1 } }],
  'fire-blast': [{ c: 10, s: 'brn' }], 'fire-fang': [{ c: 10, s: 'brn' }, { c: 10, fl: 1 }], 'fire-punch': [{ c: 10, s: 'brn' }],
  'flamethrower': [{ c: 10, s: 'brn' }], 'flare-blitz': [{ c: 10, s: 'brn' }], 'flash-cannon': [{ c: 10, d: { spd: -1 } }],
  'focus-blast': [{ c: 10, d: { spd: -1 } }], 'grav-apple': [{ c: 100, d: { def: -1 } }], 'gunk-shot': [{ c: 30, s: 'psn' }],
  'heat-wave': [{ c: 10, s: 'brn' }], 'hurricane': [{ c: 30, cf: 1 }], 'ice-beam': [{ c: 10, s: 'frz' }],
  'ice-fang': [{ c: 10, s: 'frz' }, { c: 10, fl: 1 }], 'ice-punch': [{ c: 10, s: 'frz' }], 'icicle-crash': [{ c: 30, fl: 1 }],
  'icy-wind': [{ c: 100, d: { spe: -1 } }], 'infernal-parade': [{ c: 30, s: 'brn' }], 'iron-head': [{ c: 20, fl: 1 }],
  'iron-tail': [{ c: 30, d: { def: -1 } }], 'lava-plume': [{ c: 30, s: 'brn' }], 'liquidation': [{ c: 20, d: { def: -1 } }],
  'lumina-crash': [{ c: 100, d: { spd: -2 } }], 'lunge': [{ c: 100, d: { atk: -1 } }], 'matcha-gotcha': [{ c: 20, s: 'brn' }],
  'meteor-mash': [{ c: 20, me: { atk: 1 } }], 'moonblast': [{ c: 10, d: { spa: -1 } }], 'mountain-gale': [{ c: 30, fl: 1 }],
  'mud-shot': [{ c: 100, d: { spe: -1 } }], 'mystical-fire': [{ c: 100, d: { spa: -1 } }], 'nuzzle': [{ c: 100, s: 'par' }],
  'play-rough': [{ c: 10, d: { atk: -1 } }], 'poison-fang': [{ c: 50, s: 'tox' }], 'poison-jab': [{ c: 30, s: 'psn' }],
  'psychic': [{ c: 10, d: { spd: -1 } }], 'pyro-ball': [{ c: 10, s: 'brn' }], 'razor-shell': [{ c: 50, d: { def: -1 } }],
  'rock-slide': [{ c: 30, fl: 1 }], 'rock-tomb': [{ c: 100, d: { spe: -1 } }], 'scald': [{ c: 30, s: 'brn' }],
  'scorching-sands': [{ c: 30, s: 'brn' }], 'shadow-ball': [{ c: 20, d: { spd: -1 } }], 'shell-side-arm': [{ c: 20, s: 'psn' }],
  'sludge-bomb': [{ c: 30, s: 'psn' }], 'sludge-wave': [{ c: 10, s: 'psn' }], 'snarl': [{ c: 100, d: { spa: -1 } }],
  'spirit-break': [{ c: 100, d: { spa: -1 } }], 'struggle-bug': [{ c: 100, d: { spa: -1 } }], 'thunder': [{ c: 30, s: 'par' }],
  'thunder-fang': [{ c: 10, s: 'par' }, { c: 10, fl: 1 }], 'thunder-punch': [{ c: 10, s: 'par' }], 'thunderbolt': [{ c: 10, s: 'par' }],
  'triple-arrows': [{ c: 50, d: { def: -1 } }, { c: 30, fl: 1 }], 'trop-kick': [{ c: 100, d: { atk: -1 } }], 'upper-hand': [{ c: 100, fl: 1 }],
  'volt-tackle': [{ c: 10, s: 'par' }], 'water-pulse': [{ c: 20, cf: 1 }], 'waterfall': [{ c: 20, fl: 1 }], 'zap-cannon': [{ c: 100, s: 'par' }],
  'zen-headbutt': [{ c: 20, fl: 1 }],
  // 鹽醃（冠軍版 mods/champions：之後每回合結束扣最大 HP 的 1/16，水、鋼屬性 1/8；換下場解除，見 simEnd）
  'salt-cure': [{ c: 100, salt: 1 }],
  // 精神噪音：2 回合回復封鎖（hb；Showdown healblock，精神噪音給的 duration 2）；地獄突刺：2 回合不能用聲音招式（tc；throatchop）；
  // 魅誘之聲、妒火：對手這回合能力有上升過才混亂／灼傷（up；statsRaisedThisTurn，見 simBoost 的 v.up）
  'psychic-noise': [{ c: 100, hb: 1 }], 'throat-chop': [{ c: 100, tc: 1 }],
  // 糖漿炸彈：之後 3 次回合結束速度 −1（用的那隻離場就解除；Showdown syrupbomb duration 4、onResidualOrder 14）
  'syrup-bomb': [{ c: 100, syrup: 1 }],
  'alluring-voice': [{ c: 100, up: 1, cf: 1 }], 'burning-jealousy': [{ c: 100, up: 1, s: 'brn' }],
  // 縫影：用的那隻還在場上時對手不能換人（trap；Showdown spiritshackle secondary onHit → trapped，幽靈屬性不受影響，見 simOpts 的 v.shackle）；
  // 泡影的詠歎調：打完治好對手的灼傷（aria；Showdown sparklingaria 追加效果，強行沒有）
  'spirit-shackle': [{ c: 100, trap: 1 }], 'sparkling-aria': [{ c: 100, aria: 1 }],
  // 降命中（Showdown secondary boosts accuracy −1）
  'night-daze': [{ c: 40, d: { acc: -1 } }], 'muddy-water': [{ c: 30, d: { acc: -1 } }], 'mud-slap': [{ c: 100, d: { acc: -1 } }],
  'mirror-shot': [{ c: 30, d: { acc: -1 } }], 'leaf-tornado': [{ c: 50, d: { acc: -1 } }], 'octazooka': [{ c: 50, d: { acc: -1 } }], 'mud-bomb': [{ c: 30, d: { acc: -1 } }] };
// 冰凍（Showdown flags.defrost／thawsTarget）：冰凍時用 SIM_DEFROST 的招式會先融化再出招（燃盡要是火屬性）；
// 冰凍的對手被火屬性攻擊招式或 SIM_THAW 的招式打中就融化
const SIM_DEFROST = new Set(['burn-up', 'flare-blitz', 'matcha-gotcha', 'pyro-ball', 'scald', 'scorching-sands']);
const SIM_THAW = new Set(['matcha-gotcha', 'scald', 'scorching-sands']);
// 每一下都判定命中的連續攻擊（Showdown multiaccuracy；特性連續攻擊只判定第一下）
const SIM_MULTIACC = new Set(['population-bomb', 'triple-axel']);
// 沒打中（沒命中、被守住、沒有效果、對手在地底等）自己扣最大 HP 的一半（Showdown hasCrashDamage／onMoveFail；特性魔法防守不受）
const SIM_CRASH = new Set(['high-jump-kick', 'supercell-slam']);
// 使用限制（Showdown）：擊掌奇襲、迎頭一擊只有上場後第一回合能用（onTry）；大爆炸、自爆、薄霧炸裂用了就倒下（selfdestruct always）；
// 破壞光線等打中後下一回合不能動（recharge）；日光束、日光刃、電光束、挖洞、潛靈奇襲先蓄力一回合（charge；
// 日光束、日光刃晴天、電光束下雨時不用蓄力，見 SIM_CHARGE_WX；挖洞、潛靈奇襲蓄力時打不到；電光束特攻 +1）；預知未來兩回合後才打中；急速折返等打完換人（selfSwitch）；
// 龍尾、巴投打中後強制對手換人（forceSwitch）；高速旋轉、晶光轉轉打中後清掉自己這邊的撒菱類（onAfterHit）
const SIM_FIRST = new Set(['fake-out', 'first-impression']);
const SIM_BOOM = new Set(['explosion', 'self-destruct', 'misty-explosion']);
const SIM_RECHARGE = new Set(['hyper-beam', 'giga-impact', 'hydro-cannon', 'rock-wrecker', 'meteor-assault']);
const SIM_CHARGE = new Set(['solar-beam', 'solar-blade', 'electro-shot', 'dig', 'phantom-force']);
const SIM_HIDE = new Set(['dig', 'phantom-force']);
const SIM_PIVOT = new Set(['u-turn', 'volt-switch', 'flip-turn']);
const SIM_PHAZE = new Set(['dragon-tail', 'circle-throw']);
const SIM_SPIN = new Set(['rapid-spin', 'mortal-spin']);
// 不能連續使用（Showdown flags.cantusetwice：上一次用的就是這招時不能選；資料裡只有巨力錘）
const SIM_TWICE = new Set(['gigaton-hammer']);
// 打中後自己失去這個屬性、沒有這個屬性時失敗（Showdown doubleshock／burnup：onTryMove 失敗、self.onHit setType 把它換成 ???＝沒有屬性）
const SIM_LOSE_TYPE = { 'double-shock': 'electric', 'burn-up': 'fire' };
// 綁住類（Showdown volatileStatus partiallytrapped）：打中後 5 或 6 回合（random(5, 7)，期望值模式取 5；含這回合，回合結束先扣再看）
// 每回合結束扣最大 HP 的 1/8（緊綁束帶 1/6），被綁住的不能換人（幽靈屬性可以）；用的那隻離場或倒下就解除；高速旋轉解除自己的
const SIM_BIND = new Set(['infestation', 'whirlpool', 'fire-spin', 'sand-tomb', 'bind', 'wrap', 'snap-trap']);
// 連續攻擊 2～5 下的（damageCalc 的 VAR_HITS）實際下數：35%／35%／15%／15%（Showdown multihit [2, 5]，連續攻擊特性固定 5 下）；
// 期望值模式各下的權重（打到第 h 下的機率，平均 3.1 下）
const SIM_HIT_N = [[2, 0.35], [3, 0.35], [4, 0.15], [5, 0.15]];
const SIM_HIT_W = [1, 1, 0.65, 0.3, 0.15];
// 吸收類特性（Showdown onTryHit）：t 吸收的屬性；heal 回最大 HP 的 1/4（儲水、蓄電、乾燥皮膚、食土）、b 提升能力（避雷針、引水、電氣引擎、食草）、
// ff 引火（之後自己的火屬性招式 ×1.5，換下場消失；見 damageCalc 的 a.flashFire）
const SIM_ABSORB = { 'water-absorb': { t: 'water', heal: 1 }, 'volt-absorb': { t: 'electric', heal: 1 }, 'dry-skin': { t: 'water', heal: 1 },
  'earth-eater': { t: 'ground', heal: 1 }, 'lightning-rod': { t: 'electric', b: { spa: 1 } }, 'storm-drain': { t: 'water', b: { spa: 1 } },
  'motor-drive': { t: 'electric', b: { spe: 1 } }, 'sap-sipper': { t: 'grass', b: { atk: 1 } }, 'flash-fire': { t: 'fire', ff: 1 } };
// 逆鱗類（Showdown lockedmove，冠軍版實測）：打中後鎖住 2 或 3 次（random(2, 4)，期望值模式取 2），期間只能用這招、不能換人；用完最後一次自己混亂；
// 第 2 次以後沒打中（被守住、沒命中、沒有效果）就提早解除，這次本來就是最後一次的照樣混亂；第一次沒打中不會鎖；睡著就解除
const SIM_RAGE = new Set(['outrage', 'thrash', 'petal-dance', 'raging-fury']);
// 場地種子（Showdown psychicseed 等 onStart／onTerrainChange）：上場時或場地變了、是這個場地就用掉，能力 +1
const SIM_SEED = { 'psychic-seed': ['psychic', { spd: 1 }], 'grassy-seed': ['grassy', { def: 1 }], 'electric-seed': ['electric', { def: 1 }], 'misty-seed': ['misty', { spd: 1 }] };
// 複製抄不到的特性（Showdown flags.notrace，資料裡有的）
const SIM_NOTRACE = new Set(['disguise', 'illusion', 'imposter', 'stance-change', 'trace', 'zen-mode', 'commander', 'protosynthesis', 'quark-drive',
  'flower-gift', 'forecast', 'schooling', 'shields-down', 'power-construct', 'neutralizing-gas', 'hunger-switch', 'ice-face', 'comatose', 'battle-bond']);
// 不能被換掉的特性（Showdown flags.cantsuppress，資料裡有的）：木乃伊傳染不到；遊魂、特性互換換不了的（failskillswap）另外加幻覺、化學變化氣體、神奇守護、飽了又餓
const SIM_NOSUPP = new Set(['disguise', 'stance-change', 'zero-to-hero', 'commander', 'ice-face', 'schooling', 'shields-down', 'comatose', 'battle-bond', 'power-construct',
  'multitype', 'rks-system', 'gulp-missile', 'as-one-glastrier', 'as-one-spectrier', 'tera-shift',
  // 波導防護（冠軍版新特性，超級路卡利歐Z）：Serebii 寫特性互換、遊魂、胃液、化學變化氣體都對它沒用
  'aura-guard']);
const SIM_NOSWAP = new Set([...SIM_NOSUPP, 'illusion', 'neutralizing-gas', 'wonder-guard', 'hunger-switch']);
// 換特性（木乃伊、遊魂、特性互換）：原本的存在 b0、換下場換回來（同複製，simSwitch）；b 換新的物件（局面複本共用 b，不能就地改）
function simSetAb(st, s, M, ab, why) {
  if (!M.b0) M.b0 = M.b;
  M.b = { ...M.b, ab };
  simLog(st, `${simName(st, s, M)}${why}`);
}
// 換到的特性的出場效果（Showdown skillSwap、setAbility 會觸發新特性的 onStart）：威嚇、開天氣場地
function simAbStart(st, s, M) { simIntimidate(st, s, M); simEntryField(st, s, M); }
// 被接觸招式打中時 30% 讓攻擊方陷入的異常（火焰之軀、毒刺、靜電；Showdown onDamagingHit checkMoveMakesContact）
const SIM_CONTACT_ST = { 'flame-body': 'brn', 'poison-point': 'psn', static: 'par' };
// 威力隨自己剩下的 HP：資料的威力 × 剩下 HP ÷ 最大 HP，取整、至少 1（Showdown basePowerCallback）
const SIM_HPBP = new Set(['eruption', 'water-spout']);
// 輔助招（Showdown data/moves.ts，冠軍版有改的照 mods/champions）：kind 效果種類；p 先制等級；tgt＝目標是對手場上那隻；
// f＝會被守住擋（protect 旗標；王者盾牌不擋輔助招）；r＝會被魔法鏡反彈（reflectable）；sub＝穿透替身（bypasssub 或聲音）；pw＝粉末（草屬性、防塵免疫）
//   boost 自己的能力變化 b｜prot 守住類（how：protect／kings 王者盾牌：接觸的攻擊 −1｜spiky 尖刺防守：接觸的扣 1/8｜bunker 碉堡：接觸的中毒｜endure 挺住）
//   heal 回復一半（光合作用、晨光、月光照天氣，見 SIM_SUNHEAL）｜wish 祈願：下回合結束回復使用者最大 HP 一半｜split 分擔痛楚｜rest 睡覺：全滿、睡 2 回合
//   sap 吸取力量：回復對手的攻擊值、對手攻擊 −1｜seed 寄生種子：每回合吸 1/8｜hwish 治癒之願：自己倒下，換上來的回滿、治好異常
//   status 異常狀態 x（toxic-thread 另外速度 −2，冠軍版）｜yawn 哈欠：下回合結束睡著｜hazard 撒菱類 h（層數上限 max）
//   defog 清除濃霧：清掉雙方撒菱類、對手的牆｜tidy 大掃除：清掉雙方撒菱類與替身、攻擊速度 +1
//   encore 再來一次 3 回合（冠軍版：對手這回合還沒出招就立刻改成那招，已經出過就多 1 回合）｜taunt 挑釁 3 回合（對手已出招多 1 回合）
//   subst 替身：扣 1/4、替身 HP 1/4｜screen 牆 5 回合（光之黏土 8；極光幕要下雪，見 simFutile）｜phaze 吼叫、吹飛：強制對手換人（隨機）
//   haze 黑霧：雙方能力變化歸零｜debuff 降對手能力 d｜shot 拋下狠話：降對手能力後換人｜memento 臨別禮物：降對手能力後自己倒下
//   transform 變身：變成對手的樣子（見 simTransform）｜field 開天氣或場地 w（見 simSetField；pivot＝開完自己換下場：冷笑話，
//   已經下雪時天氣不變、照樣換下場：Showdown runMoveEffects 的 selfSwitch 能換人就算成功）
//   drum 腹鼓：扣一半、攻擊 +6｜soul 魂舞烈音爆：扣 33%、全能力 +1｜retreat 背水一戰：全能力 +1、不能換人｜curse 詛咒（非幽靈：攻防 +1 速度 −1；
//   幽靈：扣一半、對手每回合扣 1/4）｜focus 聚氣：急所 +2｜charge 充電：特防 +1、下一招電屬性威力 ×2
const SIM_ALL1 = { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 };
const SIM_FOE = { tgt: 1, f: 1, r: 1 };
// 打場上全體的輔助招（Showdown target 'all'：天氣、場地、戲法空間、黑霧、滅亡之歌、冷笑話）：對手特性壓迫感時照樣多扣 1 PP（見 simMove）
const SIM_PRESS_ALL = new Set(['chilly-reception', 'electric-terrain', 'grassy-terrain', 'misty-terrain', 'psychic-terrain', 'haze', 'perish-song',
  'rain-dance', 'snowscape', 'sunny-day', 'trick-room']);
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
  defog: { kind: 'defog', tgt: 1, f: 1, r: 1, sub: 1 },
  encore: { kind: 'encore', sub: 1, ...SIM_FOE }, taunt: { kind: 'taunt', sub: 1, ...SIM_FOE }, substitute: { kind: 'subst' },
  reflect: { kind: 'screen' }, 'light-screen': { kind: 'screen' }, 'aurora-veil': { kind: 'screen' },
  roar: { kind: 'phaze', p: -6, tgt: 1, r: 1, sub: 1 }, whirlwind: { kind: 'phaze', p: -6, tgt: 1, r: 1, sub: 1 }, haze: { kind: 'haze' },
  charm: { kind: 'debuff', d: { atk: -2 }, ...SIM_FOE }, 'feather-dance': { kind: 'debuff', d: { atk: -2 }, ...SIM_FOE },
  'eerie-impulse': { kind: 'debuff', d: { spa: -2 }, ...SIM_FOE }, 'fake-tears': { kind: 'debuff', d: { spd: -2 }, ...SIM_FOE },
  'baby-doll-eyes': { kind: 'debuff', d: { atk: -1 }, p: 1, ...SIM_FOE }, 'string-shot': { kind: 'debuff', d: { spe: -2 }, ...SIM_FOE },
  'parting-shot': { kind: 'shot', d: { atk: -1, spa: -1 }, sub: 1, ...SIM_FOE }, memento: { kind: 'memento', d: { atk: -2, spa: -2 }, tgt: 1, f: 1 },
  transform: { kind: 'transform', tgt: 1 },
  'sunny-day': { kind: 'field', w: 'sun' }, 'rain-dance': { kind: 'field', w: 'rain' }, sandstorm: { kind: 'field', w: 'sand' }, snowscape: { kind: 'field', w: 'snow' },
  'chilly-reception': { kind: 'field', w: 'snow', pivot: 1 }, 'electric-terrain': { kind: 'field', w: 'electric' }, 'grassy-terrain': { kind: 'field', w: 'grassy' },
  'misty-terrain': { kind: 'field', w: 'misty' }, 'psychic-terrain': { kind: 'field', w: 'psychic' },
  // 以下照 Showdown（冠軍版 mod 沒改）：troom 戲法空間 5 回合同先制等級慢的先（再用一次就結束；先制 −7）｜tailwind 順風：這一方 4 回合速度 ×2｜
  // dbond 同命：到自己下一次出招前被對手的招式打倒，對手也倒下（連續用失敗）｜baton 接棒：換人並傳能力變化與部分狀態（SIM_BATON）｜
  // shedtail 斷尾：扣一半（無條件進位）、換人並給換上來的替身（自己最大 HP 的 1/4）｜minimize 變小：閃避 +2、之後被踩踏類招式必中又 ×2｜
  // perish 滅亡之歌：雙方 3 回合後倒下（隔音不受、換下場解除）｜soak 浸水：對手變成水屬性｜revive 復生祈禱：倒下的一隻回到一半 HP｜
  // trick 戲法、掉包：交換道具｜octo 蛸固：對手不能換人、每回合結束防禦特防 −1｜topsy 顛倒：對手的能力變化反過來｜disable 定身法：對手上一招 4 回合不能用｜
  // safeguard 神秘守護：這一方 5 回合不會被對手弄成異常、混亂、哈欠｜recycle 回收利用：用掉的道具拿回來｜mrise 電磁飄浮：5 回合地面招式打不到｜
  // skillswap 特性互換。投擲是攻擊招式（見 simVarBp、simMove）
  'trick-room': { kind: 'troom', p: -7 }, tailwind: { kind: 'tailwind' }, 'destiny-bond': { kind: 'dbond' }, 'baton-pass': { kind: 'baton' },
  'shed-tail': { kind: 'shedtail' }, minimize: { kind: 'boost', b: { eva: 2 }, mini: 1 }, 'double-team': { kind: 'boost', b: { eva: 1 } },
  'perish-song': { kind: 'perish', sub: 1 }, soak: { kind: 'soak', ...SIM_FOE }, 'revival-blessing': { kind: 'revive' },
  trick: { kind: 'trick', tgt: 1, f: 1 }, switcheroo: { kind: 'trick', tgt: 1, f: 1 }, octolock: { kind: 'octo', tgt: 1, f: 1 },
  'topsy-turvy': { kind: 'topsy', ...SIM_FOE }, disable: { kind: 'disable', sub: 1, ...SIM_FOE }, safeguard: { kind: 'safeguard' },
  recycle: { kind: 'recycle' }, 'magnet-rise': { kind: 'mrise' }, 'skill-swap': { kind: 'skillswap', tgt: 1, f: 1, sub: 1 },
  // 仿效、號令在 simMove 直接處理（要叫出別的招）
  copycat: { kind: 'copycat' }, instruct: { kind: 'instruct', tgt: 1, f: 1, sub: 1 },
};
// 仿效叫不出來的（Showdown flags.failcopycat）、號令叫不出來的（flags.failinstruct；蓄力招另外也不行）
const SIM_NOCOPY = new Set(['baneful-bunker', 'beak-blast', 'kings-shield', 'protect', 'spiky-shield', 'circle-throw', 'copycat', 'counter', 'covet', 'destiny-bond',
  'detect', 'dragon-tail', 'endure', 'feint', 'follow-me', 'helping-hand', 'rage-powder', 'roar', 'switcheroo', 'transform', 'trick', 'whirlwind']);
const SIM_NOINSTRUCT = new Set(['beak-blast', 'kings-shield', 'copycat', 'dig', 'instruct', 'meteor-assault', 'outrage', 'phantom-force', 'solar-beam', 'solar-blade', 'thrash', 'transform']);
// 聲音的輔助招（Showdown flags.sound，FLAG.sound 只收攻擊招式）：地獄突刺時不能用、對手隔音擋得住
const SIM_SOUND_ST = new Set(['roar', 'perish-song', 'parting-shot', 'clangorous-soul']);
const simSound = k => FLAG.sound.has(k) || SIM_SOUND_ST.has(k);
// 接棒傳給換上來的（Showdown copyVolatileFrom：能力變化，加上沒有 noCopy 的暫時狀態；斷尾只傳替身）
const SIM_BATON = ['sub', 'focus', 'seed', 'curse', 'conf', 'perish', 'mrise', 'taunt', 'bind', 'octo', 'charge', 'hblock', 'tchop'];
// 對變小的對手必中、威力 ×2 的招式（Showdown 冠軍版 flags.minimize）
const SIM_MINI = new Set(['body-slam', 'dragon-rush', 'flying-press', 'heat-crash', 'heavy-slam', 'supercell-slam']);
// 回復類招式（Showdown flags.heal）：回復封鎖（v.hblock，精神噪音）時不能用
const SIM_HEALMV = new Set([...Object.keys(SIM_DRAIN), ...Object.entries(SIM_SUP).filter(([, x]) => ['heal', 'rest', 'wish', 'sap', 'hwish'].includes(x.kind)).map(([k]) => k)]);
// 回復量照天氣的（Showdown synthesis／morningsun／moonlight onHit：pokemon.effectiveWeather 晴天 0.667、下雨／沙暴／下雪 0.25、其他 0.5，this.modify(maxhp, factor)）
const SIM_SUNHEAL = new Set(['synthesis', 'morning-sun', 'moonlight']);
const SIM_SUNHEAL_F = { sun: 0.667, rain: 0.25, sand: 0.25, snow: 0.25 };
// 晴天不用蓄力的日光束、日光刃，下雨不用蓄力的電光束（Showdown solarbeam／solarblade／electroshot onTryMove 看 attacker.effectiveWeather）
const SIM_CHARGE_WX = { 'solar-beam': 'sun', 'solar-blade': 'sun', 'electro-shot': 'rain' };
const SIM_STATUS_ZH = { brn: '灼傷', par: '麻痺', psn: '中毒', tox: '劇毒', slp: '睡眠', frz: '冰凍' };
const SIM_HAZ_ZH = { sr: '隱形岩', spikes: '撒菱', tspikes: '毒菱', web: '黏黏網' };
// 一場最多幾回合（到了算平手）、往前算的時候簡單規則最多再打幾回合
const SIM_MAX_TURN = 100, SIM_LOOK = 40;
const SIM_ST0 = () => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 });

// 上場的一隻：key 這場的型態、set 配招（能算傷害的攻擊招式與 SIM_SUP 有的輔助招；沒有招式就用 OP.GG 前 4 招 defaultSet）、
// item 道具（沒給照 battler）、s 哪一方。能力點數、性格、特性同 battler；其餘是場上狀態：hp、item（會被打掉、用掉）、st 能力變化、
// lock 講究圍巾鎖住的招式、chg 蓄力中的招式、hide 蓄力時打不到、rech 下一回合要休息、in 第幾回合上場（擊掌奇襲用）、kos 打倒幾隻、
// out 有沒有上過場、status 異常狀態（tox 劇毒累積、slp 還要睡幾次、frz 冰凍還剩幾次出招機會）、v 換下場就清掉的狀態（sub 替身 HP、taunt、enc／encK 再來一次、seed、
// curse、yawn、focus、charge、trap、prot／endure／stall／protUsed 守住類、flinch 這回合畏縮、conf 混亂還剩幾次出招機會、fallen 大將算的倒下隻數、
// types／pt 變幻自如換過的屬性與這次上場發動過了（simProtean）、dis 被定身的招式 { k, n 還剩幾次回合結束 }（詛咒之軀）、
// mt 這隻最近一次出招 { t 第幾回合, ok 有沒有成功 }（豁出去、跺腳）、got 這回合被打的傷害（反擊類、雪崩）、ff 引火吸收過火屬性招式、
// bind 被綁住類招式綁住 { s 用的那方, i 用的那隻在隊伍第幾隻, dur 還剩幾回合, div 每回合扣最大 HP 的 1/div, k 招式 }、
// glaive 用了巨劍突擊還沒再出招、roost 這回合用了羽棲（失去飛行屬性）、unb 輕裝發動了、rage 逆鱗類鎖住 { k, n 共幾次, used 用了幾次 }）、
// last 上一次用的招式（再來一次用）、pp 各招剩下的 PP（OP.GG 冠軍版的 PP）、bust 畫皮被揭穿了（換下場也不會恢復）、
// fk 戰鬥切換後能力值用的型態（simStance；換下場變回 key）、hits 被攻擊打中幾下（憤怒之拳；換下場不重算）、
// b0 複製抄特性前原本的 b（simTrace；換下場換回來）
// 能算的招式：damageCalc 算得了的攻擊招式（含看體重的）、固定傷害、反擊類與一擊必殺（SIM_FIXED／SIM_REACT／SIM_OHKO）、SIM_SUP 的輔助招；其他（變身…）不列
const simCanUse = k => canCalc(k) || !!SIM_FIXED[k] || !!SIM_REACT[k] || SIM_OHKO.has(k) || !!SIM_SUP[k] || SIM_VARBP.has(k);
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
// 掙扎的傷害（Showdown getDamage：威力 50、物理接觸、沒有屬性，照一般公式但沒有本系與屬性相剋）。照 Showdown 的順序算常見的修正：
// 威力：技術高手 ×1.5、硬爪 ×1.3、力量頭帶 ×1.1｜攻擊：大力士／瑜伽之力 ×2、活力 ×1.5、毅力（有異常）×1.5｜防禦：毛皮大衣 ×2、神奇鱗片（有異常）×1.5｜
// 急所 ×1.5（crit：不看自己降低的攻擊、對手提升的防禦，牆沒有作用）→ 亂數 → 灼傷 ×0.5（毅力不減）→ 牆 ×0.5、生命寶珠 ×1.3、多重鱗片／幻影防守（滿血）×0.5、毛茸茸 ×0.5
function simStruggleDmg(st, A, D, rnd, crit = false) {
  const aab = A.b.ab, dab = D.b.ab, scr = st.sd[+D.id[0]].scr;
  const md = (v, ms) => { const m = ms.filter(Boolean); return m.length ? Math.max(1, pokeRound(v * chainMods(m, 1, 1 << 20) / 4096)) : v; };
  const [asp, anat] = invAt(A.b, 1, A.b.atkInv), [dsp, dnat] = invAt(D.b, 2, D.b.defInv);
  const bp = md(50, [aab === 'technician' && 6144, aab === 'tough-claws' && 5325, A.item === 'muscle-band' && 4505]);
  const atk = md(stageStat(statOf(MON[simFk(A)].bs[1], asp, 1, anat), crit ? Math.max(0, A.st.atk) : A.st.atk),
    [['huge-power', 'pure-power'].includes(aab) && 8192, aab === 'hustle' && 6144, aab === 'guts' && !!A.status && 6144]);
  const def = md(stageStat(statOf(MON[simFk(D)].bs[2], dsp, 2, dnat), crit ? Math.min(0, D.st.def) : D.st.def), [dab === 'fur-coat' && 8192, dab === 'marvel-scale' && !!D.status && 6144]);
  const b0 = Math.floor(Math.floor(Math.floor(22 * bp * atk) / def) / 50) + 2, base = crit ? Math.floor(b0 * 1.5) : b0;
  let d = Math.floor(base * (rnd ? 85 + Math.floor(rnd() * 16) : 92.5) / 100);
  if (A.status === 'brn' && aab !== 'guts') d = Math.floor(d / 2);
  d = md(d, [!crit && (scr.reflect || scr['aurora-veil']) && 2048, A.item === 'life-orb' && 5324, ['multiscale', 'shadow-shield'].includes(dab) && D.hp >= D.max && 2048, dab === 'fluffy' && 2048]);
  return Math.max(1, d);
}
// 混亂打到自己（Showdown getConfusionDamage）：威力 40，自己的攻擊（含能力變化）打自己的防禦（含能力變化），亂數 85～100%，
// 沒有屬性、本系、道具特性的修正，不吃灼傷與牆，至少 1
function simConfDmg(M, rnd) {
  const [asp, anat] = invAt(M.b, 1, M.b.atkInv), [dsp, dnat] = invAt(M.b, 2, M.b.defInv);
  const atk = stageStat(statOf(MON[simFk(M)].bs[1], asp, 1, anat), M.st.atk), def = stageStat(statOf(MON[simFk(M)].bs[2], dsp, 2, dnat), M.st.def);
  return Math.max(1, Math.floor((Math.floor(Math.floor(22 * 40 * atk / def) / 50) + 2) * (85 + Math.floor(rnd() * 16)) / 100));
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
// 熱門隊伍（隊伍分析的整隊模擬打的對手）：fmt 排名前 n 名（不含超級進化）各當核心，加上牠 OP.GG 隊友名單（mates）的前 5 隻，
// 6 隻一樣的只留核心排名前的那隊、湊不滿 6 隻的不要（OP.GG 只有每隻的隊友名單，沒有整隊統計）。超級進化與否、配招、道具交給 simOppScenarios。
// 回傳 [{ core 核心 key, keys 6 隻（核心排第一）}]
const SIM_META_N = 30;
function simMetaTeams(fmt, n = SIM_META_N) {
  const seen = new Set();
  return topMons(fmt, n).map(m => ({ core: m.key, keys: [m.key, ...(useOf(m.key, fmt)?.mates || []).filter(k => MON[k] && k !== m.key).slice(0, 5)] }))
    .filter(t => { const id = t.keys.slice().sort().join(); return t.keys.length === 6 && !seen.has(id) && seen.add(id); });
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
// 紀錄裡的名字：變身中的寫原本的寶可夢（simBaseKey）
const simName = (st, s, M = simAct(st, s)) => `${s ? '對手' : '我方'}${MON[simBaseKey(M)].zh}`;
const simPct = (v, max) => Math.round(Math.max(0, v) / max * 100);
const simLog = (st, t) => { if (st.log) st.log.push('　' + t); };
const simSide0 = mons => ({ act: 0, mons, haz: { sr: 0, spikes: 0, tspikes: 0, web: 0 }, scr: {}, wish: null, hwish: false });
// v（換下場就清掉的狀態）裡的物件（bind、dis、rage、mt…）會就地改計數，要各複製一份：只複製一層的話，往前推演、樹搜尋的複本會改到原本的局面
const simCloneV = v => { const o = {}; for (const k in v) { const x = v[k]; o[k] = x && typeof x === 'object' ? (Array.isArray(x) ? x.slice() : { ...x }) : x; } return o; };
const simCloneMon = m => ({ ...m, st: { ...m.st }, v: simCloneV(m.v), pp: { ...m.pp } });
const simClone = st => ({ sd: st.sd.map(x => ({ ...x, mons: x.mons.map(simCloneMon), haz: { ...x.haz }, scr: { ...x.scr }, wish: x.wish && { ...x.wish } })),
  turn: st.turn, fut: st.fut.map(f => ({ ...f })), idle: st.idle, seq: st.seq, wx: st.wx && { ...st.wx }, ter: st.ter && { ...st.ter }, troom: st.troom && { ...st.troom }, lastMv: st.lastMv, log: null });
// 場上現在的屬性（變幻自如、自由者換過的，見 simProtean；這回合用了羽棲的拿掉飛行，只有飛行的變一般，Showdown roost onType／getTypes）；
// 能力值用的型態（戰鬥切換換過的，見 simStance）
const simTypes = M => {
  const ty = M.v.types || MON[M.key].types;
  if (!M.v.roost || !ty.includes('flying')) return ty;
  const rest = ty.filter(t => t !== 'flying');
  return rest.length ? rest : ['normal'];
};
// 道具用掉、被拿掉（輕裝：之後沒有道具時速度 ×2，換下場消失；Showdown unburden onAfterUseItem／onTakeItem）
// 道具沒了：用掉的記在 lastItem（換下場也留著；收穫、回收利用用，Showdown useItem／eatItem 的 lastItem），take＝被拿走的（拍落、偷走、交換，Showdown takeItem 不記）
const simLoseItem = (M, take = false) => { if (!take) M.lastItem = M.item; M.item = ''; if (M.b.ab === 'unburden') M.v.unb = true; };
// hk＝全能變身換下場後永久的全能形態（simSwitch；能力值照 palafin-hero）
const simFk = M => M.fk || M.hk || M.key;
// M 被綁住類綁著、用的那隻還在場上（離場或倒下就不算，見 SIM_BIND）
const simBound = (st, M) => !!M.v.bind && st.sd[M.v.bind.s].act === M.v.bind.i && simAct(st, M.v.bind.s).hp > 0;
// 在地面上（撒菱、毒菱、黏黏網用）：不是飛行屬性、沒有飄浮、沒帶氣球（Showdown isGrounded）
const simGround = M => M.item === 'iron-ball' || !!M.v.smack || (!M.v.mrise && !simTypes(M).includes('flying') && M.b.ab !== 'levitate' && M.item !== 'air-balloon');
// ---------- 天氣與場地 ----------
// st.wx／st.ter＝{ t 哪一種, n 還剩幾回合 }（沒有是 null）。規則照 Pokémon Showdown（冠軍版 mod 沒改）：開了 5 回合，開的那隻帶對應的岩石
// （SIM_WX_ROCK）或場地延長器 8 回合（conditions.ts／moves.ts durationCallback）；已經是同一種時失敗、回合數不重算（field.ts setWeather／setTerrain）；
// 回合結束先扣回合數、扣到 0 就結束（battle.ts fieldEvent Residual；天氣在回合結束最前面、場地在牆之後，見 simEnd），所以開的那回合也算一回合
const SIM_WX_ROCK = { sun: 'heat-rock', rain: 'damp-rock', sand: 'smooth-rock', snow: 'icy-rock' };
// 有作用的天氣：場上有特性無關天氣（WEATHER_OFF）的就沒有作用，回合數照扣（field.ts suppressingWeather）；場地
const simWx = st => st.wx && ![0, 1].some(s => { const M = simAct(st, s); return M.hp > 0 && WEATHER_OFF.includes(M.b.ab); }) ? st.wx.t : '';
const simTer = st => st.ter?.t || '';
// M 開天氣或場地 t：成功回傳持續幾回合，已經是同一種回傳 0
function simSetField(st, M, t) {
  const wx = t in SIM_WX_ROCK, k = wx ? 'wx' : 'ter';
  if (st[k]?.t === t) return 0;
  st[k] = { t, n: M.item === (wx ? SIM_WX_ROCK[t] : 'terrain-extender') ? 8 : 5 };
  if (!wx) simMimicry(st); else simForecast(st);
  return st[k].n;
}
// 陰晴不定（Showdown forecast onStart／onWeatherChange）：飄浮泡泡照有作用的天氣變型態（晴天火、下雨水、下雪冰，其他變回一般；各型態能力值一樣，只換屬性 v.types，fc＝換過的）
function simForecast(st) {
  [0, 1].forEach(s => {
    const M = simAct(st, s), t = { sun: 'fire', rain: 'water', snow: 'ice' }[simWx(st)];
    if (M.hp <= 0 || M.b.ab !== 'forecast' || M.tf || simFk(M) !== 'castform') return;
    if (t) { if (M.v.fc && M.v.types?.[0] === t) return; M.v.types = [t]; M.v.fc = true; simLog(st, `${simName(st, s)}的${abilZh('forecast')}：變成${TYPES[IDX[t]].zh}屬性`); }
    else if (M.v.fc) { delete M.v.types; delete M.v.fc; simLog(st, `${simName(st, s)}的${abilZh('forecast')}：變回一般屬性`); }
  });
}
// 清掉場地（場地回合到了、鐵滾輪、冰旋）
const simClearTer = (st, why) => { simLog(st, `${FIELD_ZH[st.ter.t]}${why}`); st.ter = null; simMimicry(st); };
// 擬態（Showdown mimicry onStart／onTerrainChange）：場上有場地時變成場地的屬性（電氣→電、青草→草、薄霧→妖精、精神→超能力），沒有場地變回原本的
// （v.types，換下場清掉；mim＝擬態換過的）
function simMimicry(st) {
  [0, 1].forEach(s => {
    const M = simAct(st, s), t = simTer(st);
    if (M.hp <= 0 || M.b.ab !== 'mimicry' || M.tf) return;
    if (t) { if (M.v.mim && M.v.types?.[0] === TERRAIN_TYPE[t]) return; M.v.types = [TERRAIN_TYPE[t]]; M.v.mim = true; simLog(st, `${simName(st, s)}的${abilZh('mimicry')}：變成${TYPES[IDX[TERRAIN_TYPE[t]]].zh}屬性`); }
    else if (M.v.mim) { delete M.v.types; delete M.v.mim; simLog(st, `${simName(st, s)}的${abilZh('mimicry')}：變回原本的屬性`); }
  });
}
// 特性開天氣或場地 t：出場的（WX_AB、TER_AB）要還站著；被打中的（吐沙、播種，hit）被打倒也照樣發動
// （Showdown spreadMoveHit 的 DamagingHit 在倒下結算之前，沒有看倒下）
function simFieldAb(st, s, M, t, hit = false) {
  const n = t && (hit || M.hp > 0) ? simSetField(st, M, t) : 0;
  if (n) simLog(st, `${simName(st, s, M)}的${abilZh(M.b.ab)}：變成${FIELD_ZH[t]}（${n} 回合）`);
  if (n && !(t in SIM_WX_ROCK)) simSeeds(st);
}
const simEntryField = (st, s, M) => simFieldAb(st, s, M, WX_AB[M.b.ab] || TER_AB[M.b.ab]);
// 這一招現在要不要先蓄力（SIM_CHARGE；晴天的日光束、日光刃、下雨的電光束不用，SIM_CHARGE_WX）
const simMustCharge = (st, M, k) => SIM_CHARGE.has(k) && M.chg !== k && simWxOf(st, M, k) !== SIM_CHARGE_WX[k];
// M 出招 k 時看的天氣：超級日光自己出招時一律當晴天（Showdown pokemon.effectiveWeather：出招中的是超級日光、而且不是電光束）
const simWxOf = (st, M, k) => M.b.ab === 'mega-sol' && k !== 'electro-shot' ? 'sun' : simWx(st);
// M 出招 k 實際的屬性（氣象球照天氣、大地波動照場地、皮膚類把一般招式變屬性、濕潤之聲把聲音招式變水，同 damageCalc；掙扎沒有屬性）
function simMoveType(st, M, k) {
  if (k === SIM_STRUGGLE) return '';
  const wx = simWxOf(st, M, k), ter = simTer(st), ty = MOVES[k][1];
  if (k === 'weather-ball') return wx ? WB_TYPE[wx] : ty;
  if (k === 'terrain-pulse') return ter && simGround(M) ? TERRAIN_TYPE[ter] : ty;
  if (k === 'raging-bull' && RB_TYPE[simFk(M)]) return RB_TYPE[simFk(M)];
  if (k === 'aura-wheel') return M.v.hangry ? 'dark' : 'electric';
  return ATE[M.b.ab] && ty === 'normal' ? ATE[M.b.ab] : M.b.ab === 'liquid-voice' && FLAG.sound.has(k) ? 'water' : ty;
}
// 這一招的先制等級：SIM_PRI 或輔助招的 p；特性惡作劇之心讓輔助招 +1（Showdown prankster）；青草滑梯在青草場地、自己在地面上時 +1（grassyglide onModifyPriority）
// 疾風之翼：HP 全滿時飛行屬性招式 +1（Showdown galewings onModifyPriority）
const simPri = (st, M, k) => (SIM_PRI[k] ?? SIM_SUP[k]?.p ?? 0) + (SIM_SUP[k] && M.b.ab === 'prankster' ? 1 : 0)
  + (k === 'grassy-glide' && simTer(st) === 'grassy' && simGround(M) ? 1 : 0)
  + (M.b.ab === 'gale-wings' && M.hp >= M.max && k !== SIM_STRUGGLE && simMoveType(st, M, k) === 'flying' ? 1 : 0);
// 精神場地擋先制（Showdown psychicterrain onTryHit：先制等級 > 0 打對手的招式、對手在地面上又沒在蓄力躲起來）；攻擊招式 damageCalc 已經擋了，這裡給打對手的輔助招用
const simPsyBlock = (st, M, T, k) => simTer(st) === 'psychic' && simGround(T) && !T.hide && simPri(st, M, k) > 0;
// M 用招式 k 打 T 的命中率 %（Showdown battle-actions.ts hitStepAccuracy 與 ModifyAccuracy／Accuracy 事件）：招式的命中率（OP.GG 冠軍版，
// 和 Showdown 冠軍版 mod 改過的一致；null＝必中）依序乘特性複眼 ×1.3、活力的物理招式 ×0.8、對手特性蹣跚在混亂時 ×0.5（破格無視）、
// 道具廣角鏡 ×1.1、對焦鏡在對手這回合已經行動過時（moved）×1.2、對手道具光粉 ×0.9（4096 制連乘再四捨五入）；
// 雙方任一隻特性無防守、毒屬性用劇毒、對手用了巨劍突擊還沒再出招（glaiverush onAccuracy）時必中。回傳 100 以下（100＝必中）；一擊必殺不在這裡算（固定 30，見 simFixed），回傳 100。
// 天氣（simWx）：打雷、暴風下雨時必中、晴天命中 50（thunder／hurricane onModifyMove）；暴風雪下雪時必中（blizzard）；
// 對手特性沙隱在沙暴、雪隱在下雪時命中 ×0.8（sandveil／snowcloak onModifyAccuracy 3277/4096）
function simAcc(st, M, T, k, moved) {
  const wx = simWx(st), tw = k === 'thunder' || k === 'hurricane';
  const a0 = tw && wx === 'sun' ? 50 : MOVES[k]?.[6];
  if (a0 == null || SIM_OHKO.has(k) || M.b.ab === 'no-guard' || T.b.ab === 'no-guard' || T.v.glaive || (k === 'toxic' && simTypes(M).includes('poison'))
    || (tw && wx === 'rain') || (k === 'blizzard' && wx === 'snow') || (SIM_MINI.has(k) && T.v.mini)) return 100;
  const mods = [];
  if ((T.b.ab === 'sand-veil' && wx === 'sand') || (T.b.ab === 'snow-cloak' && wx === 'snow')) mods.push(3277);
  if (M.b.ab === 'compound-eyes') mods.push(5325);
  if (M.b.ab === 'hustle' && simCat(k) === 'physical') mods.push(3277);
  if (T.b.ab === 'tangled-feet' && T.v.conf && M.b.ab !== 'mold-breaker') mods.push(2048);
  if (M.item === 'wide-lens') mods.push(4505);
  if (M.item === 'zoom-lens' && moved) mods.push(4915);
  if (T.item === 'bright-powder') mods.push(3686);
  let a = mods.length ? pokeRound(a0 * chainMods(mods, 0, Infinity) / 4096) : a0;
  // 命中、閃避等級（Showdown hitStepAccuracy：上面的修正之後，n＝命中等級 − 閃避等級（−6～6），×(3＋n)/3 或 ×3/(3−n) 取整）；
  // 對手特性純樸時不看自己的命中等級；自己純樸、銳利目光、發光、心眼或聖劍類（ignoreEvasion）不看對手的閃避等級
  const ac = T.b.ab === 'unaware' ? 0 : M.st.acc || 0;
  const ev = ['unaware', 'keen-eye', 'illuminate', 'minds-eye'].includes(M.b.ab) || IGNORE_DEF.has(k) ? 0 : T.st.eva || 0, n = Math.max(-6, Math.min(6, ac - ev));
  if (n > 0) a = Math.floor(a * (3 + n) / 3); else if (n < 0) a = Math.floor(a * 3 / (3 - n));
  return Math.min(100, a);
}

// 威力會變的招式（Showdown basePowerCallback／onBasePower）這一下的威力，不變回傳 undefined（damageCalc 照資料）；last 同 simCalc：
//   噴火、噴水（SIM_HPBP）× 剩下 HP ÷ 最大 HP；掃墓 +50 × 這一方倒下幾隻（side.totalFainted）；憤怒之拳 +50 × 被打中幾下（A.hits，最多 350）；
//   輔助力量、囂張 +20 × 能力提升的總階數（positiveBoosts）；毒千針：對手中毒 ×2；禍不單行、群魔亂舞：對手有異常狀態 ×2；
//   雪崩：這回合被對手打到 ×2（attackedBy thisTurn）；豁出去、跺腳：上一回合出的招失敗了 ×2（moveLastTurnResult，見 A.v.mt）；
//   雜技：沒帶道具 ×2（超級進化帶著超級石，不算）；以牙還牙：對手這回合已經出過招、又不是剛換上來 ×2。最後充電讓電屬性招式再 ×2
function simVarBp(st, A, D, k, last) {
  const pw = MOVES[k][3], x2 = c => c ? pw * 2 : undefined;
  let bp;
  if (SIM_HPBP.has(k)) bp = Math.max(1, Math.floor(pw * A.hp / A.max));
  else switch (k) {
    case 'last-respects': bp = pw + 50 * st.sd[+A.id[0]].mons.filter(m => m.hp <= 0).length; break;
    case 'rage-fist': bp = Math.min(350, pw + 50 * (A.hits || 0)); break;
    case 'stored-power': case 'power-trip': bp = pw + 20 * Object.values(A.st).reduce((t, v) => t + Math.max(0, v), 0); break;
    case 'barb-barrage': bp = x2(D.status === 'psn' || D.status === 'tox'); break;
    case 'hex': case 'infernal-parade': bp = x2(!!D.status); break;
    case 'avalanche': bp = x2(A.v.got?.turn === st.turn); break;
    // 出招當下（live）看存起來的 pf；回合之間（往前算、選招時）看上一回合（＝st.turn）的紀錄
    case 'temper-flare': case 'stomping-tantrum': { const m = A.v.mt; bp = x2(!!m && (m.live ? m.pf : m.t === st.turn && m.ok === false)); break; }
    case 'acrobatics': bp = x2(!A.item && !MON[A.key].base); break;
    case 'payback': bp = x2(last && D.in !== st.turn); break;
    // 隨機光：30% 威力 ×2（Showdown fickebeam onBasePower；simMove 出招時照亂數抽在 v.fickle，期望值模式不算）
    case 'fickle-beam': bp = x2(!!A.v.fickle); break;
    // 陀螺球：⌊25 × 對手速度 ÷ 自己速度⌋ ＋ 1，最多 150（含能力變化、順風、麻痺等，不看戲法空間）
    case 'gyro-ball': bp = Math.min(150, Math.floor(25 * simSpe(st, D) / Math.max(1, simSpe(st, A))) + 1); break;
    // 起死回生、抓狂：r＝⌊48 × 剩下 HP ÷ 最大 HP⌋（至少 1），r＜2：200、＜5：150、＜10：100、＜17：80、＜33：40、其他 20
    case 'reversal': case 'flail': { const r = Math.max(1, Math.floor(48 * A.hp / A.max)); bp = r < 2 ? 200 : r < 5 ? 150 : r < 10 ? 100 : r < 17 ? 80 : r < 33 ? 40 : 20; break; }
    // 投擲：丟出去的道具（出招時已經拿下來放在 v.fling；還沒出招時看身上的）的威力
    case 'fling': bp = simFlingBp(A.v.fling || A.item) || undefined; break;
  }
  return A.v.charge && MOVES[k][1] === 'electric' ? (bp ?? pw) * 2 : bp;
}
// A 打 D 用招式 k 的 damageCalc（crit 急所）；結果依會影響傷害的狀態快取（D 剩下的 HP 只看滿不滿：氣勢披帶、結實、多重鱗片）。
// D 那一方的牆、A 灼傷（特性毅力有異常狀態就照 damageCalc 的灼傷算，攻擊 ×1.5、不減半）、威力會變的招式（simVarBp）也算進去；
// 雙方照場上現在的屬性（simTypes）與能力值用的型態（simFk），A 的變幻自如這次上場發動過了就不再每招本系、引火吸收過（v.ff）火屬性招式 ×1.5；
// D 沒有道具時拍落不加成（noItem）、D 用了巨劍突擊還沒再出招時傷害 ×2（glaive）；特性會被複製換掉，所以也進快取的鍵；
// 看場上狀況的特性：猛火類（PINCH_AB）看 A 剩下的 HP、大將看 A.v.fallen（見 simSwitch）；畫皮還在時給 damageCalc d.disguise（整招照效果普通、
// rolls 第一下是揭穿扣的 1/8），第一下擋掉、揭穿在 simMove 處理；
// last＝D 這回合已經出過招（特性分析 ×1.3；同對焦鏡，算期望值時不知道順序不給）
function simCalc(ctx, st, A, D, k, crit, last = false) {
  const dSide = st.sd[+D.id[0]], bp = simVarBp(st, A, D, k, last);
  // 電光束蓄力時已經特攻 +1，damageCalc 又會在出招前 +1，所以先扣回來
  const spa = A.st.spa - (CHARGE_SPA.has(k) ? 1 : 0), full = D.hp >= D.max;
  const burn = A.status === 'brn' || (A.b.ab === 'guts' && !!A.status), walls = Object.keys(dSide.scr);
  const pinch = !!PINCH_AB[A.b.ab] && A.hp <= A.max / 3, fallen = A.v.fallen || 0;
  const ak = simFk(A), dk = simFk(D), aTy = simTypes(A), dTy = simTypes(D), pt = !!A.v.pt, ff = !!A.v.ff, gl = !!D.v.glaive, dg = simDisguised(D, A), hg = !!A.v.hangry;
  // 神奇鱗片看 D 有沒有異常；監視看 D 是不是這回合才換上來（D.in）；節拍器（道具）看 A 連用了幾次（v.metro，見 simMove）
  const dst = !!D.status, so = A.b.ab === 'stakeout' && D.in === st.turn, mt = A.item === 'metronome' && A.v.metro?.k === k ? A.v.metro.n : 0, mi = !!D.v.mini;
  // 鬥爭心：雙方性別都知道（simGender 抽過）才算，同性 1、異性 -1
  const rv = A.b.ab === 'rivalry' && A.g && D.g && A.g !== 'N' && D.g !== 'N' ? (A.g === D.g ? 1 : -1) : 0;
  // 撲擊看自己的防禦變化、欺詐看對手的攻擊變化，都要進快取的鍵
  // 天氣、場地（simWx、simTer）照 damageCalc 算：晴雨強化減弱、沙暴岩石特防、下雪冰防禦、氣象球、場地強化與減弱、精神場地擋先制、鐵滾輪沒場地失敗…
  const wx = simWx(st), ter = simTer(st);
  const key = [A.id, ak, A.b.ab, aTy.join('.'), pt, ff, hg, so, mt, rv, A.item, A.st.atk, spa, A.st.def, burn, D.id, dk, D.b.ab, dTy.join('.'), gl, dg, dst, mi, !!D.v.mrise, !!D.v.smack, D.item, D.st.def, D.st.spd, D.st.atk, full,
    walls.join('.'), k, crit, bp, pinch, fallen, last, wx, ter].join('|');
  let r = ctx.memo.get(key);
  if (!r) {
    const a = A.b, d = D.b;
    r = damageCalc({ key: ak, types: aTy, ptUsed: pt, flashFire: ff, hangry: hg, stakeout: so, metro: mt, rival: rv, inv: a.atkInv, sp: a.sp, nat: a.nat, st: { atk: A.st.atk, spa, def: A.st.def }, item: A.item, ab: a.ab, pinch, fallen },
      { key: dk, types: dTy, glaive: gl, disguise: dg, status: dst, mini: mi, float: !!D.v.mrise, grounded: !!D.v.smack, hp: d.hp, inv: d.defInv, sp: d.sp, nat: d.nat, st: { def: D.st.def, spd: D.st.spd, atk: D.st.atk }, item: D.item, noItem: !D.item, ab: d.ab,
        cur: full ? undefined : D.hp, atkInv: d.atkInv },
      k, { fmt: ctx.fmt, weather: wx, crit, terrain: ter, hh: false, walls, burn, bp, last });
    r = r.skip || !r.eff ? { eff: 0 } : { eff: r.eff, type: r.type, cat: r.cat, crit: r.crit, rolls: r.rolls, endured: r.endured, berry: r.berry };
    ctx.memo.set(key, r);
  }
  return r;
}
// 固定傷害、反擊類這一下的結果（同 simCalc 的格式：eff 有沒有效果、rolls／later 16 個一樣的傷害、endured 氣勢披帶或結實撐住；fixed 標記）。
// 反擊類用 D 這回合打 A 的傷害（A.v.got，見 simMove）；exp＝估期望值（往前算用）：還沒被打，就用 D 對 A 同類招式裡最痛一招的期望傷害、A 撐得住才算；
// 失敗（反擊類沒被打到、蠻幹對手 HP 沒比較多）的 eff 是 0，fail 寫原因。一擊必殺（SIM_OHKO）多回傳 acc 命中率：exp 時傷害是剩下的 HP × 命中率，
// 不然是最大 HP（中不中由 simMove 照亂數抽）
function simFixed(ctx, st, A, D, k, exp) {
  const ty = MOVES[k][1], rc = SIM_REACT[k];
  // 屬性免疫；地面招式（地裂）另外打不到帶氣球、特性飄浮的（Showdown runImmunity('Ground')；破格無視飄浮；帶黑色鐵球的在地面上，飛行屬性也打得到）
  const iron = ty === 'ground' && (D.item === 'iron-ball' || !!D.v.smack);
  if (!eff(ty, iron ? simTypes(D).filter(t => t !== 'flying') : simTypes(D))
    || (ty === 'ground' && !iron && (D.item === 'air-balloon' || D.v.mrise || (D.b.ab === 'levitate' && A.b.ab !== 'mold-breaker')))) return { eff: 0 };
  let d, acc = 0;
  if (SIM_OHKO.has(k)) {
    if ((D.b.ab === 'sturdy' && A.b.ab !== 'mold-breaker') || (k === 'sheer-cold' && simTypes(D).includes('ice'))) return { eff: 0 };
    acc = A.b.ab === 'no-guard' || D.b.ab === 'no-guard' || D.v.glaive ? 100 : k === 'sheer-cold' && !simTypes(A).includes('ice') ? 20 : MOVES[k][6] ?? 30;
    // 照亂數打時傷害＝對手的最大 HP（Showdown getDamage：ohko 回傳 target.maxhp；打替身一定打破，扣本體時再截到剩下的 HP）
    d = exp ? Math.max(1, Math.floor(D.hp * acc / 100)) : D.max;
  } else if (rc) {
    const g = A.v.got, ok = x => !rc.cat || x === rc.cat;
    const base = g?.turn === st.turn && ok(g.cat) ? g.dmg
      : exp ? Math.max(0, ...D.moves.filter(k2 => !SIM_SUP[k2] && !SIM_REACT[k2] && ok(simCat(k2))).map(k2 => simExp(ctx, st, D, A, k2)).filter(x => x < A.hp)) : 0;
    if (!base) return { eff: 0, fail: '這回合沒有被打到' };
    d = Math.floor(base * rc.x);
  } else d = SIM_FIXED[k](A, D);
  if (d <= 0) return { eff: 0, fail: '對手的 HP 沒有比較多' };
  const endured = D.hp >= D.max && d >= D.hp ? (D.item === 'focus-sash' ? D.item : D.b.ab === 'sturdy' && A.b.ab !== 'mold-breaker' ? 'sturdy' : '') : '';
  const rolls = [Array(16).fill(d)];
  return { eff: 1, crit: false, rolls, later: rolls, endured, berry: false, fixed: true, acc };
}
// 這一招打 D 的計算：固定傷害、反擊類、一擊必殺用 simFixed，其他用 simCalc；電光雙擊、燃盡自己沒有那個屬性時失敗（SIM_LOSE_TYPE）；
// 靈騷打沒有道具的對手失敗（Showdown poltergeist onTry；超級進化帶著超級石，算有）
// 性別（Showdown 沒指定性別的隊伍照種族的比例隨機給；FEMALE＝母的比例，-1 無性別）：照亂數打時第一次用到才抽（M.g 'F'／'M'／'N'，
// 變身照自己的），期望值模式抽不了（回傳 ''）
function simGender(M, rnd) {
  const k = simBaseKey(M), f = FEMALE[k] ?? FEMALE[MON[k].base] ?? 0.5;
  if (!M.g && (f < 0 || rnd)) M.g = f < 0 ? 'N' : rnd() < f ? 'F' : 'M';
  return M.g || '';
}
// 著迷（迷人之軀；Showdown attract：要一公一母，我行我素、芳香幕不會）：讓牠著迷的那隻在場上時 50% 不能動（見 simMove），心靈香草馬上解除
function simAttract(st, s, M, src, rnd) {
  const a = simGender(M, rnd), b = simGender(src, rnd);
  if (!((a === 'M' && b === 'F') || (a === 'F' && b === 'M')) || M.b.ab === 'oblivious' || M.b.ab === 'aroma-veil' || M.v.attract) return;
  M.v.attract = { s: 1 - s, i: st.sd[1 - s].act };
  simLog(st, `${simName(st, s, M)}著迷了`);
  if (M.item === 'mental-herb') { delete M.v.attract; simLoseItem(M); simLog(st, `${simName(st, s, M)}用心靈香草解除了`); }
}
// M 這一方有神秘守護、src 是對手（不是穿透）：擋異常、混亂、哈欠
const simSafe = (st, M, src) => !!src && src.id[0] !== M.id[0] && st.sd[+M.id[0]].sg > 0 && src.b.ab !== 'infiltrator';
// 芳香幕（Showdown aromaveil onAllyTryAddVolatile；破格無視）：擋挑釁、再來一次、定身（含詛咒之軀）
// 破格能無視的特性（Showdown abilities flags.breakable，資料裡有的；見 simMove）
const SIM_BREAKABLE = new Set(['armor-tail', 'aroma-veil', 'battle-armor', 'big-pecks', 'bulletproof', 'clear-body', 'contrary', 'damp', 'disguise', 'dry-skin',
  'earth-eater', 'filter', 'flash-fire', 'flower-veil', 'fluffy', 'friend-guard', 'fur-coat', 'good-as-gold', 'grass-pelt', 'guard-dog', 'heatproof', 'heavy-metal',
  'hyper-cutter', 'illuminate', 'immunity', 'inner-focus', 'insomnia', 'keen-eye', 'leaf-guard', 'levitate', 'lightning-rod', 'limber', 'magic-bounce', 'marvel-scale',
  'mirror-armor', 'motor-drive', 'multiscale', 'oblivious', 'overcoat', 'own-tempo', 'punk-rock', 'purifying-salt', 'queenly-majesty', 'sand-veil', 'sap-sipper',
  'shell-armor', 'snow-cloak', 'solid-rock', 'soundproof', 'sticky-hold', 'sturdy', 'suction-cups', 'sweet-veil', 'tangled-feet', 'telepathy', 'thermal-exchange',
  'thick-fat', 'unaware', 'vital-spirit', 'volt-absorb', 'water-absorb', 'water-bubble']);
// 會自己治好異常的特性（Showdown 這些特性的 onUpdate）：破格出招期間被弄成的，特性回來就馬上治好
const SIM_UPD_CURE = { immunity: ['psn', 'tox'], 'pastel-veil': ['psn', 'tox'], insomnia: ['slp'], 'vital-spirit': ['slp'], limber: ['par'], 'magma-armor': ['frz'],
  'thermal-exchange': ['brn'], 'water-bubble': ['brn'], 'water-veil': ['brn'] };
// 不會被強制換下場的特性（Showdown onDragOut：吸盤、看家犬；吼叫類、龍尾類、紅牌都換不走；破格無視）
const SIM_ANCHOR = new Set(['suction-cups', 'guard-dog']);
// 破格出招結束（或中途有人換下場）：對手的特性換回來（期間被換成別的物件就不動），回來的特性照 SIM_UPD_CURE、我行我素（混亂）、遲鈍（著迷、挑釁）治好
function simMbEnd(st) {
  const x = st.mb;
  if (!x) return;
  delete st.mb;
  if (x.T.b !== x.nb) return;
  const T = x.T, ab = (T.b = x.b).ab, tn = simName(st, +T.id[0], T);
  if (T.hp <= 0) return;
  if (SIM_UPD_CURE[ab]?.includes(T.status)) { T.status = ''; simLog(st, `${tn}的${abilZh(ab)}治好了異常狀態`); }
  if (ab === 'own-tempo' && T.v.conf) { delete T.v.conf; simLog(st, `${tn}的${abilZh(ab)}解除了混亂`); }
  if (ab === 'oblivious' && (T.v.attract || T.v.taunt)) { delete T.v.attract; delete T.v.taunt; simLog(st, `${tn}的${abilZh(ab)}解除了著迷、挑釁`); }
}
const simAroma = (M, T) => T.b.ab === 'aroma-veil' && M.b.ab !== 'mold-breaker';
const simDamp = (A, D, k) => SIM_BOOM.has(k) && A.b.ab !== 'mold-breaker' && [A, D].some(P => P.hp > 0 && P.b.ab === 'damp');
const simHit = (ctx, st, A, D, k, crit, exp, last) => SIM_LOSE_TYPE[k] && !simTypes(A).includes(SIM_LOSE_TYPE[k])
  ? { eff: 0, fail: `已經沒有${TYPES[IDX[SIM_LOSE_TYPE[k]]].zh}屬性` }
  : simDamp(A, D, k) ? { eff: 0, fail: '濕氣' }
  : k === 'fling' && !simFlingBp(A.v.fling || A.item) ? { eff: 0, fail: '沒有可以丟的道具' }
  : k === 'poltergeist' && !D.item && !MON[D.key].base ? { eff: 0, fail: '對手沒有道具' }
  : SIM_FIXED[k] || SIM_REACT[k] || SIM_OHKO.has(k) ? simFixed(ctx, st, A, D, k, exp) : simCalc(ctx, st, A, D, k, crit, last);
// 打中時的期望傷害（各下的 16 個亂數取平均加總；每下判定命中的招式第二下起乘上命中的機率；氣勢披帶、結實撐住時最多打到剩 1；
// 畫皮還在時第一下改算揭穿的 1/8）；輔助招是 0
function simExpHit(ctx, st, A, D, k) {
  if (SIM_SUP[k]) return 0;
  const disg = simDisguised(D, A);
  if (k === SIM_STRUGGLE) return disg ? D.max / 8 : simStruggleDmg(st, A, D, null);
  const r = simHit(ctx, st, A, D, k, false, true);
  if (!r.eff) return 0;
  const pm = SIM_MULTIACC.has(k) && A.b.ab !== 'skill-link' ? simAcc(st, A, D, k, false) / 100 : 1;
  // 2～5 下的連續攻擊照各下打到的機率（SIM_HIT_W，同 simMove）
  const ws = HITS[k]?.[1] === VAR_HITS && A.b.ab !== 'skill-link' ? SIM_HIT_W : r.rolls.map(() => 1);
  const e = ws.reduce((t, w, h) => t + w * (h || !disg ? pm ** h * r.rolls[Math.min(h, r.rolls.length - 1)].reduce((a, x) => a + x, 0) / 16 : D.max / 8), 0);
  return r.endured && D.hp >= D.max ? Math.min(e, D.hp - 1) : e;
}
// 期望傷害＝打中時的期望傷害 × 命中率（simAcc；這裡不知道出招順序，對焦鏡不算）
const simExp = (ctx, st, A, D, k) => simExpHit(ctx, st, A, D, k) * simAcc(st, A, D, k, false) / 100;
// 速度（speedOf：能力變化、天氣場地加速特性、講究圍巾、麻痺；不含順風）；simSpeed 是有快取的
// 順風：這一方的 side.tw 還有回合數就 ×2
const simTw = (st, M) => st.sd[+M.id[0]].tw > 0;
const simSpe = (st, M) => speedOf({ key: simFk(M), inv: M.b.speInv, sp: M.b.sp, nat: M.b.nat, st: M.st.spe, item: M.item, ab: M.b.ab, tw: simTw(st, M),
  par: M.status === 'par', status: !!M.status, unburden: !!M.v.unb }, { weather: simWx(st), terrain: simTer(st) }).v;
function simSpeed(ctx, st, M) {
  const key = [M.id, simFk(M), M.b.ab, M.item, M.st.spe, M.status, !!M.v.unb, simTw(st, M), simWx(st), simTer(st)].join('|');
  if (!ctx.spd.has(key)) ctx.spd.set(key, simSpe(st, M));
  return ctx.spd.get(key);
}
// 出場特性、回合結束的天氣效果照速度快的先（Showdown runSwitch／eachEvent 的 speedSort）：回傳 [先的一方, 後的一方]，同速當我方先
// 戲法空間（st.troom）時慢的先（Showdown：speed 換成 10000 − speed，同速照舊）
const simFaster = (st, a, b) => st.troom ? a < b : a > b;
const simOrder = st => simFaster(st, simSpe(st, simAct(st, 1)), simSpe(st, simAct(st, 0))) ? [1, 0] : [0, 1];
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
  // 回復封鎖中什麼回復都沒有（Showdown healblock onTryHeal）
  if (M.hp <= 0 || M.hp >= M.max || v <= 0 || M.v.hblock) return 0;
  const h = Math.min(M.max - M.hp, Math.max(1, Math.floor(v)));
  M.hp += h;
  simLog(st, `${simName(st, s, M)}${why} +${simPct(h, M.max)}%（${simPct(M.hp, M.max)}%）`);
  return h;
}
// 畫皮（Showdown disguise）：謎擬Ｑ還沒被揭穿（bust）時，攻擊招式（含掙扎、預知未來、混亂打到自己）的這一下沒有傷害，揭穿後扣最大 HP 的 1/8；
// 揭穿了就一直是揭穿的樣子（換下場也不會恢復）。攻擊方 A 的特性破格無視；變身來的不算
const simDisguised = (T, A) => T.key === 'mimikyu' && T.b.ab === 'disguise' && !T.bust && !T.tf && A?.b.ab !== 'mold-breaker';
// 畫皮還在、只因為攻擊方 A 破格才沒擋：紀錄寫出來（接在傷害後面），免得看起來像沒算
const simMbNote = (st, T, A) => { const R = st.mb?.T === T ? { ...T, b: st.mb.b } : T; return simDisguised(R, null) && !simDisguised(R, A) ? `，${abilZh(A.b.ab)}無視${abilZh('disguise')}` : ''; };
// said＝攻擊那行已經寫了擋下第一下（連續攻擊招式）
function simBust(st, s, T, said) {
  T.bust = true;
  if (!said) simLog(st, `${simName(st, s, T)}的${abilZh('disguise')}擋下了這一下`);
  simHurt(st, s, T, T.max / 8, `的${abilZh('disguise')}被揭穿了`);
}
// 文柚果：HP 一半以下時回復 1/4（Showdown sitrusberry；特性熟成 ×2）；回復封鎖中不能吃（onTryEatItem 看 TryHeal），樹果留著
function simSitrus(st, s, M) {
  if (M.hp > 0 && M.item === 'sitrus-berry' && M.hp <= M.max / 2 && !M.v.hblock && simCanEat(st, s)) { simLoseItem(M); simSitrusHeal(st, s, M, '吃了文柚果'); simAte(st, s, M, 'sitrus-berry'); }
}
// 拿到樹果後馬上看要不要吃（Showdown onUpdate）：文柚果 HP 一半以下、木子果有異常
function simBerryNow(st, s, M) {
  simSitrus(st, s, M);
  if (M.item === 'lum-berry' && M.status && simCanEat(st, s)) { simLog(st, `${simName(st, s, M)}吃了${ITEMS[M.item][0]}，治好了`); M.status = ''; simLoseItem(M); simAte(st, s, M, 'lum-berry'); }
}
const simSitrusHeal = (st, s, M, why) => simHeal(st, s, M, M.max / 4 * (M.b.ab === 'ripen' ? 2 : 1), why);
// 每個行動後（Showdown eachEvent('Update')）：雙方場上的再看一次樹果（原本被緊張感擋住、那隻倒下或換下場了就吃得到）
function simUpdate(st) { [0, 1].forEach(s => { const M = simAct(st, s); if (M.hp > 0) simBerryNow(st, s, M); }); }
// 能不能吃樹果：對手場上那隻特性緊張感時不能吃（Showdown unnerve onFoeTryEatItem）
const simCanEat = (st, s) => { const O = simAct(st, 1 - s); return !(O.hp > 0 && O.b.ab === 'unnerve'); };
// 吃了樹果 it 之後（Showdown eatItem → EatItem 事件；lastItem 在 simLoseItem 記了）：頰囊回最大 HP 的 1/3；
// 反芻在下一回合結束再吃一次（v.cud，見 simEnd；吃回來的不再觸發反芻）
// pouched＝頰囊已經算過了（連續攻擊中途吃的，見 simMove 的 midPouch）
function simAte(st, s, M, it, again = false, pouched = false) {
  if (M.b.ab === 'cheek-pouch' && !pouched) simHeal(st, s, M, M.max / 3, `的${abilZh('cheek-pouch')}`);
  if (M.b.ab === 'cud-chew' && !again) M.v.cud = { it, n: 2 };
}
// 能力變化 d：foe＝造成的一方（對手造成的才看恆淨之軀、鏡甲、不服輸、好勝）；唱反調反過來；白色香草把降低的恢復（用掉）。回傳有沒有變。
// mirrored＝鏡甲反彈回來的（Showdown mirrorarmor：effect 是鏡甲的不再反彈，雙方都是鏡甲時不會一直彈）
function simBoost(st, s, M, d, foe, mirrored = false) {
  if (M.hp <= 0) return false;
  let ch = Object.entries(d).map(([k, v]) => [k, M.b.ab === 'contrary' ? -v : v]);
  if (foe != null) {
    // 對手造成的降低：恆淨之軀、白霧、金屬防護全擋，怪力鉗擋攻擊、健壯胸肌擋防禦（Showdown onTryBoost）
    if (['clear-body', 'white-smoke', 'full-metal-body'].includes(M.b.ab)) ch = ch.filter(([, v]) => v > 0);
    if (M.b.ab === 'hyper-cutter') ch = ch.filter(([k, v]) => k !== 'atk' || v > 0);
    if (M.b.ab === 'big-pecks') ch = ch.filter(([k, v]) => k !== 'def' || v > 0);
    if (['keen-eye', 'illuminate', 'minds-eye'].includes(M.b.ab)) ch = ch.filter(([k, v]) => k !== 'acc' || v > 0);
    if (M.b.ab === 'mirror-armor' && !mirrored) {
      const back = ch.filter(([, v]) => v < 0);
      ch = ch.filter(([, v]) => v > 0);
      if (back.length) simBoost(st, foe, simAct(st, foe), Object.fromEntries(back), s, true);
    }
  }
  // 一項一項套（Showdown boost 逐項跑 AfterEachBoost）：對手造成的每降一項，不服輸攻擊 +2、好勝特攻 +2（拋下狠話降兩項就觸發兩次）
  const done = [];
  let shown = 0;
  const flush = () => { const part = done.slice(shown); shown = done.length; if (part.length) simLog(st, `${simName(st, s, M)}${part.map(([k, v]) => `${SIM_STAT_ZH[k]} ${v > 0 ? '+' : '−'}${Math.abs(v)}`).join('、')}`); };
  for (const [k, v] of ch) {
    const was = M.st[k];
    M.st[k] = Math.max(-6, Math.min(6, was + v));
    if (M.st[k] === was) continue;
    done.push([k, M.st[k] - was]);
    if (M.st[k] < was && foe != null && ['defiant', 'competitive'].includes(M.b.ab)) { flush(); simBoost(st, s, M, M.b.ab === 'defiant' ? { atk: 2 } : { spa: 2 }); }
  }
  flush();
  // 這回合能力有上升過（Showdown statsRaisedThisTurn；魅誘之聲、妒火看）
  if (done.some(([, v]) => v > 0)) M.v.up = st.turn;
  if (M.item === 'white-herb' && Object.values(M.st).some(v => v < 0)) {
    Object.keys(M.st).forEach(k => { if (M.st[k] < 0) M.st[k] = 0; });
    simLoseItem(M);
    simLog(st, `${simName(st, s, M)}用白色香草把降低的能力恢復`);
  }
  return done.length > 0;
}
// M 會不會陷入異常狀態 x（屬性、特性免疫；src＝造成的寶可夢，特性腐蝕能讓毒、鋼屬性中毒）。
// 天氣場地（Showdown）：晴天不會冰凍（sunnyday onImmunity frz）、晴天時特性葉片防守不會陷入異常（leafguard）；
// 在地面上（沒在蓄力躲起來）時電氣場地不會睡著、薄霧場地不會陷入任何異常（electricterrain／mistyterrain onSetStatus）
function simCanStatus(st, M, x, src) {
  const ty = simTypes(M), ab = M.b.ab, wx = simWx(st), ter = simTer(st), gr = simGround(M) && !M.hide;
  if (M.hp <= 0 || M.status || ab === 'purifying-salt') return false;
  // 神秘守護（Showdown safeguard onSetStatus）：對手造成的不會（對手特性穿透照樣）
  if (simSafe(st, M, src)) return false;
  if ((x === 'frz' && wx === 'sun') || (ab === 'leaf-guard' && wx === 'sun') || (gr && (ter === 'misty' || (ter === 'electric' && x === 'slp')))) return false;
  if (x === 'brn') return !ty.includes('fire') && !['water-veil', 'water-bubble', 'thermal-exchange'].includes(ab);
  if (x === 'par') return !ty.includes('electric') && ab !== 'limber';
  if (x === 'slp') return !['insomnia', 'vital-spirit', 'sweet-veil'].includes(ab);
  if (x === 'frz') return !ty.includes('ice');
  return (!(ty.includes('poison') || ty.includes('steel')) || src?.b.ab === 'corrosion') && ab !== 'immunity';
}
// 陷入異常狀態：睡眠照冠軍版 2～3 回合（mods/champions/conditions.ts：[2, 3, 3] 抽一個，期望值模式取 3）；冰凍照冠軍版最多 3 次出招機會（見 simMove）；
// 木子果（任何異常）、零餘果（睡眠）馬上治好；特性同步把灼傷、麻痺、中毒傳回給對手（睡眠、冰凍不傳）。回傳成功與否
function simStatus(st, s, M, x, rnd, src) {
  if (!simCanStatus(st, M, x, src)) return false;
  Object.assign(M, { status: x, tox: 0, slp: x === 'slp' ? (rnd ? [2, 3, 3][Math.floor(rnd() * 3)] : 3) : 0, frz: x === 'frz' ? 3 : 0 });
  simLog(st, `${simName(st, s, M)}陷入${SIM_STATUS_ZH[x]}狀態`);
  if ((M.item === 'lum-berry' || (x === 'slp' && M.item === 'chesto-berry')) && simCanEat(st, s)) {
    const it = M.item;
    simLog(st, `${simName(st, s, M)}吃了${ITEMS[it][0]}，治好了`);
    M.status = '';
    simLoseItem(M);
    simAte(st, s, M, it);
  } else if (M.b.ab === 'synchronize' && src && src.hp > 0 && x !== 'slp' && x !== 'frz') simStatus(st, 1 - s, src, x, rnd, M);
  return true;
}
// 換上第 i 隻：換下來的（還站著的）特性再生力回 1/3、自然回復治好異常（冠軍版），能力變化與換下場就清掉的狀態都清掉、戰鬥切換變回原本的型態，
// 上一次用的招式也清掉（Showdown switchIn 對換下場的呼叫 clearVolatile，裡面 lastMove = null；所以換回來還沒出招時再來一次會失敗）；
// 換上來的：劇毒累積重算、治癒之願回滿，再踩撒菱類
// late＝出場特性（威嚇）先不發動，等雙方都換上來再一起發動（倒下後同時補位，見 simReplace）
// pass＝'baton' 接棒（能力變化與 SIM_BATON 的狀態傳給換上來的）、{ sub } 斷尾（只給替身，HP sub）；在踩撒菱類之前傳（Showdown switchIn 的 copyVolatileFrom 在 runSwitch 之前）
function simSwitch(st, s, i, rnd, late = false, pass = null) {
  simMbEnd(st);
  const side = st.sd[s], O = side.mons[side.act];
  const keep = pass === 'baton' ? { st: { ...O.st }, v: simCloneV(Object.fromEntries(SIM_BATON.filter(x => O.v[x] != null).map(x => [x, O.v[x]]))) }
    : pass?.sub ? { v: { sub: pass.sub } } : null;
  if (O.hp > 0 && O.b.ab === 'regenerator') simHeal(st, s, O, O.max / 3, '換下場時再生力');
  if (O.hp > 0 && O.b.ab === 'natural-cure') O.status = '';
  // 全能變身（Showdown zerotohero onSwitchOut）：帕路秋甘換下場就變成全能形態，之後一直是（hk，見 simFk）
  if (O.hp > 0 && O.b.ab === 'zero-to-hero' && !O.tf && O.key === 'palafin' && !O.hk && MON['palafin-hero']) O.hk = 'palafin-hero';
  simUntransform(O);
  Object.assign(O, { st: SIM_ST0(), lock: '', chg: '', hide: false, rech: false, v: {}, last: '' });
  delete O.fk;
  if (O.b0) { O.b = O.b0; delete O.b0; }
  side.act = i;
  const M = side.mons[i];
  Object.assign(M, { in: st.turn, out: true, tox: 0 });
  simLog(st, `${s ? '對手' : '我方'}換上${MON[M.key].zh}（HP ${simPct(M.hp, M.max)}%）`);
  if (keep) {
    if (keep.st) M.st = keep.st;
    Object.assign(M.v, keep.v);
    simLog(st, `${simName(st, s, M)}接手了${pass === 'baton' ? '能力變化與狀態' : `替身（${simPct(pass.sub, O.max)}%）`}`);
  }
  // 大將（Showdown supremeoverlord onStart）：上場時記下這一方倒下幾隻（最多 5），威力照這個算到換下場（v.fallen，見 simCalc）
  const down = side.mons.filter(m => m.hp <= 0).length;
  if (M.b.ab === 'supreme-overlord' && down) { M.v.fallen = Math.min(5, down); simLog(st, `${simName(st, s, M)}的${abilZh('supreme-overlord')}：倒下 ${down} 隻，威力 ×${1 + M.v.fallen / 10}`); }
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
  if (!late) { simEntry(st, [s]); simSeeds(st); }
}
// 剛上場的 ss 這幾方的出場效果（Showdown fieldEvent('SwitchIn')：同時上場的照速度快的先（速度在這時排一次，同速當我方先，同 simOrder），
// 每隻把自己的做完才輪下一隻）：複製（抄到的威嚇、天氣照樣發動）、威嚇、開天氣場地、變身者（變完身抄到的威嚇、天氣發動）。
// 所以比對面快的百變怪先變身、再吃對面的威嚇；比較慢的先吃威嚇、變身時能力變化被抄來的蓋掉（同對位的 intimidated）
function simEntry(st, ss) {
  simOrder(st).filter(s => ss.includes(s)).forEach(s => {
    const M = simAct(st, s);
    simTrace(st, s, M); simIntimidate(st, s, M); simEntryField(st, s, M); simImposter(st, s, M);
    // 除障（Showdown screencleaner onStart）：雙方的反射壁、光牆、極光幕都清掉
    if (M.hp > 0 && M.b.ab === 'screen-cleaner' && st.sd.some(x => Object.keys(x.scr).length)) { st.sd.forEach(x => { x.scr = {}; }); simLog(st, `${simName(st, s)}的${abilZh('screen-cleaner')}：雙方的牆都消失了`); }
    // 甘露之蜜（Showdown supersweetsyrup onStart，一場只發動一次）：對手閃避 −1（有替身的不受）
    const T = simAct(st, 1 - s);
    if (M.hp > 0 && M.b.ab === 'supersweet-syrup' && !M.syrup) {
      M.syrup = true;
      simLog(st, `${simName(st, s)}的${abilZh('supersweet-syrup')}`);
      if (T.hp > 0 && !T.v.sub) simBoost(st, 1 - s, T, { eva: -1 }, s);
    }
  });
  // 擬態、陰晴不定：上場時照現在的場地、天氣變屬性（出場特性開了天氣也在這裡跟著變）
  if (ss.some(s => simAct(st, s).b.ab === 'mimicry')) simMimicry(st);
  simForecast(st);
}
// 變身（招式變身、特性變身者）：M 變成對手 T 的樣子（Showdown pokemon.ts transformInto，冠軍版 mod 沒改）：寶可夢（現在的型態、屬性、種族值、體重）、
// HP 以外的能力（能力點數、性格也照 T 的）、能力變化、特性、招式（每招 PP＝min(5, 原本的 PP)）、被打中幾下（timesAttacked）、暫時狀態只抄集氣；
// HP、異常狀態、道具照自己的。
// 對手倒下了、有替身、自己或對手已經變身過的失敗（守住擋不住）。原本的樣子存在 M.tf，換下場就變回來（simUntransform，Showdown clearVolatile）；
// id 改成「原本的 id>對手 key」，計算快取不會和本來那隻或對手混在一起
function simTransform(st, s, M, T) {
  if (T.hp <= 0 || T.v.sub || M.tf || T.tf) return false;
  simLog(st, `${simName(st, s, M)}變身成${MON[T.key].zh}`);
  M.tf = { key: M.key, id: M.id, b: M.b, moves: M.moves, pp: M.pp };
  const tk = simFk(T);
  Object.assign(M, { key: tk, id: `${M.id}>${tk}`, b: { ...T.b, hp: M.b.hp }, moves: T.moves.slice(),
    pp: Object.fromEntries(T.moves.map(k => [k, Math.min(5, MOVES[k]?.[5] ?? 5)])), st: { ...T.st }, lock: '', hits: T.hits || 0 });
  if (T.v.focus) M.v.focus = true;
  if (T.v.types) M.v.types = T.v.types.slice();
  return true;
}
const simUntransform = M => { if (M.tf) { Object.assign(M, { key: M.tf.key, id: M.tf.id, b: M.tf.b, moves: M.tf.moves, pp: M.tf.pp }); delete M.tf; } };
// 寶可夢原本的 key（變身中的是變身前的；統計、畫面用）
const simBaseKey = M => M.tf?.key || M.key;
// 特性變身者：出場時變身成對手場上那隻（Showdown abilities.ts imposter）。照 Showdown 實際打出來的紀錄：對手的威嚇先發動、變身再抄能力變化
// （被降的會被蓋掉），變完身抄到的出場特性（威嚇、開天氣場地）會發動
function simImposter(st, s, M) {
  if (M.hp > 0 && M.b.ab === 'imposter' && !M.tf && simTransform(st, s, M, simAct(st, 1 - s))) { simIntimidate(st, s, M); simEntryField(st, s, M); }
}
// 複製（Showdown trace）：出場時抄對手場上那隻的特性（SIM_NOTRACE 的抄不到），換下場換回來（simSwitch 的 b0）；
// 抄到的出場特性（威嚇、開天氣場地）照樣發動，所以要在 simIntimidate、simEntryField 之前呼叫
function simTrace(st, s, M) {
  const T = simAct(st, 1 - s);
  if (M.hp <= 0 || M.b.ab !== 'trace' || T.hp <= 0 || !T.b.ab || SIM_NOTRACE.has(T.b.ab)) return;
  M.b0 = M.b;
  M.b = { ...M.b, ab: T.b.ab };
  simLog(st, `${simName(st, s, M)}的${abilZh('trace')}：抄了${simName(st, 1 - s)}的${abilZh(T.b.ab)}`);
}
// 場地種子（SIM_SEED）：雙方場上的帶著和現在場地相同的種子就用掉、能力 +1（上場時、場地變了的時候都看；Showdown onStart／onTerrainChange）
function simSeeds(st) {
  [0, 1].forEach(s => {
    const M = simAct(st, s), x = SIM_SEED[M.item];
    if (M.hp <= 0 || !x || x[0] !== simTer(st)) return;
    simLog(st, `${simName(st, s, M)}用掉了${ITEMS[M.item][0]}`);
    simLoseItem(M);
    simBoost(st, s, M, x[1]);
  });
}
// 威嚇（出場特性）：s 這方的 M 出場時，對手場上那隻照 intimidateOn 改攻擊／特攻（同出戰選角的對位：不吃威嚇的特性不降，
// 不服輸、好勝等反而上升）；對手場上那隻倒下了就沒有作用。降了能力的帶白色香草就恢復（用掉）
function simIntimidate(st, s, M) {
  const T = simAct(st, 1 - s);
  if (M.hp <= 0 || M.b.ab !== 'intimidate' || T.hp <= 0) return;
  const e = intimidateOn(T.b.ab), who = `${simName(st, s, M)}的威嚇：${simName(st, 1 - s)}`;
  // 有替身的不受影響（Showdown intimidate：target 有 substitute 就 -immune）；鏡甲反彈回威嚇的那隻（mirrorarmor onTryBoost，
  // 反彈的那下照 simBoost 看威嚇方的恆淨之軀、不服輸等）
  if (T.v.sub) return simLog(st, `${who}有替身，不受影響`);
  if (T.b.ab === 'mirror-armor') { simLog(st, `${who}的${abilZh('mirror-armor')}把威嚇反彈回去`); simBoost(st, s, M, { atk: -1 }, 1 - s, true); return; }
  if (!e) return simLog(st, `${who}不受影響`);
  const done = [['atk', e[0]], ['spa', e[1]]].filter(([, v]) => v)
    .map(([k, v]) => { const was = T.st[k]; T.st[k] = Math.max(-6, Math.min(6, was + v)); return [k, T.st[k] - was]; }).filter(([, v]) => v);
  simLog(st, `${who}${done.map(([k, v]) => `${SIM_STAT_ZH[k]} ${v > 0 ? '+' : '−'}${Math.abs(v)}`).join('、') || '能力已經到底'}`);
  if (T.item === 'white-herb' && Object.values(T.st).some(v => v < 0)) {
    Object.keys(T.st).forEach(k => { if (T.st[k] < 0) T.st[k] = 0; });
    simLoseItem(T);
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
  if (x.tgt && (T.hp <= 0 || tb === 'good-as-gold' || (T.v.sub && !x.sub) || (M.b.ab === 'prankster' && simTypes(T).includes('dark')) || simPsyBlock(st, M, T, k)
    || (SIM_ABSORB[tb] && M.b.ab !== 'mold-breaker' && SIM_ABSORB[tb].t === simMoveType(st, M, k)))) return true;
  if (x.r && tb === 'magic-bounce') return true;
  if (x.tgt && SIM_SOUND_ST.has(k) && tb === 'soundproof' && M.b.ab !== 'mold-breaker') return true;
  const bare = !Object.values(side.haz).some(Boolean) && !Object.values(tSide.haz).some(Boolean);
  switch (x.kind) {
    case 'boost': case 'tidy': return capped(M, x.b) && (x.kind !== 'tidy' || bare);
    case 'drum': return M.hp <= M.max / 2 || M.st.atk >= 6;
    case 'soul': return M.hp <= M.max * 33 / 100 || capped(M, x.b);
    case 'retreat': return !!M.v.trap;
    case 'curse': return simTypes(M).includes('ghost') ? T.hp <= 0 || !!T.v.curse || tb === 'good-as-gold' : capped(M, { atk: 1, def: 1 });
    case 'focus': return !!M.v.focus;
    // 充電：已經在充電還是能用（Showdown charge 有 onRestart），特防也到頂了才沒效果
    case 'charge': return !!M.v.charge && capped(M, x.b);
    case 'heal': return M.hp >= M.max;
    case 'wish': return !!side.wish;
    // 睡覺照陷入睡眠的規則（Showdown rest onHit：target.setStatus('slp')，不眠、幹勁、甜幕、潔淨之鹽、葉片防守、場地都擋得住；原本有的異常會被換掉，所以先當沒有異常看）
    case 'rest': return M.status === 'slp' || M.hp >= M.max || !simCanStatus(st, { ...M, status: '' }, 'slp', M);
    case 'hwish': return !simBench(st, s).length;
    case 'split': return M.hp >= T.hp;
    case 'sap': return T.st.atk <= -6;
    case 'seed': return simTypes(T).includes('grass') || !!T.v.seed;
    case 'status':
      if (x.pw && (simTypes(T).includes('grass') || tb === 'overcoat')) return true;
      if (k === 'thunder-wave' && eff('electric', simTypes(T)) === 0) return true;
      return !simCanStatus(st, T, x.x, M) && (!x.d || capped(T, x.d));
    case 'yawn': return !simCanStatus(st, T, 'slp', M) || !!T.v.yawn;
    case 'hazard': return tSide.haz[x.h] >= x.max;
    // 清除濃霧：沒有東西可清、對手閃避也降不了（已經 −6、有替身、恆淨之軀類擋）才失敗
    case 'defog': return bare && !Object.keys(tSide.scr).length && !tSide.sg && !st.ter
      && (T.st.eva <= -6 || (!!T.v.sub && M.b.ab !== 'infiltrator') || (['clear-body', 'white-smoke', 'full-metal-body'].includes(tb) && M.b.ab !== 'mold-breaker'));
    case 'encore': return simAroma(M, T) || !T.last || !!T.v.enc || T.last === 'encore' || !T.moves.includes(T.last) || !(T.pp[T.last] > 0);
    case 'taunt': return simAroma(M, T) || !!T.v.taunt || tb === 'oblivious';
    case 'subst': return !!M.v.sub || M.hp <= M.max / 4;
    // 極光幕要下雪（Showdown auroraveil onTry：field.isWeather snowscape）
    case 'screen': return !!side.scr[k] || (k === 'aurora-veil' && simWx(st) !== 'snow');
    case 'field': return (x.w in SIM_WX_ROCK ? st.wx : st.ter)?.t === x.w && !(x.pivot && simBench(st, s).length);
    case 'phaze': return !simBench(st, 1 - s).length || (SIM_ANCHOR.has(tb) && M.b.ab !== 'mold-breaker');
    case 'haze': return [M, T].every(P => Object.values(P.st).every(v => !v));
    case 'debuff': return capped(T, x.d) || ['clear-body', 'white-smoke', 'full-metal-body'].includes(tb)
      || (tb === 'hyper-cutter' && Object.keys(x.d).every(k => k === 'atk')) || (tb === 'big-pecks' && Object.keys(x.d).every(k => k === 'def'));
    case 'shot': return capped(T, x.d) && !simBench(st, s).length;
    case 'transform': return !!M.tf || !!T.tf;
    case 'tailwind': return !!side.tw;
    case 'dbond': return !!M.v.db;
    case 'baton': return !simBench(st, s).length;
    case 'shedtail': return !simBench(st, s).length || !!M.v.sub || M.hp <= Math.ceil(M.max / 2);
    case 'perish': return [M, T].every(P => P.hp <= 0 || !!P.v.perish || (P !== M && P.b.ab === 'soundproof' && M.b.ab !== 'mold-breaker'));
    case 'soak': return simTypes(T).join() === 'water';
    case 'revive': return !side.mons.some(m => m.hp <= 0);
    case 'trick': return !!T.v.sub || (tb === 'sticky-hold' && M.b.ab !== 'mold-breaker') || (!M.item && !T.item) || !!MON[M.key].base || !!MON[T.key].base;
    case 'octo': return !!T.v.octo || simTypes(T).includes('ghost');
    case 'topsy': return !Object.values(T.st).some(Boolean);
    case 'disable': return simAroma(M, T) || !T.last || !T.moves.includes(T.last) || !(T.pp[T.last] > 0) || !!T.v.dis;
    case 'safeguard': return !!side.sg;
    case 'recycle': return !!M.item || !M.lastItem;
    case 'mrise': return !!M.v.mrise || M.item === 'iron-ball';
    case 'skillswap': return SIM_NOSWAP.has(M.b.ab) || SIM_NOSWAP.has(tb);
    case 'copycat': return !st.lastMv || SIM_NOCOPY.has(st.lastMv) || !simCanUse(st.lastMv) || st.lastMv === SIM_STRUGGLE;
    case 'instruct': return !T.last || SIM_NOINSTRUCT.has(T.last) || SIM_CHARGE.has(T.last) || !T.moves.includes(T.last) || !(T.pp[T.last] > 0);
    default: return false;
  }
}
// 一方這回合能做的：招式（再來一次鎖住的那招；講究圍巾鎖住的那招（圍巾被拍落就解除，Showdown choicelock）；PP 用完的、被挑釁時的輔助招、被定身的招式、
// 上一次剛用過的巨力錘（SIM_TWICE）不能選；
// 擊掌奇襲、迎頭一擊要上場後第一回合；一定失敗的輔助招不列，見 simFutile）、換人（後排還站著的；背水一戰、被對手的踩影困住、
// 被綁住類綁著、被蛸固纏住、被縫影縫住（用的那隻還在場上，simBound；幽靈屬性不受影響）不能換）。
// 能選的招式（有 PP、沒被挑釁擋）一招都沒有時只能掙扎（或換人）；要休息的、蓄力中的、被逆鱗類鎖住的只能照做、不能換人；
// 招式都會失敗又不能換人時是 none（什麼都不做）。
// 連續 SIM_IDLE 回合雙方都沒扣血也沒換人時，打不到對手場上那隻的攻擊招式不能選（不然雙方都出無效招式會原地空轉）；只剩這種招式又不能換人就照舊
const SIM_IDLE = 2;
function simOpts(ctx, st, s) {
  const M = simAct(st, s), T = simAct(st, 1 - s);
  if (M.rech) return [{ t: 'rech' }];
  if (M.chg) return [{ t: 'mv', k: M.chg }];
  if (M.v.rage) return [{ t: 'mv', k: M.v.rage.k }];
  const ks = M.v.enc && M.moves.includes(M.v.encK) && M.pp[M.v.encK] > 0 ? [M.v.encK] : M.lock && M.item === 'choice-scarf' && M.moves.includes(M.lock) ? [M.lock] : M.moves;
  const can = ks.filter(k => M.pp[k] > 0 && !(M.v.taunt && SIM_SUP[k]) && M.v.dis?.k !== k && !(SIM_TWICE.has(k) && M.last === k)
    && !(M.v.hblock && SIM_HEALMV.has(k)) && !(M.v.tchop && simSound(k)));
  let mv = !can.length ? [{ t: 'mv', k: SIM_STRUGGLE }]
    : can.filter(k => (!SIM_FIRST.has(k) || M.in === st.turn) && !simFutile(st, s, k)).map(k => ({ t: 'mv', k }));
  // 不能換人：背水一戰；對手場上那隻特性踩影（Showdown shadowtag：自己也是踩影、幽靈屬性不受影響；打完換人、被吹走照樣換）
  const tagged = T.hp > 0 && T.b.ab === 'shadow-tag' && M.b.ab !== 'shadow-tag' && !simTypes(M).includes('ghost');
  // 被綁住類綁著、被蛸固纏住、被縫影縫住（用的那隻還在場上；幽靈屬性不受影響）
  const held = x => !!x && st.sd[x.s].act === x.i && simAct(st, x.s).hp > 0;
  const bound = (simBound(st, M) || held(M.v.octo) || held(M.v.shackle)) && !simTypes(M).includes('ghost');
  const sw = M.v.trap || tagged || bound ? [] : simBench(st, s).map(i => ({ t: 'sw', i }));
  if (st.idle >= SIM_IDLE) {
    const hit = mv.filter(o => SIM_SUP[o.k] || o.k === SIM_STRUGGLE || simHit(ctx, st, M, T, o.k, false, true).eff);
    if (hit.length || sw.length) mv = hit;
  }
  const all = [...mv, ...sw];
  return all.length ? all : [{ t: 'none' }];
}
// s 這方的 M 用輔助招 k（SIM_SUP）；oa＝對手這回合的選擇、oWill＝對手這回合還會出招（守住類要對手還沒動才成功；再來一次、挑釁看這個）；
// bounced＝被魔法鏡反彈回來的（不再反彈、不看惡作劇之心）。失敗、被擋下、沒命中都記成這回合出招失敗（M.v.mt，豁出去、跺腳用；反彈回來的不算）
function simSupport(st, s, k, oa, oWill, rnd, pick, bounced) {
  const x = SIM_SUP[k], M = simAct(st, s), T = simAct(st, 1 - s), side = st.sd[s], tSide = st.sd[1 - s];
  const me = simName(st, s), tn = simName(st, 1 - s), mz = MOVES[k][0];
  const bad = () => { if (!bounced && M.v.mt) M.v.mt.ok = false; };
  const say = t => simLog(st, `${me}用${mz}${t}`), fail = why => { bad(); say(`，但失敗了（${why}）`); };
  if (x.tgt && T.hp <= 0) return fail('沒有目標');
  if (x.tgt && T.hide) return fail(`${tn}${T.chg === 'dig' ? '在地底' : '消失了'}`);
  // 精神場地（onTryHitPriority 4）在守住（3）之前
  if (x.tgt && simPsyBlock(st, M, T, k)) return fail(`${FIELD_ZH.psychic}擋下先制招式`);
  // 被守住不算出招失敗也不算成功（Showdown NOT_FAIL，同 simMove）
  if (x.f && T.v.prot && T.v.prot !== 'kings') { if (!bounced && M.v.mt) M.v.mt.ok = null; return say(`，被${tn}擋下`); }
  if (x.tgt && simAbsorb(st, s, M, T, k)) return bad();
  if (x.r && !bounced && T.b.ab === 'magic-bounce') { say(`，被${tn}的魔法鏡反彈`); return simSupport(st, 1 - s, k, null, false, rnd, pick, true); }
  if (x.tgt && T.b.ab === 'good-as-gold') return fail(`${tn}的黃金之軀`);
  if (x.tgt && SIM_SOUND_ST.has(k) && T.b.ab === 'soundproof' && M.b.ab !== 'mold-breaker') return fail(`${tn}的隔音`);
  if (x.tgt && !bounced && M.b.ab === 'prankster' && simTypes(T).includes('dark')) return fail('惡屬性不受惡作劇之心的招式影響');
  if (x.tgt && T.v.sub && !x.sub) return fail(`${tn}有替身`);
  // 命中率（simAcc；打自己、撒在場上的輔助招是必中）：照亂數抽，期望值模式當命中
  const acc = simAcc(st, M, T, k, !oWill);
  if (acc < 100 && rnd && rnd() * 100 >= acc) { bad(); return say(`，但沒有命中（命中率 ${acc}%）`); }
  // 心靈香草（Showdown mentalherb：著迷、再來一次、挑釁、無理取鬧、定身、回復封鎖）
  const herb = () => { if (T.item === 'mental-herb') { delete T.v.taunt; delete T.v.enc; delete T.v.encK; delete T.v.dis; delete T.v.hblock; simLoseItem(T); simLog(st, `${tn}用心靈香草解除了`); } };
  switch (x.kind) {
    case 'boost': case 'charge': case 'focus':
      if (simFutile(st, s, k)) return fail('沒有效果');
      say('');
      if (x.kind === 'charge') M.v.charge = true;
      if (x.kind === 'focus') M.v.focus = true;
      if (x.mini) M.v.mini = true;
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
      // 幽靈屬性的詛咒是打對手的輔助招：黃金之軀擋得住（不會扣自己的 HP；Showdown goodasgold onTryHit）
      if (T.b.ab === 'good-as-gold') return fail(`${tn}的黃金之軀`);
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
    case 'heal': {
      if (M.hp >= M.max) return fail('HP 已經全滿');
      say('');
      // 光合作用、晨光、月光照天氣（SIM_SUNHEAL；this.modify 取整同 pokeRound），其他一半
      const f = SIM_SUNHEAL.has(k) && (SIM_SUNHEAL_F[simWxOf(st, M, k)] || 0.5);
      simHeal(st, s, M, f ? pokeRound(M.max * Math.floor(f * 4096) / 4096) : Math.round(M.max / 2), '回復');
      // 羽棲：這回合失去飛行屬性（Showdown roost 的 self volatile，回合結束解除，見 simTypes）
      if (k === 'roost') M.v.roost = true;
      return;
    }
    case 'wish':
      if (side.wish) return fail('已經在祈願');
      side.wish = { t: 2, hp: Math.floor(M.max / 2) };
      return say('：下一回合結束時回復');
    case 'rest':
      if (simFutile(st, s, k)) return fail('HP 全滿或已經睡著');
      Object.assign(M, { status: 'slp', slp: 3, tox: 0, hp: M.max });
      say('：HP 回滿、睡著了');
      if ((M.item === 'lum-berry' || M.item === 'chesto-berry') && simCanEat(st, s)) { const it = M.item; simLog(st, `${me}吃了${ITEMS[it][0]}，醒來了`); M.status = ''; simLoseItem(M); simAte(st, s, M, it); }
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
      // 被平分到一半以下的照樣吃文柚果（Showdown sethp 後的 Update）
      simSitrus(st, 1 - s, T); simSitrus(st, s, M);
      return;
    }
    case 'sap': {
      if (T.st.atk <= -6) return fail('對手攻擊已經最低');
      // 回復量＝對手含能力變化的攻擊能力值（Showdown getStat('atk', false, true)）
      // 對手攻擊值照能力值用的型態（戰鬥切換的刀劍形態、全能形態，simFk）
      const [sp, nat] = invAt(T.b, 1, T.b.atkInv), atk = stageStat(statOf(MON[simFk(T)].bs[1], sp, 1, nat), T.st.atk);
      say('');
      const v = M.item === 'big-root' ? pokeRound(atk * 5324 / 4096) : atk;
      if (T.b.ab === 'liquid-ooze') simHurt(st, s, M, v, `吸到${tn}的${abilZh('liquid-ooze')}`); else simHeal(st, s, M, v, '吸取力量');
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
      if (!simCanStatus(st, T, 'slp', M) || T.v.yawn) return fail('沒有效果');
      T.v.yawn = 2;
      return say(`：${tn}打起瞌睡，下一回合結束會睡著`);
    case 'hazard':
      if (tSide.haz[x.h] >= x.max) return fail('已經撒滿了');
      tSide.haz[x.h]++;
      return say(`：在${s ? '我方' : '對手'}場地撒下${SIM_HAZ_ZH[x.h]}${x.max > 1 ? `（${tSide.haz[x.h]} 層）` : ''}`);
    case 'defog':
      // Showdown defog：對手閃避 −1（有替身的不降，穿透照降）、清掉雙方的撒菱類、對手的牆與神秘守護，場地也清掉（第八世代起）
      say('：清掉雙方的撒菱類、對手的牆與神秘守護、場地');
      if (!T.v.sub || M.b.ab === 'infiltrator') simBoost(st, 1 - s, T, { eva: -1 }, s);
      st.sd.forEach(sd => Object.keys(sd.haz).forEach(h => { sd.haz[h] = 0; }));
      tSide.scr = {};
      delete tSide.sg;
      if (st.ter) simClearTer(st, '消失了');
      return;
    case 'encore':
      if (simAroma(M, T)) return fail(`${tn}的${abilZh('aroma-veil')}`);
      if (simFutile(st, s, k)) return fail('沒有可以重複的招式');
      Object.assign(T.v, { enc: 3, encK: T.last });
      if (oWill && oa?.t === 'mv') oa.k = T.last; else T.v.enc++;
      say(`：${tn}只能用${MOVES[T.last][0]}`);
      return herb();
    case 'taunt':
      if (simAroma(M, T)) return fail(`${tn}的${abilZh('aroma-veil')}`);
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
      // 吸盤（Showdown suctioncups onDragOut；破格無視）
      if (SIM_ANCHOR.has(T.b.ab) && M.b.ab !== 'mold-breaker') return fail(`${tn}的${abilZh(T.b.ab)}`);
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
    case 'transform':
      if (M.tf || T.tf) return fail(M.tf ? '已經變身了' : `${tn}是變身來的`);
      say('');
      simTransform(st, s, M, T);
      return;
    case 'field': {
      const n = simSetField(st, M, x.w), out = x.pivot && M.hp > 0 && simBench(st, s).length && !simOver(st);
      if (!n && !out) return fail(`已經是${FIELD_ZH[x.w]}`);
      say(n ? `：變成${FIELD_ZH[x.w]}（${n} 回合）` : `：已經是${FIELD_ZH[x.w]}`);
      if (n && !(x.w in SIM_WX_ROCK)) simSeeds(st);
      if (out) simSwitch(st, s, pick(st, s), rnd);
      return;
    }
    case 'troom':
      if (st.troom) { st.troom = null; return say('：戲法空間結束了'); }
      st.troom = { n: 5 };
      return say('：5 回合內慢的先動');
    case 'tailwind':
      if (side.tw) return fail('已經有順風');
      side.tw = 4;
      return say('：4 回合內這一方速度 ×2');
    case 'dbond':
      if (M.v.db) { delete M.v.db; return fail('連續使用'); }
      M.v.db = true;
      return say('：到下次出招前被打倒，對手也會倒下');
    case 'baton': case 'shedtail': {
      if (!simBench(st, s).length || simOver(st)) return fail('沒有可以換的');
      if (x.kind === 'baton') { say(''); return simSwitch(st, s, pick(st, s), rnd, false, 'baton'); }
      if (M.v.sub) return fail('已經有替身');
      if (M.hp <= Math.ceil(M.max / 2)) return fail('HP 不夠');
      say('');
      simHurt(st, s, M, Math.ceil(M.max / 2), '削減自己的 HP', false);
      return simSwitch(st, s, pick(st, s), rnd, false, { sub: Math.floor(M.max / 4) });
    }
    case 'perish': {
      // 隔音的對手不受（使用者自己是隔音照樣算，Showdown soundproof onTryHit target !== source）
      const who = [[s, M], [1 - s, T]].filter(([, P]) => P.hp > 0 && !P.v.perish && !(P !== M && P.b.ab === 'soundproof' && M.b.ab !== 'mold-breaker'));
      if (!who.length) return fail('沒有效果');
      who.forEach(([, P]) => { P.v.perish = 4; });
      return say(`：${who.map(([q]) => simName(st, q)).join('、')}3 回合後倒下`);
    }
    case 'soak':
      if (simTypes(T).join() === 'water') return fail('已經是水屬性');
      T.v.types = ['water'];
      return say(`：${tn}變成水屬性`);
    case 'revive': {
      // 復活哪一隻是玩家選的；這裡挑種族值總和最高的
      const dead = side.mons.filter(m => m.hp <= 0), bst = m => MON[m.key].bs.reduce((t, v) => t + v, 0);
      if (!dead.length) return fail('沒有倒下的');
      const P = dead.reduce((a, m) => bst(m) > bst(a) ? m : a);
      Object.assign(P, { hp: Math.floor(P.max / 2), status: '', tox: 0, slp: 0 });
      delete P.ft;
      return say(`：${MON[P.key].zh}復活了（HP 50%）`);
    }
    case 'trick': {
      if (T.v.sub) return fail(`${tn}有替身`);
      if (T.b.ab === 'sticky-hold' && M.b.ab !== 'mold-breaker') return fail(`${tn}的${abilZh('sticky-hold')}`);
      if (!M.item && !T.item) return fail('雙方都沒有道具');
      if (MON[M.key].base || MON[T.key].base) return fail('超級進化的道具換不了');
      const [a, b] = [M.item, T.item];
      simLoseItem(M, true); simLoseItem(T, true);
      Object.assign(M, { item: b, lock: '' });
      Object.assign(T, { item: a, lock: '' });
      say(`：交換了道具（自己拿到${b ? ITEMS[b]?.[0] || b : '空手'}、${tn}拿到${a ? ITEMS[a]?.[0] || a : '空手'}）`);
      // 換到的樹果條件已經符合就馬上吃（Showdown Update）
      simBerryNow(st, s, M); simBerryNow(st, 1 - s, T);
      return;
    }
    case 'octo':
      if (T.v.octo || simTypes(T).includes('ghost')) return fail('沒有效果');
      T.v.octo = { s, i: st.sd[s].act };
      return say(`：${tn}被纏住，不能換人`);
    case 'topsy':
      if (!Object.values(T.st).some(Boolean)) return fail('對手沒有能力變化');
      Object.keys(T.st).forEach(q => { T.st[q] = -T.st[q]; });
      return say(`：${tn}的能力變化反過來了`);
    case 'disable':
      if (simAroma(M, T)) return fail(`${tn}的${abilZh('aroma-veil')}`);
      if (!T.last || !T.moves.includes(T.last) || !(T.pp[T.last] > 0) || T.v.dis) return fail('沒有可以定身的招式');
      // 4 回合（Showdown disable duration 5，對手這回合還沒出招先扣 1；同詛咒之軀的 v.dis）
      T.v.dis = { k: T.last, n: oWill ? 4 : 5 };
      say(`：${tn}的${simMoveZh(T.last)}被定身了`);
      return herb();
    case 'safeguard':
      if (side.sg) return fail('已經有神秘守護');
      side.sg = 5;
      return say('：5 回合內這一方不會被對手弄成異常、混亂');
    case 'recycle':
      if (M.item || !M.lastItem) return fail('沒有可以拿回的道具');
      M.item = M.lastItem; M.lastItem = '';
      say(`：拿回了${ITEMS[M.item]?.[0] || M.item}`);
      return simBerryNow(st, s, M);
    case 'mrise':
      if (M.v.mrise || M.item === 'iron-ball') return fail('沒有效果');
      M.v.mrise = 5;
      return say('：5 回合內浮在空中');
    case 'skillswap': {
      if (SIM_NOSWAP.has(M.b.ab) || SIM_NOSWAP.has(T.b.ab)) return fail('特性換不了');
      const [a, b] = [M.b.ab, T.b.ab];
      say('');
      simSetAb(st, s, M, b, `換成了${abilZh(b)}`);
      simSetAb(st, 1 - s, T, a, `換成了${abilZh(a)}`);
      simAbStart(st, s, M); simAbStart(st, 1 - s, T);
      return;
    }
  }
}
// s 這方的 M 用攻擊招式 k 打中 T 之後的追加效果（SIM_SEC；Showdown battle-actions.ts secondaries）：照機率抽（期望值模式只算機率 100% 的）；
// 特性強行沒有追加效果（FLAG.secondary 的招式）；道具王者之證讓沒有畏縮效果的攻擊招式多 10% 畏縮（Showdown kingsrock，加在強行拿掉之後，所以強行也有）。
// 對手那邊的：打在替身上（subbed）、對手倒下了不算；畏縮要對手這回合還沒行動（oWill），特性精神力不會畏縮、我行我素不會混亂；
// 異常狀態照 simStatus（已經有異常、屬性特性免疫的不會）、能力變化照 simBoost（恆淨之軀等擋得住）。
// up＝出招前對手的 v.up（魅誘之聲、妒火看這個：追加效果在被打中發動的特性之前，持久力這招才加的不算，Showdown spreadMoveHit）
function simSecondary(st, s, M, T, k, oWill, rnd, subbed, up) {
  const list = M.b.ab === 'sheer-force' && FLAG.secondary.has(k) ? [] : SIM_SEC[k] || [];
  // 王者之證、特性惡臭：沒有畏縮效果的攻擊招式多 10% 畏縮（Showdown kingsrock onModifyMove、stench onModifyMove）
  const all = (M.item === 'kings-rock' || M.b.ab === 'stench') && !list.some(x => x.fl) ? [...list, { c: 10, fl: 1 }] : list;
  for (const x of all) {
    if (rnd ? rnd() * 100 >= x.c : x.c < 100) continue;
    if (x.me) { if (M.hp > 0) simBoost(st, s, M, x.me); continue; }
    if (subbed || T.hp <= 0) continue;
    if (x.up && up !== st.turn) continue;
    if (x.s) simStatus(st, 1 - s, T, Array.isArray(x.s) ? x.s[Math.floor(rnd() * x.s.length)] : x.s, rnd, M);
    else if (x.fl) { if (oWill && T.b.ab !== 'inner-focus') T.v.flinch = true; }
    else if (x.cf) { if (!simSafe(st, T, M)) simConfuse(st, 1 - s, T, rnd); }
    else if (x.d) simBoost(st, 1 - s, T, x.d, s);
    else if (x.salt && !T.v.salt) { T.v.salt = true; simLog(st, `${simName(st, 1 - s, T)}被鹽醃了`); }
    else if (x.hb && !T.v.hblock && !simAroma(M, T)) { T.v.hblock = 2; simLog(st, `${simName(st, 1 - s, T)}2 回合不能回復`); }
    else if (x.tc && !T.v.tchop) { T.v.tchop = 2; simLog(st, `${simName(st, 1 - s, T)}2 回合不能用聲音招式`); }
    else if (x.syrup && !T.v.syrup) { T.v.syrup = { n: 4, s, i: st.sd[s].act }; simLog(st, `${simName(st, 1 - s, T)}沾上了糖漿`); }
    else if (x.trap && !T.v.shackle && M.hp > 0 && !simTypes(T).includes('ghost')) { T.v.shackle = { s, i: st.sd[s].act }; simLog(st, `${simName(st, 1 - s, T)}的影子被縫住，不能換人`); }
    else if (x.aria) T.v.aria = true;
  }
}
// M 陷入混亂（why 寫在「混亂了」前面）：已經混亂、我行我素、薄霧場地在地面上的不會（mistyterrain onTryAddVolatile）；
// 2～5 次出招機會（Showdown random(2, 6)；期望值模式不會打到自己，次數取 3）。回傳有沒有混亂
function simConfuse(st, s, M, rnd, why = '') {
  if (M.hp <= 0 || M.v.conf || M.b.ab === 'own-tempo' || (simTer(st) === 'misty' && simGround(M) && !M.hide)) return false;
  M.v.conf = rnd ? 2 + Math.floor(rnd() * 4) : 3;
  simLog(st, `${simName(st, s, M)}${why}混亂了`);
  return true;
}
// s 這方的 M 用招式打倒了 T（dealt＝這招打掉的 HP）：打倒數 +1；T 的特性飛出的內在物讓 M 受到同樣的傷害（Showdown innardsout，魔法防守不受）；
// M 的特性自信過度攻擊 +1（moxie onSourceAfterFaint）
function simKO(st, s, M, T, dealt) {
  M.kos++;
  if (T.b.ab === 'innards-out' && dealt > 0) simHurt(st, s, M, dealt, `受到${simName(st, 1 - s, T)}的${abilZh('innards-out')}傷害`);
  if (M.b.ab === 'moxie' && M.hp > 0) simBoost(st, s, M, { atk: 1 });
}
// 逆鱗類（SIM_RAGE）出完招：沒鎖住的打中了才鎖（共 n 次）；鎖住中的這是第 u 次，u 到 n 就解除、自己混亂，
// 還沒到 n 但沒打中（landed false：被守住、沒命中、沒有效果、沒有目標）就提早解除、不混亂（Showdown lockedmove 實測）
function simRage(st, s, M, k, landed, rnd) {
  const g = M.v.rage;
  if (!g) { if (landed && M.hp > 0) M.v.rage = { k, n: rnd && rnd() < 0.5 ? 3 : 2, used: 1 }; return; }
  const u = g.used + 1;
  if (u < g.n && landed) { g.used = u; return; }
  delete M.v.rage;
  if (u >= g.n) simConfuse(st, s, M, rnd, '鬧累了，');
}
// 被守住類擋下的接觸招式：王者盾牌攻擊 −1、尖刺防守扣 1/8、碉堡中毒（Showdown kingsshield／spikyshield／banefulbunker）
function simProtHit(st, s, M, T, rnd) {
  if (T.v.prot === 'kings') simBoost(st, s, M, { atk: -1 }, 1 - s);
  if (T.v.prot === 'spiky') simHurt(st, s, M, M.max / 8, '被尖刺防守刺傷');
  if (T.v.prot === 'bunker') simStatus(st, s, M, 'psn', rnd, T);
}
// 掙扎（傷害見 simStruggleDmg）：接觸招式，會被守住類擋、打在替身上、被氣勢披帶／結實／挺住撐住，接觸懲罰等被打中的效果照算（simOnHit）；最後自己扣 1/4
function simStruggle(st, s, M, T, rnd) {
  const me = simName(st, s), tn = simName(st, 1 - s);
  // 急所（同一般攻擊：超幸運、焦點鏡、聚氣提高等級；戰鬥盔甲、硬殼盔甲不會被急所；照亂數抽，期望值模式不算）
  const rank = (M.b.ab === 'super-luck') + (M.item === 'scope-lens' || M.item === 'razor-claw') + (M.v.focus ? 2 : 0);
  const crit = () => !!rnd && !['battle-armor', 'shell-armor'].includes(T.b.ab) && rnd() < SIM_CRIT_P[Math.min(3, rank)], cz = c => c ? '（急所）' : '';
  // hit＝打出傷害（打在替身上也算；畫皮擋下的 0 不算）：反作用力、生命寶珠只在這時扣（Showdown applyRecoilDamage 看 totalDamage）
  const conn = T.hp > 0 && !T.hide && !T.v.prot;
  let hit = conn;
  if (T.hp <= 0) simLog(st, `${me}用掙扎，但沒有目標`);
  else if (T.hide) simLog(st, `${me}用掙扎，但打不到`);
  else if (T.v.prot) { simLog(st, `${me}用掙扎，被${tn}擋下`); simProtHit(st, s, M, T, rnd); }
  else if (T.v.sub > 0) {
    const c = crit();
    T.v.sub -= Math.min(simStruggleDmg(st, M, T, rnd, c), T.v.sub);
    simLog(st, `${me}用掙扎${cz(c)} → 打在${tn}的替身上${T.v.sub <= 0 ? '，替身消失了' : ''}`);
    if (T.v.sub <= 0) delete T.v.sub;
  } else {
    const disg = simDisguised(T, M), c = !disg && crit();
    let d = disg ? 0 : simStruggleDmg(st, M, T, rnd, c), held = '';
    if (d >= T.hp && T.hp >= T.max && (T.item === 'focus-sash' || T.b.ab === 'sturdy')) { d = T.hp - 1; held = T.item === 'focus-sash' ? ITEMS[T.item][0] : abilZh('sturdy'); if (T.item === 'focus-sash') simLoseItem(T); }
    else if (T.v.endure && d >= T.hp) { d = T.hp - 1; held = '挺住'; }
    const dd = Math.min(d, T.hp);
    if (!dd) hit = false;
    T.hp -= dd;
    simFaint(st, T);
    T.hits = (T.hits || 0) + 1;
    if (dd > 0) T.v.got = { turn: st.turn, cat: 'physical', dmg: dd };
    const pop = T.item === 'air-balloon' && d > 0;
    if (pop) simLoseItem(T);
    simLog(st, `${me}用掙扎${cz(c)} → ${tn} −${simPct(d, T.max)}%（剩 ${simPct(T.hp, T.max)}%）${simMbNote(st, T, M)}${held ? `，靠${held}撐住` : ''}${pop ? '，氣球破了' : ''}${T.hp <= 0 ? `，${tn}倒下` : ''}`);
    if (disg) simBust(st, 1 - s, T);
    if (T.hp <= 0) simKO(st, s, M, T, dd);
    // 同命、引爆（同 simMove；倒下處理在反作用力之前，Showdown faintMessages 在 applyRecoilDamage 之前）
    if (T.hp <= 0 && T.v.db && M.hp > 0) { simLog(st, `${tn}的同命：${me}也倒下了`); M.hp = 0; simFaint(st, M); }
    if (T.hp <= 0 && T.b.ab === 'aftermath' && M.hp > 0 && M.b.ab !== 'damp') simHurt(st, s, M, M.max / 4, `受到${tn}的${abilZh('aftermath')}傷害`);
    if (!disg) simHitEffect(st, s, M, T, SIM_STRUGGLE, rnd, '', T.hp > 0, true);
    simOnHit(st, s, M, T, SIM_STRUGGLE, 1, rnd, true);
    simSitrus(st, 1 - s, T);
  }
  if (hit && M.hp > 0) simHurt(st, s, M, Math.round(M.max / 4), '受到掙扎的反作用力', false);
  // 生命寶珠（Showdown lifeorb onAfterMoveSecondarySelf：打中就扣，打在畫皮上也扣，同 simMove）
  if (conn && M.hp > 0 && M.item === 'life-orb') simHurt(st, s, M, M.max / 10, '生命寶珠');
}
// 變幻自如、自由者（Showdown protean／libero onPrepareHit）：每次上場第一次出招前變成那招的屬性（輔助招也算；預知未來、掙扎不算；
// 已經只有這個屬性的不變、也不算發動過），換下場就恢復（v 清掉）。屬性照 simMoveType（氣象球、大地波動照天氣場地）
function simProtean(st, s, M, k) {
  if (!['protean', 'libero'].includes(M.b.ab) || M.v.pt || k === 'future-sight' || k === SIM_STRUGGLE) return;
  const ty = simMoveType(st, M, k);
  if (simTypes(M).join() === ty) return;
  Object.assign(M.v, { types: [ty], pt: true });
  simLog(st, `${simName(st, s, M)}的${abilZh(M.b.ab)}：變成${TYPES[IDX[ty]].zh}屬性`);
}
// 吸收類特性（SIM_ABSORB；Showdown onTryHit：守住之後、命中判定之前，輔助招也算）：s 這方的 M 用招式 k 打到對手 T 的吸收屬性就沒有效果，
// 改成 T 回 1/4、提升能力或引火（能力到頂、HP 全滿就只是沒有效果）；破格無視。回傳有沒有被吸收
function simAbsorb(st, s, M, T, k) {
  const x = SIM_ABSORB[T.b.ab];
  if (!x || T.hp <= 0 || M.b.ab === 'mold-breaker' || simMoveType(st, M, k) !== x.t) return false;
  simLog(st, `${simName(st, s)}用${simMoveZh(k)}，被${simName(st, 1 - s)}的${abilZh(T.b.ab)}吸收了`);
  if (x.heal) simHeal(st, 1 - s, T, T.max / 4, `的${abilZh(T.b.ab)}回復`);
  if (x.b) simBoost(st, 1 - s, T, x.b);
  if (x.ff && !T.v.ff) { T.v.ff = true; simLog(st, `${simName(st, 1 - s)}的火屬性招式威力提高`); }
  return true;
}
// 攻擊招式每打中 T 一下就發動、會影響連續攻擊後面幾下傷害的（Showdown onDamagingHit；打在替身上的不算、T 被打倒也算）：
// 辣椒噴發讓攻擊方 M 灼傷、接觸招式 30% 讓 M 陷入異常（SIM_CONTACT_ST 火焰之軀、毒刺、靜電；機率性的，期望值模式不算）；
// T 自己的碎裂鎧甲（物理招式：防禦 −1、速度 +2）、熱交換（火屬性招式：攻擊 +1）、持久力（防禦 +1）、正義之心（惡屬性招式：攻擊 +1）
// （alive＝T 吃了這一下還站著；倒下的不會提升能力）。回傳有沒有發動
// 另外（每下、只看接觸，Showdown onDamagingHit／onSourceDamagingHit）：孢子 30%（11% 睡眠、10% 麻痺、9% 中毒；草屬性、防塵、防塵護目鏡不受）、
// 毒手（M 的特性：30% 讓 T 中毒）、木乃伊（M 的特性變成木乃伊）、遊魂（T 還站著就和 M 交換特性）（引爆在 simMove 傷害結算之後）；
// 機率性的期望值模式不算
function simHitEffect(st, s, M, T, k, rnd, type, alive = true, contact = false) {
  let on = false;
  if (T.b.ab === 'spicy-spray' && M.hp > 0) on = simStatus(st, s, M, 'brn', rnd, T);
  const cs = SIM_CONTACT_ST[T.b.ab];
  if (cs && contact && rnd && M.hp > 0 && rnd() < 0.3) on = simStatus(st, s, M, cs, rnd, T) || on;
  if (contact && rnd && M.hp > 0 && T.b.ab === 'effect-spore' && !simTypes(M).includes('grass') && M.b.ab !== 'overcoat' && M.item !== 'safety-goggles') {
    const r = rnd() * 100;
    if (r < 30) on = simStatus(st, s, M, r < 11 ? 'slp' : r < 21 ? 'par' : 'psn', rnd, T) || on;
  }
  if (contact && rnd && T.b.ab === 'cute-charm' && M.hp > 0 && !M.v.attract && rnd() < 0.3) simAttract(st, s, M, T, rnd);
  if (contact && rnd && alive && M.b.ab === 'poison-touch' && T.b.ab !== 'shield-dust' && T.item !== 'covert-cloak' && rnd() < 0.3) simStatus(st, 1 - s, T, 'psn', rnd, M);
  // 換了特性會影響連續攻擊後面幾下（技術高手等），回傳 true 讓呼叫端重算；原本是親子愛的不重算（第二下 ¼ 在出招開始就定了，Showdown multihitType parentalbond）
  const pb = M.b.ab === 'parental-bond';
  if (contact && T.b.ab === 'mummy' && M.hp > 0 && !SIM_NOSUPP.has(M.b.ab) && M.b.ab !== 'mummy') { simSetAb(st, s, M, 'mummy', `被${simName(st, 1 - s, T)}的${abilZh('mummy')}傳染`); on = on || !pb; }
  if (contact && alive && T.b.ab === 'wandering-spirit' && M.hp > 0 && !SIM_NOSWAP.has(M.b.ab)) {
    const [a, b] = [M.b.ab, T.b.ab];
    simSetAb(st, s, M, b, `和${simName(st, 1 - s, T)}交換了特性（${abilZh(b)}）`);
    simSetAb(st, 1 - s, T, a, `換成了${abilZh(a)}`);
    simAbStart(st, s, M); simAbStart(st, 1 - s, T);
    on = on || !pb;
  }
  const self = T.b.ab === 'weak-armor' && simCat(k) === 'physical' ? { def: -1, spe: 2 } : T.b.ab === 'thermal-exchange' && type === 'fire' ? { atk: 1 }
    : T.b.ab === 'stamina' ? { def: 1 } : T.b.ab === 'justified' && type === 'dark' ? { atk: 1 } : null;
  if (self && alive) on = simBoost(st, 1 - s, T, self) || on;
  return on;
}
// 攻擊招式打完、打中過 T（同上；nh＝打中幾下，期望值模式是下數的期望）：不影響這招傷害的，照下數一起算：
// 攻擊方 M 吃的接觸懲罰（凸凸頭盔 1/6、粗糙皮膚 1/8，每下一次；期望值模式合成一次扣）、黏滑（接觸招式：M 速度 −1）、
// 毒滿地（物理招式：M 那邊撒一層毒菱，最多 2 層）、電力轉換（T 充電：下一招電屬性威力 ×2）、
// 詛咒之軀每下 30% 讓這招被定身（到之後第 3 次回合結束才解除：定身在出招當下先扣 1、每回合結束再扣 1，共 5；已經被定身、這招沒 PP、掙扎的不會；
// 機率性的，期望值模式不算）
function simOnHit(st, s, M, T, k, nh, rnd, contact) {
  const perHit = (v, why) => { if (!rnd) simHurt(st, s, M, v * nh, why); else for (let i = 0; i < nh; i++) simHurt(st, s, M, v, why); };
  const n = Math.round(nh), tn = simName(st, 1 - s);
  if (contact && T.item === 'rocky-helmet') perHit(M.max / 6, '被凸凸頭盔刺傷');
  if (contact && T.b.ab === 'rough-skin') perHit(M.max / 8, '被粗糙皮膚刺傷');
  if (contact && T.b.ab === 'gooey') for (let i = 0; i < n && M.hp > 0; i++) { simLog(st, `${tn}的${abilZh('gooey')}`); simBoost(st, s, M, { spe: -1 }, 1 - s); }
  const haz = st.sd[s].haz;
  if (T.b.ab === 'toxic-debris' && simCat(k) === 'physical') {
    for (let i = 0; i < n && haz.tspikes < 2; i++) { haz.tspikes++; simLog(st, `${tn}的${abilZh('toxic-debris')}：${simName(st, s)}那邊撒了毒菱（${haz.tspikes} 層）`); }
  }
  if (T.b.ab === 'electromorphosis' && T.hp > 0 && !T.v.charge) { T.v.charge = true; simLog(st, `${tn}的${abilZh('electromorphosis')}：充電了`); }
  // 鳥嘴加農炮加熱中被接觸招式打中：打的那方灼傷（Showdown beakblast condition onHit）
  if (contact && T.v.beak && M.hp > 0) simStatus(st, s, M, 'brn', rnd, T);
  if (T.b.ab === 'cursed-body' && rnd && M.hp > 0 && k !== SIM_STRUGGLE && k !== 'future-sight' && M.b.ab !== 'aroma-veil') {
    for (let i = 0; i < nh && !M.v.dis && M.pp[k] > 0; i++) {
      if (rnd() < 0.3) { M.v.dis = { k, n: 4 }; simLog(st, `${simName(st, 1 - s)}的${abilZh('cursed-body')}：${simName(st, s)}的${simMoveZh(k)}被定身了`); }
    }
  }
}
// 戰鬥切換（Showdown stancechange onModifyMove）：堅盾劍怪出攻擊招式（含掙扎）前變刀劍形態、出王者盾牌前變盾牌形態，其他輔助招不變；
// 變身來的不算。只換能力值用的型態 fk（種族值照新型態；key 不變，畫面與統計照舊），換下場變回來（simSwitch）
const SIM_STANCE = { shield: 'aegislash', blade: 'aegislash-blade' };
function simStance(st, s, M, k) {
  if (M.b.ab !== 'stance-change' || M.tf || !Object.values(SIM_STANCE).includes(M.key) || (SIM_SUP[k] && k !== 'kings-shield')) return;
  const to = SIM_STANCE[k === 'kings-shield' ? 'shield' : 'blade'];
  if (simFk(M) === to) return;
  M.fk = to;
  simLog(st, `${simName(st, s, M)}的${abilZh(M.b.ab)}：變成${MON[to].zh}`);
}
// s 這方的 M 用招式 k 打對手場上那隻；oa＝對手這回合的選擇、oWill＝對手這回合還會出招（突襲、快手還擊、守住類、再來一次看這個）；
// rnd 亂數（null＝期望值：傷害取平均、命中率不到 100 的傷害乘命中率、不會急所、麻痺不會不能動、冰凍不會提早融化、混亂不會打到自己、
// 機率不到 100% 的追加效果不算）；pick(st, s) 打完換人、被吹走時換上誰
// called＝被仿效叫出來的招（Showdown useMove）：不再做出招前的檢查（睡眠、麻痺…）、不扣 PP、不鎖講究圍巾、不改「上一招」；'prank'＝帶著惡作劇之心的加成
function simMove(ctx, st, s, k, oa, oWill, rnd, pick, called = false) {
  // 破格（Showdown moldbreaker onModifyMove ignoreAbility ＋ suppressingAbility）：出招期間對手可被無視（flags.breakable）的特性當作沒有
  // （精神力擋畏縮、恆淨之軀擋降能力、我行我素擋混亂…都不算）；T.b 換成特性空白的複本，出完招或有人換下場（simSwitch）就換回來。
  // 變身、特性互換要抄對手真正的特性，不換
  const M = simAct(st, s), T = simAct(st, 1 - s);
  if (st.mb || M.b.ab !== 'mold-breaker' || T.hp <= 0 || !SIM_BREAKABLE.has(T.b.ab) || k === 'transform' || k === 'skill-swap') simMoveIn(ctx, st, s, k, oa, oWill, rnd, pick, called);
  else {
    st.mb = { T, b: T.b, nb: { ...T.b, ab: '' } };
    T.b = st.mb.nb;
    try { simMoveIn(ctx, st, s, k, oa, oWill, rnd, pick, called); } finally { simMbEnd(st); }
  }
  // 充電（Showdown charge onAfterMove／onMoveAborted）：出了電屬性招式就結束（打中、被守住、失敗、不能動都算；充電本身不算）
  if (M.v.charge && k !== 'charge' && k !== SIM_STRUGGLE && simMoveType(st, M, k) === 'electric') delete M.v.charge;
}
function simMoveIn(ctx, st, s, k, oa, oWill, rnd, pick, called) {
  const M = simAct(st, s), me = simName(st, s), mz = simMoveZh(k);
  // 特性強行打有追加效果的招式（Showdown hasSheerForce）：打完後的 AfterMoveSecondarySelf（生命寶珠、貝殼之鈴）、被打方的 AfterMoveSecondary
  // （怒火沖天、逃脫按鍵、紅牌）、危險迴避都不發動（battle-actions.ts）
  const sf = M.b.ab === 'sheer-force' && FLAG.secondary.has(k);
  // 不能出招（睡著、結冰、畏縮、混亂打到自己、麻痺、被挑釁／定身擋下）：蓄力中的招式也中斷、下次要重新蓄力（Showdown twoturnmove onMoveAborted）；同命也解除；
  // 也記成這回合出招失敗（Showdown runMove：BeforeMove 回傳 false 時 moveThisTurnResult＝false，下一回合的豁出去、跺腳威力 ×2）
  const cant = t => { Object.assign(M, { chg: '', hide: false }); delete M.v.db; M.v.mt = { t: st.turn, ok: false, live: true }; simLog(st, t); };
  if (!called) {
  // 巨劍突擊的副作用在自己下一次要出招時解除（Showdown glaiverush onBeforeMove 優先度 100，比睡眠等不能動的判定早）
  delete M.v.glaive;
  // 同命在自己下一次出招時解除（Showdown destinybond onBeforeMove；這次出的就是同命的話留著，同命自己會判連續使用失敗）
  if (k !== 'destiny-bond') delete M.v.db;
  if (M.status === 'slp') {
    M.slp -= M.b.ab === 'early-bird' ? 2 : 1;
    if (M.slp > 0) return cant(`${me}睡著了`);
    M.status = '';
    simLog(st, `${me}醒來了`);
  }
  // 冰凍（冠軍版 mods/champions/conditions.ts）：每次要出招先扣次數，每次 1/4 融化、第 3 次一定融化；用 SIM_DEFROST 的招式會自己融化
  if (M.status === 'frz') {
    if (SIM_DEFROST.has(k) && !(k === 'burn-up' && !simTypes(M).includes('fire'))) { M.status = ''; simLog(st, `${me}用${mz}融化了冰`); }
    else if (--M.frz <= 0 || (rnd && rnd() < 1 / 4)) { M.status = ''; simLog(st, `${me}的冰融化了`); }
    else return cant(`${me}結冰了，不能動`);
  }
  // 畏縮（Showdown flinch）：這回合先被打中畏縮的不能動；特性不屈之心速度 +1
  if (M.v.flinch) {
    cant(`${me}畏縮了，不能動`);
    if (M.b.ab === 'steadfast') simBoost(st, s, M, { spe: 1 });
    return;
  }
  // 混亂（Showdown confusion）：每次要出招先扣次數，扣完就解除；沒解除時 1/3 打到自己（simConfDmg）
  if (M.v.conf) {
    if (!--M.v.conf) { delete M.v.conf; simLog(st, `${me}的混亂解除了`); }
    else if (rnd && rnd() < 1 / 3) {
      Object.assign(M, { chg: '', hide: false });
      M.v.mt = { t: st.turn, ok: false, live: true };
      if (simDisguised(M, null)) { simLog(st, `${me}混亂中打到自己`); simBust(st, s, M); }
      else simHurt(st, s, M, simConfDmg(M, rnd), '混亂中打到自己', false);
      return;
    }
  }
  // 著迷（Showdown attract onBeforeMove，在麻痺之前）：讓牠著迷的那隻不在場上就解除，不然 50% 不能動（照亂數，期望值模式不算）
  if (M.v.attract) {
    const a = M.v.attract;
    if (st.sd[a.s].act !== a.i || simAct(st, a.s).hp <= 0) delete M.v.attract;
    else if (rnd && rnd() < 0.5) return cant(`${me}著迷了，不能動`);
  }
  // 麻痺：冠軍版 1/8 不能動（mods/champions/conditions.ts）
  if (M.status === 'par' && rnd && rnd() < 1 / 8) return cant(`${me}麻痺了，不能動`);
  if (M.v.taunt && SIM_SUP[k]) return cant(`${me}被挑釁，不能用${mz}`);
  if (M.v.dis?.k === k) return cant(`${me}的${mz}被定身了，不能用`);
  if (M.v.hblock && SIM_HEALMV.has(k)) return cant(`${me}被回復封鎖，不能用${mz}`);
  if (M.v.tchop && simSound(k)) return cant(`${me}被地獄突刺擋住，不能用${mz}`);
  }
  // ia／it＝出招前雙方場上的是隊伍第幾隻（打完被換走就不再做換人類效果）、tHp0＝對手出招前的 HP（危險迴避看有沒有跌破一半）
  const T = simAct(st, 1 - s), tn = simName(st, 1 - s), ia = st.sd[s].act, it = st.sd[1 - s].act, tHp0 = T.hp;
  // 場上最後被用的招（仿效用；仿效自己不算，叫出來的那招才算）
  if (k !== 'copycat') st.lastMv = k;
  if (!called) {
  M.last = k;
  // 鳥嘴加農炮出招了就不再加熱（Showdown beakblast onAfterMove；這時對手的接觸招式已經打完）
  if (k === 'beak-blast') delete M.v.beak;
  // 節拍器（道具）：上一回合成功用的也是這招就連用次數 +1，不然從 0 算（Showdown metronome onTryMove 的 lastMove、moveLastTurnResult；見 simCalc）
  if (M.item === 'metronome') M.v.metro = M.v.metro?.k === k && M.v.mt?.t === st.turn - 1 && M.v.mt.ok ? { k, n: M.v.metro.n + 1 } : { k, n: 0 };
  // 這回合出的招：失敗、被擋下、沒命中、沒有效果時改成 ok false（豁出去、跺腳看上一回合的，見 simVarBp）；
  // pf＝上一回合失敗了（這裡就要蓋掉上一回合的紀錄，先存起來），live＝這回合正在出的（回合結束清掉，見 simEnd）
  const pm = M.v.mt;
  M.v.mt = { t: st.turn, ok: true, pf: !!pm && pm.t === st.turn - 1 && pm.ok === false, live: true };
  }
  simStance(st, s, M, k);
  if (k === SIM_STRUGGLE) return simStruggle(st, s, M, T, rnd);
  // PP：出招就扣 1（失敗也扣；睡著、麻痺不能動、被挑釁擋下的不扣；蓄力招第二回合、逆鱗類鎖住的那幾次不扣）；對手特性壓迫感、而且這招是打對手的（攻擊招式、
  // 打對手的輔助招、撒菱類）多扣 1（Showdown deductPP、pressure onDeductPP）
  if (!called && M.chg !== k && M.v.rage?.k !== k) {
    // 壓迫感照 Showdown getMoveTargets 的 pressureTargets：打對手的、打場上全體的（SIM_PRESS_ALL）、撒菱類（mustpressure；黏黏網沒有）；
    // 詛咒只有幽靈屬性用（打對手）才算
    const foe = (!SIM_SUP[k] || SIM_SUP[k].tgt || ['hazard', 'defog'].includes(SIM_SUP[k].kind) || SIM_PRESS_ALL.has(k)
      || (k === 'curse' && simTypes(M).includes('ghost'))) && k !== 'sticky-web';
    M.pp[k] = Math.max(0, M.pp[k] - 1 - (foe && T.hp > 0 && T.b.ab === 'pressure' ? 1 : 0));
    // 這場用過的招式（珍藏用；Showdown deductPP 的 moveSlot.used，換下場也不清）；每次換新的物件，複製的局面才不會互相改到
    M.used = { ...M.used, [k]: 1 };
  }
  if (!called && M.item === 'choice-scarf' && !M.lock) M.lock = k;
  // 女王的威嚴、尾甲、鮮豔之軀（Showdown onFoeTryMove，比變幻自如的 PrepareHit 早，所以擋下時變幻自如不發動；破格無視）：
  // 打牠的招式（攻擊招式、打對手的輔助招）先制等級大於 0 就失敗
  if (T.hp > 0 && (!SIM_SUP[k] || SIM_SUP[k].tgt) && ['queenly-majesty', 'armor-tail', 'dazzling'].includes(T.b.ab) && M.b.ab !== 'mold-breaker' && simPri(st, M, k) > 0) {
    M.v.mt.ok = false;
    return simLog(st, `${me}用${mz}，被${tn}的${abilZh(T.b.ab)}擋下`);
  }
  // 濕氣（Showdown damp onAnyTryMove；破格無視）：雙方場上有濕氣時大爆炸、自爆、薄霧炸裂失敗（自己不會倒下）
  if (simDamp(M, T, k)) { M.v.mt.ok = false; return simLog(st, `${me}用${mz}，但因為濕氣失敗了`); }
  // 仿效（Showdown copycat：用場上最後被用的招，failcopycat 的失敗）；號令（instruct：對手立刻再用一次牠上一招，照常扣 PP、做出招前檢查；
  // 蓄力招、failinstruct 的、沒 PP 的、被守住的失敗）
  if (k === 'copycat' || k === 'instruct') {
    const c = k === 'copycat' ? st.lastMv : T.last, bad = () => { M.v.mt.ok = false; simLog(st, `${me}用${mz}，但失敗了`); };
    if (k === 'copycat') {
      if (!c || SIM_NOCOPY.has(c) || !simCanUse(c) || c === SIM_STRUGGLE) return bad();
      simLog(st, `${me}用${mz}：使出${simMoveZh(c)}`);
      // 仿效是輔助招，惡作劇之心的加成帶給叫出來的招（Showdown useMoveInner 沿用 activeMove.pranksterBoosted）：攻擊招式打惡屬性也沒效果
      return simMove(ctx, st, s, c, oa, oWill, rnd, pick, M.b.ab === 'prankster' ? 'prank' : true);
    }
    if (T.hp <= 0 || T.v.prot || !c || SIM_NOINSTRUCT.has(c) || SIM_CHARGE.has(c) || !T.moves.includes(c) || !(T.pp[c] > 0) || T.v.rage || T.rech) return bad();
    simLog(st, `${me}用${mz}：${tn}再用一次${simMoveZh(c)}`);
    // 換對手出招：自己破格的效果不帶過去
    simMbEnd(st);
    return simMove(ctx, st, 1 - s, c, { t: 'mv', k }, false, rnd, pick);
  }
  if (SIM_SUP[k]) {
    if (!SIM_SUP[k].tgt || T.hp > 0) simProtean(st, s, M, k);
    return simSupport(st, s, k, oa, oWill, rnd, pick, false);
  }
  if (simMustCharge(st, M, k)) {
    Object.assign(M, { chg: k, hide: SIM_HIDE.has(k) });
    simLog(st, `${me}用${mz}：蓄力，下一回合才攻擊`);
    if (k === 'electro-shot') simBoost(st, s, M, { spa: 1 });
    return;
  }
  // 天氣讓蓄力招式直接打（電光束照樣先特攻 +1）
  if (SIM_CHARGE.has(k) && M.chg !== k) {
    simLog(st, `${simWx(st) === simWxOf(st, M, k) ? FIELD_ZH[simWx(st)] : `${me}的${abilZh(M.b.ab)}`}，${mz}不用蓄力`);
    if (k === 'electro-shot') simBoost(st, s, M, { spa: 1 });
  }
  Object.assign(M, { chg: '', hide: false });
  const fail = why => { M.v.mt.ok = false; simLog(st, `${me}用${mz}，但失敗了（${why}）`); };
  // 電光雙擊、燃盡：自己沒有那個屬性就失敗（Showdown onTryMove，在守住判定之前）
  if (SIM_LOSE_TYPE[k] && !simTypes(M).includes(SIM_LOSE_TYPE[k])) return fail(`已經沒有${TYPES[IDX[SIM_LOSE_TYPE[k]]].zh}屬性`);
  if (k === 'sucker-punch' && (!oWill || oa.t !== 'mv' || simCat(oa.k) === 'status')) return fail('對手沒有要出攻擊招式');
  if (k === 'upper-hand' && (!oWill || oa.t !== 'mv' || simCat(oa.k) === 'status' || simPri(st, T, oa.k) <= 0)) return fail('對手沒有要出先制招式');
  // 珍藏：其他招式這場都用過才能用、只有這一招也失敗（Showdown lastresort onTry）
  if (k === 'last-resort' && (M.moves.length < 2 || M.moves.some(x => x !== k && !M.used?.[x]))) return fail('還有其他招式沒用過');
  if (k === 'future-sight') {
    if (st.fut.some(f => f.s === 1 - s)) return fail('已經在預知未來');
    // 打中時用使用者當下的樣子算（Showdown futuremove 的 data.source 是那隻寶可夢本身：被浸水改屬性、換下場清掉能力變化都照現在的）
    st.fut.push({ s: 1 - s, t: 3, ss: s, si: st.sd[s].act });
    simLog(st, `${me}用${mz}：兩回合後打中`);
    return;
  }
  // 變幻自如在出招前（PrepareHit：突襲這類 onTry 失敗的不會發動；被守住、沒命中、沒有效果都照樣發動）
  if (T.hp > 0) simProtean(st, s, M, k);
  // 投擲（Showdown fling onPrepareHit）：道具在這時就拿下來（被守住也沒了，算用掉，回收利用拿得回來），威力看 v.fling
  if (k === 'fling' && simFlingBp(M.item)) { M.v.fling = M.item; simLoseItem(M); simLog(st, `${me}丟出了${ITEMS[M.v.fling]?.[0] || M.v.fling}`); }
  // 自爆類：先倒下才打（Showdown selfdestruct always 在出招前 faint），同時全倒時算對手最後倒下
  if (SIM_BOOM.has(k)) { M.hp = 0; simFaint(st, M); }
  // 接觸：臂貝武器物理比較痛時變物理接觸（Showdown onModifyMove，在守住判定之前；同 damageCalc 的 ssaCat）
  const ssa = k === 'shell-side-arm' && ssaCat({ sp: M.b.sp, nat: M.b.nat, inv: M.b.atkInv, st: M.st }, { sp: T.b.sp, nat: T.b.nat, inv: T.b.defInv, st: T.st },
    MON[simFk(M)], MON[simFk(T)]) === 'physical';
  const contact = (FLAG.contact.has(k) || ssa) && M.b.ab !== 'long-reach';
  // 隨機光：30% 威力 ×2（照亂數抽，期望值模式不算；見 simVarBp）
  if (k === 'fickle-beam' && (M.v.fickle = !!rnd && rnd() < 0.3)) simLog(st, `${me}的${mz}威力加倍`);
  // 沒打中（打不到、被守住、沒有效果、沒命中）：記成出招失敗，SIM_CRASH 的招式扣撞擊傷害
  const crash = () => { M.v.mt.ok = false; if (SIM_CRASH.has(k)) simHurt(st, s, M, M.max / 2, '沒打中，摔傷自己'); };
  // dealt＝打出的傷害（-1＝沒打中）；stay＝對手用逃脫按鍵、危險迴避換下場了，自己的急速折返類就不換
  let dealt = -1, stay = false;
  // 超級龍頭地鼠的特性（piercing-drill，Showdown onHitProtect）：接觸招式穿透守住類，傷害變 ¼（getDamage 最後 modify 0.25），守住照樣留著
  // 無形拳同樣穿透（冠軍版 mods/champions：onHitProtect 同 piercing-drill，scripts.ts getDamage 的 bypassProtect ×0.25）
  const pierce = !!T.v.prot && contact && (M.b.ab === 'piercing-drill' || M.b.ab === 'unseen-fist');
  if (T.hp <= 0) fail('沒有目標');
  // 蓄力中躲起來的打不到（雙方任一隻特性無防守就打得到）
  else if (T.hide && M.b.ab !== 'no-guard' && T.b.ab !== 'no-guard') { simLog(st, `${me}用${mz}，但打不到（${tn}${T.chg === 'dig' ? '在地底' : '消失了'}）`); crash(); }
  else if (T.v.prot && !pierce && k !== 'phantom-force' && k !== 'feint') {
    simLog(st, `${me}用${mz}，被${tn}擋下`);
    if (contact) simProtHit(st, s, M, T, rnd);
    // 被守住不算出招失敗也不算成功（Showdown protect onTryHit 回傳 NOT_FAIL，moveThisTurnResult 是 null：下一回合豁出去、跺腳不加倍，
    // 節拍器的連用中斷），飛膝踢類照樣摔傷（MoveFail）
    M.v.mt.ok = null;
    if (SIM_CRASH.has(k)) simHurt(st, s, M, M.max / 2, '沒打中，摔傷自己');
  } else if (simAbsorb(st, s, M, T, k)) crash();
  else {
    if (pierce) simLog(st, `${me}的特性穿透了${tn}的守住（傷害 ¼）`);
    else if (T.v.prot) { delete T.v.prot; simLog(st, `${me}的${mz}打破了守住`); }
    // 鬥爭心要知道雙方性別（照亂數打時抽）
    if (rnd && M.b.ab === 'rivalry') { simGender(M, rnd); simGender(T, rnd); }
    // 一擊必殺：期望值模式（沒有 rnd）直接算期望傷害；照亂數打時先抽中不中
    let r = simHit(ctx, st, M, T, k, false, !rnd && SIM_OHKO.has(k), !oWill);
    // 命中率：一擊必殺用 simFixed 的，其他看 simAcc（對手這回合已經行動過時對焦鏡有作用）
    const acc = SIM_OHKO.has(k) ? r.acc : simAcc(st, M, T, k, !oWill);
    if (!r.eff) { r.fail ? fail(r.fail) : simLog(st, `${me}用${mz}，對${tn}沒有效果`); crash(); }
    // 惡作劇之心加成的攻擊招式（只有仿效叫出來的會有）打惡屬性沒有效果（Showdown hitStepTryImmunity，在屬性免疫之後、命中之前）
    else if (called === 'prank' && simTypes(T).includes('dark')) { simLog(st, `${me}用${mz}，${tn}是惡屬性，不受惡作劇之心的招式影響`); crash(); }
    else if (acc < 100 && rnd && rnd() * 100 >= acc) { simLog(st, `${me}用${mz}，沒有命中（命中率 ${acc}%）`); crash(); }
    else {
      // 大蔥：大蔥鴨（含伽勒爾）、蔥遊兵 +2（Showdown leek onModifyCritRatio）
      const leek = M.item === 'leek' && (simFk(M).startsWith('farfetchd') || simFk(M) === 'sirfetchd') ? 2 : 0;
      const rank = SIM_HICRIT.has(k) + (M.b.ab === 'super-luck') + (M.item === 'scope-lens' || M.item === 'razor-claw') + (M.v.focus ? 2 : 0) + leek;
      // 急所每一下各抽（Showdown getDamage 每下都判定，連續攻擊不是整招一起）：pc＝每下急所的機率（一定急所的招式 r.crit 已經是急所、固定傷害不會急所、
      // 期望值模式不算）；急所的那幾下用 rCrit（急所版本的傷害，用到才算）；anyCrit＝有任何一下急所（紀錄、憤怒穴位看這個）
      const pc = !r.fixed && !r.crit && rnd ? SIM_CRIT_P[Math.min(3, rank)] : 0;
      // endu＝氣勢披帶、結實撐不撐得住（damageCalc 只在那個版本的傷害打得倒滿血時才標；急所那下另外看急所版本的）
      let rCrit = null, anyCrit = !!r.crit, endu = r.endured || '';
      // 寶石：這招屬性的寶石打出去就用掉（只加成一次）
      const gem = DMG_ITEMS[M.item]?.gem && DMG_ITEMS[M.item].type === r.type ? M.item : '';
      // 替身（sub0＝這招是打在替身上開始的）：聲音招式、特性穿透打得穿；連續攻擊打破替身後，後面幾下打到本體（Showdown 實測）；
      // 整招都打在替身上的（subbed，打完才知道）不會有接觸懲罰、拍落、強制換人
      const sub0 = T.v.sub > 0 && !FLAG.sound.has(k) && M.b.ab !== 'infiltrator';
      // 畫皮（simDisguised）：第一下沒有傷害，打完揭穿（打在替身上的不算）
      const disg = !sub0 && simDisguised(T, M);
      // 各下的傷害加總：每下判定命中的招式（SIM_MULTIACC）第二下起照命中率抽、沒中就停；
      // 期望值模式整招乘命中率（一擊必殺 simFixed 已經乘過）、第二下起再乘命中的機率。
      // 2～5 下的連續攻擊（vh）照 SIM_HIT_N 抽下數，期望值模式各下再乘打到這一下的機率（SIM_HIT_W）；第 4、5 下的亂數表同第 2 下（damageCalc 照 3 下給）。
      // nh＝實際打中幾下（期望值模式是各下機率的和）：對手被打倒就停（後面幾下不會打），憤怒之拳照這個算；nt＝其中打到本體的（接觸懲罰、詛咒之軀照這個算）。
      // 打到本體的每一下就發動 simHitEffect（期望值模式打到機率一半以上的那幾下）；有發動就用新的狀態重算後面幾下（cur），這幾下發動的紀錄搬到傷害那行後面。
      // 打替身的：sd 累計打在替身上的、sl 替身還剩多少，打破那一下多出來的不會打到本體
      const pm = SIM_MULTIACC.has(k) && M.b.ab !== 'skill-link' ? acc / 100 : 1, vh = HITS[k]?.[1] === VAR_HITS && M.b.ab !== 'skill-link';
      const n = !vh ? r.rolls.length : rnd ? SIM_HIT_N[simDraw(SIM_HIT_N.map(x => x[1]), rnd)][0] : SIM_HIT_W.length;
      const L0 = st.log?.length ?? 0, ty = r.type || MOVES[k][1];
      // 穿透守住的 ¼ 在 modifyDamage 裡：一擊必殺、固定傷害、反擊類（r.fixed，getDamage 提早回傳）不乘
      const q = x => pierce && !r.fixed ? Math.max(1, Math.floor((x * 1024 + 2047) / 4096)) : x;
      // midHeal＝連續攻擊打到一半以下、後面還有幾下時先吃的文柚果回復量（Showdown 每下打完 eachEvent('Update')；dmg 是扣掉它的淨傷害）
      // lh＝最後一下打到本體的傷害（反擊類、復仇看這個：Showdown gotAttacked 記的是連續攻擊最後一下）
      // midPouch＝同時頰囊的回復量（Showdown 吃樹果的 EatItem 也在這時，被最大 HP 截掉的就沒了，接著才打下一下）
      let dmg = 0, held = '', w = rnd || SIM_OHKO.has(k) ? 1 : acc / 100, nh = 0, nt = 0, cur = r, sd = 0, sl = sub0 ? T.v.sub : 0, midHeal = 0, midPouch = 0, lh = 0;
      const up0 = T.v.up;
      // 電光雙擊、燃盡：打中（含打在替身上）就失去這個屬性，在對手被打中發動的特性之前（Showdown self onHit 在 DamagingHit 之前：辣椒噴發燒得到）；
      // 只剩這個屬性的變成沒有屬性（simTypes 是空的，打誰、被誰打都 ×1、沒有本系）。這招的傷害已經算好（r），照樣有本系
      if (SIM_LOSE_TYPE[k]) { M.v.types = simTypes(M).filter(t => t !== SIM_LOSE_TYPE[k]); simLog(st, `${me}的${TYPES[IDX[SIM_LOSE_TYPE[k]]].zh}屬性消失了`); }
      for (let h = 0; h < n; h++) {
        if (h && pm < 1) { if (!rnd) w *= pm; else if (rnd() >= pm) break; }
        const ch = pc > 0 && rnd() < pc, src = ch ? (rCrit ||= simCalc(ctx, st, M, T, k, true, !oWill)) : cur;
        if (ch) anyCrit = true;
        if (src.endured) endu = src.endured;
        const xs = src.rolls[Math.min(h, src.rolls.length - 1)];
        const wh = vh && !rnd ? w * SIM_HIT_W[h] : w, v = wh * (rnd ? q(xs[Math.floor(rnd() * 16)]) : xs.reduce((a, x) => a + q(x), 0) / 16);
        nh += wh;
        if (sl > 0) { sd += Math.min(v, sl); sl = Math.max(0, sl - v); continue; }
        if (h || !disg) { dmg += v; lh = v; }
        nt += wh;
        if (h < n - 1 && !midHeal && T.item === 'sitrus-berry' && !T.v.hblock && dmg < T.hp && T.hp - dmg <= T.max / 2 && simCanEat(st, 1 - s)) {
          midHeal = Math.min(Math.floor(T.max / 4 * (T.b.ab === 'ripen' ? 2 : 1)), T.max - (T.hp - dmg));
          dmg -= midHeal;
          if (T.b.ab === 'cheek-pouch') { midPouch = Math.min(Math.floor(T.max / 3), T.max - (T.hp - dmg)); dmg -= midPouch; }
        }
        // 還站著：傷害不到剩下的 HP，或滿血有氣勢披帶／結實、或挺住撐得住（碎裂鎧甲等照樣發動）
        const alive = dmg < T.hp || (!!endu && T.hp >= T.max) || !!T.v.endure;
        if ((h || !disg) && (rnd || wh >= 0.5) && simHitEffect(st, s, M, T, k, rnd, ty, alive, contact) && h < n - 1 && !r.fixed) { cur = simCalc(ctx, st, M, T, k, r.crit, !oWill); rCrit = null; }
        if (!T.v.endure && dmg >= T.hp) break;
      }
      const mid = st.log ? st.log.splice(L0) : [], subbed = sub0 && !nt;
      if (sub0) {
        dealt = Math.min(sd, T.v.sub);
        T.v.sub -= dealt;
        simLog(st, `${me}用${mz}${anyCrit ? '（急所）' : ''} → 打在${tn}的替身上${T.v.sub <= 0 ? '，替身消失了' : ''}`);
        if (T.v.sub <= 0) delete T.v.sub;
      }
      // td＝打到本體的傷害；dealt＝替身加本體（吸血、反作用力、生命寶珠等看這個）
      let td = 0;
      if (!subbed) {
        if (endu && T.hp >= T.max && dmg >= T.hp) {
          dmg = T.hp - 1;
          held = endu === 'sturdy' ? abilZh('sturdy') : ITEMS[endu][0];
          if (endu === T.item) simLoseItem(T);
        } else if (T.v.endure && dmg >= T.hp) { dmg = T.hp - 1; held = '挺住'; }
        // 氣勢頭帶：會倒下的一擊 10% 撐住剩 1（Showdown focusband onDamage；不用掉；照亂數抽，期望值模式不算）
        else if (rnd && T.item === 'focus-band' && dmg >= T.hp && rnd() < 0.1) { dmg = T.hp - 1; held = ITEMS['focus-band']?.[0] || '氣勢頭帶'; }
        td = Math.min(dmg, T.hp);
        dealt = Math.max(0, dealt) + td;
        T.hp -= td;
        simFaint(st, T);
        // 憤怒穴位：被急所打中還站著，攻擊直接拉到 +6（Showdown angerpoint onHit：boost atk +12；紀錄寫在傷害那行後面）
        const ang = anyCrit && T.hp > 0 && T.b.ab === 'anger-point' && T.st.atk < 6;
        // 這回合被打的傷害（反擊類用）；抗性樹果用掉；氣球被打中就破（拍落打掉道具在接觸懲罰之後，見下面）
        if (td > 0) T.v.got = { turn: st.turn, cat: simCat(k), dmg: Math.min(lh, td) };
        if (r.berry) { const it = T.item; simLoseItem(T); simAte(st, 1 - s, T, it); }
        const pop = T.item === 'air-balloon' && td > 0;
        if (pop) simLoseItem(T);
        // 連續攻擊招式被畫皮擋下第一下：扣的是後面幾下，寫在同一行（不然先看到扣血、下一行才擋下，像沒算）
        const said = disg && td > 0;
        simLog(st, `${me}用${mz}${anyCrit ? '（急所）' : ''} → ${sub0 ? '後面幾下打到' : ''}${tn} −${simPct(td, T.max)}%（剩 ${simPct(T.hp, T.max)}%）`
          + (said ? `，第一下被${abilZh('disguise')}擋下` : simMbNote(st, T, M))
          + (held ? `，靠${held}撐住` : '') + (pop ? '，氣球破了' : '') + (T.hp <= 0 ? `，${tn}倒下` : ''));
        if (st.log) st.log.push(...mid);
        if (midHeal) {
          simLoseItem(T);
          simLog(st, `${tn}打到一半時吃了文柚果 +${simPct(midHeal, T.max)}%${midPouch ? `、${abilZh('cheek-pouch')} +${simPct(midPouch, T.max)}%` : ''}（上面是扣掉回復後的淨傷害）`);
          simAte(st, 1 - s, T, 'sitrus-berry', false, true);
        }
        if (ang) { T.st.atk = 6; simLog(st, `${tn}的${abilZh('anger-point')}：攻擊提升到最高`); }
        if (disg) simBust(st, 1 - s, T, said);
        if (T.hp <= 0) simKO(st, s, M, T, td);
        // 同命：被這招打倒，打的那方也倒下（Showdown destinybond onFaint；倒下順序在後，雙方同時全倒時打的那方贏）
        if (T.hp <= 0 && T.v.db && M.hp > 0) { simLog(st, `${tn}的同命：${me}也倒下了`); M.hp = 0; simFaint(st, M); }
        // 引爆（Showdown aftermath onDamagingHit，在扣血之後）：被接觸招式打倒，打的那方扣最大 HP 的 1/4（濕氣擋得住）；倒下順序在 T 之後
        if (T.hp <= 0 && contact && T.b.ab === 'aftermath' && M.hp > 0 && M.b.ab !== 'damp') simHurt(st, s, M, M.max / 4, `受到${tn}的${abilZh('aftermath')}傷害`);
        // 擊落（Showdown smackdown volatile）：打中後到換下場前都在地面上（地面招式打得到，飄浮、氣球沒用，電磁飄浮解除；見 simGround、damageCalc 的 d.grounded）
        if (k === 'smack-down' && T.hp > 0 && !T.v.smack) {
          if (!simGround(T)) simLog(st, `${tn}被擊落到地面`);
          T.v.smack = true; delete T.v.mrise;
        }
        // 投擲的道具效果（Showdown fling：光之球麻痺、毒針中毒、王者之證畏縮；樹果、香草由對手吃下）
        const fl = k === 'fling' && T.hp > 0 ? M.v.fling : '';
        if (fl === 'light-ball') simStatus(st, 1 - s, T, 'par', rnd, M);
        else if (fl === 'poison-barb') simStatus(st, 1 - s, T, 'psn', rnd, M);
        else if (fl === 'kings-rock') { if (oWill && T.b.ab !== 'inner-focus') T.v.flinch = true; }
        else if (fl === 'white-herb') { Object.keys(T.st).forEach(q => { if (T.st[q] < 0) T.st[q] = 0; }); simLog(st, `${tn}吃了白色香草`); }
        else if (fl === 'mental-herb') { delete T.v.taunt; delete T.v.enc; delete T.v.encK; delete T.v.dis; delete T.v.hblock; delete T.v.attract; simLog(st, `${tn}吃了心靈香草`); }
        else if (fl.endsWith('-berry')) {
          simLog(st, `${tn}吃了${ITEMS[fl]?.[0] || fl}`);
          if (fl === 'sitrus-berry') simSitrusHeal(st, 1 - s, T, '文柚果');
          else if ((fl === 'lum-berry' && T.status) || (fl === 'chesto-berry' && T.status === 'slp')) T.status = '';
          simAte(st, 1 - s, T, fl);
        }
        // 蟲咬、啄食（Showdown bugbite／pluck onHit）：自己還站著就搶走對手的樹果馬上吃（不看 HP、緊張感擋不住；黏著擋得住）
        if ((k === 'bug-bite' || k === 'pluck') && M.hp > 0 && T.item?.endsWith('-berry') && T.b.ab !== 'sticky-hold') {
          const it = T.item;
          simLoseItem(T, true);
          simLog(st, `${me}搶走了${tn}的${ITEMS[it]?.[0] || it}吃掉`);
          if (it === 'sitrus-berry') simSitrusHeal(st, s, M, '文柚果');
          else if (it === 'lum-berry') { M.status = ''; delete M.v.conf; }
          else if (it === 'chesto-berry' && M.status === 'slp') M.status = '';
          simAte(st, s, M, it);
        }
        // 清除之煙（Showdown clearsmog onHit）：對手的能力變化歸零
        if (k === 'clear-smog' && T.hp > 0 && Object.values(T.st).some(Boolean)) { T.st = SIM_ST0(); simLog(st, `${tn}的能力變化歸零了`); }
        // 被攻擊打中就開天氣場地的特性（Showdown sandspit／seedsower onDamagingHit）：吐沙開沙暴、播種開青草場地（被打倒也發動）
        if (td > 0) simFieldAb(st, 1 - s, T, { 'sand-spit': 'sand', 'seed-sower': 'grassy' }[T.b.ab], true);
      }
      // 被打中幾下（憤怒之拳；Showdown timesAttacked += 打中的下數，打在替身上也算）
      T.hits = (T.hits || 0) + Math.round(nh);
      // 巨劍突擊：打中後到自己下一次出招前，被打必中、受到的傷害 ×2（Showdown glaiverush self volatile，見 simAcc、simCalc）
      if (k === 'glaive-rush') M.v.glaive = true;
      // 鐵滾輪、冰旋打中（含打在替身上）就清掉場地（Showdown steelroller／icespinner onAfterHit、onAfterSubDamage；鐵滾輪沒有場地時 damageCalc 已經當失敗）
      if ((k === 'steel-roller' || k === 'ice-spinner') && st.ter) simClearTer(st, '消失了');
      // 岩斧、秘劍・千重濤：打中後在對手那邊撒隱形岩／一層撒菱（Showdown stoneaxe／ceaselessedge onAfterHit；自己還站著、特性不是強行）
      const hz = { 'stone-axe': 'sr', 'ceaseless-edge': 'spikes' }[k], th = st.sd[1 - s].haz;
      if (hz && M.hp > 0 && M.b.ab !== 'sheer-force' && th[hz] < (hz === 'sr' ? 1 : 3)) { th[hz]++; simLog(st, `${me}在${tn}那邊撒了${SIM_HAZ_ZH[hz]}`); }
      if (gem) { simLoseItem(M); simLog(st, `${me}的${ITEMS[gem][0]}用掉了`); }
      // 搏命：自己倒下（Showdown damageCallback 在對手受到傷害前就 pokemon.faint()：倒下的順序在對手之前，雙方同時全倒時對手那方贏，見 simWinner）
      if (k === 'final-gambit' && M.hp > 0) { const tf = T.ft; M.hp = 0; simFaint(st, M); if (tf) [M.ft, T.ft] = [tf, M.ft]; simLog(st, `${me}倒下`); }
      // 吸血在扣血當下（Showdown spreadDamage），接觸懲罰在那之後
      const dr = SIM_DRAIN[k], rc = SIM_RECOIL[k];
      // 吸取；對手特性污泥漿時改成扣同樣多的 HP（Showdown liquidooze onSourceTryHeal）
      if (dr && dealt > 0) {
        const v0 = Math.max(1, Math.round(dealt * dr[0] / dr[1])), v = M.item === 'big-root' ? pokeRound(v0 * 5324 / 4096) : v0;
        if (T.b.ab === 'liquid-ooze') simHurt(st, s, M, v, `吸到${tn}的${abilZh('liquid-ooze')}`); else simHeal(st, s, M, v, '吸取');
      }
      // 追加效果在吸血之後、接觸懲罰之前（Showdown spreadMoveHit 的 secondaries 在 DamagingHit 之前）；連續攻擊、親子愛每打中一下各判一次
      // （照亂數打時；期望值模式只算機率 100% 的，判一次）
      for (let i = 0, reps = rnd ? Math.max(1, Math.round(nt)) : 1; i < reps; i++) simSecondary(st, s, M, T, k, oWill, rnd, subbed, up0);
      // 冰凍的對手被火屬性攻擊招式、SIM_THAW 的招式打中就融化（Showdown frz onDamagingHit、thawsTarget）
      if (T.status === 'frz' && T.hp > 0 && !subbed && (SIM_THAW.has(k) || (r.type || MOVES[k][1]) === 'fire')) { T.status = ''; simLog(st, `${tn}的冰融化了`); }
      if (!subbed) {
        // 打完後的被打中效果（接觸懲罰、詛咒之軀，見 simOnHit；辣椒噴發、碎裂鎧甲等每下的已經在上面 simHitEffect 發動）
        simOnHit(st, s, M, T, k, nt, rnd, contact);
        // 拍落（Showdown knockoff onAfterHit，在凸凸頭盔等 DamagingHit 之後）：自己還站著就打掉對手的道具（超級石、黏著拿不掉）
        if (k === 'knock-off' && T.item && !MON[T.key].base && T.b.ab !== 'sticky-hold' && M.hp > 0) { simLog(st, `${me}打掉了${tn}的${ITEMS[T.item]?.[0] || T.item}`); simLoseItem(T, true); }
        // 順手牽羊（Showdown pickpocket onAfterMoveSecondary；強行不發動）：沒有道具時被接觸招式打中，偷走攻擊方的道具（黏著偷不到）
        else if (!sf && contact && T.b.ab === 'pickpocket' && !T.item && T.hp > 0 && M.item && M.b.ab !== 'sticky-hold') {
          T.item = M.item; simLoseItem(M, true);
          simLog(st, `${tn}的${abilZh('pickpocket')}：偷走了${me}的${ITEMS[T.item]?.[0] || T.item}`);
        }
        // 怒火沖天（Showdown berserk onAfterMoveSecondary）：這招讓 HP 從一半以上跌到一半以下時特攻 +1
        if (!sf && T.b.ab === 'berserk' && T.hp > 0 && T.hp <= T.max / 2 && T.hp + td > T.max / 2) simBoost(st, 1 - s, T, { spa: 1 });
        // 綁住類（SIM_BIND）：還沒被綁住的才綁
        if (SIM_BIND.has(k) && T.hp > 0 && !T.v.bind) {
          T.v.bind = { s, i: st.sd[s].act, dur: rnd && rnd() < 0.5 ? 6 : 5, div: M.item === 'binding-band' ? 6 : 8, k };
          simLog(st, `${tn}被${mz}綁住了`);
        }
        simSitrus(st, 1 - s, T);
      }
      if (!sf && M.item === 'shell-bell' && dealt > 0) simHeal(st, s, M, dealt / 8, '貝殼之鈴');
      if (rc && dealt > 0 && M.b.ab !== 'rock-head') simHurt(st, s, M, Math.max(1, Math.round(dealt * rc[0] / rc[1])), '受到反作用力');
      // 生命寶珠：攻擊打中就扣最大 HP 的 1/10（Showdown lifeorb onAfterMoveSecondarySelf 不看傷害，打在畫皮上沒有傷害也扣；強行打有追加效果的招式不扣，見 sf）
      if (!sf && M.item === 'life-orb' && dealt >= 0) simHurt(st, s, M, M.max / 10, '生命寶珠');
      // 魔術師（Showdown magician onAfterMoveSecondarySelf；強行不發動）：自己沒有道具時，打中後偷走對手的道具（超級石、黏著偷不到，寶石用掉的那下不偷）；
      // 在生命寶珠之後（這招出手時身上沒有道具，偷到的生命寶珠這下不扣）
      if (!sf && !subbed && M.b.ab === 'magician' && !M.item && !gem && M.hp > 0 && T.item && !MON[T.key].base && T.b.ab !== 'sticky-hold') {
        M.item = T.item; simLoseItem(T, true);
        simLog(st, `${me}的${abilZh('magician')}：偷走了${tn}的${ITEMS[M.item]?.[0] || M.item}`);
      }
      // 泡影的詠歎調（Showdown sparklingaria onAfterMove，在生命寶珠之後）：追加效果有中（v.aria）、自己還站著才治好對手的灼傷
      if (T.v.aria) {
        delete T.v.aria;
        if (M.hp > 0 && T.hp > 0 && T.status === 'brn') { T.status = ''; simLog(st, `${tn}的灼傷治好了`); }
      }
      // 自己的能力變化；屬於追加效果的（FLAG.secondary，如流水旋舞）特性強行不會發動
      if (M.hp > 0 && SIM_SELF[k] && !(M.b.ab === 'sheer-force' && FLAG.secondary.has(k))) simBoost(st, s, M, SIM_SELF[k]);
      if (M.hp > 0 && k === 'fell-stinger' && T.hp <= 0) simBoost(st, s, M, { atk: 3 });
      if (SIM_RECHARGE.has(k)) M.rech = true;
      if (SIM_SPIN.has(k) && M.hp > 0) {
        if (k === 'mortal-spin' && !subbed) simStatus(st, 1 - s, T, 'psn', rnd, M);
        if (Object.values(st.sd[s].haz).some(Boolean)) { Object.keys(st.sd[s].haz).forEach(h => { st.sd[s].haz[h] = 0; }); simLog(st, `${me}清掉了自己場地的撒菱類`); }
        delete M.v.seed;
        delete M.v.bind;
      }
      if (SIM_PHAZE.has(k) && !subbed && T.hp > 0 && simBench(st, 1 - s).length && !simOver(st) && !(SIM_ANCHOR.has(T.b.ab) && M.b.ab !== 'mold-breaker')) simSwitch(st, 1 - s, simPhazeTo(st, 1 - s, rnd), rnd);
      // 逃脫按鍵、紅牌（Showdown onAfterMoveSecondary；打在替身上的不算）：被攻擊打中還站著時，逃脫按鍵自己換下場（打的那方急速折返類就不換）、
      // 紅牌讓打的那方被換下場（後排隨機換上）；道具用掉，後排沒有就不發動
      if (!sf && !subbed && T.hp > 0 && st.sd[1 - s].act === it && !simOver(st)) {
        if (T.item === 'eject-button' && simBench(st, 1 - s).length) {
          simLog(st, `${tn}用了${ITEMS[T.item][0]}`); simLoseItem(T); simSwitch(st, 1 - s, pick(st, 1 - s), rnd); stay = true;
        } else if (T.item === 'red-card' && M.hp > 0 && st.sd[s].act === ia && simBench(st, s).length) {
          simLog(st, `${tn}舉起了${ITEMS[T.item][0]}`); simLoseItem(T);
          // 紅牌照樣用掉，但打的那方是吸盤就不會被換下場（Showdown redcard forceSwitchFlag → dragOut 被 suctioncups 擋）
          if (SIM_ANCHOR.has(M.b.ab)) simLog(st, `${me}的${abilZh(M.b.ab)}：沒有被換下場`); else simSwitch(st, s, simPhazeTo(st, s, rnd), rnd);
        }
      }
    }
  }
  delete M.v.fickle; delete M.v.fling;
  // 鐵蹄光線：打出傷害（含打在替身上）或沒打中（onMoveFail）都扣一半；打在畫皮上傷害 0 不扣（Showdown applyRecoilDamage 看 totalDamage）
  if (k === 'steel-beam' && M.hp > 0 && dealt !== 0) simHurt(st, s, M, Math.round(M.max / 2), '自己受到傷害', false);
  if (M.hp <= 0 && SIM_BOOM.has(k)) { M.hp = 0; simLog(st, `${me}倒下`); }
  // 危險迴避（Showdown emergencyexit：這招讓 HP 從一半以上跌到一半以下）：自己換下場，打的那方急速折返類就不換
  if (!sf && T.b.ab === 'emergency-exit' && st.sd[1 - s].act === it && T.hp > 0 && T.hp <= T.max / 2 && tHp0 > T.max / 2 && simBench(st, 1 - s).length && !simOver(st)) {
    simLog(st, `${tn}的${abilZh('emergency-exit')}發動`);
    simSwitch(st, 1 - s, pick(st, 1 - s), rnd);
    stay = true;
  }
  // 逆鱗類：鎖招、解除與混亂（simRage；打中＝dealt 0 以上）
  if (SIM_RAGE.has(k) && st.sd[s].act === ia) simRage(st, s, M, k, dealt >= 0, rnd);
  if (SIM_PIVOT.has(k) && dealt >= 0 && M.hp > 0 && !stay && st.sd[s].act === ia && !simOver(st) && simBench(st, s).length) simSwitch(st, s, pick(st, s), rnd);
}
// 回合結束（Showdown onResidualOrder 的順序）：天氣、預知未來、祈願、青草場地、濕潤之軀、蛻皮、吃剩的東西、寄生種子、中毒、灼傷、詛咒、
// 綁住類、挑釁／再來一次／定身／哈欠倒數、牆倒數、場地倒數、加速、心情不定、危險迴避；
// 守住類這回合沒用的連續計數歸零、畏縮清掉（只有這回合有效）。殘血傷害照 Showdown：灼傷 1/16、中毒 1/8、劇毒 n/16（換下場重算、最多 15/16）、寄生種子 1/8、詛咒 1/4，
// 特性魔法防守不受、毒療改成回 1/8
function simEnd(ctx, st, rnd) {
  // 回合結束前雙方場上的與 HP（危險迴避看回合結束的傷害有沒有跌破一半）
  const act0 = st.sd.map(x => x.act), hp0 = [0, 1].map(s => simAct(st, s).hp);
  // 天氣（Showdown onFieldResidualOrder 1，回合結束最先）：先扣回合數，扣到 0 就結束；還在、又有作用（simWx）時照速度快的先（eachEvent('Weather')）：
  // 沙暴扣最大 HP 1/16（岩石、地面、鋼屬性不受：typechart sandstorm 3；特性沙隱、撥沙、沙之力、防塵、魔法防守不受）；
  // 特性乾燥皮膚下雨回 1/8、晴天扣 1/8，太陽之力晴天扣 1/8，雨盤下雨回 1/16，冰凍之軀下雪回 1/16（abilities.ts onWeather）
  if (st.wx && !--st.wx.n) { simLog(st, `${FIELD_ZH[st.wx.t]}結束了`); st.wx = null; simForecast(st); }
  const wx = simWx(st);
  if (wx) simOrder(st).forEach(s => {
    const M = simAct(st, s), ab = M.b.ab;
    if (M.hp <= 0 || simOver(st)) return;
    if (wx === 'sand' && !simTypes(M).some(t => ['rock', 'ground', 'steel'].includes(t)) && !['sand-veil', 'sand-rush', 'sand-force', 'overcoat'].includes(ab)) simHurt(st, s, M, M.max / 16, '受到沙暴的傷害');
    if ((ab === 'dry-skin' && wx === 'rain') || (ab === 'rain-dish' && wx === 'rain') || (ab === 'ice-body' && wx === 'snow')) simHeal(st, s, M, M.max / (ab === 'dry-skin' ? 8 : 16), `的${abilZh(ab)}`);
    if ((ab === 'dry-skin' || ab === 'solar-power') && wx === 'sun') simHurt(st, s, M, M.max / 8, `的${abilZh(ab)}`);
  });
  // 預知未來打中（Showdown futuremove → trySpreadMoveHit，是一次完整的攻擊）：會急所（照使用者現在的樣子，期望值模式不算）、
  // 打在替身上（沒有 bypasssub）、氣勢披帶／結實撐得住、抗性樹果用掉、被打中的特性照樣發動（電力轉換、持久力…；詛咒之軀不算預知未來）
  st.fut.forEach(f => {
    if (--f.t || simOver(st)) return;
    const T = simAct(st, f.s), k = 'future-sight';
    if (T.hp <= 0) return;
    const src = st.sd[f.ss].mons[f.si], rank = (src.b.ab === 'super-luck') + (src.item === 'scope-lens' || src.item === 'razor-claw') + (src.v.focus ? 2 : 0);
    const crit = !!rnd && rnd() < SIM_CRIT_P[Math.min(3, rank)], r = simCalc(ctx, st, src, T, k, crit), tn = simName(st, f.s);
    if (!r.eff) return;
    const cz = crit ? '（急所）' : '';
    let d = r.rolls.reduce((t, xs) => t + (rnd ? xs[Math.floor(rnd() * 16)] : xs.reduce((a, x) => a + x, 0) / 16), 0);
    if (T.v.sub > 0 && src.b.ab !== 'infiltrator') {
      T.v.sub -= Math.min(d, T.v.sub);
      simLog(st, `預知未來${cz}打在${tn}的替身上${T.v.sub <= 0 ? '，替身消失了' : ''}`);
      if (T.v.sub <= 0) delete T.v.sub;
      T.hits = (T.hits || 0) + 1;
      return;
    }
    if (simDisguised(T, src)) { simLog(st, `預知未來打中${tn}`); simBust(st, f.s, T); return; }
    let held = '';
    if (r.endured && T.hp >= T.max && d >= T.hp) {
      d = T.hp - 1;
      held = r.endured === 'sturdy' ? abilZh('sturdy') : ITEMS[r.endured][0];
      if (r.endured === T.item) simLoseItem(T);
    }
    d = Math.min(T.hp, d);
    T.hp -= d;
    simFaint(st, T);
    if (r.berry) { const it = T.item; simLoseItem(T); simAte(st, f.s, T, it); }
    T.hits = (T.hits || 0) + 1;
    simLog(st, `預知未來${cz}打中${tn} −${simPct(d, T.max)}%（剩 ${simPct(T.hp, T.max)}%）${simMbNote(st, T, src)}${held ? `，靠${held}撐住` : ''}${T.hp <= 0 ? '，倒下' : ''}`);
    if (crit && T.hp > 0 && T.b.ab === 'anger-point' && T.st.atk < 6) { T.st.atk = 6; simLog(st, `${tn}的${abilZh('anger-point')}：攻擊提升到最高`); }
    simHitEffect(st, f.ss, src, T, k, rnd, r.type, T.hp > 0, false);
    simOnHit(st, f.ss, src, T, k, 1, rnd, false);
    simSitrus(st, f.s, T);
  });
  st.fut = st.fut.filter(f => f.t > 0);
  st.sd.forEach((side, s) => {
    if (!side.wish || --side.wish.t) return;
    simHeal(st, s, simAct(st, s), side.wish.hp, '祈願實現');
    side.wish = null;
  });
  const each = f => [0, 1].forEach(s => { const M = simAct(st, s); if (M.hp > 0 && !simOver(st)) f(M, s); });
  // 青草場地（grassyterrain onResidual 5.2，在吃剩的東西 5.4 之前）：在地面上、沒在蓄力躲起來的回 1/16；濕潤之軀（hydration 5.3）下雨時治好異常
  if (simTer(st) === 'grassy') each((M, s) => { if (simGround(M) && !M.hide) simHeal(st, s, M, M.max / 16, '受到青草場地回復'); });
  each((M, s) => { if (M.b.ab === 'hydration' && M.status && simWx(st) === 'rain') { M.status = ''; simLog(st, `${simName(st, s)}靠${abilZh('hydration')}治好了`); } });
  each((M, s) => { if (M.b.ab === 'shed-skin' && M.status && rnd && rnd() < 0.33) { M.status = ''; simLog(st, `${simName(st, s)}靠蛻皮治好了`); } });
  each((M, s) => { if (M.item === 'leftovers') simHeal(st, s, M, M.max / 16, '吃剩的東西'); });
  each((M, s) => {
    const O = simAct(st, 1 - s);
    if (!M.v.seed || O.hp <= 0) return;
    const d = simHurt(st, s, M, M.max / 8, '被寄生種子吸取'), v = O.item === 'big-root' ? pokeRound(d * 5324 / 4096) : d;
    // 被吸的是污泥漿：種的那方改扣同樣多（Showdown liquidooze onSourceTryHeal）
    if (d) { if (M.b.ab === 'liquid-ooze') simHurt(st, 1 - s, O, v, `吸到${abilZh('liquid-ooze')}`); else simHeal(st, 1 - s, O, v, '寄生種子'); }
  });
  each((M, s) => {
    if (M.status !== 'psn' && M.status !== 'tox') return;
    if (M.status === 'tox') M.tox = Math.min(15, M.tox + 1);
    if (M.b.ab === 'poison-heal') simHeal(st, s, M, M.max / 8, '毒療');
    else simHurt(st, s, M, M.status === 'tox' ? Math.max(1, Math.floor(M.max / 16)) * M.tox : M.max / 8, '受到毒的傷害');
  });
  // 灼傷 1/16；特性耐熱減半（Showdown heatproof onDamage：effect brn 時 ÷2）
  each((M, s) => { if (M.status === 'brn') simHurt(st, s, M, M.max / (M.b.ab === 'heatproof' ? 32 : 16), '受到灼傷的傷害'); });
  each((M, s) => { if (M.v.curse) simHurt(st, s, M, M.max / 4, '受到詛咒'); });
  // 鹽醃（saltcure onResidualOrder 13）：1/16，水、鋼屬性 1/8（冠軍版）
  each((M, s) => { if (M.v.salt) simHurt(st, s, M, M.max / (simTypes(M).some(t => t === 'water' || t === 'steel') ? 8 : 16), '受到鹽醃的傷害'); });
  // 綁住類（partiallytrapped onResidualOrder 13）：先扣回合數，扣完就解除；用的那隻離場或倒下也解除（不扣血）；不然扣 1/8（緊綁束帶 1/6）
  each((M, s) => {
    const b = M.v.bind;
    if (!b) return;
    if (!--b.dur) { delete M.v.bind; simLog(st, `${simName(st, s)}從${MOVES[b.k][0]}中解脫了`); }
    else if (!simBound(st, M)) delete M.v.bind;
    else simHurt(st, s, M, M.max / b.div, `受到${MOVES[b.k][0]}的傷害`);
  });
  // 糖漿炸彈（syrupbomb duration 4、onResidualOrder 14）：每次回合結束先扣回合數，扣到 0 就結束（這次不降）；
  // 用的那隻不在場上也解除；不然速度 −1（共降 3 次，第 4 次回合結束才解除，這之前不能再黏上）
  each((M, s) => {
    const y = M.v.syrup;
    if (!y) return;
    if (y.n <= 1 || st.sd[y.s].act !== y.i || simAct(st, y.s).hp <= 0) { delete M.v.syrup; return; }
    M.v.syrup = { ...y, n: y.n - 1 };
    simBoost(st, s, M, { spe: -1 }, y.s);
  });
  // 蛸固（octolock onResidualOrder 14）：用的那隻還在場上就防禦、特防 −1（對手造成的，恆淨之軀等擋得住），不在了就解除
  each((M, s) => {
    const o = M.v.octo;
    if (!o) return;
    if (st.sd[o.s].act !== o.i || simAct(st, o.s).hp <= 0) { delete M.v.octo; return; }
    simLog(st, `${simName(st, s)}被蛸固勒緊`);
    simBoost(st, s, M, { def: -1, spd: -1 }, o.s);
  });
  each((M, s) => {
    if (M.v.taunt && !--M.v.taunt) delete M.v.taunt;
    // 回復封鎖結束：HP 一半以下、留著的文柚果馬上吃（Showdown Update）
    if (M.v.hblock && !--M.v.hblock) { delete M.v.hblock; simSitrus(st, s, M); }
    if (M.v.tchop && !--M.v.tchop) delete M.v.tchop;
    if (M.v.mrise && !--M.v.mrise) { delete M.v.mrise; simLog(st, `${simName(st, s)}的電磁飄浮結束了`); }
    if (M.v.enc && (!--M.v.enc || !(M.pp[M.v.encK] > 0))) { delete M.v.enc; delete M.v.encK; }
    if (M.v.dis && !--M.v.dis.n) { simLog(st, `${simName(st, s)}的${simMoveZh(M.v.dis.k)}不再被定身`); delete M.v.dis; }
    if (M.v.yawn && !--M.v.yawn) { delete M.v.yawn; simStatus(st, s, M, 'slp', rnd, null); }
    // 逆鱗類鎖住中睡著了就解除（Showdown lockedmove onResidual）
    if (M.v.rage && M.status === 'slp') delete M.v.rage;
  });
  // 滅亡之歌（perishsong onResidualOrder 24）：倒數到 0 就倒下（照速度依序，雙方一起倒到 0 時兩邊都倒，最後倒下的那方贏）
  simOrder(st).forEach(s => {
    const M = simAct(st, s);
    if (M.hp <= 0 || !M.v.perish) return;
    if (--M.v.perish > 0) return simLog(st, `${simName(st, s)}的滅亡倒數：${M.v.perish}`);
    simLog(st, `${simName(st, s)}因為滅亡之歌倒下`);
    M.hp = 0;
    simFaint(st, M);
  });
  st.sd.forEach(side => Object.keys(side.scr).forEach(w => { if (!--side.scr[w]) delete side.scr[w]; }));
  // 順風（26.5）、神秘守護（26.3）各自倒數；戲法空間（27.1）倒數
  st.sd.forEach((side, s) => {
    if (side.tw && !--side.tw) simLog(st, `${s ? '對手' : '我方'}的順風停了`);
    if (side.sg && !--side.sg) simLog(st, `${s ? '對手' : '我方'}的神秘守護結束了`);
  });
  if (st.troom && !--st.troom.n) { simLog(st, '戲法空間結束了'); st.troom = null; }
  // 場地（onFieldResidualOrder 27：牆之後、加速之前）：扣回合數，扣到 0 就結束
  if (st.ter && !--st.ter.n) simClearTer(st, '結束了');
  // 收穫（Showdown harvest onResidualOrder 28）：沒有道具、最後吃的是樹果時，晴天一定、不然 50% 長回來（照亂數抽，期望值模式只算晴天）；
  // 長回來的馬上看要不要吃（文柚果 HP 一半以下、木子果有異常）
  each((M, s) => {
    if (M.b.ab !== 'harvest' || M.item || !M.lastItem?.endsWith('-berry') || !(simWx(st) === 'sun' || (rnd && rnd() < 0.5))) return;
    M.item = M.lastItem; M.lastItem = '';
    simLog(st, `${simName(st, s)}的${abilZh('harvest')}：${ITEMS[M.item][0]}長回來了`);
    simBerryNow(st, s, M);
  });
  // 反芻（Showdown cudchew onResidual）：吃了樹果的下一回合結束再吃一次（文柚果再回、木子果再治；抗性樹果沒有效果）
  each((M, s) => {
    const c = M.v.cud;
    if (!c) return;
    if (c.n > 1) { M.v.cud = { ...c, n: c.n - 1 }; return; }
    delete M.v.cud;
    simLog(st, `${simName(st, s)}的${abilZh('cud-chew')}：又吃了一次${ITEMS[c.it]?.[0] || c.it}`);
    if (c.it === 'sitrus-berry') simSitrusHeal(st, s, M, '文柚果');
    else if ((c.it === 'lum-berry' && M.status) || (c.it === 'chesto-berry' && M.status === 'slp')) M.status = '';
    simAte(st, s, M, c.it, true);
  });
  // 加速（Showdown speedboost onResidual，在回合結束的最後）：這回合開始時已經在場上的（不是這回合才換上來的）速度 +1
  each((M, s) => { if (M.b.ab === 'speed-boost' && M.in < st.turn) simBoost(st, s, M, { spe: 1 }); });
  // 心情不定（Showdown moody onResidual，同加速在最後）：沒到頂的能力隨機一項 +2，另一項沒到底的 −1（不含命中閃避）；機率性的，期望值模式不算
  each((M, s) => {
    if (M.b.ab !== 'moody' || !rnd) return;
    const ks = ['atk', 'def', 'spa', 'spd', 'spe'], pick = xs => xs[Math.floor(rnd() * xs.length)], up = pick(ks.filter(k => M.st[k] < 6));
    const down = pick(ks.filter(k => M.st[k] > -6 && k !== up));
    simLog(st, `${simName(st, s)}的${abilZh('moody')}發動`);
    simBoost(st, s, M, { ...(up && { [up]: 2 }), ...(down && { [down]: -1 }) });
  });
  // 飽了又餓（Showdown hungerswitch onResidualOrder 29）：莫魯貝可每回合結束在飽腹花紋、空腹花紋之間切換（v.hangry，換下場變回飽腹；氣場輪的屬性跟著變）
  each((M, s) => { if (M.b.ab === 'hunger-switch' && simFk(M) === 'morpeko') { M.v.hangry = !M.v.hangry; simLog(st, `${simName(st, s)}變成${M.v.hangry ? '空腹' : '飽腹'}花紋`); } });
  st.sd.forEach(side => side.mons.forEach(m => {
    delete m.v.prot; delete m.v.endure; delete m.v.flinch; delete m.v.roost; delete m.v.beak;
    // 這回合出招的紀錄變成「上一回合的」（豁出去、跺腳，見 simVarBp）
    if (m.v.mt?.live) m.v.mt = { ...m.v.mt, live: false };
    if (!m.v.protUsed) delete m.v.stall;
    delete m.v.protUsed;
  }));
  // 危險迴避：回合結束的傷害讓 HP 從一半以上跌到一半以下也換下場（Showdown battle.ts residual 後的 EmergencyExit）；換上誰同 simStep 的 pin，不然簡單規則
  [0, 1].forEach(s => {
    const M = simAct(st, s);
    if (M.b.ab !== 'emergency-exit' || st.sd[s].act !== act0[s] || M.hp <= 0 || M.hp > M.max / 2 || hp0[s] <= M.max / 2 || !simBench(st, s).length || simOver(st)) return;
    simLog(st, `${simName(st, s)}的${abilZh('emergency-exit')}發動`);
    simSwitch(st, s, simBench(st, s).includes(st.pin?.[s]) ? st.pin[s] : simGreedyPick(ctx, st, s), rnd);
  });
  simUpdate(st);
}
// 一回合：acts[s] 是雙方的選擇（simOpts 的一項；會複製一份，再來一次改對手的招式不影響呼叫端）。先換人，再依先制等級、速度出招
// （同速：有 rnd 抽，沒有看 tie 誰先），最後回合結束（simEnd）。倒下的補位不在這裡（見 simReplace／simPlay）。
// idle＝連續幾回合雙方都沒扣血也沒換人（見 simOpts）。回傳這回合有沒有同速決定先後
function simTurn(ctx, st, acts0, rnd, tie, pick) {
  const snap = () => JSON.stringify(st.sd.map(x => [x.act, x.mons.map(m => m.hp)])), was = snap(), acts = acts0.map(a => ({ ...a }));
  st.turn++;
  if (st.log) st.log.push(`第 ${st.turn} 回合`);
  // 鳥嘴加農炮：回合一開始（換人之前）就加熱，到出招前被接觸招式打到的會灼傷（Showdown priorityChargeCallback；見 simOnHit，回合結束解除）
  [0, 1].forEach(s => { const M = simAct(st, s); if (acts[s].t === 'mv' && acts[s].k === 'beak-blast' && M.hp > 0) { M.v.beak = true; simLog(st, `${simName(st, s)}開始加熱鳥嘴`); } });
  [0, 1].forEach(s => { if (acts[s].t === 'sw') simSwitch(st, s, acts[s].i, rnd); });
  if (acts.some(a => a.t === 'sw')) simUpdate(st);
  // 要休息的（破壞光線類打中後）也照出招順序排（Showdown mustrecharge 鎖在 recharge 這招，先制等級 0）：比它快的守住類照樣成功
  const start = st.sd.map(x => x.act), mv = [0, 1].filter(s => (acts[s].t === 'mv' || acts[s].t === 'rech') && simAct(st, s).hp > 0);
  const priOf = s => acts[s].t === 'rech' ? 0 : simPri(st, simAct(st, s), acts[s].k);
  let order = mv, tied = false;
  if (mv.length === 2) {
    // 同一先制等級裡搶先（Showdown onFractionalPriority +0.1；機率性的，期望值模式不算）：先制之爪在先制等級 0 以下時 20%、特性速擊用攻擊招式時 30%
    const frac = s => {
      const M = simAct(st, s), k = acts[s].k;
      if (!rnd) return 0;
      if (M.item === 'quick-claw' && priOf(s) <= 0 && rnd() < 0.2) { simLog(st, `${simName(st, s)}的先制之爪發動`); return 0.1; }
      if (M.b.ab === 'quick-draw' && acts[s].t === 'mv' && simCat(k) !== 'status' && rnd() < 0.3) { simLog(st, `${simName(st, s)}的${abilZh('quick-draw')}發動`); return 0.1; }
      return 0;
    };
    const pri = mv.map(s => priOf(s) + frac(s)), spd = mv.map(s => simSpeed(ctx, st, simAct(st, s)));
    const first = pri[0] !== pri[1] ? (pri[0] > pri[1] ? 0 : 1) : spd[0] !== spd[1] ? (simFaster(st, spd[0], spd[1]) ? 0 : 1)
      : (tied = true, rnd ? (rnd() < 0.5 ? 0 : 1) : tie);
    order = [first, 1 - first];
  }
  const done = [false, false];
  order.forEach(s => {
    if (simOver(st) || st.sd[s].act !== start[s] || simAct(st, s).hp <= 0) return;
    if (acts[s].t === 'rech') {
      simAct(st, s).rech = false;
      simLog(st, `${simName(st, s)}要休息一回合`);
      done[s] = true;
      return;
    }
    // 對手這回合還會行動（Showdown queue.willAct；要休息的也算一個行動，守住類看這個）
    const o = 1 - s, oWill = !done[o] && (acts[o].t === 'mv' || acts[o].t === 'rech') && st.sd[o].act === start[o] && simAct(st, o).hp > 0;
    simMove(ctx, st, s, acts[s].k, acts[o], oWill, rnd, pick);
    done[s] = true;
    simUpdate(st);
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
// 出招：攻擊招式看打中時的期望傷害（打不倒時佔對方最大 HP 的比例），打得倒的再加 1、用先制打得倒的再加 0.5，再乘命中率；
// 要蓄力、要休息的打不倒時只算一半；自爆類扣掉自己剩下的 HP（打不倒再扣 1）；快手還擊不預判（算 0）；對手有替身時只算打替身的一半。
// 輔助招見 simGreedySup（也乘命中率）。
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
    const p = simAcc(st, M, T, k, false) / 100;
    if (SIM_SUP[k]) v = p * simGreedySup(st, s, M, T, k, dt, dm);
    else {
      const e = k === 'upper-hand' ? 0 : simExpHit(ctx, st, M, T, k), sub = T.v.sub > 0 && !FLAG.sound.has(k) && M.b.ab !== 'infiltrator', ko = !sub && e >= T.hp;
      v = p * (sub ? Math.min(e, T.v.sub) / T.max / 2 : Math.min(e, T.hp) / T.max + (ko ? 1 + (simPri(st, M, k) > 0 ? 0.5 : 0) : 0));
      if (!ko && (simMustCharge(st, M, k) || SIM_RECHARGE.has(k))) v /= 2;
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
    case 'transform': return 0.9;
    // 戲法空間：自己比對手慢（還沒開）或比對手快（對手開了）時；順風：比對手慢、×2 就追得上；同命：這回合會被打倒；
    // 接棒：強化合計 +2 以上；斷尾、復生祈禱、回收利用、顛倒（對手強化 +2 以上）、定身法（對手上一招是牠最痛的）
    case 'troom': { const a = simSpe(st, M), b = simSpe(st, T); return (st.troom ? a > b : a < b) ? 0.6 : 0; }
    case 'tailwind': { const a = simSpe(st, M), b = simSpe(st, T); return a < b && a * 2 > b ? 0.55 : 0; }
    case 'dbond': return dt >= M.hp ? 0.75 : 0;
    case 'baton': return Object.values(M.st).reduce((t, v) => t + Math.max(0, v), 0) >= 2 ? 0.5 : 0;
    case 'shedtail': return safe ? 0.4 : 0;
    case 'revive': return 0.8;
    case 'recycle': return 0.4;
    case 'topsy': return T.st.atk + T.st.spa + T.st.spe >= 2 ? 0.8 : 0;
    case 'disable': return T.last && !SIM_SUP[T.last] ? 0.4 : 0;
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
    // 特性變身者的換上來就變成對手那隻：招式、能力照對手的算（HP 是自己的、道具照自己的算速度）
    const imp = M.b.ab === 'imposter' && !T.tf && !T.v.sub, src = imp ? T : M;
    const dm = Math.max(0, ...src.moves.map(k => simExp(ctx, st, src, T, k))), dt = Math.max(0, ...T.moves.map(k => simExp(ctx, st, T, src, k)));
    const n1 = dm ? Math.ceil(T.hp / dm) : Infinity, n2 = dt ? Math.ceil(M.hp / dt) : Infinity;
    const fast = simFaster(st, simSpeed(ctx, st, imp ? { ...T, item: M.item, status: M.status } : M), simSpeed(ctx, st, T));
    if (n1 < n2 || (n1 === n2 && fast && n1 < Infinity)) return 2 + Math.max(0, M.hp - dt * (fast ? n1 - 1 : n1)) / M.max;
    return Math.min(1, dm * (n2 === Infinity ? 9 : n2) / T.hp);
  };
  return bench.map(i => [i, score(i)]).sort((x, y) => y[1] - x[1])[0][0];
}
// 倒下的補位（兩方都倒時都換）：picks[s] 是 { t: 'sw', i } 或 { t: 'pass' }；雙方都換上來後才照速度發動出場效果（simEntry；兩邊同時補位時互相都吃得到）
function simReplace(st, picks, rnd) {
  const sw = [0, 1].filter(s => picks[s].t === 'sw');
  sw.forEach(s => simSwitch(st, s, picks[s].i, rnd, true));
  simEntry(st, sw);
  if (sw.length) { simSeeds(st); simUpdate(st); }
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
// 一場的開頭局面：sides＝[我方, 對手]，每方 { mons 帶出場的（simMon，先發排第一）}（會複製一份）；先發都在場上。
// intim＝哪幾方的威嚇發動（沒給＝雙方；simDuel 的換上來只有我方剛出場）
function simStart(sides, log, intim = [0, 1]) {
  const st = { sd: sides.map(x => simSide0(x.mons.map(simCloneMon))), turn: 0, fut: [], idle: 0, wx: null, ter: null, log: log ? [] : null };
  st.sd.forEach(x => Object.assign(x.mons[0], { in: 0, out: true }));
  // 先發雙方同時出場：照速度各自發動出場效果（simEntry；開天氣場地慢的蓋掉快的）。intim＝剛出場的方（沒給＝雙方）；
  // 不在裡面的是早就在場上的（單打對位換上來那場的對手）：牠開的天氣場地先在、再被剛出場的蓋掉，特性變身者照樣變成剛出場的那隻
  const old = [0, 1].filter(s => !intim.includes(s));
  old.forEach(s => simEntryField(st, s, simAct(st, s)));
  simEntry(st, intim);
  old.forEach(s => simImposter(st, s, simAct(st, s)));
  simSeeds(st);
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
  if (st.log) st.log.unshift(`先發：我方${MON[simBaseKey(simAct(st, 0))].zh}、對手${MON[simBaseKey(simAct(st, 1))].zh}`);
  const pick = (c, s) => simGreedyPick(ctx, c, s), algo = [].concat(opt.algo || 'ply1');
  const by = (a, phase) => a === 'tree' ? simSearch(ctx, st, phase, opt.iters || 200, rnd) : simDecide(ctx, st, phase, rnd);
  const decide = phase => algo.length < 2 || algo[0] === algo[1] ? by(algo[0], phase) : [by(algo[0], phase)[0], by(algo[1], phase)[1]];
  while (!simOver(st) && st.turn < SIM_MAX_TURN) {
    simTurn(ctx, st, decide('turn'), rnd, 0, pick);
    // 補位換上來又被撒菱類打倒的再補（補到有人站著才打下一回合）
    while (!simOver(st) && (simNeed(st, 0) || simNeed(st, 1))) simReplace(st, decide('replace'), rnd);
  }
  // 打完時還在變身的變回來（統計照原本的寶可夢）
  st.sd.forEach(x => x.mons.forEach(simUntransform));
  const w = simWinner(st), res = w === 0 ? 1 : w === 1 ? -1 : 0, both = simDead(st, 0) && simDead(st, 1);
  if (st.log) st.log.push((both ? `雙方同時全倒，最後倒下的是${w ? '對手' : '我方'}，` : '') + (res > 0 ? '我方贏' : res < 0 ? '我方輸' : `打滿 ${SIM_MAX_TURN} 回合，平手`));
  return { res, turns: st.turn, mons: st.sd.map(x => x.mons), log: st.log };
}
// 單打一對一（隊伍分析、出戰選角的對位 duelVs 用）：x 我方 { key, set 登錄的配招, item（沒給照 battler；超級進化這場不進化、以原型上場的給 ''）}、
// 對手寶可夢 key yk（配招照 OP.GG 常見，同 battler）。不靠亂數打一場：雙方每回合照 simDecide 取機率最高的選擇，
// 傷害、命中、追加效果用期望值（同樹搜尋往下推演）；每次重開 simCtx（共用的話 ctx.flip 會讓結果跟著前面算過的變）。
// left＝換上來吃過牠最痛的一招後剩下的 HP（matchup 的 left）：我方從這個 HP 開打、畫皮已揭穿，只有我方的威嚇發動，
// 對手早就在場上（不能用擊掌奇襲這類上場第一回合的招式）；沒給＝雙方剛出場、HP 全滿。
// 同速的回合先照我方先動打一場，有遇到同速再照對手先動打一場，兩場都贏才算贏（同 matchup 同速算我方沒贏）。
// 回傳 { win, res 我方先動那場的結果（1 贏、−1 輸、0 打滿回合）, turns 那場打了幾回合, tieLose 同速時對手先動就輸 }
function simDuel(fmt, x, yk, left) {
  const run = tie => {
    const ctx = simCtx(fmt), st = simDuelStart(fmt, x, yk, left), pick = (c, s) => simGreedyPick(ctx, c, s);
    let tied = false;
    while (!simOver(st) && st.turn < SIM_MAX_TURN) {
      tied = simTurn(ctx, st, simDecide(ctx, st, 'turn', null), null, tie, pick) || tied;
      while (!simOver(st) && (simNeed(st, 0) || simNeed(st, 1))) simReplace(st, simDecide(ctx, st, 'replace', null), null);
    }
    const w = simWinner(st);
    return { res: w === 0 ? 1 : w === 1 ? -1 : 0, turns: st.turn, tied };
  };
  const a = run(0), tieLose = a.res > 0 && a.tied && run(1).res <= 0;
  return { win: a.res > 0 && !tieLose, res: a.res, turns: a.turns, tieLose };
}
// 單打一對一的開頭局面（simDuel、simDuelP 共用；x、yk、left 同 simDuel）
function simDuelStart(fmt, x, yk, left) {
  const me = simMon(x.key, x.set, x.item, 0, fmt), op = simMon(yk, undefined, undefined, 1, fmt);
  if (left != null) Object.assign(me, { hp: Math.min(me.max, left), bust: true });
  const st = simStart([{ mons: [me] }, { mons: [op] }], false, left != null ? [0] : [0, 1]);
  if (left != null) simAct(st, 1).in = -1;
  return st;
}
// 有種子的亂數（mulberry32）與字串雜湊（FNV-1a）：同一組對位每次算出一樣的勝率（事先算好的 sim-matrix.js 和畫面上現算的對得起來）
const simRng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const simHash = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; };
// 單打一對一的勝率（對位 duelVs 用）：x、yk、left 同 simDuel，帶亂數打 n 場（傷害、急所、命中、追加效果照亂數；雙方每回合照 simDecide 的混合策略抽），
// 贏 1、打滿回合算 0.5、輸 0 的平均。亂數種子照輸入雜湊，同一組每次一樣；n 場共用一個計算快取
const SIM_DUEL_N = 30;
function simDuelP(fmt, x, yk, left, n = SIM_DUEL_N) {
  const rnd = simRng(simHash(JSON.stringify([fmt, x.key, x.set || null, x.item ?? null, yk, left ?? null, n]))), ctx = simCtx(fmt), pick = (c, s) => simGreedyPick(ctx, c, s);
  let w = 0;
  for (let r = 0; r < n; r++) {
    const st = simDuelStart(fmt, x, yk, left);
    while (!simOver(st) && st.turn < SIM_MAX_TURN) {
      simTurn(ctx, st, simDecide(ctx, st, 'turn', rnd), rnd, 0, pick);
      while (!simOver(st) && (simNeed(st, 0) || simNeed(st, 1))) simReplace(st, simDecide(ctx, st, 'replace', rnd), rnd);
    }
    const win = simWinner(st);
    w += win === 0 ? 1 : win === 1 ? 0 : 0.5;
  }
  return w / n;
}

// 計算引擎：資料與純邏輯，不碰 DOM（畫面在 js/ui/）
// ---------- 對戰模擬（單打：6 選 3，雙方每回合同時出招） ----------
// 算攻擊招式的傷害與招式本身附帶的效果（使用限制、自己的能力變化、反作用力與吸血、打完換人、追加效果見 SIM_SEC）、命中率（見 simAcc），
// 加上輔助招（強化、守住、回復、異常狀態、撒菱、擾亂，見 SIM_SUP）與相關的道具、特性、回合結束效果，以及 PP（照 OP.GG 冠軍版的 PP，用完只能掙扎）。
// 看場上狀況的特性：猛火類、大將（simCalc）、畫皮（simDisguised）、加速（simEnd）、踩影（simOpts）、變幻自如／自由者（simProtean）、
// 戰鬥切換（simStance）、詛咒之軀（simMove）；威力會變的招式見 simVarBp。
// 不算：威嚇、變身者、開天氣場地以外的出場特性、命中閃避的能力變化、少數特殊的追加效果（見 SIM_SEC 上方）。
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
const SIM_STAT_ZH = { atk: '攻擊', def: '防禦', spa: '特攻', spd: '特防', spe: '速度' };
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
// 不算：魅誘之聲、妒火（要對手這回合能力上升過）、鹽醃、地獄突刺、縫影、泡影的詠歎調、精神噪音、糖漿炸彈這些特殊狀態，濁流、暗黑爆破的降命中
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
  'zen-headbutt': [{ c: 20, fl: 1 }] };
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
  transform: { kind: 'transform', tgt: 1 },
  'sunny-day': { kind: 'field', w: 'sun' }, 'rain-dance': { kind: 'field', w: 'rain' }, sandstorm: { kind: 'field', w: 'sand' }, snowscape: { kind: 'field', w: 'snow' },
  'chilly-reception': { kind: 'field', w: 'snow', pivot: 1 }, 'electric-terrain': { kind: 'field', w: 'electric' }, 'grassy-terrain': { kind: 'field', w: 'grassy' },
  'misty-terrain': { kind: 'field', w: 'misty' }, 'psychic-terrain': { kind: 'field', w: 'psychic' },
};
// 回復量照天氣的（Showdown synthesis／morningsun／moonlight onHit：pokemon.effectiveWeather 晴天 0.667、下雨／沙暴／下雪 0.25、其他 0.5，this.modify(maxhp, factor)）
const SIM_SUNHEAL = new Set(['synthesis', 'morning-sun', 'moonlight']);
const SIM_SUNHEAL_F = { sun: 0.667, rain: 0.25, sand: 0.25, snow: 0.25 };
// 晴天不用蓄力的日光束、日光刃，下雨不用蓄力的電光束（Showdown solarbeam／solarblade／electroshot onTryMove 看 attacker.effectiveWeather）
const SIM_CHARGE_WX = { 'solar-beam': 'sun', 'solar-blade': 'sun', 'electro-shot': 'rain' };
const SIM_STATUS_ZH = { brn: '灼傷', par: '麻痺', psn: '中毒', tox: '劇毒', slp: '睡眠', frz: '冰凍' };
const SIM_HAZ_ZH = { sr: '隱形岩', spikes: '撒菱', tspikes: '毒菱', web: '黏黏網' };
// 一場最多幾回合（到了算平手）、往前算的時候簡單規則最多再打幾回合
const SIM_MAX_TURN = 100, SIM_LOOK = 40;
const SIM_ST0 = () => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });

// 上場的一隻：key 這場的型態、set 配招（能算傷害的攻擊招式與 SIM_SUP 有的輔助招；沒有招式就用 OP.GG 前 4 招 defaultSet）、
// item 道具（沒給照 battler）、s 哪一方。能力點數、性格、特性同 battler；其餘是場上狀態：hp、item（會被打掉、用掉）、st 能力變化、
// lock 講究圍巾鎖住的招式、chg 蓄力中的招式、hide 蓄力時打不到、rech 下一回合要休息、in 第幾回合上場（擊掌奇襲用）、kos 打倒幾隻、
// out 有沒有上過場、status 異常狀態（tox 劇毒累積、slp 還要睡幾次、frz 冰凍還剩幾次出招機會）、v 換下場就清掉的狀態（sub 替身 HP、taunt、enc／encK 再來一次、seed、
// curse、yawn、focus、charge、trap、prot／endure／stall／protUsed 守住類、flinch 這回合畏縮、conf 混亂還剩幾次出招機會、fallen 大將算的倒下隻數、
// types／pt 變幻自如換過的屬性與這次上場發動過了（simProtean）、dis 被定身的招式 { k, n 還剩幾次回合結束 }（詛咒之軀）、
// mt 這隻最近一次出招 { t 第幾回合, ok 有沒有成功 }（豁出去、跺腳）、got 這回合被打的傷害（反擊類、雪崩））、
// last 上一次用的招式（再來一次用）、pp 各招剩下的 PP（OP.GG 冠軍版的 PP）、bust 畫皮被揭穿了（換下場也不會恢復）、
// fk 戰鬥切換後能力值用的型態（simStance；換下場變回 key）、hits 被攻擊打中幾下（憤怒之拳；換下場不重算）
// 能算的招式：damageCalc 算得了的攻擊招式（含看體重的）、固定傷害、反擊類與一擊必殺（SIM_FIXED／SIM_REACT／SIM_OHKO）、SIM_SUP 的輔助招；其他（變身…）不列
const simCanUse = k => canCalc(k) || !!SIM_FIXED[k] || !!SIM_REACT[k] || SIM_OHKO.has(k) || !!SIM_SUP[k];
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
  const atk = stageStat(statOf(MON[simFk(A)].bs[1], asp, 1, anat), A.st.atk), def = stageStat(statOf(MON[simFk(D)].bs[2], dsp, 2, dnat), D.st.def);
  const base = Math.floor(Math.floor(22 * 50 * atk / def) / 50) + 2, scr = st.sd[+D.id[0]].scr;
  let d = Math.floor(base * (rnd ? 85 + Math.floor(rnd() * 16) : 92.5) / 100);
  if (A.status === 'brn' && A.b.ab !== 'guts') d = Math.floor(d / 2);
  if (scr.reflect || scr['aurora-veil']) d = Math.floor(d / 2);
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
const simCloneMon = m => ({ ...m, st: { ...m.st }, v: { ...m.v }, pp: { ...m.pp } });
const simClone = st => ({ sd: st.sd.map(x => ({ ...x, mons: x.mons.map(simCloneMon), haz: { ...x.haz }, scr: { ...x.scr }, wish: x.wish && { ...x.wish } })),
  turn: st.turn, fut: st.fut.map(f => ({ ...f })), idle: st.idle, seq: st.seq, wx: st.wx && { ...st.wx }, ter: st.ter && { ...st.ter }, log: null });
// 場上現在的屬性（變幻自如、自由者換過的，見 simProtean）；能力值用的型態（戰鬥切換換過的，見 simStance）
const simTypes = M => M.v.types || MON[M.key].types;
const simFk = M => M.fk || M.key;
// 在地面上（撒菱、毒菱、黏黏網用）：不是飛行屬性、沒有飄浮、沒帶氣球（Showdown isGrounded）
const simGround = M => !simTypes(M).includes('flying') && M.b.ab !== 'levitate' && M.item !== 'air-balloon';
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
  return st[k].n;
}
// 特性開天氣或場地 t：出場的（WX_AB、TER_AB）要還站著；被打中的（吐沙、播種，hit）被打倒也照樣發動
// （Showdown spreadMoveHit 的 DamagingHit 在倒下結算之前，沒有看倒下）
function simFieldAb(st, s, M, t, hit = false) {
  const n = t && (hit || M.hp > 0) ? simSetField(st, M, t) : 0;
  if (n) simLog(st, `${simName(st, s, M)}的${abilZh(M.b.ab)}：變成${FIELD_ZH[t]}（${n} 回合）`);
}
const simEntryField = (st, s, M) => simFieldAb(st, s, M, WX_AB[M.b.ab] || TER_AB[M.b.ab]);
// 這一招現在要不要先蓄力（SIM_CHARGE；晴天的日光束、日光刃、下雨的電光束不用，SIM_CHARGE_WX）
const simMustCharge = (st, M, k) => SIM_CHARGE.has(k) && M.chg !== k && simWx(st) !== SIM_CHARGE_WX[k];
// 這一招的先制等級：SIM_PRI 或輔助招的 p；特性惡作劇之心讓輔助招 +1（Showdown prankster）；青草滑梯在青草場地、自己在地面上時 +1（grassyglide onModifyPriority）
const simPri = (st, M, k) => (SIM_PRI[k] ?? SIM_SUP[k]?.p ?? 0) + (SIM_SUP[k] && M.b.ab === 'prankster' ? 1 : 0)
  + (k === 'grassy-glide' && simTer(st) === 'grassy' && simGround(M) ? 1 : 0);
// 精神場地擋先制（Showdown psychicterrain onTryHit：先制等級 > 0 打對手的招式、對手在地面上又沒在蓄力躲起來）；攻擊招式 damageCalc 已經擋了，這裡給打對手的輔助招用
const simPsyBlock = (st, M, T, k) => simTer(st) === 'psychic' && simGround(T) && !T.hide && simPri(st, M, k) > 0;
// M 用招式 k 打 T 的命中率 %（Showdown battle-actions.ts hitStepAccuracy 與 ModifyAccuracy／Accuracy 事件）：招式的命中率（OP.GG 冠軍版，
// 和 Showdown 冠軍版 mod 改過的一致；null＝必中）依序乘特性複眼 ×1.3、活力的物理招式 ×0.8、對手特性蹣跚在混亂時 ×0.5（破格無視）、
// 道具廣角鏡 ×1.1、對焦鏡在對手這回合已經行動過時（moved）×1.2、對手道具光粉 ×0.9（4096 制連乘再四捨五入）；
// 雙方任一隻特性無防守、毒屬性用劇毒時必中。回傳 100 以下（100＝必中）；一擊必殺不在這裡算（固定 30，見 simFixed），回傳 100。
// 天氣（simWx）：打雷、暴風下雨時必中、晴天命中 50（thunder／hurricane onModifyMove）；暴風雪下雪時必中（blizzard）；
// 對手特性沙隱在沙暴、雪隱在下雪時命中 ×0.8（sandveil／snowcloak onModifyAccuracy 3277/4096）
function simAcc(st, M, T, k, moved) {
  const wx = simWx(st), tw = k === 'thunder' || k === 'hurricane';
  const a0 = tw && wx === 'sun' ? 50 : MOVES[k]?.[6];
  if (a0 == null || SIM_OHKO.has(k) || M.b.ab === 'no-guard' || T.b.ab === 'no-guard' || (k === 'toxic' && simTypes(M).includes('poison'))
    || (tw && wx === 'rain') || (k === 'blizzard' && wx === 'snow')) return 100;
  const mods = [];
  if ((T.b.ab === 'sand-veil' && wx === 'sand') || (T.b.ab === 'snow-cloak' && wx === 'snow')) mods.push(3277);
  if (M.b.ab === 'compound-eyes') mods.push(5325);
  if (M.b.ab === 'hustle' && simCat(k) === 'physical') mods.push(3277);
  if (T.b.ab === 'tangled-feet' && T.v.conf && M.b.ab !== 'mold-breaker') mods.push(2048);
  if (M.item === 'wide-lens') mods.push(4505);
  if (M.item === 'zoom-lens' && moved) mods.push(4915);
  if (T.item === 'bright-powder') mods.push(3686);
  return Math.min(100, mods.length ? pokeRound(a0 * chainMods(mods, 0, Infinity) / 4096) : a0);
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
    case 'temper-flare': case 'stomping-tantrum': bp = x2(A.v.mt?.t === st.turn - 1 && !A.v.mt.ok); break;
    case 'acrobatics': bp = x2(!A.item && !MON[A.key].base); break;
    case 'payback': bp = x2(last && D.in !== st.turn); break;
  }
  return A.v.charge && MOVES[k][1] === 'electric' ? (bp ?? pw) * 2 : bp;
}
// A 打 D 用招式 k 的 damageCalc（crit 急所）；結果依會影響傷害的狀態快取（D 剩下的 HP 只看滿不滿：氣勢披帶、結實、多重鱗片）。
// D 那一方的牆、A 灼傷（特性毅力有異常狀態就照 damageCalc 的灼傷算，攻擊 ×1.5、不減半）、威力會變的招式（simVarBp）也算進去；
// 雙方照場上現在的屬性（simTypes）與能力值用的型態（simFk），A 的變幻自如這次上場發動過了就不再每招本系；D 沒有道具時拍落不加成（noItem）；
// 看場上狀況的特性：猛火類（PINCH_AB）看 A 剩下的 HP、大將看 A.v.fallen（見 simSwitch）；畫皮不在這裡算（見 simMove）；
// last＝D 這回合已經出過招（特性分析 ×1.3；同對焦鏡，算期望值時不知道順序不給）
function simCalc(ctx, st, A, D, k, crit, last = false) {
  const dSide = st.sd[+D.id[0]], bp = simVarBp(st, A, D, k, last);
  // 電光束蓄力時已經特攻 +1，damageCalc 又會在出招前 +1，所以先扣回來
  const spa = A.st.spa - (CHARGE_SPA.has(k) ? 1 : 0), full = D.hp >= D.max;
  const burn = A.status === 'brn' || (A.b.ab === 'guts' && !!A.status), walls = Object.keys(dSide.scr);
  const pinch = !!PINCH_AB[A.b.ab] && A.hp <= A.max / 3, fallen = A.v.fallen || 0;
  const ak = simFk(A), dk = simFk(D), aTy = simTypes(A), dTy = simTypes(D), pt = !!A.v.pt;
  // 撲擊看自己的防禦變化、欺詐看對手的攻擊變化，都要進快取的鍵
  // 天氣、場地（simWx、simTer）照 damageCalc 算：晴雨強化減弱、沙暴岩石特防、下雪冰防禦、氣象球、場地強化與減弱、精神場地擋先制、鐵滾輪沒場地失敗…
  const wx = simWx(st), ter = simTer(st);
  const key = [A.id, ak, aTy.join('.'), pt, A.item, A.st.atk, spa, A.st.def, burn, D.id, dk, dTy.join('.'), D.item, D.st.def, D.st.spd, D.st.atk, full,
    walls.join('.'), k, crit, bp, pinch, fallen, last, wx, ter].join('|');
  let r = ctx.memo.get(key);
  if (!r) {
    const a = A.b, d = D.b;
    r = damageCalc({ key: ak, types: aTy, ptUsed: pt, inv: a.atkInv, sp: a.sp, nat: a.nat, st: { atk: A.st.atk, spa, def: A.st.def }, item: A.item, ab: a.ab, pinch, fallen },
      { key: dk, types: dTy, hp: d.hp, inv: d.defInv, sp: d.sp, nat: d.nat, st: { def: D.st.def, spd: D.st.spd, atk: D.st.atk }, item: D.item, noItem: !D.item, ab: d.ab,
        cur: full ? undefined : D.hp, atkInv: d.atkInv },
      k, { fmt: ctx.fmt, weather: wx, crit, terrain: ter, hh: false, walls, burn, bp, last });
    r = r.skip || !r.eff ? { eff: 0 } : { eff: r.eff, type: r.type, crit: r.crit, rolls: r.rolls, endured: r.endured, berry: r.berry };
    ctx.memo.set(key, r);
  }
  return r;
}
// 固定傷害、反擊類這一下的結果（同 simCalc 的格式：eff 有沒有效果、rolls／later 16 個一樣的傷害、endured 氣勢披帶或結實撐住；fixed 標記）。
// 反擊類用 D 這回合打 A 的傷害（A.v.got，見 simMove）；exp＝估期望值（往前算用）：還沒被打，就用 D 對 A 同類招式裡最痛一招的期望傷害、A 撐得住才算；
// 失敗（反擊類沒被打到、蠻幹對手 HP 沒比較多）的 eff 是 0，fail 寫原因。一擊必殺（SIM_OHKO）多回傳 acc 命中率：exp 時傷害是剩下的 HP × 命中率，
// 不然是剩下的 HP（中不中由 simMove 照亂數抽）
function simFixed(ctx, st, A, D, k, exp) {
  const ty = MOVES[k][1], rc = SIM_REACT[k];
  if (!eff(ty, simTypes(D))) return { eff: 0 };
  let d, acc = 0;
  if (SIM_OHKO.has(k)) {
    if ((D.b.ab === 'sturdy' && A.b.ab !== 'mold-breaker') || (k === 'sheer-cold' && simTypes(D).includes('ice'))) return { eff: 0 };
    acc = A.b.ab === 'no-guard' || D.b.ab === 'no-guard' ? 100 : k === 'sheer-cold' && !simTypes(A).includes('ice') ? 20 : MOVES[k][6] ?? 30;
    d = exp ? Math.max(1, Math.floor(D.hp * acc / 100)) : D.hp;
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
// 這一招打 D 的計算：固定傷害、反擊類、一擊必殺用 simFixed，其他用 simCalc
const simHit = (ctx, st, A, D, k, crit, exp, last) => SIM_FIXED[k] || SIM_REACT[k] || SIM_OHKO.has(k) ? simFixed(ctx, st, A, D, k, exp) : simCalc(ctx, st, A, D, k, crit, last);
// 打中時的期望傷害（各下的 16 個亂數取平均加總；每下判定命中的招式第二下起乘上命中的機率；氣勢披帶、結實撐住時最多打到剩 1；
// 畫皮還在時第一下改算揭穿的 1/8）；輔助招是 0
function simExpHit(ctx, st, A, D, k) {
  if (SIM_SUP[k]) return 0;
  const disg = simDisguised(D, A);
  if (k === SIM_STRUGGLE) return disg ? D.max / 8 : simStruggleDmg(st, A, D, null);
  const r = simHit(ctx, st, A, D, k, false, true);
  if (!r.eff) return 0;
  const pm = SIM_MULTIACC.has(k) && A.b.ab !== 'skill-link' ? simAcc(st, A, D, k, false) / 100 : 1;
  const e = r.rolls.reduce((t, xs, h) => t + (h || !disg ? pm ** h * xs.reduce((a, x) => a + x, 0) / 16 : D.max / 8), 0);
  return r.endured && D.hp >= D.max ? Math.min(e, D.hp - 1) : e;
}
// 期望傷害＝打中時的期望傷害 × 命中率（simAcc；這裡不知道出招順序，對焦鏡不算）
const simExp = (ctx, st, A, D, k) => simExpHit(ctx, st, A, D, k) * simAcc(st, A, D, k, false) / 100;
// 速度（speedOf：能力變化、天氣場地加速特性、講究圍巾、麻痺；不含順風）；simSpeed 是有快取的
const simSpe = (st, M) => speedOf({ key: simFk(M), inv: M.b.speInv, sp: M.b.sp, nat: M.b.nat, st: M.st.spe, item: M.item, ab: M.b.ab, tw: false,
  par: M.status === 'par', status: !!M.status }, { weather: simWx(st), terrain: simTer(st) }).v;
function simSpeed(ctx, st, M) {
  const key = [M.id, simFk(M), M.item, M.st.spe, M.status, simWx(st), simTer(st)].join('|');
  if (!ctx.spd.has(key)) ctx.spd.set(key, simSpe(st, M));
  return ctx.spd.get(key);
}
// 出場特性、回合結束的天氣效果照速度快的先（Showdown runSwitch／eachEvent 的 speedSort）：回傳 [先的一方, 後的一方]，同速當我方先
const simOrder = st => simSpe(st, simAct(st, 1)) > simSpe(st, simAct(st, 0)) ? [1, 0] : [0, 1];
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
// 畫皮（Showdown disguise）：謎擬Ｑ還沒被揭穿（bust）時，攻擊招式（含掙扎、預知未來、混亂打到自己）的這一下沒有傷害，揭穿後扣最大 HP 的 1/8；
// 揭穿了就一直是揭穿的樣子（換下場也不會恢復）。攻擊方 A 的特性破格無視；變身來的不算
const simDisguised = (T, A) => T.key === 'mimikyu' && T.b.ab === 'disguise' && !T.bust && !T.tf && A?.b.ab !== 'mold-breaker';
// 畫皮還在、只因為攻擊方 A 破格才沒擋：紀錄寫出來（接在傷害後面），免得看起來像沒算
const simMbNote = (T, A) => simDisguised(T, null) && !simDisguised(T, A) ? `，${abilZh(A.b.ab)}無視${abilZh('disguise')}` : '';
// said＝攻擊那行已經寫了擋下第一下（連續攻擊招式）
function simBust(st, s, T, said) {
  T.bust = true;
  if (!said) simLog(st, `${simName(st, s, T)}的${abilZh('disguise')}擋下了這一下`);
  simHurt(st, s, T, T.max / 8, `的${abilZh('disguise')}被揭穿了`);
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
// M 會不會陷入異常狀態 x（屬性、特性免疫；src＝造成的寶可夢，特性腐蝕能讓毒、鋼屬性中毒）。
// 天氣場地（Showdown）：晴天不會冰凍（sunnyday onImmunity frz）、晴天時特性葉片防守不會陷入異常（leafguard）；
// 在地面上（沒在蓄力躲起來）時電氣場地不會睡著、薄霧場地不會陷入任何異常（electricterrain／mistyterrain onSetStatus）
function simCanStatus(st, M, x, src) {
  const ty = simTypes(M), ab = M.b.ab, wx = simWx(st), ter = simTer(st), gr = simGround(M) && !M.hide;
  if (M.hp <= 0 || M.status || ab === 'purifying-salt') return false;
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
  if (M.item === 'lum-berry' || (x === 'slp' && M.item === 'chesto-berry')) {
    simLog(st, `${simName(st, s, M)}吃了${ITEMS[M.item][0]}，治好了`);
    Object.assign(M, { status: '', item: '' });
  } else if (M.b.ab === 'synchronize' && src && src.hp > 0 && x !== 'slp' && x !== 'frz') simStatus(st, 1 - s, src, x, rnd, M);
  return true;
}
// 換上第 i 隻：換下來的（還站著的）特性再生力回 1/3、自然回復治好異常（冠軍版），能力變化與換下場就清掉的狀態都清掉、戰鬥切換變回原本的型態，
// 上一次用的招式也清掉（Showdown switchIn 對換下場的呼叫 clearVolatile，裡面 lastMove = null；所以換回來還沒出招時再來一次會失敗）；
// 換上來的：劇毒累積重算、治癒之願回滿，再踩撒菱類
// late＝出場特性（威嚇）先不發動，等雙方都換上來再一起發動（倒下後同時補位，見 simReplace）
function simSwitch(st, s, i, rnd, late = false) {
  const side = st.sd[s], O = side.mons[side.act];
  if (O.hp > 0 && O.b.ab === 'regenerator') simHeal(st, s, O, O.max / 3, '換下場時再生力');
  if (O.hp > 0 && O.b.ab === 'natural-cure') O.status = '';
  simUntransform(O);
  Object.assign(O, { st: SIM_ST0(), lock: '', chg: '', hide: false, rech: false, v: {}, last: '' });
  delete O.fk;
  side.act = i;
  const M = side.mons[i];
  Object.assign(M, { in: st.turn, out: true, tox: 0 });
  simLog(st, `${s ? '對手' : '我方'}換上${MON[M.key].zh}（HP ${simPct(M.hp, M.max)}%）`);
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
  if (!late) { simIntimidate(st, s, M); simEntryField(st, s, M); simImposter(st, s, M); }
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
  if (x.tgt && (T.hp <= 0 || tb === 'good-as-gold' || (T.v.sub && !x.sub) || (M.b.ab === 'prankster' && simTypes(T).includes('dark')) || simPsyBlock(st, M, T, k))) return true;
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
    case 'defog': return bare && !Object.keys(tSide.scr).length;
    case 'encore': return !T.last || !!T.v.enc || T.last === 'encore' || !T.moves.includes(T.last) || !(T.pp[T.last] > 0);
    case 'taunt': return !!T.v.taunt || tb === 'oblivious';
    case 'subst': return !!M.v.sub || M.hp <= M.max / 4;
    // 極光幕要下雪（Showdown auroraveil onTry：field.isWeather snowscape）
    case 'screen': return !!side.scr[k] || (k === 'aurora-veil' && simWx(st) !== 'snow');
    case 'field': return (x.w in SIM_WX_ROCK ? st.wx : st.ter)?.t === x.w && !(x.pivot && simBench(st, s).length);
    case 'phaze': return !simBench(st, 1 - s).length;
    case 'haze': return [M, T].every(P => Object.values(P.st).every(v => !v));
    case 'debuff': return capped(T, x.d) || tb === 'clear-body';
    case 'shot': return capped(T, x.d) && !simBench(st, s).length;
    case 'transform': return !!M.tf || !!T.tf;
    default: return false;
  }
}
// 一方這回合能做的：招式（再來一次鎖住的那招；講究圍巾鎖住的那招（圍巾被拍落就解除，Showdown choicelock）；PP 用完的、被挑釁時的輔助招、被定身的招式不能選；
// 擊掌奇襲、迎頭一擊要上場後第一回合；一定失敗的輔助招不列，見 simFutile）、換人（後排還站著的；背水一戰、被對手的踩影困住不能換）。
// 能選的招式（有 PP、沒被挑釁擋）一招都沒有時只能掙扎（或換人）；要休息的、蓄力中的只能照做、不能換人；
// 招式都會失敗又不能換人時是 none（什麼都不做）。
// 連續 SIM_IDLE 回合雙方都沒扣血也沒換人時，打不到對手場上那隻的攻擊招式不能選（不然雙方都出無效招式會原地空轉）；只剩這種招式又不能換人就照舊
const SIM_IDLE = 2;
function simOpts(ctx, st, s) {
  const M = simAct(st, s), T = simAct(st, 1 - s);
  if (M.rech) return [{ t: 'rech' }];
  if (M.chg) return [{ t: 'mv', k: M.chg }];
  const ks = M.v.enc && M.moves.includes(M.v.encK) && M.pp[M.v.encK] > 0 ? [M.v.encK] : M.lock && M.item === 'choice-scarf' && M.moves.includes(M.lock) ? [M.lock] : M.moves;
  const can = ks.filter(k => M.pp[k] > 0 && !(M.v.taunt && SIM_SUP[k]) && M.v.dis?.k !== k);
  let mv = !can.length ? [{ t: 'mv', k: SIM_STRUGGLE }]
    : can.filter(k => (!SIM_FIRST.has(k) || M.in === st.turn) && !simFutile(st, s, k)).map(k => ({ t: 'mv', k }));
  // 不能換人：背水一戰；對手場上那隻特性踩影（Showdown shadowtag：自己也是踩影、幽靈屬性不受影響；打完換人、被吹走照樣換）
  const tagged = T.hp > 0 && T.b.ab === 'shadow-tag' && M.b.ab !== 'shadow-tag' && !simTypes(M).includes('ghost');
  const sw = M.v.trap || tagged ? [] : simBench(st, s).map(i => ({ t: 'sw', i }));
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
  if (x.f && T.v.prot && T.v.prot !== 'kings') { bad(); return say(`，被${tn}擋下`); }
  if (x.r && !bounced && T.b.ab === 'magic-bounce') { say(`，被${tn}的魔法鏡反彈`); return simSupport(st, 1 - s, k, null, false, rnd, pick, true); }
  if (x.tgt && T.b.ab === 'good-as-gold') return fail(`${tn}的黃金之軀`);
  if (x.tgt && !bounced && M.b.ab === 'prankster' && simTypes(T).includes('dark')) return fail('惡屬性不受惡作劇之心的招式影響');
  if (x.tgt && T.v.sub && !x.sub) return fail(`${tn}有替身`);
  // 命中率（simAcc；打自己、撒在場上的輔助招是必中）：照亂數抽，期望值模式當命中
  const acc = simAcc(st, M, T, k, !oWill);
  if (acc < 100 && rnd && rnd() * 100 >= acc) { bad(); return say(`，但沒有命中（命中率 ${acc}%）`); }
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
    case 'heal': {
      if (M.hp >= M.max) return fail('HP 已經全滿');
      say('');
      // 光合作用、晨光、月光照天氣（SIM_SUNHEAL；this.modify 取整同 pokeRound），其他一半
      const f = SIM_SUNHEAL.has(k) && (SIM_SUNHEAL_F[simWx(st)] || 0.5);
      simHeal(st, s, M, f ? pokeRound(M.max * Math.floor(f * 4096) / 4096) : Math.round(M.max / 2), '回復');
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
      if (!simCanStatus(st, T, 'slp', M) || T.v.yawn) return fail('沒有效果');
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
    case 'transform':
      if (M.tf || T.tf) return fail(M.tf ? '已經變身了' : `${tn}是變身來的`);
      say('');
      simTransform(st, s, M, T);
      return;
    case 'field': {
      const n = simSetField(st, M, x.w), out = x.pivot && M.hp > 0 && simBench(st, s).length && !simOver(st);
      if (!n && !out) return fail(`已經是${FIELD_ZH[x.w]}`);
      say(n ? `：變成${FIELD_ZH[x.w]}（${n} 回合）` : `：已經是${FIELD_ZH[x.w]}`);
      if (out) simSwitch(st, s, pick(st, s), rnd);
      return;
    }
  }
}
// s 這方的 M 用攻擊招式 k 打中 T 之後的追加效果（SIM_SEC；Showdown battle-actions.ts secondaries）：照機率抽（期望值模式只算機率 100% 的）；
// 特性強行沒有追加效果（FLAG.secondary 的招式）；道具王者之證讓沒有畏縮效果的攻擊招式多 10% 畏縮（Showdown kingsrock，加在強行拿掉之後，所以強行也有）。
// 對手那邊的：打在替身上（subbed）、對手倒下了不算；畏縮要對手這回合還沒行動（oWill），特性精神力不會畏縮、我行我素不會混亂；
// 異常狀態照 simStatus（已經有異常、屬性特性免疫的不會）、能力變化照 simBoost（恆淨之軀等擋得住）
function simSecondary(st, s, M, T, k, oWill, rnd, subbed) {
  const list = M.b.ab === 'sheer-force' && FLAG.secondary.has(k) ? [] : SIM_SEC[k] || [];
  const all = M.item === 'kings-rock' && !list.some(x => x.fl) ? [...list, { c: 10, fl: 1 }] : list;
  for (const x of all) {
    if (rnd ? rnd() * 100 >= x.c : x.c < 100) continue;
    if (x.me) { if (M.hp > 0) simBoost(st, s, M, x.me); continue; }
    if (subbed || T.hp <= 0) continue;
    if (x.s) simStatus(st, 1 - s, T, Array.isArray(x.s) ? x.s[Math.floor(rnd() * x.s.length)] : x.s, rnd, M);
    else if (x.fl) { if (oWill && T.b.ab !== 'inner-focus') T.v.flinch = true; }
    else if (x.cf) {
      // 薄霧場地：在地面上的不會混亂（mistyterrain onTryAddVolatile）
      if (T.v.conf || T.b.ab === 'own-tempo' || (simTer(st) === 'misty' && simGround(T) && !T.hide)) continue;
      // 混亂 2～5 次出招機會（Showdown random(2, 6)；期望值模式不會打到自己，次數取 3）
      T.v.conf = rnd ? 2 + Math.floor(rnd() * 4) : 3;
      simLog(st, `${simName(st, 1 - s)}混亂了`);
    } else if (x.d) simBoost(st, 1 - s, T, x.d, s);
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
    const disg = simDisguised(T, M);
    let d = disg ? 0 : simStruggleDmg(st, M, T, rnd), held = '';
    if (d >= T.hp && T.hp >= T.max && (T.item === 'focus-sash' || T.b.ab === 'sturdy')) { d = T.hp - 1; held = T.item === 'focus-sash' ? ITEMS[T.item][0] : abilZh('sturdy'); if (T.item === 'focus-sash') T.item = ''; }
    else if (T.v.endure && d >= T.hp) { d = T.hp - 1; held = '挺住'; }
    const dd = Math.min(d, T.hp);
    T.hp -= dd;
    simFaint(st, T);
    T.hits = (T.hits || 0) + 1;
    if (dd > 0) T.v.got = { turn: st.turn, cat: 'physical', dmg: dd };
    const pop = T.item === 'air-balloon' && d > 0;
    if (pop) T.item = '';
    simLog(st, `${me}用掙扎 → ${tn} −${simPct(d, T.max)}%（剩 ${simPct(T.hp, T.max)}%）${simMbNote(T, M)}${held ? `，靠${held}撐住` : ''}${pop ? '，氣球破了' : ''}${T.hp <= 0 ? `，${tn}倒下` : ''}`);
    if (disg) simBust(st, 1 - s, T);
    if (T.hp <= 0) M.kos++;
    if (T.item === 'rocky-helmet') simHurt(st, s, M, M.max / 6, '被凸凸頭盔刺傷');
    if (T.b.ab === 'rough-skin') simHurt(st, s, M, M.max / 8, '被粗糙皮膚刺傷');
    simSitrus(st, 1 - s, T);
  }
  simHurt(st, s, M, Math.round(M.max / 4), '受到掙扎的反作用力', false);
}
// 變幻自如、自由者（Showdown protean／libero onPrepareHit）：每次上場第一次出招前變成那招的屬性（輔助招也算；預知未來、掙扎不算；
// 已經只有這個屬性的不變、也不算發動過），換下場就恢復（v 清掉）。只有這兩個特性會用到的氣象球、大地波動照場上的天氣場地變屬性
function simProtean(st, s, M, k) {
  if (!['protean', 'libero'].includes(M.b.ab) || M.v.pt || k === 'future-sight' || k === SIM_STRUGGLE) return;
  const wx = simWx(st), ter = simTer(st);
  const ty = k === 'weather-ball' && wx ? WB_TYPE[wx] : k === 'terrain-pulse' && ter && simGround(M) ? TERRAIN_TYPE[ter] : MOVES[k][1];
  if (simTypes(M).join() === ty) return;
  Object.assign(M.v, { types: [ty], pt: true });
  simLog(st, `${simName(st, s, M)}的${abilZh(M.b.ab)}：變成${T[ty].zh}屬性`);
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
function simMove(ctx, st, s, k, oa, oWill, rnd, pick) {
  const M = simAct(st, s), me = simName(st, s), mz = simMoveZh(k);
  if (M.status === 'slp') {
    M.slp -= M.b.ab === 'early-bird' ? 2 : 1;
    if (M.slp > 0) return simLog(st, `${me}睡著了`);
    M.status = '';
    simLog(st, `${me}醒來了`);
  }
  // 冰凍（冠軍版 mods/champions/conditions.ts）：每次要出招先扣次數，每次 1/4 融化、第 3 次一定融化；用 SIM_DEFROST 的招式會自己融化
  if (M.status === 'frz') {
    if (SIM_DEFROST.has(k) && !(k === 'burn-up' && !simTypes(M).includes('fire'))) { M.status = ''; simLog(st, `${me}用${mz}融化了冰`); }
    else if (--M.frz <= 0 || (rnd && rnd() < 1 / 4)) { M.status = ''; simLog(st, `${me}的冰融化了`); }
    else return simLog(st, `${me}結冰了，不能動`);
  }
  // 畏縮（Showdown flinch）：這回合先被打中畏縮的不能動；特性不屈之心速度 +1
  if (M.v.flinch) {
    simLog(st, `${me}畏縮了，不能動`);
    if (M.b.ab === 'steadfast') simBoost(st, s, M, { spe: 1 });
    return;
  }
  // 混亂（Showdown confusion）：每次要出招先扣次數，扣完就解除；沒解除時 1/3 打到自己（simConfDmg）
  if (M.v.conf) {
    if (!--M.v.conf) { delete M.v.conf; simLog(st, `${me}的混亂解除了`); }
    else if (rnd && rnd() < 1 / 3) {
      if (simDisguised(M, null)) { simLog(st, `${me}混亂中打到自己`); simBust(st, s, M); }
      else simHurt(st, s, M, simConfDmg(M, rnd), '混亂中打到自己', false);
      return;
    }
  }
  // 麻痺：冠軍版 1/8 不能動（mods/champions/conditions.ts）
  if (M.status === 'par' && rnd && rnd() < 1 / 8) return simLog(st, `${me}麻痺了，不能動`);
  if (M.v.taunt && SIM_SUP[k]) return simLog(st, `${me}被挑釁，不能用${mz}`);
  if (M.v.dis?.k === k) return simLog(st, `${me}的${mz}被定身了，不能用`);
  const T = simAct(st, 1 - s), tn = simName(st, 1 - s);
  M.last = k;
  // 這回合出的招：失敗、被擋下、沒命中、沒有效果時改成 ok false（豁出去、跺腳看上一回合的，見 simVarBp）
  M.v.mt = { t: st.turn, ok: true };
  simStance(st, s, M, k);
  if (k === SIM_STRUGGLE) return simStruggle(st, s, M, T, rnd);
  // PP：出招就扣 1（失敗也扣；睡著、麻痺不能動、被挑釁擋下的不扣；蓄力招第二回合不扣）；對手特性壓迫感、而且這招是打對手的（攻擊招式、
  // 打對手的輔助招、撒菱類）多扣 1（Showdown deductPP、pressure onDeductPP）
  if (M.chg !== k) {
    const foe = !SIM_SUP[k] || SIM_SUP[k].tgt || ['hazard', 'defog'].includes(SIM_SUP[k].kind);
    M.pp[k] = Math.max(0, M.pp[k] - 1 - (foe && T.hp > 0 && T.b.ab === 'pressure' ? 1 : 0));
  }
  if (M.item === 'choice-scarf' && !M.lock) M.lock = k;
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
  if (SIM_CHARGE.has(k) && M.chg !== k) { simLog(st, `${FIELD_ZH[simWx(st)]}，${mz}不用蓄力`); if (k === 'electro-shot') simBoost(st, s, M, { spa: 1 }); }
  Object.assign(M, { chg: '', hide: false });
  const fail = why => { M.v.mt.ok = false; simLog(st, `${me}用${mz}，但失敗了（${why}）`); };
  if (k === 'sucker-punch' && (!oWill || simCat(oa.k) === 'status')) return fail('對手沒有要出攻擊招式');
  if (k === 'upper-hand' && (!oWill || simCat(oa.k) === 'status' || simPri(st, T, oa.k) <= 0)) return fail('對手沒有要出先制招式');
  if (k === 'future-sight') {
    if (st.fut.some(f => f.s === 1 - s)) return fail('已經在預知未來');
    st.fut.push({ s: 1 - s, t: 3, src: simCloneMon(M) });
    simLog(st, `${me}用${mz}：兩回合後打中`);
    return;
  }
  // 變幻自如在出招前（PrepareHit：突襲這類 onTry 失敗的不會發動；被守住、沒命中、沒有效果都照樣發動）
  if (T.hp > 0) simProtean(st, s, M, k);
  // 自爆類：先倒下才打（Showdown selfdestruct always 在出招前 faint），同時全倒時算對手最後倒下
  if (SIM_BOOM.has(k)) { M.hp = 0; simFaint(st, M); }
  const contact = FLAG.contact.has(k) && M.b.ab !== 'long-reach';
  // 沒打中（打不到、被守住、沒有效果、沒命中）：記成出招失敗，SIM_CRASH 的招式扣撞擊傷害
  const crash = () => { M.v.mt.ok = false; if (SIM_CRASH.has(k)) simHurt(st, s, M, M.max / 2, '沒打中，摔傷自己'); };
  let dealt = -1;
  if (T.hp <= 0) fail('沒有目標');
  // 蓄力中躲起來的打不到（雙方任一隻特性無防守就打得到）
  else if (T.hide && M.b.ab !== 'no-guard' && T.b.ab !== 'no-guard') { simLog(st, `${me}用${mz}，但打不到（${tn}${T.chg === 'dig' ? '在地底' : '消失了'}）`); crash(); }
  else if (T.v.prot && k !== 'phantom-force' && k !== 'feint') {
    simLog(st, `${me}用${mz}，被${tn}擋下`);
    if (contact) simProtHit(st, s, M, T, rnd);
    crash();
  } else {
    if (T.v.prot) { delete T.v.prot; simLog(st, `${me}的${mz}打破了守住`); }
    // 一擊必殺：期望值模式（沒有 rnd）直接算期望傷害；照亂數打時先抽中不中
    let r = simHit(ctx, st, M, T, k, false, !rnd && SIM_OHKO.has(k), !oWill);
    // 命中率：一擊必殺用 simFixed 的，其他看 simAcc（對手這回合已經行動過時對焦鏡有作用）
    const acc = SIM_OHKO.has(k) ? r.acc : simAcc(st, M, T, k, !oWill);
    if (!r.eff) { r.fail ? fail(r.fail) : simLog(st, `${me}用${mz}，對${tn}沒有效果`); crash(); }
    else if (acc < 100 && rnd && rnd() * 100 >= acc) { simLog(st, `${me}用${mz}，沒有命中（命中率 ${acc}%）`); crash(); }
    else {
      const rank = SIM_HICRIT.has(k) + (M.b.ab === 'super-luck') + (M.item === 'scope-lens') + (M.v.focus ? 2 : 0);
      if (!r.fixed && !r.crit && rnd && rnd() < SIM_CRIT_P[Math.min(3, rank)]) r = simCalc(ctx, st, M, T, k, true, !oWill);
      // 寶石：這招屬性的寶石打出去就用掉（只加成一次）
      const gem = DMG_ITEMS[M.item]?.gem && DMG_ITEMS[M.item].type === r.type ? M.item : '';
      // 替身：聲音招式、特性穿透打得穿；打在替身上的不會有接觸懲罰、拍落、強制換人
      const subbed = T.v.sub > 0 && !FLAG.sound.has(k) && M.b.ab !== 'infiltrator';
      // 畫皮（simDisguised）：第一下沒有傷害，打完揭穿（打在替身上的不算）
      const disg = !subbed && simDisguised(T, M);
      // 各下的傷害加總：每下判定命中的招式（SIM_MULTIACC）第二下起照命中率抽、沒中就停；
      // 期望值模式整招乘命中率（一擊必殺 simFixed 已經乘過）、第二下起再乘命中的機率。
      // nh＝實際打中幾下（期望值模式是各下命中機率的和）：對手被打倒就停（後面幾下不會打），接觸懲罰、詛咒之軀、憤怒之拳照這個算
      const pm = SIM_MULTIACC.has(k) && M.b.ab !== 'skill-link' ? acc / 100 : 1;
      let dmg = 0, held = '', w = rnd || SIM_OHKO.has(k) ? 1 : acc / 100, nh = 0;
      for (const [h, xs] of r.rolls.entries()) {
        if (h && pm < 1) { if (!rnd) w *= pm; else if (rnd() >= pm) break; }
        if (h || !disg) dmg += w * (rnd ? xs[Math.floor(rnd() * 16)] : xs.reduce((a, x) => a + x, 0) / 16);
        nh += w;
        if (!subbed && !T.v.endure && dmg >= T.hp) break;
      }
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
        // 連續攻擊招式被畫皮擋下第一下：扣的是後面幾下，寫在同一行（不然先看到扣血、下一行才擋下，像沒算）
        const said = disg && dealt > 0;
        simLog(st, `${me}用${mz}${r.crit ? '（急所）' : ''} → ${tn} −${simPct(dealt, T.max)}%（剩 ${simPct(T.hp, T.max)}%）`
          + (said ? `，第一下被${abilZh('disguise')}擋下` : simMbNote(T, M))
          + (held ? `，靠${held}撐住` : '') + (pop ? '，氣球破了' : '') + (T.hp <= 0 ? `，${tn}倒下` : ''));
        if (disg) simBust(st, 1 - s, T, said);
        if (T.hp <= 0) M.kos++;
        // 被攻擊打中就開天氣場地的特性（Showdown sandspit／seedsower onDamagingHit）：吐沙開沙暴、播種開青草場地（被打倒也發動）
        if (dealt > 0) simFieldAb(st, 1 - s, T, { 'sand-spit': 'sand', 'seed-sower': 'grassy' }[T.b.ab], true);
      }
      // 被打中幾下（憤怒之拳；Showdown timesAttacked += 打中的下數，打在替身上也算）
      T.hits = (T.hits || 0) + Math.round(nh);
      // 鐵滾輪打中（含打在替身上）就清掉場地（Showdown steelroller onHit／onAfterSubDamage；沒有場地時 damageCalc 已經當失敗）
      if (k === 'steel-roller' && st.ter) { simLog(st, `${FIELD_ZH[st.ter.t]}消失了`); st.ter = null; }
      if (gem) { M.item = ''; simLog(st, `${me}的${ITEMS[gem][0]}用掉了`); }
      // 搏命：打完自己倒下
      if (k === 'final-gambit' && M.hp > 0) { M.hp = 0; simFaint(st, M); simLog(st, `${me}倒下`); }
      // 吸血在扣血當下（Showdown spreadDamage），接觸懲罰在那之後
      const dr = SIM_DRAIN[k], rc = SIM_RECOIL[k];
      if (dr && dealt > 0) { const v = Math.max(1, Math.round(dealt * dr[0] / dr[1])); simHeal(st, s, M, M.item === 'big-root' ? pokeRound(v * 5324 / 4096) : v, '吸取'); }
      // 追加效果在吸血之後、接觸懲罰之前（Showdown spreadMoveHit 的 secondaries 在 DamagingHit 之前）
      simSecondary(st, s, M, T, k, oWill, rnd, subbed);
      // 冰凍的對手被火屬性攻擊招式、SIM_THAW 的招式打中就融化（Showdown frz onDamagingHit、thawsTarget）
      if (T.status === 'frz' && T.hp > 0 && !subbed && (SIM_THAW.has(k) || (r.type || MOVES[k][1]) === 'fire')) { T.status = ''; simLog(st, `${tn}的冰融化了`); }
      if (!subbed) {
        // 接觸懲罰：凸凸頭盔扣 1/6、粗糙皮膚扣 1/8，連續攻擊每打中一下扣一次（Showdown rockyhelmet／roughskin onDamagingHit，打倒也算）；
        // 期望值模式照打中幾下的期望（nh）合成一次扣
        const perHit = (v, why) => { if (!rnd) simHurt(st, s, M, v * nh, why); else for (let i = 0; i < nh; i++) simHurt(st, s, M, v, why); };
        if (contact && T.item === 'rocky-helmet') perHit(M.max / 6, '被凸凸頭盔刺傷');
        if (contact && T.b.ab === 'rough-skin') perHit(M.max / 8, '被粗糙皮膚刺傷');
        // 詛咒之軀（Showdown cursedbody onDamagingHit＋disable）：每打中一下 30% 讓這招被定身，到之後第 3 次回合結束才解除
        // （定身在出招當下先扣 1、每回合結束再扣 1，共 5）；已經被定身、這招沒 PP 了的不會；機率性的，期望值模式不算
        if (T.b.ab === 'cursed-body' && rnd && M.hp > 0) {
          for (let i = 0; i < nh && !M.v.dis && M.pp[k] > 0; i++) if (rnd() < 0.3) { M.v.dis = { k, n: 4 }; simLog(st, `${tn}的${abilZh('cursed-body')}：${me}的${mz}被定身了`); }
        }
        simSitrus(st, 1 - s, T);
      }
      if (M.item === 'shell-bell' && dealt > 0) simHeal(st, s, M, dealt / 8, '貝殼之鈴');
      if (rc && dealt > 0 && M.b.ab !== 'rock-head') simHurt(st, s, M, Math.max(1, Math.round(dealt * rc[0] / rc[1])), '受到反作用力');
      // 生命寶珠：每次攻擊扣最大 HP 的 1/10（Showdown lifeorb）
      if (M.item === 'life-orb' && dealt > 0) simHurt(st, s, M, M.max / 10, '生命寶珠');
      // 自己的能力變化；屬於追加效果的（FLAG.secondary，如流水旋舞）特性強行不會發動
      if (M.hp > 0 && SIM_SELF[k] && !(M.b.ab === 'sheer-force' && FLAG.secondary.has(k))) simBoost(st, s, M, SIM_SELF[k]);
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
// 回合結束（Showdown onResidualOrder 的順序）：天氣、預知未來、祈願、青草場地、濕潤之軀、蛻皮、吃剩的東西、寄生種子、中毒、灼傷、詛咒、
// 挑釁／再來一次／定身／哈欠倒數、牆倒數、場地倒數、加速；
// 守住類這回合沒用的連續計數歸零、畏縮清掉（只有這回合有效）。殘血傷害照 Showdown：灼傷 1/16、中毒 1/8、劇毒 n/16（換下場重算、最多 15/16）、寄生種子 1/8、詛咒 1/4，
// 特性魔法防守不受、毒療改成回 1/8
function simEnd(ctx, st, rnd) {
  // 天氣（Showdown onFieldResidualOrder 1，回合結束最先）：先扣回合數，扣到 0 就結束；還在、又有作用（simWx）時照速度快的先（eachEvent('Weather')）：
  // 沙暴扣最大 HP 1/16（岩石、地面、鋼屬性不受：typechart sandstorm 3；特性沙隱、撥沙、沙之力、防塵、魔法防守不受）；
  // 特性乾燥皮膚下雨回 1/8、晴天扣 1/8，太陽之力晴天扣 1/8，雨盤下雨回 1/16，冰凍之軀下雪回 1/16（abilities.ts onWeather）
  if (st.wx && !--st.wx.n) { simLog(st, `${FIELD_ZH[st.wx.t]}結束了`); st.wx = null; }
  const wx = simWx(st);
  if (wx) simOrder(st).forEach(s => {
    const M = simAct(st, s), ab = M.b.ab;
    if (M.hp <= 0 || simOver(st)) return;
    if (wx === 'sand' && !simTypes(M).some(t => ['rock', 'ground', 'steel'].includes(t)) && !['sand-veil', 'sand-rush', 'sand-force', 'overcoat'].includes(ab)) simHurt(st, s, M, M.max / 16, '受到沙暴的傷害');
    if ((ab === 'dry-skin' && wx === 'rain') || (ab === 'rain-dish' && wx === 'rain') || (ab === 'ice-body' && wx === 'snow')) simHeal(st, s, M, M.max / (ab === 'dry-skin' ? 8 : 16), `的${abilZh(ab)}`);
    if ((ab === 'dry-skin' || ab === 'solar-power') && wx === 'sun') simHurt(st, s, M, M.max / 8, `的${abilZh(ab)}`);
  });
  st.fut.forEach(f => {
    if (--f.t || simOver(st)) return;
    const T = simAct(st, f.s);
    if (T.hp <= 0) return;
    const r = simCalc(ctx, st, f.src, T, 'future-sight', false);
    if (!r.eff) return;
    if (simDisguised(T, f.src)) { simLog(st, `預知未來打中${simName(st, f.s)}`); simBust(st, f.s, T); return; }
    const d = Math.min(T.hp, r.rolls.reduce((t, xs) => t + (rnd ? xs[Math.floor(rnd() * 16)] : xs.reduce((a, x) => a + x, 0) / 16), 0));
    T.hp -= d;
    simFaint(st, T);
    simLog(st, `預知未來打中${simName(st, f.s)} −${simPct(d, T.max)}%（剩 ${simPct(T.hp, T.max)}%）${simMbNote(T, f.src)}${T.hp <= 0 ? '，倒下' : ''}`);
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
    if (M.v.dis && !--M.v.dis.n) { simLog(st, `${simName(st, s)}的${simMoveZh(M.v.dis.k)}不再被定身`); delete M.v.dis; }
    if (M.v.yawn && !--M.v.yawn) { delete M.v.yawn; simStatus(st, s, M, 'slp', rnd, null); }
  });
  st.sd.forEach(side => Object.keys(side.scr).forEach(w => { if (!--side.scr[w]) delete side.scr[w]; }));
  // 場地（onFieldResidualOrder 27：牆之後、加速之前）：扣回合數，扣到 0 就結束
  if (st.ter && !--st.ter.n) { simLog(st, `${FIELD_ZH[st.ter.t]}結束了`); st.ter = null; }
  // 加速（Showdown speedboost onResidual，在回合結束的最後）：這回合開始時已經在場上的（不是這回合才換上來的）速度 +1
  each((M, s) => { if (M.b.ab === 'speed-boost' && M.in < st.turn) simBoost(st, s, M, { spe: 1 }); });
  st.sd.forEach(side => side.mons.forEach(m => {
    delete m.v.prot; delete m.v.endure; delete m.v.flinch;
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
    const pri = mv.map(s => simPri(st, simAct(st, s), acts[s].k)), spd = mv.map(s => simSpeed(ctx, st, simAct(st, s)));
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
    const fast = simSpeed(ctx, st, imp ? { ...T, item: M.item, status: M.status } : M) > simSpeed(ctx, st, T);
    if (n1 < n2 || (n1 === n2 && fast && n1 < Infinity)) return 2 + Math.max(0, M.hp - dt * (fast ? n1 - 1 : n1)) / M.max;
    return Math.min(1, dm * (n2 === Infinity ? 9 : n2) / T.hp);
  };
  return bench.map(i => [i, score(i)]).sort((x, y) => y[1] - x[1])[0][0];
}
// 倒下的補位（兩方都倒時都換）：picks[s] 是 { t: 'sw', i } 或 { t: 'pass' }；雙方都換上來後才發動威嚇（兩邊同時補位時互相都吃得到）、
// 開天氣場地的特性（照速度快的先，慢的蓋掉，見 simOrder）
function simReplace(st, picks, rnd) {
  const sw = [0, 1].filter(s => picks[s].t === 'sw');
  sw.forEach(s => simSwitch(st, s, picks[s].i, rnd, true));
  sw.forEach(s => simIntimidate(st, s, simAct(st, s)));
  simOrder(st).filter(s => sw.includes(s)).forEach(s => simEntryField(st, s, simAct(st, s)));
  sw.forEach(s => simImposter(st, s, simAct(st, s)));
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
  // 先發雙方同時出場：各自的威嚇都打對方（同出戰選角的正面對打），開天氣場地的照速度快的先、慢的蓋掉（simOrder），變身者再變身
  intim.forEach(s => simIntimidate(st, s, simAct(st, s)));
  simOrder(st).forEach(s => simEntryField(st, s, simAct(st, s)));
  [0, 1].forEach(s => simImposter(st, s, simAct(st, s)));
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
    const ctx = simCtx(fmt), me = simMon(x.key, x.set, x.item, 0, fmt), op = simMon(yk, undefined, undefined, 1, fmt);
    if (left != null) Object.assign(me, { hp: Math.min(me.max, left), bust: true });
    const st = simStart([{ mons: [me] }, { mons: [op] }], false, left != null ? [0] : [0, 1]), pick = (c, s) => simGreedyPick(ctx, c, s);
    if (left != null) simAct(st, 1).in = -1;
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

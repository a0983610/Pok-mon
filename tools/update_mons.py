# 寶可夢名單（屬性、種族值、超級進化原型與超級進化後的特性）從 OP.GG 寶可夢冠軍圖鑑頁擷取，再逐隻抓詳細頁，取招式資料
# （中文名與效果、PP、命中率、先制、範圍、追加效果、連續攻擊次數、招式標記等）和每隻可學的招式與可能的特性（LEARN；沒人常用的招式／特性另存 LEARN_MOVES／LEARN_ABILS）；
# 道具、特性的中文名與效果從 OP.GG 的道具／特性清單頁擷取（詳細頁只附那一頁用到的）。
# 單打／雙打的使用率統計（常用招式、特性、道具，能力點數＋性格，隊友、剋星，排名）從 Pokémon Showdown 天梯的每月統計
# （Smogon stats 的 chaos JSON）擷取：單打用 6 選 3 的 Battle Stadium Singles（gen9championsbss…），雙打用 VGC（gen9championsvgc…，bo3 不算），
# 分數門檻 SD_CUTOFF，自動取兩種格式都有的最新一個月。Showdown 的超級進化（帶超級石的）有自己的統計，原型只算沒帶超級石的；
# 另外存每種超級進化佔全家族的比例（猜對手會不會超級進化用）。整個檔重寫到 index.html 旁邊的 mons-data.js。
# 種族值不太會變，另外寫到 index.html 旁邊的 base-stats.js（不帶日期，資料沒變就不會有 diff）；
# 體重（打草結、踢倒、重磅衝撞、高溫重壓用）OP.GG 沒有，從 Pokémon Showdown 的寶可夢資料（pokedex.json 的 weightkg）補，也寫在 base-stats.js
# （Showdown 的冠軍版 mod 沒有自己的 pokedex，沿用主資料的體重）。
# 寫完後列出這次新出現（舊的 mons-data.js 沒有）、網頁程式（js 資料夾）也還沒提到的招式與特性，提醒特殊效果要另外補程式。
# 用法：python tools/update_mons.py [--stats] [index.html 路徑，預設為 repo 根目錄的 index.html；只用來決定寫到哪個資料夾，不會改 index.html]
#   --stats：只重寫 base-stats.js（OP.GG 名單頁的種族值＋Showdown 的體重，幾秒），不抓詳細頁、不動 mons-data.js
# 詳細頁約 260 頁要逐頁抓，Showdown 雙打統計檔約 18 MB，跑一次約 3～5 分鐘。
import datetime
import json
import os
import re
import sys
import time
import urllib.request

OPGG = 'https://op.gg/zh-tw/pokemon-champions/'
URL = OPGG + 'pokedex'
DEX_URL = 'https://play.pokemonshowdown.com/data/pokedex.json'
SD_URL = 'https://www.smogon.com/stats/'
SD_CUTOFF = 1500  # Showdown 統計的分數門檻（檔案有 0／1500／1630／1760）
SD_FMTS = {'single': 'gen9championsbss', 'double': 'gen9championsvgc'}  # 統計檔名的開頭
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Accept-Language': 'zh-TW,zh;q=0.9',
}
TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
         'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy']
MIN_PCT = 5  # 使用率（四捨五入到整數）低於這個 % 的招式／特性／道具不收
LIST_N = 10  # 隊友／勝於／敗於名單只收前幾隻
SP_N = 6  # 能力點數配法、點數＋性格組合只收前幾種（使用率四捨五入到整數，0% 的不收；配法很分散，不設 MIN_PCT 門檻）
FMTS = ('single', 'double')
# Showdown 的性格英文名 → [↑能力索引, ↓能力索引]（1 攻擊、2 防禦、3 特攻、4 特防、5 速度，同網頁的 STAT_ZH；不加減的是 [0, 0]）；照 Showdown data/natures.ts
NATURES = {'Hardy': (0, 0), 'Docile': (0, 0), 'Serious': (0, 0), 'Bashful': (0, 0), 'Quirky': (0, 0),
           'Lonely': (1, 2), 'Brave': (1, 5), 'Adamant': (1, 3), 'Naughty': (1, 4),
           'Bold': (2, 1), 'Relaxed': (2, 5), 'Impish': (2, 3), 'Lax': (2, 4),
           'Modest': (3, 1), 'Mild': (3, 2), 'Quiet': (3, 5), 'Rash': (3, 4),
           'Calm': (4, 1), 'Gentle': (4, 2), 'Sassy': (4, 5), 'Careful': (4, 3),
           'Timid': (5, 1), 'Hasty': (5, 2), 'Jolly': (5, 3), 'Naive': (5, 4)}
CAT_ZH = {'physical': '物理', 'special': '特殊', 'status': '變化'}


def fetch(url=URL, rsc=False):
    # rsc：帶 RSC 標頭只回 Next.js 的資料串流（比整頁 HTML 小一半），內容和 payload() 解出來的相同
    req = urllib.request.Request(url, headers={**HEADERS, **({'RSC': '1'} if rsc else {})})
    for n in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read().decode('utf-8')
        except OSError:
            if n == 2:
                raise
            time.sleep(3)


def payload(html):
    # Next.js 把資料放在 self.__next_f.push([1,"..."]) 的字串常值裡
    parts = []
    for m in re.finditer(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', html, re.S):
        parts.append(json.loads(m.group(1)))
    return ''.join(parts)


def grab(txt, key, opener):
    i = txt.index('"%s":%s' % (key, opener)) + len(key) + 3
    depth, in_str, esc = 0, False, False
    for k in range(i, len(txt)):
        c = txt[k]
        if in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c in '[{':
            depth += 1
        elif c in ']}':
            depth -= 1
            if depth == 0:
                return json.loads(txt[i:k + 1])
    raise ValueError('找不到 ' + key)


def clean(s):
    # 遊戲內文字的換行在 OP.GG 變成空白，中文旁邊的空白都拿掉
    return re.sub(r'(?<=[^\x00-\x7f])\s+|\s+(?=[^\x00-\x7f])', '', (s or '').strip())


alnum = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())


def detail(key):
    # 一隻寶可夢詳細頁：全部招式的字典，以及這隻的資料（pokemon：可學招式 moves、禁用招式 bannedMoves、可能的特性 abilities 等；沒有的話是 {}）
    txt = fetch(URL + '/' + key, rsc=True)
    i = txt.index('"moves":[{"id":1,"key":"pound"')
    j = txt.find('"pokemon":{"id":')
    mon = grab(txt[j:], 'pokemon', '{') if j >= 0 else {}
    return grab(txt[i:], 'moves', '['), mon


def catalog(path, key):
    # OP.GG 的道具／特性清單頁（完整清單）：頁面裡第一個每筆都有 key、name 的 "<key>":[…] 陣列（其他同名陣列是網站選單）
    txt = fetch(OPGG + path, rsc=True)
    for m in re.finditer(r'"%s":\[\{' % key, txt):
        arr = grab(txt[m.start():], key, '[')
        if 'key' in arr[0] and 'name' in arr[0]:
            return arr
    raise ValueError('%s 頁找不到 %s 清單' % (path, key))


# OP.GG 招式的 meta／statChanges／moveTraits → 只留有值的欄位（見 mons-data.js 的 MOVES 說明）
def move_extra(m):
    meta, x = m.get('meta') or {}, {}
    if meta.get('ailment') not in (None, 'none'):
        x['ail'] = meta['ailment']
    for k, o in (('ailmentChance', 'ailP'), ('flinchChance', 'fl'), ('critRate', 'cr'), ('drain', 'dr'), ('healing', 'hl'), ('statChance', 'stP')):
        if meta.get(k):
            x[o] = meta[k]
    if meta.get('minHits') is not None or meta.get('maxHits') is not None:
        x['hits'] = [meta.get('minHits'), meta.get('maxHits')]
    if m.get('statChanges'):
        x['st'] = [[c['stat'], c['change']] for c in m['statChanges']]
    tr = [t for t in m.get('moveTraits') or [] if t != 'non-contact']
    if tr:
        x['tr'] = tr
    return x


# OP.GG 屬性和冠軍版不一樣的招式：捕獸夾冠軍版從草改成鋼（Bulbapedia、Showdown 冠軍版 mod、Smogon 冠軍版計算機），
# OP.GG 還是草（2026-11-17 使用者決定照冠軍版）
TYPE_FIX = {'snap-trap': 'steel'}


def move_row(m):
    # 招式一筆：[中文名, 屬性, 分類, 威力, 效果, PP, 命中率, 先制等級, 目標範圍, 其他（move_extra）]
    return [m['name'], TYPE_FIX.get(m['key'], m['type']), m['category'], m['power'], clean(m['effect'] or m['description']),
            m.get('pp'), m.get('accuracy'), m.get('priority') or 0, m.get('target'), move_extra(m)]


# OP.GG 的寶可夢 key → Showdown 的 id：地區型態的寫法不同（alolan→alola…）、超級進化在後面（mega-charizard-y→charizardmegay）、
# 母的寫 f（indeedee-female→indeedeef）、公的就是原型、羽色不寫 plumage（squawkabilly-blue-plumage→squawkabillyblue）；寫法對不起來的直接對照（DEX_FIX）
DEX_REGION = {'alolan': 'alola', 'galarian': 'galar', 'hisuian': 'hisui', 'paldean': 'paldea'}
DEX_FIX = {'floette-eternal-flower': 'floetteeternal', 'mega-meowstic': 'meowsticmmega',
           'maushold-family-of-four': 'mausholdfour', 'maushold-family-of-three': 'maushold'}


def dex_id(key):
    mega = key.startswith('mega-')
    parts = [DEX_REGION.get(p, p) for p in (key[5:] if mega else key).split('-') if p != 'plumage']
    if parts[-1] == 'male':
        parts = parts[:-1]
    elif parts[-1] == 'female':
        parts[-1] = 'f'
    if mega:
        return alnum(''.join(parts[:-1])) + 'mega' + parts[-1] if parts[-1] in ('x', 'y', 'z') else alnum(''.join(parts)) + 'mega'
    return alnum(''.join(parts))


_dex = None


def load_dex():
    # Showdown 的 pokedex.json（只抓一次）
    global _dex
    if _dex is None:
        req = urllib.request.Request(DEX_URL, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=60) as r:
            _dex = json.loads(r.read().decode('utf-8'))
    return _dex


def base_forme(key, dex):
    # Showdown 原型的 baseForme 就是 key 這個型態（如 toxtricity-amped＝Toxtricity、gourgeist-average、squawkabilly-green-plumage）時回傳原型 id
    parts = [p for p in key.split('-') if p != 'plumage']
    base = alnum(parts[0])
    return base if len(parts) > 1 and (dex.get(base, {}).get('baseForme') or '').lower() == parts[-1] else None


def weights(keys):
    # 寶可夢 key → 體重 kg（Showdown pokedex.json 的 weightkg）。依序試：DEX_FIX、dex_id、
    # Showdown 沒分開的（只差外觀的母的、Showdown 原型的 baseForme 就是這個型態，如 gourgeist-average、toxtricity-amped）用原型的；
    # 都對不上的不收（網頁上看體重的招式就不算），並印出來
    # 同時取性別：母的比例（gender 'N' 無性別記 -1、'M' 只有公 0、'F' 只有母 1，其他看 genderRatio 的 F，沒寫是 0.5；
    # 迷人之軀、鬥爭心用，Showdown 沒指定性別的隊伍照這個比例隨機給）
    dex = load_dex()
    out, fem, miss = {}, {}, []
    for key in keys:
        sid = dex_id(key)
        cands = [DEX_FIX.get(key), sid, sid[:-1] if key.split('-')[-1] == 'female' else None, base_forme(key, dex)]
        s = next((c for c in cands if c and dex.get(c, {}).get('weightkg')), None)
        if s:
            out[key] = dex[s]['weightkg']
            e = dex[s]
            g = e.get('gender')
            fem[key] = -1 if g == 'N' else 0 if g == 'M' else 1 if g == 'F' else (e.get('genderRatio') or {}).get('F', 0.5)
        else:
            miss.append(key)
    if miss:
        print('這些寶可夢在 Showdown 找不到體重（看體重的招式不算）：%r' % miss)
    return out, fem


def sd_keys(rows):
    # Showdown 統計的寶可夢名（alnum 後＝Showdown id）→ 我們的 key：依序試 DEX_FIX、dex_id、Showdown 原型的 baseForme 就是這個型態
    dex, out = load_dex(), {}
    for r in rows:
        for c in (DEX_FIX.get(r[0]), dex_id(r[0]), base_forme(r[0], dex)):
            if c:
                out.setdefault(c, r[0])
    return out


def sd_pick():
    # Showdown 統計：兩種格式都有 chaos JSON 的最新一個月 → (月份, {single／double: 檔名})。
    # 同開頭有好幾個（換規則的月份）取檔名排最後的（regmc < regmd、2026 < 2027），bo3 不算
    months = sorted(set(re.findall(r'href="(\d{4}-\d{2})/"', fetch(SD_URL))), reverse=True)
    for mo in months[:3]:
        files = re.findall(r'href="([a-z0-9]+-%d\.json)"' % SD_CUTOFF, fetch(SD_URL + mo + '/chaos/'))
        pick = {}
        for f, pre in SD_FMTS.items():
            c = sorted(x for x in files if x.startswith(pre) and 'bo3' not in x)
            if c:
                pick[f] = c[-1]
        if len(pick) == len(SD_FMTS):
            return mo, pick
    raise SystemExit('最近 3 個月的 Showdown 統計找不到 %r 開頭、分數 %d 的檔案' % (list(SD_FMTS.values()), SD_CUTOFF))


def sd_stats(data, sid, fam, mv_ids, ab_ids, it_ids, miss):
    # 一種格式的 chaos JSON（data：Showdown 寶可夢名 → 統計）→ 我們的 key → {usage 使用率（0～1）, moves／abils／items／spreads／natures／sets 字串,
    # mates／lose／win 家族 key 清單}。招式、特性、道具的使用率＝次數 ÷ 這隻的次數（特性次數加總）；對不上我們 key 的記在 miss
    out, raw = {}, {}
    for name, e in data.items():
        key = sid.get(alnum(name))
        if not key:
            miss['mon'][name] = max(miss['mon'].get(name, 0), e['usage'])
            continue
        tot = sum(e['Abilities'].values()) or 1

        def pick(d, ids, kind):
            # {Showdown id: 次數} → "key:使用率 key:使用率"（依使用率高到低，低於 MIN_PCT 的不收；對照不到的記下來）
            res = []
            for k, v in sorted(d.items(), key=lambda x: -x[1]):
                p = round(v / tot * 100)
                if p < MIN_PCT or not k or k == 'nothing':
                    continue
                if k in ids:
                    res.append('%s:%d' % (ids[k], p))
                else:
                    miss[kind].add(k)
            return ' '.join(res)

        sets, sps, nats = {}, {}, {}
        for s, v in e['Spreads'].items():
            nat, _, evs = s.partition(':')
            sp = tuple(int(x) for x in evs.split('/') if x.isdigit())
            if nat not in NATURES:
                miss['nature'].add(nat)
                continue
            if len(sp) != 6 or max(sp) > 32 or sum(sp) > 66:
                continue
            q, n = v / tot * 100, NATURES[nat]
            sets[sp + n] = sets.get(sp + n, 0) + q
            sps[sp] = sps.get(sp, 0) + q
            nats[n] = nats.get(n, 0) + q
        top = lambda d, n=None: [(k, round(q)) for k, q in sorted(d.items(), key=lambda x: -x[1]) if round(q) >= 1][:n]
        out[key] = {
            'usage': e['usage'], 'pct': '%.2f' % (e['usage'] * 100),
            'moves': pick(e['Moves'], mv_ids, 'move'), 'abils': pick(e['Abilities'], ab_ids, 'abil'), 'items': pick(e['Items'], it_ids, 'item'),
            'spreads': ' '.join('%s:%d' % ('.'.join(map(str, k)), p) for k, p in top(sps, SP_N)),
            'natures': ' '.join('%d.%d:%d' % (k[0], k[1], p) for k, p in top(nats)),
            'sets': ' '.join('%s:%d' % ('.'.join(map(str, k)), p) for k, p in top(sets, SP_N)),
        }
        raw[key] = e
    # 隊友：同隊次數，依家族加總，% 是同隊率（同隊次數 ÷ 這隻的次數）；敗於（剋星）＝Checks and Counters：遇到時這隻被打倒或被逼換下的比例 p
    # 減 4 倍標準差 d（Smogon 排剋星用的分數）大於 0 的，依家族取最高分，% 是那筆的 p；勝於＝反過來，這隻出現在誰的剋星裡（% 是對方被打倒或逼換下的 p）。
    # 都不含自己家族，依次數／分數高到低取前 LIST_N 個家族，寫成「key:%」
    win = {}
    for key, e in raw.items():
        for name, c in e['Checks and Counters'].items():
            k = sid.get(alnum(name))
            sc = c['p'] - 4 * c['d']
            if k and sc > 0:
                w = win.setdefault(k, {})
                if sc > w.get(fam[key], (0, 0))[0]:
                    w[fam[key]] = (sc, c['p'] * 100)
    for key, e in raw.items():
        tot = sum(e['Abilities'].values()) or 1
        mates, lose = {}, {}
        for name, v in e['Teammates'].items():
            k = sid.get(alnum(name))
            if k and fam[k] != fam[key]:
                s = mates.get(fam[k], (0, 0))[0] + v
                mates[fam[k]] = (s, s / tot * 100)
        for name, c in e['Checks and Counters'].items():
            k = sid.get(alnum(name))
            sc = c['p'] - 4 * c['d']
            if k and sc > 0 and fam[k] != fam[key] and sc > lose.get(fam[k], (0, 0))[0]:
                lose[fam[k]] = (sc, c['p'] * 100)
        rank = lambda d: ' '.join('%s:%d' % (k, round(p)) for k, (_, p) in sorted(d.items(), key=lambda x: -x[1][0])[:LIST_N])
        out[key].update(mates=rank(mates), lose=rank(lose), win=rank({k: v for k, v in win.get(key, {}).items() if k != fam[key]}))
    return out


def stats_js(stats, wts, fem):
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
    return ('// 種族值：擷取自 OP.GG 寶可夢冠軍圖鑑（含超級進化）；這個檔由 tools/update_mons.py 產生，勿手改\n'
            '// 寶可夢 key → [HP, 攻擊, 防禦, 特攻, 特防, 速度]\n'
            'const BASE_STATS = {\n%s\n};\n'
            '// 體重 kg（打草結、踢倒、重磅衝撞、高溫重壓用）：OP.GG 沒有，取自 Pokémon Showdown 的 pokedex.json（weightkg）；找不到的不收\n'
            'const WEIGHT_KG = {\n%s\n};\n'
            '// 母的比例（迷人之軀、鬥爭心用；-1＝無性別）：OP.GG 沒有，取自 Pokémon Showdown 的 pokedex.json（gender／genderRatio）；找不到的不收\n'
            'const FEMALE = {\n%s\n};\n') % ('\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in stats.items()),
                                           '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in wts.items()),
                                           '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in fem.items()))


def section(txt, name):
    # mons-data.js 裡「const <name> = {」或「[」到「};」或「];」之間的各行
    m = re.search(r'^const %s = [\[{]\n(.*?)\n[\]}];' % name, txt, re.S | re.M)
    return m.group(1).split('\n') if m else []


def old_keys(txt):
    # 舊的 mons-data.js 收了哪些招式 key、特性 key（ABILS，加上超級進化名單的特性：沒有說明的不在 ABILS）
    txt = txt.replace('\r\n', '\n')
    keys = lambda name: {re.match(r'"([^"]+)":', l).group(1) for l in section(txt, name) if l.startswith('"')}
    megas = {a for l in section(txt, 'MONS_RAW') for r in [json.loads(l.rstrip(','))] if len(r) > 6 for a in r[6].split('.') if a}
    return keys('MOVES'), keys('ABILS') | megas


def js_words(folder):
    # 網頁程式（folder 底下的 .js）字串裡的詞（含空白分隔的招式清單）與物件 key（如 { levitate: 'ground' }）：
    # 招式／特性 key 出現在這裡＝程式已經有考慮它的效果。只看字串與物件 key，免得 key 剛好和變數名相同（如 endure）被當成提到過
    words = set()
    for root, _, files in os.walk(folder):
        for fn in files:
            if fn.endswith('.js'):
                with open(os.path.join(root, fn), encoding='utf-8') as f:
                    s = f.read()
                for lit in re.findall(r"'[^'\n]*'|\"[^\"\n]*\"|`[^`]*`", s):
                    words.update(re.findall(r'[a-z0-9]+(?:-[a-z0-9]+)*', lit))
                words.update(re.findall(r'[{,]\s*([a-z][a-z0-9]*)\s*:', s))
    return words


def remind(old_txt, js_dir, mv_out, ab_out, mega_a):
    # 印出這次新出現（舊的 mons-data.js 沒有）、網頁程式也還沒提到的招式與特性：網頁只會照威力、屬性、分類算，
    # 先制、範圍、連續攻擊、特性效果這類特殊效果要另外補程式。下次更新時它們就算舊的了，只會列這一次
    if old_txt is None:
        print('沒有舊的 mons-data.js 可以比，略過新招式／特性的提醒')
        return
    om, oa = old_keys(old_txt)
    known = js_words(js_dir)
    new_m = sorted(k for k in mv_out if k not in om and k not in known)
    new_a = sorted(k for k in set(ab_out) | {k for ks in mega_a.values() for k in ks} if k not in oa and k not in known)
    if not new_m and not new_a:
        print('沒有新出現、網頁程式還沒提到的招式／特性')
        return
    print('\n【提醒】新出現、網頁程式還沒提到的招式／特性 %d 種（只列這一次，下次更新就算舊的了）：\n'
          '  網頁只照威力、屬性、分類算；先制、範圍、連續攻擊、特性效果等特殊效果要另外補進 js 的清單' % (len(new_m) + len(new_a)))
    for k in new_m:
        zh, _, cat, power, eff = mv_out[k][:5]
        print('  招式 %s %s（%s%s）：%s' % (k, zh, CAT_ZH.get(cat, cat), '' if power is None else '、威力 %s' % power, eff))
    for k in new_a:
        zh, eff = ab_out.get(k, ('', '沒有說明'))
        print('  特性 %s%s：%s' % (k, ' ' + zh if zh else '', eff))


def write_stats(out, stats):
    # 重寫 base-stats.js（種族值＋體重）；換行沿用既有的檔（Windows 上 git 取出來是 CRLF），還不存在就用 LF
    p, s = os.path.join(out, 'base-stats.js'), stats_js(stats, *weights(list(stats)))
    if os.path.exists(p):
        with open(p, encoding='utf-8', newline='') as f:
            if f.readline().endswith('\r\n'):
                s = s.replace('\n', '\r\n')
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)
    return s


def main(path, only_stats=False):
    txt = payload(fetch())
    mons = grab(txt, 'pokemon', '[')
    rows, bad, stats = [], [], {}
    for p in mons:
        if not set(p['types']) <= set(TYPES):
            bad.append((p['key'], p['types']))
        base = p.get('base_key') or ''
        rows.append([p['key'], p['name'], '.'.join(p['types']), 0, 0, base] + (['.'.join(p.get('abilities') or [])] if base else []))
        st = p['stats']
        stats[p['key']] = [st['hp'], st['attack'], st['defense'], st['spAttack'], st['spDefense'], st['speed']]
    if bad:
        raise SystemExit('有不認得的屬性：%r' % bad)
    # 洗翠型態和原型同名，補上前綴（阿羅拉等其他地區型態 OP.GG 已自帶前綴）
    names = [r[1] for r in rows]
    for r in rows:
        if names.count(r[1]) > 1 and r[0].endswith('-hisui'):
            r[1] = '洗翠' + r[1]
    names = [r[1] for r in rows]
    dup = sorted({n for n in names if names.count(n) > 1})
    if dup:
        raise SystemExit('中文名重複：%r' % dup)
    out = os.path.dirname(os.path.abspath(path))
    if only_stats:
        s = write_stats(out, stats)
        print('只重寫 base-stats.js：種族值 %d 隻、體重 %d 隻' % (len(stats), s.count('\n', s.index('const WEIGHT_KG'), s.index('// 母的比例')) - 2))
        print(SIM_MATRIX_TIP)
        return

    # 招式字典與可學招式：逐頁抓非超級進化的寶可夢（超級進化沿用原型的可學招式）
    targets = [r[0] for r in rows if not r[5]]
    moves, learn, fail = {}, {}, []
    for n, key in enumerate(targets, 1):
        try:
            mv, mon = detail(key)
        except (ValueError, OSError) as e:
            fail.append((key, str(e)[:60]))
            continue
        moves = moves or {m['id']: m for m in mv}
        learn[key] = mon
        if n % 25 == 0 or n == len(targets):
            print('詳細頁 %d/%d' % (n, len(targets)), flush=True)
        time.sleep(0.3)
    if fail:
        print('這些詳細頁抓不到（沒有可學招式）：%r' % fail)
    abils = {a['key']: a for a in catalog('abilities', 'abilities')}
    items = {x['key']: x for x in catalog('items', 'items')}

    # Showdown 使用率統計
    month, files = sd_pick()
    print('Showdown %s：%s' % (month, '、'.join(files[f] for f in FMTS)), flush=True)
    sid = sd_keys(rows)
    fam = {r[0]: r[5] or r[0] for r in rows}
    mv_ids = {alnum(m['key']): m['key'] for m in moves.values()}
    ab_ids, it_ids = {alnum(k): k for k in abils}, {alnum(k): k for k in items}
    miss = {'mon': {}, 'move': set(), 'abil': set(), 'item': set(), 'nature': set()}
    sd, src = {}, {'month': month, 'cutoff': SD_CUTOFF}
    for f in FMTS:
        d = json.loads(fetch(SD_URL + month + '/chaos/' + files[f]))
        sd[f] = sd_stats(d['data'], sid, fam, mv_ids, ab_ids, it_ids, miss)
        src[f[0]] = [d['info']['metagame'], d['info']['number of battles']]
    for k, v in miss.items():
        if v:
            print('Showdown 統計裡對不上的%s（不收）：%r' % ({'mon': '寶可夢（使用率）', 'move': '招式', 'abil': '特性', 'item': '道具', 'nature': '性格'}[k],
                                               sorted(v.items(), key=lambda x: -x[1]) if k == 'mon' else sorted(v)))
    # 排名：家族（原型＋超級進化）使用率加總由高到低，同家族的型態同一個排名；沒有統計的是 0
    for i, f in enumerate(FMTS):
        tot = {}
        for k, x in sd[f].items():
            tot[fam[k]] = tot.get(fam[k], 0) + x['usage']
        rk = {k: n for n, k in enumerate(sorted(tot, key=lambda k: -tot[k]), 1)}
        for r in rows:
            r[3 + i] = rk.get(fam[r[0]], 0)
    # 每個 key 一列：招式／道具／點數／性格／組合是這個型態自己的（原型＝沒帶超級石的）；特性：超級進化放原型的常用特性
    # （出場時還沒超級進化；Showdown 超級進化那筆記的是超級進化後的固定特性，名單已經有）；
    # 隊友／勝於／敗於：超級進化看自己的，原型看家族裡使用率最高的型態（如噴火龍看超級噴火龍Ｙ）；超級進化比例只有原型有
    use = {}
    for r in rows:
        key, cols = r[0], {}
        for f in FMTS:
            forms = {k: x['usage'] for k, x in sd[f].items() if fam[k] == key}
            own, c = sd[f].get(key), {}
            if r[5]:
                if own:
                    c = {**own, 'abils': (sd[f].get(r[5]) or {}).get('abils', '')}
            elif forms:
                tot = sum(forms.values())
                dom = sd[f][max(forms, key=forms.get)]
                c = {**(own or {}), 'mates': dom['mates'], 'win': dom['win'], 'lose': dom['lose'],
                     'megas': ' '.join('%s:%d' % (k, round(u / tot * 100)) for k, u in sorted(forms.items(), key=lambda x: -x[1])
                                       if k != key and round(u / tot * 100) >= 1)}
            cols[f] = c
        row = [cols[f].get(k, '') for k in ('moves', 'abils', 'items', 'mates', 'win', 'lose', 'spreads', 'natures', 'sets', 'megas', 'pct') for f in FMTS]
        if any(row):
            use[key] = row
    # 超級進化的特性與超級石一定收（超級石：說明寫「超級進化的持有物」的道具，網頁 stoneOf 照說明找每種超級進化帶的那顆）
    mega_a = {r[0]: [a for a in r[6].split('.') if a] for r in rows if r[5]}
    pk = lambda cols: {s.split(':')[0] for u in use.values() for c in cols for s in u[c].split()}
    used_m, used_i = pk((0, 1)), pk((4, 5)) | {k for k, x in items.items() if '超級進化的持有物' in (x.get('effect') or '')}
    used_a = pk((2, 3)) | {k for ks in mega_a.values() for k in ks}
    mv_out = {m['key']: move_row(m) for m in moves.values() if m['key'] in used_m}
    ab_out = {k: [a['name'], clean(a['description'])] for k, a in abils.items() if k in used_a}
    it_out = {k: [x['name'], clean(x.get('effect') or x.get('description'))] for k, x in items.items() if k in used_i}
    # 可學招式（OP.GG 標為不可用、或這隻禁用的不收）與可能的特性；不在 MOVES／ABILS 的另外存 LEARN_MOVES／LEARN_ABILS，
    # 網頁現有功能只看 MOVES／ABILS，不受影響
    avail = {m['key'] for m in moves.values() if m.get('isAvailable', True)}
    learn_out = {}
    for key, mon in learn.items():
        banned = {b if isinstance(b, str) else b.get('key') for b in mon.get('bannedMoves') or []}
        ms = [k for k in mon.get('moves') or [] if k in avail and k not in banned]
        ab = list(mon.get('abilities') or [])
        if ms or ab:
            learn_out[key] = ' '.join(ms) + '|' + ' '.join(ab)
    learn_m = {k for v in learn_out.values() for k in v.split('|')[0].split()} - used_m
    learn_a = {k for v in learn_out.values() for k in v.split('|')[1].split()} - used_a
    lm_out = {m['key']: move_row(m) for m in moves.values() if m['key'] in learn_m}
    la_out = {k: [a['name'], clean(a['description'])] for k, a in abils.items() if k in learn_a}
    miss_a = sorted({k for ks in mega_a.values() for k in ks} - set(ab_out))
    if miss_a:
        print('找不到這些超級進化特性的說明，網頁上會略過：%r' % miss_a)

    today = datetime.date.today().isoformat()
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
    body = '\n'.join(dump(r) + ',' for r in rows)
    mons_js = ('// 寶可夢名單與常用招式：%s 擷取。名單、招式資料、可學招式取自 OP.GG 寶可夢冠軍圖鑑（含超級進化），道具與特性取自 OP.GG 的清單頁；\n'
               '// 使用率取自 Pokémon Showdown 天梯 %s 的統計（Smogon stats）。這個檔由 tools/update_mons.py 產生，勿手改\n'
               "const MONS_DATE = '%s';\n"
               '// 使用率統計的來源：month 月份、cutoff 分數門檻、s 單打／d 雙打：[Showdown 格式, 場數]\n'
               'const USAGE_SRC = %s;\n'
               '// [key, 中文名, 屬性（. 分隔）, 單打排名, 雙打排名（Showdown 家族使用率加總，同家族的型態同一個排名；0＝沒有統計）,\n'
               '//   超級進化的原型 key, 超級進化後的特性 key（. 分隔，只有超級進化有）]；種族值在 base-stats.js\n'
               'const MONS_RAW = [\n%s\n];\n'
               '// 常用統計：寶可夢 key → [單打招式, 雙打招式, 單打特性, 雙打特性, 單打道具, 雙打道具,\n'
               '//   單打隊友, 雙打隊友, 單打勝於, 雙打勝於, 單打敗於, 雙打敗於, 單打能力點數, 雙打能力點數, 單打性格, 雙打性格,\n'
               '//   單打點數＋性格, 雙打點數＋性格, 單打超級進化比例, 雙打超級進化比例, 單打使用率, 雙打使用率]。\n'
               '//   招式／道具／點數／性格是這個型態自己的（Showdown 的超級進化有自己的統計，原型只算沒帶超級石的）；\n'
               '//   特性：超級進化放原型的常用特性（出場時還沒超級進化；超級進化後的固定特性在 MONS_RAW）；\n'
               '//   招式／特性／道具每項是「key:使用率%%」以空白分隔、依使用率高到低，低於 %d%% 的不收；\n'
               '//   隊友／勝於／敗於每項是「家族（原型）key:%%」以空白分隔，不含自己家族，取前 %d 個：隊友依同隊次數（%% 是同隊率），\n'
               '//   敗於＝這隻的剋星（Checks and Counters：遇到時這隻被打倒或被逼換下的比例 p 減 4 倍標準差，大於 0 的依分數排，%% 是 p），\n'
               '//   勝於＝反過來這隻是誰的剋星（%% 是對方被打倒或逼換下的比例）；原型的這三項看家族裡使用率最高的型態；\n'
               '//   能力點數每項是「HP.攻擊.防禦.特攻.特防.速度:使用率%%」、點數＋性格每項是「HP.攻擊.防禦.特攻.特防.速度.↑能力.↓能力:使用率%%」，各取前 %d 種；\n'
               '//   性格每項是「↑能力.↓能力:使用率%%」（1 攻擊、2 防禦、3 特攻、4 特防、5 速度，不加減的寫 0.0）；這三種依使用率高到低，0%% 的不收；\n'
               '//   超級進化比例只有原型有：「超級進化 key:佔全家族使用率%%」，0%% 的不收；使用率是這個型態出現在幾 %% 的隊伍（小數 2 位）。沒有統計的是空字串\n'
               'const USAGE_RAW = {\n%s\n};\n'
               '// 招式（任一隻常用的）：key → [中文名, 屬性, 分類（physical 物理／special 特殊／status 變化）, 威力（null＝沒有）, 效果,\n'
               '//   PP, 命中率（null＝必中）, 先制等級, 目標範圍（OP.GG target，如 selected-pokemon 單體、all-opponents 對手全體）, 其他]；\n'
               '//   其他只列有值的：ail 異常／附加狀態（burn、paralysis…）、ailP 機率%%、fl 畏縮機率%%、cr 急所等級、dr 吸血%%（負的是反作用力）、\n'
               '//   hl 回復%%、hits [最少, 最多] 連續攻擊次數、st [[能力, 變化]…] 能力變化、stP 能力變化機率%%（0＝輔助招必定）、tr 招式標記（contact 接觸、sound 聲音…）\n'
               'const MOVES = {\n%s\n};\n'
               '// 特性（任一隻常用的，加上超級進化後的特性）：key → [中文名, 效果]\n'
               'const ABILS = {\n%s\n};\n'
               '// 道具（任一隻常用的，加上全部超級石）：key → [中文名, 效果]\n'
               'const ITEMS = {\n%s\n};\n'
               '// 可學招式與可能的特性（抓了詳細頁的寶可夢；超級進化沿用原型；不可用與禁用的招式不收）：寶可夢 key → "招式 key 空白分隔|特性 key 空白分隔"\n'
               'const LEARN = {\n%s\n};\n'
               '// 可學但不在 MOVES 的招式（沒有寶可夢常用），格式同 MOVES\n'
               'const LEARN_MOVES = {\n%s\n};\n'
               '// 可能但不在 ABILS 的特性，格式同 ABILS\n'
               'const LEARN_ABILS = {\n%s\n};\n') % (
        today, month, today, dump(src), body, MIN_PCT, LIST_N, SP_N,
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in use.items()),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(mv_out.items())),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(ab_out.items())),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(it_out.items())),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(learn_out.items())),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(lm_out.items())),
        '\n'.join('%s:%s,' % (dump(k), dump(v)) for k, v in sorted(la_out.items())))
    mons_path = os.path.join(out, 'mons-data.js')
    # 換行沿用既有的 mons-data.js（Windows 上 git 取出來是 CRLF），檔案還不存在就用 LF；舊內容留著，寫完後比出新出現的招式／特性
    old_txt = None
    if os.path.exists(mons_path):
        with open(mons_path, encoding='utf-8', newline='') as f:
            old_txt = f.read()
        if old_txt.split('\n', 1)[0].endswith('\r'):
            mons_js = mons_js.replace('\n', '\r\n')
    with open(mons_path, 'w', encoding='utf-8', newline='') as f:
        f.write(mons_js)
    write_stats(out, stats)
    print('寫入 %d 隻（超級進化 %d、單打有排名 %d、雙打有排名 %d）；有統計 %d 個型態、招式 %d 種、特性 %d 種、道具 %d 種，%d bytes' % (
        len(rows), sum(1 for r in rows if r[5]), sum(1 for r in rows if r[3]), sum(1 for r in rows if r[4]),
        len(use), len(mv_out), len(ab_out), len(it_out), len(mons_js.encode())))
    print('單打 %s %d 場、雙打 %s %d 場（%s，分數 %d 以上）' % (*src['s'], *src['d'], month, SD_CUTOFF))
    print('可學招式表 %d 隻；可學但沒人常用的招式 %d 種、特性 %d 種' % (len(learn_out), len(lm_out), len(la_out)))
    print('前 3 筆：', rows[:3])
    remind(old_txt, os.path.join(out, 'js'), mv_out, ab_out, mega_a)
    print(SIM_MATRIX_TIP)


# 單打對位的勝率表（sim-matrix.js）照資料算：資料換了要重跑（mons-data.js 的日期變了網頁就不用舊表、改在背景算；只換 base-stats.js 時日期不變，舊表照用）
SIM_MATRIX_TIP = '\n【提醒】資料換了，在 repo 根目錄重跑 node tools/sim_matrix.js 重算單打對位的勝率表 sim-matrix.js（28 執行緒約 15 分鐘）'


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--stats']
    main(args[0] if args else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html'), '--stats' in sys.argv[1:])

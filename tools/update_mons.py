# 從 OP.GG 寶可夢冠軍圖鑑頁擷取寶可夢名單（屬性、單打／雙打排名、超級進化原型、速度種族值），
# 寫進 index.html 的 MONS START / MONS END 區塊之間。
# 用法：python tools/update_mons.py [index.html 路徑，預設為 repo 根目錄的 index.html]
import datetime
import json
import os
import re
import sys
import urllib.request

URL = 'https://op.gg/zh-tw/pokemon-champions/pokedex'
TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
         'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy']


def fetch():
    req = urllib.request.Request(URL, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        'Accept-Language': 'zh-TW,zh;q=0.9',
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8')


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


def main(path):
    txt = payload(fetch())
    mons = grab(txt, 'pokemon', '[')
    ranks = grab(txt, 'rankings', '{')
    rows, bad = [], []
    for p in mons:
        if not set(p['types']) <= set(TYPES):
            bad.append((p['key'], p['types']))
        base = p.get('base_key') or ''
        rs = ranks['single'].get(p['key']) or ranks['single'].get(base) or 0
        rd = ranks['double'].get(p['key']) or ranks['double'].get(base) or 0
        rows.append([p['key'], p['name'], '.'.join(p['types']), rs, rd, base, p['stats']['speed']])
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
    today = datetime.date.today().isoformat()
    body = '\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + ',' for r in rows)
    block = ('// ----- MONS START -----\n'
             '// 寶可夢名單：%s 擷取自 OP.GG 寶可夢冠軍圖鑑（含超級進化）；這段由 tools/update_mons.py 產生，勿手改\n'
             "const MONS_DATE = '%s';\n"
             '// [key, 中文名, 屬性（. 分隔）, 單打排名, 雙打排名（0＝沒有排名）, 超級進化的原型 key, 速度種族值]\n'
             'const MONS_RAW = [\n%s\n];\n'
             '// ----- MONS END -----') % (today, today, body)
    with open(path, encoding='utf-8', newline='') as f:
        html = f.read()
    if '\r\n' in html:
        block = block.replace('\n', '\r\n')
    new, n = re.subn(r'// ----- MONS START -----.*?// ----- MONS END -----', lambda m: block, html, flags=re.S)
    if n != 1:
        raise SystemExit('index.html 裡找不到唯一的 MONS 區塊')
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(new)
    print('寫入 %d 隻（超級進化 %d、單打有排名 %d、雙打有排名 %d），%d bytes' % (
        len(rows), sum(1 for r in rows if r[5]), sum(1 for r in rows if r[3]), sum(1 for r in rows if r[4]), len(block.encode())))
    print('前 3 筆：', rows[:3])


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html'))

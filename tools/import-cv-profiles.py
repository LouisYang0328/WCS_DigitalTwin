"""Read the conveyor source workbooks; generate simulation profiles and mappings.

The source files are never modified. Runtime use requires neither Python nor Excel.
String[10] here is the local simulator's ASCII S7 STRING convention; the source
collector's String length/encoding still requires verification on a real PLC.
"""
import json
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
PROFILE_FILE = ROOT / 'backend/WcsGateway/config/plc-profiles.json'
groups = []
profiles = []
for floor, count in [(1, 100), (2, 55)]:
    code = f'CV{floor:02d}'
    source = Path.home() / 'Desktop' / f'{floor}FINFO.xlsx'
    workbook = openpyxl.load_workbook(source, data_only=True, read_only=True)
    sheet = workbook['设备变量']
    rows = []
    for row_no, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), 2):
        _, name, data_type, address, length, _, redis_name, description, *_ = row
        match = re.fullmatch(r'DB(\d+)\.DB[WBD](\d+)', address)
        assert match and int(match[1]) == 600, (source, row_no, address)
        assert redis_name == f'{code}.{name}'
        kind = {'System.UInt16': 'UInt16', 'System.String': 'String'}[data_type]
        assert int(length) == (10 if kind == 'String' else 1)
        rows.append(dict(name=name, offset=int(match[2]), dataType=kind,
                         description=description or '', sourceAddress=address,
                         sourceRow=row_no, **({'length': 10} if kind == 'String' else {})))
    workbook.close()
    assert len(rows) == 1 + count * 3
    assert rows[0]['name'] == 'PLC_STATUS_HEART' and rows[0]['offset'] == 0
    bindings = []
    for index in range(count):
        source_id = str(floor * 101000 + 1 + index)
        model_id = str(floor * 1000 + 1 + index)
        fields = rows[1 + index * 3:4 + index * 3]
        assert [field['name'] for field in fields] == [
            f'PLC_STATUS_STATE_{source_id}', f'PLC_STATUS_HASGOODS_{source_id}',
            f'PLC_STATUS_CONTNO_{source_id}']
        assert [field['offset'] for field in fields] == [2 + 26 * index, 4 + 26 * index, 6 + 26 * index]
        bindings.append(dict(id=model_id, sourceId=source_id,
            stateTag=fields[0]['name'], hasGoodsTag=fields[1]['name'], trayCodeTag=fields[2]['name'],
            mapped=model_id not in {'1005', '1030', '1052', '1098'}))
    for batch, first in enumerate(range(0, count, 30), 1):
        last = min(first + 30, count)
        selected = rows[1 + first * 3:1 + last * 3]
        start = selected[0]['offset']
        if first == 0:
            selected = [rows[0], *selected]
            start = 0
        tags = []
        for field in selected:
            tag = {key: value for key, value in field.items() if key not in {'sourceAddress', 'sourceRow'}}
            tag['offset'] -= start
            tags.append(tag)
        end = max(tag['offset'] + (12 if tag['dataType'] == 'String' else 2) for tag in tags)
        assert end <= 960
        profiles.append(dict(id=f'{code.lower()}-{batch:02d}', name=f'{code} {floor}F 输送线 {first + 1}–{last}',
            description='原表DB600地址；本地模拟：状态0停止/1运行/2报警/3离线，占货0无/1有，条码S7 STRING[10] ASCII。现场枚举及编码待核。',
            defaultDbNumber=600, defaultStartAddress=start, readLength=end,
            defaultPollIntervalMs=500, tags=tags))
    groups.append(dict(equipmentCode=code, floor=floor, sourceFile=str(source), sourceSheet='设备变量',
                       sourceRange=f'A2:I{len(rows) + 1}', bindings=bindings, tags=rows))

config = json.loads(PROFILE_FILE.read_text(encoding='utf-8-sig'))
config['profiles'] = [p for p in config['profiles'] if not p['id'].startswith(('cv01-', 'cv02-'))] + profiles
PROFILE_FILE.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(ROOT / 'docs/conveyor-s7-source-map.json').write_text(
    json.dumps(dict(version=1, groups=groups), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
mapping = {group['equipmentCode']: group['bindings'] for group in groups}
(ROOT / 'assets/conveyor-s7-mapping.js').write_text(
    '// Local simulation bindings transcribed from the supplied variable tables.\n'
    '// Source-only points have mapped:false; model 2056 has no supplied source.\n'
    'window.WCS_CONVEYOR_S7_MAPPING = ' + json.dumps(mapping, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
print(json.dumps(dict(profiles=[dict(id=p['id'], start=p['defaultStartAddress'], length=p['readLength'], tags=len(p['tags'])) for p in profiles],
                     groups=[dict(code=g['equipmentCode'], segments=len(g['bindings']), mapped=sum(b['mapped'] for b in g['bindings'])) for g in groups])))

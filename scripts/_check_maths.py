import json, sys
sys.stdout.reconfigure(encoding="utf-8")

data = json.load(open(r"D:\Internship\qpgenerator\parsed_output_yashassu_maths\questions.json", encoding="utf-8"))

keys = ["YBM_01_001", "YBM_01_029", "YBM_02_001", "YBM_03_001", "YBM_04_001"]
for k in keys:
    q = data.get(k, {})
    print(k)
    print(f"  chapter_num: {q.get('chapter_num')} | chapter: {q.get('chapter')}")
    print(f"  marks: {q.get('marks')} | difficulty: {q.get('difficulty')} | type: {q.get('type')}")
    print(f"  text: {q.get('text','')[:90]}")
    if q.get("options"):
        print(f"  options[0]: {q['options'][0][:70]}")
    print()

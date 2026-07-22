"""
Patch known quality issues in yashassu_maths questions.

Issue 1 – Equation-only text: MinerU dropped the question stem for Q29/Q31 in Unit 2;
  only the display-math block survived. We restore the full text from context.

Issue 2 – Missing LaTeX wrapping: Gemini left polynomial expressions as plain text
  (e.g. "p(x) = x^2 - 3x + 4x^3 - 6") instead of "$p(x) = x^2 - 3x + 4x^3 - 6$".
"""

import json, os, sys
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "qp-builder" / ".env")

JSON_PATH = ROOT / "parsed_output_yashassu_maths" / "questions.json"

# ── Patches ───────────────────────────────────────────────────────────────────
# Each entry: qid -> {"text": ..., "options": [...]}  (only fields to patch)

PATCHES = {
    # Issue 1: MinerU lost the question stem; surrounding questions are all
    # "Write the degree of the polynomial ..." so these must be the same.
    "YBM_02_029": {
        "text": "Write the degree of the polynomial $p(x) = x(x^2 + 2x) + 3x - 5$",
    },
    "YBM_02_031": {
        "text": "Write the degree of the polynomial $P(x) = x^2 - 5x + 6$",
    },

    # Issue 2: Gemini wrote polynomial expressions as plain text instead of LaTeX.
    "YBM_02_001": {
        "text": "The degree of a polynomial $p(x) = x^2 - 3x + 4x^3 - 6$ is,",
    },
    "YBM_02_003": {
        "text": "The degree of a polynomial $p(x) = 2x^3 + 3x - 11 + 6$ is,",
    },
    "YBM_02_007": {
        "text": "In the quadratic polynomial $f(x) = x^2 - 9x + 20$ the value of $f(0)$ is,",
    },
    "YBM_02_008": {
        "text": "In the polynomial $p(x) = x^2 - 1$, the value of $p(2)$ is,",
    },
    # YBM_01_026 is fine — it's a word problem with no inline polynomial
}


def main():
    # 1. Patch local JSON
    with open(JSON_PATH, encoding="utf-8") as f:
        data = json.load(f)

    local_patched = 0
    for qid, patch in PATCHES.items():
        if qid in data:
            data[qid].update(patch)
            local_patched += 1
            print(f"  JSON patched: {qid}")
        else:
            print(f"  WARN: {qid} not in local JSON")

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\nLocal JSON: {local_patched} questions patched -> {JSON_PATH}\n")

    # 2. Patch MongoDB
    uri = os.getenv("MONGODB_URI")
    if not uri:
        sys.exit("ERROR: MONGODB_URI not set")

    col = MongoClient(uri)["qp_builder"]["questions"]
    mongo_patched = 0

    for qid, patch in PATCHES.items():
        result = col.update_one({"qid": qid}, {"$set": patch})
        if result.matched_count:
            mongo_patched += 1
            print(f"  MongoDB patched: {qid}  -> {patch['text'][:70]}")
        else:
            print(f"  WARN: {qid} not found in MongoDB")

    print(f"\nMongoDB: {mongo_patched} questions patched.")


if __name__ == "__main__":
    main()

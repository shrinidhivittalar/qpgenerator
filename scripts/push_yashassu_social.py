"""
Upsert Yashassu Social Science questions into MongoDB.
Safe to rerun — uses qid as the upsert key, never wipes existing data.
Run parse_yashassu_social.py first to generate questions.json.
"""

import json, os, sys
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient, UpdateOne, ASCENDING

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "qp-builder" / ".env")

uri = os.getenv("MONGODB_URI")
if not uri:
    sys.exit("ERROR: MONGODB_URI not set in qp-builder/.env")

SOURCE_FILE = ROOT / "parsed_output_yashassu_social" / "questions.json"
if not SOURCE_FILE.exists():
    sys.exit(f"ERROR: {SOURCE_FILE} not found — run parse_yashassu_social.py first")

with open(SOURCE_FILE, encoding="utf-8") as f:
    questions = list(json.load(f).values())

for q in questions:
    q.setdefault("subject", "social")
    q.setdefault("source",  "yashassu_social")

client = MongoClient(uri)
col    = client["qp_builder"]["questions"]

ops = [
    UpdateOne({"qid": q["qid"]}, {"$set": q}, upsert=True)
    for q in questions
]

result = col.bulk_write(ops, ordered=False)
print(f"Upserted : {result.upserted_count}")
print(f"Modified : {result.modified_count}")
print(f"Total    : {len(questions)}")

col.create_index([("subject",            ASCENDING), ("source", ASCENDING)])
col.create_index([("sub_subject",        ASCENDING)], sparse=True)
col.create_index([("global_chapter_num", ASCENDING)], sparse=True)
col.create_index([("chapter_num",        ASCENDING)], sparse=True)
col.create_index([("marks",              ASCENDING)])

print("Indexes ensured.")

print("\n=== Distribution by chapter ===")
for doc in col.aggregate([
    {"$match": {"source": "yashassu_social"}},
    {"$group": {
        "_id": {
            "sub":  "$sub_subject",
            "num":  "$chapter_num",
            "name": "$chapter",
            "glob": "$global_chapter_num",
        },
        "count": {"$sum": 1},
    }},
    {"$sort": {"_id.glob": 1}},
]):
    d = doc["_id"]
    print(f"  [{d['sub']}] Ch {d['num']} (global {d['glob']:02d}): {d['name']}  ->  {doc['count']} questions")

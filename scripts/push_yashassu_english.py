"""
Upsert Yashassu English questions into MongoDB.
Safe to rerun — uses qid as the upsert key, never wipes existing data.
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

SOURCE_FILE = ROOT / "parsed_output_yashassu_english" / "questions.json"
if not SOURCE_FILE.exists():
    sys.exit(f"ERROR: {SOURCE_FILE} not found — run parse_mineru_english_with_gemini.py first")

with open(SOURCE_FILE, encoding="utf-8") as f:
    questions = list(json.load(f).values())

for q in questions:
    q.setdefault("subject", "english")
    q.setdefault("source",  "yashassu_english")

client = MongoClient(uri)
col = client["qp_builder"]["questions"]

ops = [
    UpdateOne({"qid": q["qid"]}, {"$set": q}, upsert=True)
    for q in questions
]

result = col.bulk_write(ops, ordered=False)
print(f"Upserted : {result.upserted_count}")
print(f"Modified : {result.modified_count}")
print(f"Total    : {len(questions)}")

col.create_index([("subject", ASCENDING), ("source", ASCENDING)])
col.create_index([("chapter_num", ASCENDING)], sparse=True)
col.create_index([("difficulty",  ASCENDING)], sparse=True)
col.create_index([("marks",       ASCENDING)])

print("Indexes ensured.")

print("\n=== Lesson distribution ===")
for doc in col.aggregate([
    {"$match": {"source": "yashassu_english"}},
    {"$group": {"_id": {"num": "$chapter_num", "name": "$chapter"}, "count": {"$sum": 1}}},
    {"$sort": {"_id.num": 1}},
]):
    sys.stdout.buffer.write(
        f"  Lesson {doc['_id']['num']}: {doc['_id']['name']}  ->  {doc['count']} questions\n".encode("utf-8")
    )

print("\n=== Type distribution ===")
for doc in col.aggregate([
    {"$match": {"source": "yashassu_english"}},
    {"$group": {"_id": "$type", "count": {"$sum": 1}}},
    {"$sort": {"_id": 1}},
]):
    print(f"  {doc['_id']}: {doc['count']}")

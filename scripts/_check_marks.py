from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path
import os

load_dotenv(Path(r"D:\Internship\qpgenerator\qp-builder\.env"))
col = MongoClient(os.getenv("MONGODB_URI"))["qp_builder"]["questions"]

print("=== Marks distribution (yashassu_science) ===")
for doc in col.aggregate([
    {"$match": {"source": "yashassu_science"}},
    {"$group": {"_id": "$marks", "count": {"$sum": 1}, "types": {"$addToSet": "$type"}}},
    {"$sort": {"_id": 1}}
]):
    print(f"  {doc['_id']} mark(s): {doc['count']} questions  types={doc['types']}")

print("\n=== Marks boundary check (first + last Q per marks bucket, ch1) ===")
for marks in [1, 2, 3, 4, 5]:
    qs = list(col.find(
        {"source": "yashassu_science", "chapter_num": 1, "marks": marks},
        {"qid": 1, "number": 1, "text": 1, "marks": 1, "_id": 0}
    ).sort("number", 1))
    if qs:
        first, last = qs[0], qs[-1]
        print(f"\n  {marks}-mark, ch1 ({len(qs)} Qs): Q{first['number']}..Q{last['number']}")
        print(f"    first: [{first['qid']}] {first['text'][:70]}")
        print(f"    last : [{last['qid']}]  {last['text'][:70]}")

"""
One-time migration: push all static question bank JSON files into MongoDB.
Run once: python migrate_to_mongodb.py
"""
from pymongo import MongoClient, ASCENDING
from pathlib import Path
from dotenv import load_dotenv
import json, os, sys

load_dotenv(Path(__file__).parent / "qp-builder" / ".env")

uri = os.getenv("MONGODB_URI")
if not uri or "<new-password>" in uri:
    sys.exit("ERROR: Set MONGODB_URI in qp-builder/.env before running migration.")

client = MongoClient(uri)
db     = client["qp_builder"]
col    = db["questions"]

BASE = Path(__file__).parent

SOURCES = {
    "science": {
        "qp":       BASE / "parsed_output"                  / "questions.json",
        "textbook": BASE / "parsed_output_science_textbook" / "questions.json",
    },
    "maths": {
        "qp":       BASE / "parsed_output_maths"          / "questions.json",
        "yashassu": BASE / "parsed_output_yashassu_maths" / "questions.json",
    },
}

# Wipe existing static questions so re-running is safe
deleted = col.delete_many({}).deleted_count
if deleted:
    print(f"Cleared {deleted} existing documents from 'questions' collection.")

total = 0
for subject, sources in SOURCES.items():
    for source, path in sources.items():
        if not path.exists():
            print(f"  SKIP  {subject}/{source} — file not found: {path}")
            continue

        with open(path, encoding="utf-8") as f:
            items = list(json.load(f).values())

        for q in items:
            q.setdefault("has_table",   False)
            q.setdefault("tables",      [])
            q.setdefault("has_figure",  False)
            q.setdefault("images",      [])
            q.setdefault("chapter",     None)
            q.setdefault("chapter_num", None)
            q.setdefault("section",     None)
            q["subject"] = subject   # tag so we can query by subject
            q["source"]  = source    # tag so we can query by source

        col.insert_many(items)
        print(f"  OK    {subject}/{source}: {len(items)} questions")
        total += len(items)

# Indexes for fast subject/source queries
col.create_index([("subject", ASCENDING), ("source", ASCENDING)])
col.create_index([("qid",     ASCENDING)], unique=True)

print(f"\nDone. {total} questions migrated. Indexes created.")

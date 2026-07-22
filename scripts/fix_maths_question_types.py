"""
Fix question types in MongoDB for yashassu_maths:
  - has_figure=True, type!=mcq  →  type = "figure_based"

Maths question bank has no data tables so table_based is not expected.
Run after link_maths_images_to_questions.py.
"""

import os, sys
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "qp-builder" / ".env")


def main():
    uri = os.getenv("MONGODB_URI")
    if not uri:
        sys.exit("ERROR: MONGODB_URI not set")

    col = MongoClient(uri)["qp_builder"]["questions"]

    res = col.update_many(
        {"source": "yashassu_maths", "has_figure": True, "type": {"$ne": "mcq"}},
        {"$set": {"type": "figure_based"}},
    )
    print(f"figure_based: {res.modified_count} updated")

    print("\n=== Type distribution (yashassu_maths) ===")
    for doc in col.aggregate([
        {"$match": {"source": "yashassu_maths"}},
        {"$group": {"_id": "$type", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]):
        print(f"  {doc['_id']}: {doc['count']}")


if __name__ == "__main__":
    main()

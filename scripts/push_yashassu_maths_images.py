"""
Upload Yashassu Maths images to Supabase Storage.
Bucket: QPGen-images  |  Path: maths/yashassu_maths/<filename>
Safe to rerun — uploads with upsert=true.
"""

import os, sys
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "qp-builder" / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
BUCKET       = "QPGen-images"
DEST_PREFIX  = "maths/yashassu_maths"

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY not set in qp-builder/.env")

from supabase import create_client

client  = create_client(SUPABASE_URL, SUPABASE_KEY)
img_dir = ROOT / "parsed_output_yashassu_maths" / "images"
images  = list(img_dir.glob("*.jpg")) + list(img_dir.glob("*.png"))

if not images:
    sys.exit(f"No images found in {img_dir}")

print(f"Uploading {len(images)} images to {BUCKET}/{DEST_PREFIX}/...\n")

ok = err = 0
for img_path in images:
    dest = f"{DEST_PREFIX}/{img_path.name}"
    mime = "image/jpeg" if img_path.suffix == ".jpg" else "image/png"
    try:
        client.storage.from_(BUCKET).upload(
            path=dest,
            file=img_path.read_bytes(),
            file_options={"content-type": mime, "upsert": "true"},
        )
        print(f"  OK   {dest}")
        ok += 1
    except Exception as e:
        print(f"  ERR  {dest}: {e}")
        err += 1

base_url = os.getenv("VITE_SUPABASE_IMAGES_URL", "").rstrip("/")
print(f"\nDone. {ok} uploaded, {err} errors.")
if base_url:
    print(f"Base URL: {base_url}/{DEST_PREFIX}/")

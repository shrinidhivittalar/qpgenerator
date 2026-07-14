#!/usr/bin/env python3
"""
PDF figure extractor — reads a PDF from stdin, writes JSON to stdout.

Output: JSON array of {pageNum, base64, width, height, isFigure}

Usage (called by pdfRenderer.ts):
  python3 figureExtractor.py [maxPages]
"""

import sys
import json
import base64
import io

import fitz  # PyMuPDF
import numpy as np
from PIL import Image

# ── Constants ─────────────────────────────────────────────────────────────────

FIGURE_PHRASES = [
    'in the figure', 'in figure', 'the given figure',
    'refer to the diagram', 'as shown', 'the following figure',
    'the diagram', 'the picture', 'the graph', 'the chart',
    'using the figure', 'from the figure',
]

RENDER_DPI        = 200    # higher DPI → sharper crops (was 150)
CROP_PADDING_PT   = 10     # padding (PDF points) kept around tight content
MIN_FIG_PT        = 30     # minimum figure dimension in PDF points
MIN_FIG_PX        = 80     # minimum figure dimension in output pixels
WHITE_THRESHOLD   = 230    # pixel channel value >= this → white
WHITE_RATIO_MIN   = 0.35   # reject crop if fewer than 35% of pixels are white
MIN_DENSITY       = 3      # non-white pixels per row/col to count as real content

# Drawing filters
MIN_DRAWING_ITEMS = 1      # drawings with fewer items are filtered (1 keeps single line segments)
MIN_CLUSTER_ITEMS = 5      # total items in winning cluster must reach this
MIN_CLUSTER_SIZE  = 2      # cluster must have at least this many drawings
PAGE_SPAN_RATIO   = 0.80   # drawings spanning > 80% of page in one dim → border
THIN_LINE_PT      = 2      # drawings thinner than this (pt) in one dim are candidates for filtering
THIN_SPAN_RATIO   = 0.50   # …only filter if they also span > 50% of page (true table rules, not triangle bases)
QR_MAX_DRAWINGS   = 80     # clusters with this many tiny drawings are vector QR codes

# Clustering
CLUSTER_GAP_PT    = 25     # drawings within 25pt of each other → same cluster

# Text-overlap guard
TEXT_OVERLAP_RATIO  = 0.40  # reject cluster if text blocks cover > 40% of its area
TEXT_BAND_PT        = 10    # height of each horizontal band when scanning for table rows
TEXT_BAND_THRESHOLD = 0.45  # bands with > 45% text coverage are table rows → trim

# Page-area guard
MAX_PAGE_AREA     = 0.65   # reject crop covering > 65% of total page area


# ── Pixel helpers ─────────────────────────────────────────────────────────────

def tighten_bounds(img: Image.Image):
    """
    Scan inward from all four edges to find the tightest non-white bounding box.
    Returns (left, top, width, height) in pixels, or None if the region is blank.
    """
    arr = np.array(img.convert('RGB'))

    non_white = ~(
        (arr[:, :, 0] >= WHITE_THRESHOLD) &
        (arr[:, :, 1] >= WHITE_THRESHOLD) &
        (arr[:, :, 2] >= WHITE_THRESHOLD)
    )

    row_sums = non_white.sum(axis=1)
    top_cands = np.where(row_sums >= MIN_DENSITY)[0]
    if len(top_cands) == 0:
        return None

    top    = int(top_cands[0])
    bottom = int(top_cands[-1])

    band     = non_white[top:bottom + 1, :]
    col_sums = band.sum(axis=0)
    col_cands = np.where(col_sums >= MIN_DENSITY)[0]
    if len(col_cands) == 0:
        return None

    left  = int(col_cands[0])
    right = int(col_cands[-1])

    cw = right - left + 1
    ch = bottom - top + 1
    if cw < MIN_FIG_PX or ch < MIN_FIG_PX:
        return None

    return (left, top, cw, ch)


def has_colored_background(img: Image.Image) -> bool:
    """True if the crop has a coloured (non-white) background — e.g. NCERT grid paper."""
    arr = np.array(img.convert('RGB'))
    white = (
        (arr[:, :, 0] >= WHITE_THRESHOLD) &
        (arr[:, :, 1] >= WHITE_THRESHOLD) &
        (arr[:, :, 2] >= WHITE_THRESHOLD)
    )
    return float(white.mean()) < WHITE_RATIO_MIN


def looks_like_qr_code(img: Image.Image) -> bool:
    """
    Pixel-level QR / barcode detector. Catches both raster and vector QR codes.
    A QR code is: small (< 600px both sides), roughly square, > 85% near-black or near-white.
    """
    w, h = img.size
    if w > 600 or h > 600:
        return False
    ratio = w / h if h > 0 else 999
    if ratio < 0.70 or ratio > 1.43:
        return False
    arr   = np.array(img.convert('RGB'))
    step  = max(1, min(w, h) // 40)
    s     = arr[::step, ::step]
    is_bw = (
        ((s[:, :, 0] > 200) & (s[:, :, 1] > 200) & (s[:, :, 2] > 200)) |
        ((s[:, :, 0] < 55)  & (s[:, :, 1] < 55)  & (s[:, :, 2] < 55))
    )
    return float(is_bw.mean()) > 0.85


def trim_table_rows(fig_rect: fitz.Rect, text_blocks) -> fitz.Rect:
    """
    Scan the cluster rect in horizontal bands. Trim from the top (and bottom)
    any bands that are heavily covered by text — these are table rows that got
    merged into the cluster with the diagram below them.
    """
    if fig_rect.height <= 0:
        return fig_rect

    n_bands = max(1, int(fig_rect.height / TEXT_BAND_PT))
    coverages = []

    for i in range(n_bands):
        y0   = fig_rect.y0 + i * TEXT_BAND_PT
        y1   = min(fig_rect.y1, y0 + TEXT_BAND_PT)
        band = fitz.Rect(fig_rect.x0, y0, fig_rect.x1, y1)
        area = band.width * (y1 - y0)
        if area <= 0:
            coverages.append(0.0)
            continue
        overlap = sum(
            (band & fitz.Rect(b[0], b[1], b[2], b[3])).get_area()
            for b in text_blocks
        )
        coverages.append(overlap / area)

    # Find first band from top that is NOT a table row
    new_top_band = 0
    for i, c in enumerate(coverages):
        if c < TEXT_BAND_THRESHOLD:
            new_top_band = i
            break

    # Find first band from bottom that is NOT a table row
    new_bot_band = n_bands - 1
    for i in range(n_bands - 1, -1, -1):
        if coverages[i] < TEXT_BAND_THRESHOLD:
            new_bot_band = i
            break

    new_y0 = fig_rect.y0 + new_top_band * TEXT_BAND_PT
    new_y1 = fig_rect.y0 + (new_bot_band + 1) * TEXT_BAND_PT
    new_y1 = min(fig_rect.y1, new_y1)

    if new_y0 >= new_y1:
        return fig_rect   # trimming would collapse the rect — leave as is

    return fitz.Rect(fig_rect.x0, new_y0, fig_rect.x1, new_y1)


# ── Drawing clustering ────────────────────────────────────────────────────────

def _inside_text_block(drawing_rect, text_blocks, ratio: float = 0.60) -> bool:
    """
    True if the drawing rect is mostly (> ratio) covered by a text block.
    Decorative underlines and bullet points live inside text blocks.
    Diagram lines sit in the whitespace between text blocks.
    """
    d_area = drawing_rect.width * drawing_rect.height
    if d_area <= 0:
        return True   # zero-size drawing → discard
    for b in text_blocks:
        inter = drawing_rect & fitz.Rect(b[0], b[1], b[2], b[3])
        if not inter.is_empty and (inter.width * inter.height) / d_area > ratio:
            return True
    return False


def _is_qr_cluster(drawings_in_cluster) -> bool:
    """
    True if the cluster looks like a vector QR code / barcode:
    many tiny drawings packed into a small square area.
    """
    n = len(drawings_in_cluster)
    if n < QR_MAX_DRAWINGS:
        return False
    areas = [d['rect'].width * d['rect'].height for d in drawings_in_cluster]
    avg_area = sum(areas) / n
    # QR code modules are tiny (< 100 pt²); cluster overall is roughly square
    cluster_rect = fitz.Rect(
        min(d['rect'].x0 for d in drawings_in_cluster),
        min(d['rect'].y0 for d in drawings_in_cluster),
        max(d['rect'].x1 for d in drawings_in_cluster),
        max(d['rect'].y1 for d in drawings_in_cluster),
    )
    aspect = cluster_rect.width / cluster_rect.height if cluster_rect.height else 999
    return avg_area < 100 and 0.6 < aspect < 1.7


def _is_thin_rule(r, page_w: float, page_h: float) -> bool:
    """True for thin horizontal or vertical rules (table lines, underlines, answer boxes)."""
    if r.height < THIN_LINE_PT and r.width > page_w * THIN_SPAN_RATIO:
        return True
    if r.width < THIN_LINE_PT and r.height > page_h * THIN_SPAN_RATIO:
        return True
    return False


def cluster_drawings(drawings, page_w: float, page_h: float, text_blocks=None):
    """
    1. Pre-filter: remove page-spanning borders, thin rules, trivial drawings,
       and drawings that sit inside text blocks (decorative underlines etc.).
    2. Build proximity clusters using union-find (drawings within CLUSTER_GAP_PT
       of each other belong to the same cluster).
    3. Return the bounding fitz.Rect of the cluster with the most path items,
       or None if no cluster passes quality thresholds.
    """
    meaningful = []
    for d in drawings:
        r = d['rect']
        if r.width  > page_w * PAGE_SPAN_RATIO:
            continue
        if r.height > page_h * PAGE_SPAN_RATIO:
            continue
        if _is_thin_rule(r, page_w, page_h):
            continue
        if len(d.get('items', [])) < MIN_DRAWING_ITEMS:
            continue
        if text_blocks and _inside_text_block(r, text_blocks):
            continue
        meaningful.append(d)

    if not meaningful:
        return None

    n = len(meaningful)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: int, y: int) -> None:
        parent[find(x)] = find(y)

    # O(n²) is fine; real diagram pages rarely have > 60 meaningful drawings
    for i in range(n):
        ri = meaningful[i]['rect']
        expanded_i = fitz.Rect(
            ri.x0 - CLUSTER_GAP_PT, ri.y0 - CLUSTER_GAP_PT,
            ri.x1 + CLUSTER_GAP_PT, ri.y1 + CLUSTER_GAP_PT,
        )
        for j in range(i + 1, n):
            if find(i) != find(j) and expanded_i.intersects(meaningful[j]['rect']):
                union(i, j)

    # Group indices by cluster root
    clusters: dict[int, list[int]] = {}
    for i in range(n):
        root = find(i)
        clusters.setdefault(root, []).append(i)

    # Pick the cluster with the most total path items
    best_indices = max(
        clusters.values(),
        key=lambda idxs: sum(len(meaningful[i].get('items', [])) for i in idxs),
    )

    total_items = sum(len(meaningful[i].get('items', [])) for i in best_indices)
    if total_items < MIN_CLUSTER_ITEMS or len(best_indices) < MIN_CLUSTER_SIZE:
        return None

    best = [meaningful[i] for i in best_indices]

    if _is_qr_cluster(best):
        return None

    return fitz.Rect(
        min(d['rect'].x0 for d in best),
        min(d['rect'].y0 for d in best),
        max(d['rect'].x1 for d in best),
        max(d['rect'].y1 for d in best),
    )


# ── Text-overlap guard ───────────────────────────────────────────────────────

def overlaps_text_heavily(cluster_rect: fitz.Rect, text_blocks) -> bool:
    """
    True if text blocks cover more than TEXT_OVERLAP_RATIO of the cluster area.
    Math typesetting vectors (√, x², fractions) live at the same position as
    their text blocks. Real diagrams sit in text-free regions of the page.
    """
    cluster_area = cluster_rect.width * cluster_rect.height
    if cluster_area <= 0:
        return False

    overlap = 0.0
    for b in text_blocks:
        inter = cluster_rect & fitz.Rect(b[0], b[1], b[2], b[3])
        if not inter.is_empty:
            overlap += inter.width * inter.height

    return (overlap / cluster_area) > TEXT_OVERLAP_RATIO


# ── Text-gap fallback ─────────────────────────────────────────────────────────

def figure_rect_from_text_gap(page, page_w: float, page_h: float):
    """
    For pages where the figure is hinted by a phrase but has no vector cluster,
    find the largest vertical gap between text blocks.
    Returns a fitz.Rect or None.
    """
    blocks      = page.get_text("blocks")
    text_blocks = [b for b in blocks if b[6] == 0]

    if len(text_blocks) < 5:
        return None

    sorted_blocks = sorted(text_blocks, key=lambda b: b[1])

    best_gap      = None
    best_gap_size = 0

    for i in range(len(sorted_blocks) - 1):
        gap_top    = sorted_blocks[i][3]
        gap_bottom = sorted_blocks[i + 1][1]
        gap_size   = gap_bottom - gap_top
        if gap_size > best_gap_size and gap_size > MIN_FIG_PT * 2:
            best_gap_size = gap_size
            best_gap      = (gap_top, gap_bottom)

    if not best_gap:
        return None

    # X extent: use blocks adjacent to the gap, not the full-page span
    adjacent = [
        b for b in text_blocks
        if abs(b[3] - best_gap[0]) < 20 or abs(b[1] - best_gap[1]) < 20
    ]
    if not adjacent:
        adjacent = text_blocks

    min_x = min(b[0] for b in adjacent)
    max_x = max(b[2] for b in adjacent)

    return fitz.Rect(min_x, best_gap[0], max_x, best_gap[1])


# ── Main extraction loop ──────────────────────────────────────────────────────

def extract_figures(pdf_bytes: bytes, max_pages: int = 200) -> list:
    doc     = fitz.open(stream=pdf_bytes, filetype="pdf")
    results = []

    for page_idx in range(min(len(doc), max_pages)):
        page      = doc[page_idx]
        page_num  = page_idx + 1

        if page_num == 1:   # cover / title pages are never exam diagrams
            continue
        page_rect = page.rect
        page_w    = page_rect.width
        page_h    = page_rect.height

        text       = page.get_text().lower()
        has_phrase = any(p in text for p in FIGURE_PHRASES)
        drawings   = page.get_drawings()

        if not drawings and not has_phrase:
            continue

        # ── Step 1: find the figure region ────────────────────────────────────
        all_blocks  = page.get_text("blocks")
        text_blocks = [b for b in all_blocks if b[6] == 0]

        fig_rect = cluster_drawings(drawings, page_w, page_h, text_blocks)

        if fig_rect is not None:
            fig_rect = trim_table_rows(fig_rect, text_blocks)

        if fig_rect is not None and overlaps_text_heavily(fig_rect, text_blocks):
            fig_rect = None   # math typesetting, not a diagram

        if fig_rect is None and has_phrase:
            fig_rect = figure_rect_from_text_gap(page, page_w, page_h)

        if fig_rect is None:
            continue

        # ── Step 2: guards ────────────────────────────────────────────────────
        if fig_rect.width < MIN_FIG_PT or fig_rect.height < MIN_FIG_PT:
            continue

        fig_area  = fig_rect.width * fig_rect.height
        page_area = page_w * page_h
        if fig_area > page_area * MAX_PAGE_AREA:
            continue

        # Header / footer guard
        if fig_rect.y1 < page_h * 0.20 and fig_rect.y0 < page_h * 0.10:
            continue
        if fig_rect.y0 > page_h * 0.80 and fig_rect.y1 > page_h * 0.90:
            continue

        # ── Step 4: render + pixel-level tightening ───────────────────────────
        padded = fitz.Rect(
            max(0,      fig_rect.x0 - CROP_PADDING_PT),
            max(0,      fig_rect.y0 - CROP_PADDING_PT),
            min(page_w, fig_rect.x1 + CROP_PADDING_PT),
            min(page_h, fig_rect.y1 + CROP_PADDING_PT),
        )

        scale   = RENDER_DPI / 72
        mat     = fitz.Matrix(scale, scale)
        pixmap  = page.get_pixmap(matrix=mat, clip=padded, alpha=False)
        img     = Image.open(io.BytesIO(pixmap.tobytes("png")))

        if has_colored_background(img):
            continue

        if looks_like_qr_code(img):
            continue

        tight = tighten_bounds(img)
        if tight:
            lx, ly, lw, lh = tight
            pad = max(4, int(CROP_PADDING_PT * scale * 0.5))
            lx  = max(0,           lx - pad)
            ly  = max(0,           ly - pad)
            lw  = min(img.width  - lx, lw + pad * 2)
            lh  = min(img.height - ly, lh + pad * 2)
            img = img.crop((lx, ly, lx + lw, ly + lh))

        buf = io.BytesIO()
        img.save(buf, 'PNG')
        out_w, out_h = img.size

        b64 = base64.b64encode(buf.getvalue()).decode()
        results.append({
            "pageNum":  page_num,
            "base64":   b64,
            "width":    out_w,
            "height":   out_h,
            "isFigure": True,
        })

    doc.close()
    return results


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    max_pages = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    pdf_bytes = sys.stdin.buffer.read()

    try:
        figures = extract_figures(pdf_bytes, max_pages)
        sys.stdout.buffer.write(json.dumps(figures).encode())
        sys.exit(0)
    except Exception:
        import traceback
        sys.stderr.write(traceback.format_exc())
        sys.exit(1)

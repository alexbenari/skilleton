#!/usr/bin/env python3
"""
Extract plain-text Hebrew sentences from an HTML file into a CSV (one sentence
per row).

Usage:
    python extract_sentences.py <input.html> <output.csv> [--no-wiki-stop] [--content-selector SELECTOR]

By default this assumes a Wikipedia-style article: it looks for
div#mw-content-text as the main content container, and stops collecting
prose once it reaches a "ראו גם" / "קישורים חיצוניים" / "הערות שוליים"
heading (see also / external links / footnotes — these sections are link
and citation titles, not prose, and would pollute sentence output).

For non-Wikipedia HTML, pass --no-wiki-stop to disable the heading cutoff,
and optionally --content-selector to point at the right container (e.g.
"main", "article", "#content"). If no container is found, the whole
document body is used.

See the skill's SKILL.md for the reasoning behind each step — several of
these choices (especially the get_text() separator/strip settings and the
abbreviation-protecting regexes) fix subtle bugs that are easy to
reintroduce if this script is rewritten from scratch.
"""

import argparse
import csv
import re
import sys

try:
    from bs4 import BeautifulSoup
except ImportError:
    print(
        "bs4 is required. Install it with: pip install beautifulsoup4 lxml --break-system-packages",
        file=sys.stderr,
    )
    sys.exit(1)

# Elements that are never prose and should be dropped before extracting text.
NOISE_SELECTORS = [
    "script", "style", "sup.reference", "table", ".navbox", ".infobox",
    ".mw-editsection", ".reflist", ".reference", ".catlinks", ".thumb",
    ".gallery", ".hatnote", ".metadata", "ol.references", ".printfooter",
    ".noprint",
]

# Wikipedia section headings that mark the end of article prose. Everything
# from here to the end of the page is link/citation titles, not sentences.
WIKI_STOP_HEADINGS = {"ראו גם", "קישורים חיצוניים", "הערות שוליים", "לקריאה נוספת"}

HEBREW_RANGE = r"֐-׿"  # covers Hebrew letters, niqqud, gershayim/geresh
PLACEHOLDER = "\x00"


def find_content_root(soup, content_selector=None):
    if content_selector:
        el = soup.select_one(content_selector)
        if el:
            return el
    # Wikipedia
    el = soup.find("div", {"id": "mw-content-text"})
    if el:
        return el
    # Common generic containers
    for sel in ["main", "article", "#content", "#main"]:
        el = soup.select_one(sel)
        if el:
            return el
    return soup.body or soup


def strip_noise(content):
    for sel in NOISE_SELECTORS:
        for tag in content.select(sel):
            tag.decompose()


def collect_blocks(content, use_wiki_stop):
    """Return <p>/<li> elements in document order, stopping at a wiki
    see-also/links/footnotes heading if use_wiki_stop is set."""
    blocks = []
    for el in content.find_all(["h2", "h3", "p", "li"]):
        if use_wiki_stop and el.name in ("h2", "h3"):
            heading_text = el.get_text(strip=True)
            if heading_text in WIKI_STOP_HEADINGS:
                break
            continue
        if el.name in ("p", "li"):
            blocks.append(el)
    return blocks


def extract_raw_text(blocks):
    """Turn prose blocks into a single normalized-whitespace text blob,
    one block per line.

    IMPORTANT: use get_text(separator='', strip=False) here, NOT
    get_text(separator=' ', strip=True). BeautifulSoup's strip=True strips
    whitespace from each text node individually *before* joining them, and
    it does this regardless of the separator you asked for. That breaks in
    two different ways on real Wikipedia markup:

    1. A link that sits right after a real space in the source, e.g.
       "חברת <a>קאדילק</a>" (there IS a space in the "חברת " text node) —
       strip=True eats that trailing space, so separator='' collapses it
       to "חברתקאדילק" with the word run together.
    2. A link immediately followed by punctuation with NO space in the
       source, e.g. "<a>מוסך</a>." — separator=' ' inserts a space at the
       tag boundary that was never there, producing "מוסך ." with a
       floating period.

    The fix is to keep strip=False (so real inter-node spaces survive) and
    use separator='' (so no spurious spaces get invented at tag
    boundaries), then normalize runs of whitespace to a single space
    afterward. This preserves spacing exactly as it was in the source.
    """
    lines = []
    for b in blocks:
        t = b.get_text(separator="", strip=False)
        t = re.sub(r"\s+", " ", t).strip()
        if t:
            lines.append(t)
    text = "\n".join(lines)
    # Drop bracketed footnote markers like [1], [א], [12]
    text = re.sub(r"\[\d+\]", "", text)
    text = re.sub(rf"\[[{HEBREW_RANGE}]+\]", "", text)
    return text


def protect_abbreviations(text):
    """Replace periods that are abbreviation punctuation (not sentence
    ends) with a placeholder, so the sentence splitter doesn't break on
    them. Restore afterward with text.replace(PLACEHOLDER, '.').

    Two patterns are protected:

    (a) Multi-part abbreviations, e.g. "וושינגטון די. סי." (Washington
        D.C.): a short (<=3 Hebrew-char) token's period followed by
        another short-token period.

    (b) A single-letter initial before another word, e.g. "ג'ואן ק. קרל"
        (a person's name where ק. is a middle initial).

    Both patterns require the short token to be preceded by whitespace or
    the start of the string — a genuine standalone word — rather than
    just a regex \\b word boundary. This distinction matters a lot for
    Hebrew: gershayim abbreviations like ס"מ (cm), ק"ג (kg), מ"מ (mm),
    ק"מ (km) are internally ס + " + מ, and \\b fires right after that
    internal gershayim character too, making the trailing letter look
    like a standalone one-letter "word". Without the whitespace-anchored
    lookbehind, a real sentence-ending period after "20 ס"מ." gets
    mistaken for an initial and wrongly merged with the next sentence.

    Pattern (b) is deliberately restricted to exactly ONE Hebrew letter,
    not "1-2" as it might seem natural to write. Hebrew has plenty of
    genuine, common two-letter words that legitimately end a sentence —
    את, של, גם, עם, אם, לא, כן, עת, זה, בו — and matching those as
    "initials" silently swallows real sentence boundaries wherever one of
    those words happens to end a sentence (this actually happened during
    testing: "...עד לאותה עת. אבזור המכונית..." was wrongly merged into
    one sentence because "עת" matched the 1-2-letter initial pattern).
    A standalone single Hebrew letter, by contrast, is essentially never
    a real free-standing word — it's reliably an abbreviation or initial
    — so restricting to length 1 catches the intended case without the
    false positives.
    """
    pattern_pair = re.compile(
        rf"(?:(?<=\s)|^)([{HEBREW_RANGE}]{{1,3}})\.(\s+[{HEBREW_RANGE}]{{1,3}}\.)"
    )
    pattern_initial = re.compile(
        rf"(?:(?<=\s)|^)([{HEBREW_RANGE}'])\.(?=\s+[{HEBREW_RANGE}])"
    )
    prev = None
    while prev != text:
        prev = text
        text = pattern_pair.sub(lambda m: m.group(1) + PLACEHOLDER + m.group(2), text)
        text = pattern_initial.sub(lambda m: m.group(1) + PLACEHOLDER, text)
    return text


def split_sentences(text):
    protected = protect_abbreviations(text)
    sentence_endings = re.compile(r"(?<=[.!?])\s+")
    raw = []
    for line in protected.split("\n"):
        line = line.strip()
        if not line:
            continue
        raw.extend(sentence_endings.split(line))
    return [s.replace(PLACEHOLDER, ".") for s in raw]


def has_hebrew(s):
    return bool(re.search(rf"[{HEBREW_RANGE}]", s))


def has_latin(s):
    return bool(re.search(r"[A-Za-z]", s))


def filter_sentences(raw_sentences, min_len=3):
    seen = set()
    final = []
    for s in raw_sentences:
        s = s.strip()
        if not s or len(s) < min_len:
            continue
        if not has_hebrew(s):
            continue
        if has_latin(s):
            # Skip sentences mixing Hebrew and English (or pure English).
            continue
        if s not in seen:
            seen.add(s)
            final.append(s)
    return final


def extract(html_path, use_wiki_stop=True, content_selector=None):
    with open(html_path, encoding="utf-8", errors="ignore") as f:
        html = f.read()
    parser = "lxml"
    try:
        soup = BeautifulSoup(html, parser)
    except Exception:
        soup = BeautifulSoup(html, "html.parser")

    content = find_content_root(soup, content_selector)
    strip_noise(content)
    blocks = collect_blocks(content, use_wiki_stop)
    raw_text = extract_raw_text(blocks)
    raw_sentences = split_sentences(raw_text)
    return filter_sentences(raw_sentences)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_html")
    parser.add_argument("output_csv")
    parser.add_argument("--no-wiki-stop", action="store_true",
                         help="Disable the ראו גם/קישורים חיצוניים/הערות שוליים heading cutoff (use for non-Wikipedia pages)")
    parser.add_argument("--content-selector", default=None,
                         help="CSS selector for the main content container (default: auto-detect, falls back to div#mw-content-text then <main>/<article>/<body>)")
    args = parser.parse_args()

    sentences = extract(
        args.input_html,
        use_wiki_stop=not args.no_wiki_stop,
        content_selector=args.content_selector,
    )

    with open(args.output_csv, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["sentence"])
        for s in sentences:
            writer.writerow([s])

    print(f"Wrote {len(sentences)} sentences to {args.output_csv}")


if __name__ == "__main__":
    main()

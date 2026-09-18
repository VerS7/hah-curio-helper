# Curio Dumper (`tools/dump`)

> High-throughput, asynchronous web scraper and data extraction pipeline for Haven & Hearth curiosities from the [Ring of Brodgar Wiki](https://ringofbrodgar.com).

---

## 1. Overview

The `tools/dump` suite is an asynchronous Python application that scrapes, parses, normalizes, and enriches curiosity data from the Ring of Brodgar wiki. It outputs a rich JSON dataset containing base statistics, grid dimensions, crafting requirements, skill associations, and parsed quality scaling formulas.

### Key Capabilities
- **Composable Pipeline**: Configurable multi-stage execution pipeline supporting shallow table scraping, deep infobox page crawls, gemstone permutation generation, manual wiki correction patches, and image downloading.
- **Asynchronous Concurrency**: Built with `asyncio` and `aiohttp` using semaphore-bounded request throttling to maximize throughput while avoiding rate-limiting.
- **Mathematical Formula Extraction**: Converts MathML markup from wiki pages into LaTeX using Pandoc, then parses them into normalized formulas and softcap attribute lists using `flatlatex`.
- **Gemstone Resolution**: Automatically generates all 540 cut gemstone variants (15 gemstone families &times; 6 sizes &times; 6 cuts) with accurate LP multipliers, mental weights, and wiki image links.
- **Controversial Cases Handling**: Applies deterministic patches for known wiki errata, multi-variant curiosities (`Pickled Brain` and `Bug Collection`), and broken asset URLs.

---

## 2. Directory Structure

```text
tools/dump/
├── main.py            # CLI entry point, argument parsing, pipeline runner
├── crawler.py         # Core scraping routines, HTML parsers, patch logic
├── pipeline.py        # Pipeline abstraction, stage registration, uniqueness validation
├── models.py          # Strongly-typed dataclasses (Curiosity, Requirements, etc.)
├── math_parser.py     # Pandoc MathML -> LaTeX -> plaintext formula parsing
├── constants.py       # Softcap stats, gemstone families, sizes, cuts, HTTP headers
├── requirements.txt   # Python package dependencies
└── pandoc.exe         # Bundled standalone Pandoc executable (Windows)
```

---

## 3. Prerequisites & Installation

### Python Environment
- Python 3.10+ recommended.
- Install dependencies:
  ```powershell
  pip install -r tools/dump/requirements.txt
  ```

### Pandoc Dependency
Pandoc is required for the `deep` stage to convert MathML formula elements into LaTeX.
- On Windows: A bundled `pandoc.exe` is already present in `tools/dump/` and is automatically discovered.
- On Linux / macOS: Install Pandoc via your system package manager (e.g., `sudo apt install pandoc` or `brew install pandoc`), or specify its path using the `--pandoc-path` CLI option or `PANDOC_PATH` environment variable.

---

## 4. Pipeline Architecture & Stages

The scraper operates as a sequential pipeline configured via the `--pipeline` / `-p` flag:

```text
[read] OR [shallow] ──> [deep] ──> [gemstones] ──> [cases] ──> [write] ──> [images]
```

### Available Stages

| Stage Name | Unique? | Description |
|---|---|---|
| `shallow` | Yes | Scrapes the top-level table at `/wiki/Curiosity` to extract base entries: `name`, `image`, `url`, `baseLP`, `mentalWeight`, `expCost`, and `studySeconds`. |
| `deep` | Yes | Iterates through each curiosity's wiki article to extract grid size ($w \times h$), crafting station/producer, required skills, ingredients, and MathML quality formulas. |
| `gemstones` | Yes | Resolves the 15 base gemstones into all 540 size/cut permutations ($6 \text{ sizes} \times 6 \text{ cuts}$), computing scaled `baseLP` and `mentalWeight`. |
| `cases` (alias: `controversial`) | Yes | Applies manual data patches for known wiki inaccuracies and expands multi-variant items (`Pickled Brain`, `Bug Collection`). |
| `read` | Yes | Loads an existing JSON file (`--input`) into memory instead of scraping from scratch. |
| `write` | No (Repeatable) | Serializes the in-memory dataset to JSON (`--output`). If used multiple times in one pipeline run, subsequent writes prefix filenames with stage indexes (e.g. `1_curiosities.json`). |
| `images` | Yes | Downloads high-resolution curiosity icon files to `--images-dir`. |

---

## 5. Domain Rules & Wiki Corrections (`cases` Stage)

The `cases` (or `controversial`) stage handles discrepancies between in-game Haven & Hearth mechanics and Ring of Brodgar wiki entries:

1. **Arrow-Shattered Arrow**: Fixes missing material links for `Stone Arrow`, `Bone Arrow`, and `Metal Arrow`.
2. **Missing Icons**:
   - `Glowshroom (seed)`: Replaces missing icon with `File:Glowshroom.png`.
   - `Upside-Downbeldore`: Points to `File:Dumbledore.png`.
3. **Corndolly Lantern**: Corrects wiki base LP typo to `350`.
4. **Pickled Brain Variants**:
   The wiki only lists a single generic entry. In-game, four sizes exist with identical mental weight (15) and grid size ($1 \times 1$), but different LP and durations:
   - `Pickled Brain (Tiny)`: 500 LP, 10,920s (3h 2m)
   - `Pickled Brain (Small)`: 1,000 LP, 16,380s (4h 33m)
   - `Pickled Brain`: 2,000 LP, 21,840s (6h 4m)
   - `Pickled Brain (Big)`: 4,000 LP, 27,300s (7h 35m)
5. **Bug Collection Variants**:
   The wiki lists only the 6/6 complete collection. In-game, collections can be studied starting at 2 bugs up to 6 bugs (all $2 \times 1$ grid, weight 30):
   - `Bug Collection (2/6)`: 4,000 LP, 43,380s (12h 3m)
   - `Bug Collection (3/6)`: 6,000 LP, 50,520s (14h 2m)
   - `Bug Collection (4/6)`: 8,000 LP, 57,720s (16h 2m)
   - `Bug Collection (5/6)`: 10,000 LP, 64,980s (18h 3m)
   - `Bug Collection (6/6)`: 12,000 LP, 72,180s (20h 3m)

---

## 6. CLI Usage & Common Workflows

### Full Scraping Run (Produces Master Dataset)
To crawl the wiki from scratch, parse all details and formulas, resolve gemstones, apply patches, and export to `tools/format/curiosities.json`:

```powershell
python tools/dump/main.py -p shallow,deep,gemstones,cases,write -o tools/format/curiosities.json --concurrency 10
```

### Fast Offline Re-Processing (No Network Calls)
If you modify `resolve_controversial_cases()` in `crawler.py` or want to re-apply transformations without re-crawling the wiki:

```powershell
python tools/dump/main.py -p read,cases,write -i tools/format/curiosities.json -o tools/format/curiosities.json
```

### Downloading Curiosity Images
To download curiosity artwork locally from Ring of Brodgar:

```powershell
python tools/dump/main.py -p read,images -i tools/format/curiosities.json --images-dir tools/dump/images --concurrency 8
```

### CLI Arguments Reference

| Argument | Short | Default | Description |
|---|---|---|---|
| `--pipeline` | `-p` | `""` | Comma-separated list of pipeline stages to execute. |
| `--input` | `-i` | `curiosities.json` | Path to input JSON file (required when `read` is in the pipeline). |
| `--output` | `-o` | `curiosities.json` | Path to destination JSON file (used by `write` stage). |
| `--images-dir` | | `images` | Destination directory for downloaded curiosity images. |
| `--concurrency` | `-c` | `10` | Maximum number of simultaneous HTTP requests. |
| `--pandoc-path` | | `None` | Explicit path to Pandoc binary (auto-discovered if omitted). |

---

## 7. Data Models (`models.py`)

The JSON structure exported by `write` follows the `Curiosity` dataclass:

```json
{
  "name": "Pickled Brain (Big)",
  "image": "https://ringofbrodgar.com/wiki/File:Pickled_Brain.png",
  "url": "https://ringofbrodgar.com/wiki/Pickled_Brain",
  "baseLP": 4000,
  "mentalWeight": 15,
  "expCost": 12,
  "studySeconds": 27300,
  "size": {
    "width": 1,
    "height": 1
  },
  "requirements": {
    "producer": { "name": "Glass Jar", "url": "https://ringofbrodgar.com/wiki/Glass_Jar" },
    "quality": {
      "formula": "(Brain+Vinegar)/2",
      "params": ["Brain", "Vinegar"],
      "softcap": []
    },
    "skills": [{ "name": "Cooking", "url": "https://ringofbrodgar.com/wiki/Cooking" }],
    "materials": [
      { "name": "Brain", "url": "https://ringofbrodgar.com/wiki/Brain" },
      { "name": "Vinegar", "url": "https://ringofbrodgar.com/wiki/Vinegar" }
    ]
  }
}
```

---

## 8. Guidelines for AI & Human Contributors

1. **Do Not Spam the Wiki**: Keep `--concurrency` at $\le 10$ to respect Ring of Brodgar wiki resources. Exponential backoff retry logic is implemented in `fetch_text()`.
2. **Preserve Determinism**: Ensure all lists and dictionary iterations remain deterministic across operating systems.
3. **Adding New Curios / Fixes**: When fixing wiki errors or expanding variant items, place the logic inside `resolve_controversial_cases()` in `crawler.py` rather than manually editing output files.
4. **Downstream Synchronization**: Any modification to `tools/format/curiosities.json` must be followed by re-running `tools/format/data_from_json.py` to regenerate `data.js`.

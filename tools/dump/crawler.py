import asyncio
import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

import aiofiles
import aiohttp
from bs4 import BeautifulSoup

from constants import (
    BASE_PATH,
    DEFAULT_HEADERS,
    GEMSTONE_CUTS,
    GEMSTONE_SIZES,
    GEMSTONES,
)
from math_parser import (
    formula_from_string,
    latex_to_string,
    mathml_to_latex,
    purify,
    softcaps_from_string,
)
from models import BaseEntry, Curiosity, Quality, Requirements, Size


def parse_duration(duration_str: str) -> float:
    """Parse duration strings like '218h 50m' or '30m' into total seconds."""
    cleaned = duration_str.strip().replace(" ", "")
    total_seconds = 0.0
    pattern = re.compile(
        r"(?:(?P<days>\d+(?:\.\d+)?)d)?"
        r"(?:(?P<hours>\d+(?:\.\d+)?)h)?"
        r"(?:(?P<minutes>\d+(?:\.\d+)?)m)?"
        r"(?:(?P<seconds>\d+(?:\.\d+)?)s)?"
    )
    match = pattern.fullmatch(cleaned)
    if match:
        parts = match.groupdict()
        if parts["days"]:
            total_seconds += float(parts["days"]) * 86400
        if parts["hours"]:
            total_seconds += float(parts["hours"]) * 3600
        if parts["minutes"]:
            total_seconds += float(parts["minutes"]) * 60
        if parts["seconds"]:
            total_seconds += float(parts["seconds"])
    return total_seconds


async def fetch_text(session: aiohttp.ClientSession, url: str, retries: int = 3) -> str:
    """Fetch URL text content with retries and exponential backoff."""
    delay = 1.0
    for attempt in range(retries):
        try:
            async with session.get(
                url, headers=DEFAULT_HEADERS, timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status == 200:
                    return await resp.text()
                if resp.status in (429, 500, 502, 503, 504):
                    await asyncio.sleep(delay)
                    delay *= 2
                    continue
                resp.raise_for_status()
        except (aiohttp.ClientError, asyncio.TimeoutError):
            if attempt == retries - 1:
                raise
            await asyncio.sleep(delay)
            delay *= 2
    raise RuntimeError(f"Failed to fetch {url} after {retries} attempts")


async def parse_curiosities_table(session: aiohttp.ClientSession) -> list[Curiosity]:
    """Parse the main curiosity table from /wiki/Curiosity (Stage: shallow)."""
    print("-- Parsing curiosities from table --")
    url = f"{BASE_PATH}/wiki/Curiosity"
    html = await fetch_text(session, url)
    soup = BeautifulSoup(html, "html.parser")

    table = soup.select_one("table.smwtable.wikitable")
    if not table:
        raise RuntimeError("Curiosities table not found on page")

    curiosities: list[Curiosity] = []
    tbody = table.select_one("tbody") or table
    for row in tbody.find_all("tr"):
        # Skip header rows
        if row.find("th"):
            continue

        name_el = row.select_one(".Name")
        if not name_el:
            continue
        name = purify(name_el.get_text())

        name_a = row.select_one(".Name a")
        item_url = (BASE_PATH + name_a["href"]) if name_a and name_a.get("href") else ""

        img_a = row.select_one(".Img a")
        img_url = (BASE_PATH + img_a["href"]) if img_a and img_a.get("href") else ""

        base_lp_el = row.select_one(".Base-LP")
        base_lp_val = (
            base_lp_el.get("data-sort-value")
            if base_lp_el and base_lp_el.has_attr("data-sort-value")
            else (base_lp_el.get_text() if base_lp_el else "0")
        )
        try:
            base_lp = int(base_lp_val.replace(",", "").strip())
        except (ValueError, AttributeError):
            base_lp = 0

        mw_el = row.select_one(".Mental-Weight")
        mw_val = (
            mw_el.get("data-sort-value")
            if mw_el and mw_el.has_attr("data-sort-value")
            else (mw_el.get_text() if mw_el else "0")
        )
        try:
            mental_weight = int(mw_val.replace(",", "").strip())
        except (ValueError, AttributeError):
            mental_weight = 0

        exp_el = row.select_one(".Experience-Cost")
        exp_val = (
            exp_el.get("data-sort-value")
            if exp_el and exp_el.has_attr("data-sort-value")
            else (exp_el.get_text() if exp_el else "0")
        )
        try:
            exp_cost = int(exp_val.replace(",", "").strip())
        except (ValueError, AttributeError):
            exp_cost = 0

        study_time_el = row.find(class_=lambda c: bool(c and "Study-Time" in c))
        study_seconds = (
            parse_duration(study_time_el.get_text()) if study_time_el else 0.0
        )

        curiosities.append(
            Curiosity(
                name=name,
                image=img_url,
                url=item_url,
                baseLP=base_lp,
                mentalWeight=mental_weight,
                expCost=exp_cost,
                studySeconds=study_seconds,
            )
        )

    return curiosities


async def parse_single_curiosity(
    session: aiohttp.ClientSession,
    curio: Curiosity,
    pandoc_path: str | None = None,
) -> None:
    """Fetch and parse detailed infobox & math quality for a single curiosity."""
    html = await fetch_text(session, curio.url)
    soup = BeautifulSoup(html, "html.parser")

    quality = Quality()

    # Parse MathJax/MathML formulas
    for math_el in soup.select("math.mwe-math-element"):
        try:
            latex = await mathml_to_latex(str(math_el), pandoc_path)
            parsed = latex_to_string(latex)
            if not parsed:
                continue

            try:
                formula, params = formula_from_string(parsed)
                quality.formula = formula
                quality.params = params
            except ValueError:
                pass

            try:
                softcaps = softcaps_from_string(parsed)
                quality.softcap = softcaps
            except ValueError:
                pass
        except Exception:  # noqa: BLE001, S110
            pass

    # Parse infobox table
    infobox = soup.select_one("table.infobox.boxed")
    if infobox:
        width, height = 0, 0
        producer: BaseEntry | None = None
        skills: list[BaseEntry] = []
        materials: list[BaseEntry] = []

        for row in infobox.find_all("tr"):
            b_tag = row.find("b")
            b_text = b_tag.get_text() if b_tag else ""
            tds = row.find_all("td")

            # Size
            if "(item)" in b_text and len(tds) > 1:
                size_raw = purify(tds[1].get_text()).replace(" ", "")
                if "x" in size_raw:
                    parts = size_raw.split("x")
                    try:
                        width = int(parts[0])
                        height = int(parts[1])
                    except ValueError:
                        pass

            # Skills required
            if "Skill(s) Required" in b_text and len(tds) > 1:
                td_text = purify(tds[1].get_text())
                if "(Unknown)" not in td_text:
                    for a in tds[1].find_all("a"):
                        href = a.get("href", "")
                        link_url = (BASE_PATH + href) if href else ""
                        skills.append(
                            BaseEntry(name=purify(a.get_text()), url=link_url)
                        )

            # Objects required (materials)
            if "Object(s) Required" in b_text and len(tds) > 1:
                td_text = purify(tds[1].get_text())
                if "None" not in td_text:
                    for a in tds[1].find_all("a"):
                        href = a.get("href", "")
                        link_url = (BASE_PATH + href) if href else ""
                        materials.append(
                            BaseEntry(name=purify(a.get_text()), url=link_url)
                        )

            # Produced By
            if "Produced By" in b_text and len(tds) > 1:
                td = tds[1]
                a = td.find("a")
                href = a.get("href", "") if a else ""
                link_url = (BASE_PATH + href) if href else ""
                producer = BaseEntry(name=purify(td.get_text()), url=link_url)

        if width > 0 or height > 0:
            curio.size = Size(width=width, height=height)

        curio.requirements = Requirements(
            producer=producer,
            quality=quality if not quality.is_empty() else None,
            skills=skills,
            materials=materials,
        )


async def deep_parse_curiosities(
    session: aiohttp.ClientSession,
    curiosities: list[Curiosity],
    semaphore: asyncio.Semaphore,
    pandoc_path: str | None = None,
) -> list[Curiosity]:
    """Visit each curiosity page to parse size, requirements, and quality formulas (Stage: deep)."""
    print("-- Deeply parsing curiosities --")
    total = len(curiosities)
    counter = 0
    lock = asyncio.Lock()

    async def worker(c: Curiosity):
        nonlocal counter
        async with semaphore:
            async with lock:
                counter += 1
                current_idx = counter
            print(f"[{current_idx}/{total}] Visiting {c.url}...")
            try:
                await parse_single_curiosity(session, c, pandoc_path)
            except Exception as exc:  # noqa: BLE001
                print(f"Error parsing {c.url}: {exc}")

    tasks = [asyncio.create_task(worker(c)) for c in curiosities]
    await asyncio.gather(*tasks)
    return curiosities


async def resolve_gemstones(
    session: aiohttp.ClientSession,
    curiosities: list[Curiosity],
    semaphore: asyncio.Semaphore,
) -> list[Curiosity]:
    """Expand gemstone curiosities into 36 size/cut variations (Stage: gemstones)."""
    print("-- Resolving Gemstones --")
    gemstones_map: dict[str, Curiosity] = {}
    for c in curiosities:
        if c.name in GEMSTONES:
            gemstones_map[c.name] = c

    new_curiosities: list[Curiosity] = []
    gem_results: dict[str, list[Curiosity]] = {}

    total_gems = len(gemstones_map)
    counter = 0
    lock = asyncio.Lock()

    async def process_gem(base_gem: Curiosity):
        nonlocal counter
        async with semaphore:
            async with lock:
                counter += 1
                current_idx = counter
            print(f"[{current_idx}/{total_gems}] Visiting {base_gem.url}...")
            html = await fetch_text(session, base_gem.url)
            soup = BeautifulSoup(html, "html.parser")
            wikitables = soup.select("table.wikitable")
            if len(wikitables) < 2:
                print(
                    f"Warning: Gemstone {base_gem.name} does not have required tables"
                )
                return

            # Parse images matrix 6x6
            images: list[list[str]] = [["" for _ in range(6)] for _ in range(6)]
            img_table = wikitables[0]
            img_rows = img_table.find_all("tr")
            for i, row in enumerate(img_rows):
                if i == 0:
                    continue
                cells = row.find_all(["td", "th"])
                for j, cell in enumerate(cells):
                    if j == 0:
                        continue
                    if i - 1 < 6 and j - 1 < 6:
                        a_el = cell.select_one("span a")
                        images[i - 1][j - 1] = a_el.get("href", "") if a_el else ""

            # Parse LP table
            lp_table = wikitables[1]
            lp_rows = lp_table.find_all("tr")
            if len(lp_rows) > 1:
                cells = lp_rows[1].find_all(["td", "th"])
                if len(cells) > 1:
                    raw_lp = cells[1].get_text().replace(",", "").strip()
                    try:
                        base_lp = int(raw_lp)
                    except ValueError:
                        base_lp = 0

                    variations: list[Curiosity] = []
                    for s_idx, size in enumerate(GEMSTONE_SIZES):
                        for c_idx, cut in enumerate(GEMSTONE_CUTS):
                            image_path = images[s_idx][c_idx]
                            image = BASE_PATH + image_path
                            if "index.php" in image or not image_path:
                                image = base_gem.image

                            multiplier = (s_idx + 1) * (c_idx + 1)
                            variations.append(
                                Curiosity(
                                    name=f"{size} {cut} {base_gem.name}",
                                    image=image,
                                    url=base_gem.url,
                                    baseLP=base_lp * multiplier,
                                    mentalWeight=multiplier,
                                    expCost=base_gem.expCost,
                                    studySeconds=base_gem.studySeconds,
                                    size=base_gem.size,
                                    requirements=base_gem.requirements,
                                )
                            )
                    gem_results[base_gem.name] = variations

    tasks = [asyncio.create_task(process_gem(gem)) for gem in gemstones_map.values()]
    await asyncio.gather(*tasks)

    for curio in curiosities:
        if curio.name in gemstones_map:
            variations = gem_results.get(curio.name, [])
            new_curiosities.extend(variations)
        else:
            new_curiosities.append(curio)

    return new_curiosities


def resolve_controversial_cases(curiosities: list[Curiosity]) -> list[Curiosity]:
    """Apply manual corrections for known wiki inaccuracies (Stage: cases)."""
    print("-- Resolving controversial cases --")
    new_curiosities: list[Curiosity] = []
    for curio in curiosities:
        # Incorrect materials list in Arrow-Shattered Arrow
        if curio.name == "Arrow-Shattered Arrow":
            if len(curio.requirements.materials) >= 4:
                curio.requirements.materials[1].name = "Stone Arrow"
                curio.requirements.materials[2].name = "Bone Arrow"
                curio.requirements.materials[3].name = "Metal Arrow"

        # No icon for Glowshroom (seed)
        elif curio.name == "Glowshroom (seed)":
            curio.image = "https://ringofbrodgar.com/wiki/File:Glowshroom.png"

        # No icon for Upside-Downbeldore, only for regular one
        elif curio.name == "Upside-Downbeldore":
            curio.image = "https://ringofbrodgar.com/wiki/File:Dumbledore.png"

        # Wrong baseLP of Corndolly Lantern
        elif curio.name == "Corndolly Lantern":
            curio.baseLP = 350

        # Only one pickled brain presented & incorrect timings
        elif curio.name == "Pickled Brain":
            brain_params = {
                "Tiny": (500, 10920),
                "Small": (1000, 16380),
                "Medium": (2000, 21840),
                "Big": (4000, 27300),
            }

            for name, params in brain_params.items():
                new_curio = deepcopy(curio)

                if name != "Medium":
                    new_curio.name = new_curio.name + f" ({name})"

                new_curio.baseLP = params[0]
                new_curio.studySeconds = params[1]

                new_curiosities.append(new_curio)
            continue

        # Only Bug Collection with 6 unique bugs presented
        elif curio.name == "Bug Collection":
            bugcol_params = {
                "2/6": (4000, 43380),
                "3/6": (6000, 50520),
                "4/6": (8000, 57720),
                "5/6": (10000, 64980),
                "6/6": (12000, 72180),
            }

            for name, params in bugcol_params.items():
                new_curio = deepcopy(curio)

                new_curio.name = new_curio.name + f" ({name})"
                new_curio.baseLP = params[0]
                new_curio.studySeconds = params[1]

                new_curiosities.append(new_curio)
            continue

        new_curiosities.append(curio)

    return new_curiosities


async def download_curiosity_images(
    session: aiohttp.ClientSession,
    curiosities: list[Curiosity],
    output_dir: str | Path,
    semaphore: asyncio.Semaphore,
) -> None:
    """Download curiosity images concurrently (Stage: images)."""
    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    total = len(curiosities)
    counter = 0
    lock = asyncio.Lock()

    async def download_one(c: Curiosity):
        nonlocal counter
        async with semaphore:
            async with lock:
                counter += 1
                current_idx = counter
            print(f"[{current_idx}/{total}] downloading image for {c.name}...")
            image_url = c.image.replace(
                "https://ringofbrodgar.com/wiki/File:",
                "https://ringofbrodgar.com/wiki/Special:FilePath/",
            )
            filename = c.image.replace("https://ringofbrodgar.com/wiki/File:", "")
            file_path = target_dir / filename

            try:
                async with session.get(image_url, headers=DEFAULT_HEADERS) as resp:
                    if resp.status == 200:
                        content = await resp.read()
                        async with aiofiles.open(file_path, "wb") as f:
                            await f.write(content)
                    else:
                        print(
                            f"Warning: Failed to download {image_url} (HTTP {resp.status})"
                        )
            except Exception as exc:  # noqa: BLE001
                print(f"Error downloading image for {c.name}: {exc}")

    tasks = [asyncio.create_task(download_one(c)) for c in curiosities]
    await asyncio.gather(*tasks)


def read_curiosities(filepath: str | Path) -> list[Curiosity]:
    """Load curiosities from JSON file (Stage: read)."""
    print(f"-- Loading curiosities from {filepath} --")
    with open(filepath, "r", encoding="utf-8") as f:
        data: list[dict[str, Any]] = json.load(f)
    return [Curiosity.from_dict(item) for item in data]


def write_curiosities(curiosities: list[Curiosity], filepath: str | Path) -> None:
    """Save curiosities to JSON file (Stage: write)."""
    print(f"-- Writing to {filepath} --")
    out_dir = Path(filepath).parent
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
    serialized = [c.to_dict() for c in curiosities]
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(serialized, f, indent=4, ensure_ascii=False)
        f.write("\n")

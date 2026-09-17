import argparse
import asyncio
import sys
from pathlib import Path

import aiohttp
from crawler import (
    deep_parse_curiosities,
    download_curiosity_images,
    parse_curiosities_table,
    read_curiosities,
    resolve_controversial_cases,
    resolve_gemstones,
    write_curiosities,
)
from models import Curiosity
from pipeline import Pipeline


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Haven And Hearth Curiosity dump from ringofbrodgar.com wiki",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--pipeline",
        "-p",
        type=str,
        default="",
        help=(
            "Parsing pipeline of comma-separated stages. "
            "Available unique stages: shallow, deep, gemstones, cases (alias: controversial), images, read. "
            "Available repeatable: write."
        ),
    )
    parser.add_argument(
        "--input",
        "-i",
        type=str,
        default="curiosities.json",
        help="File with partly-parsed curiosities. Only usable if 'shallow' stage not provided in pipeline.",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default="curiosities.json",
        help="File with parsed output. With multiple 'write' stages output will be prefixed with stage index.",
    )
    parser.add_argument(
        "--images-dir",
        type=str,
        default="images",
        help="Directory for curiosity images. Only usable if 'images' provided in pipeline.",
    )
    parser.add_argument(
        "--concurrency",
        "-c",
        type=int,
        default=10,
        help="Maximum number of concurrent HTTP requests.",
    )
    parser.add_argument(
        "--pandoc-path",
        type=str,
        default=None,
        help="Optional custom path to pandoc executable.",
    )

    return parser.parse_args()


async def async_main() -> None:
    # Ensure stdout/stderr handles UTF-8 on Windows
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except AttributeError:
            pass
    if sys.stderr.encoding and sys.stderr.encoding.lower() != "utf-8":
        try:
            sys.stderr.reconfigure(encoding="utf-8")
        except AttributeError:
            pass

    args = parse_args()

    if not args.pipeline:
        print("Haven And Hearth Curiosity dump from ringofbrodgar.com wiki")
        print("No stages specified in --pipeline. Pass --help for options.")
        return

    pipeline = Pipeline.from_string(args.pipeline)
    semaphore = asyncio.Semaphore(args.concurrency)

    curiosities: list[Curiosity] = []
    write_count = 0

    async with aiohttp.ClientSession() as session:
        for i, stage in enumerate(pipeline.stages):
            print(f"[{i + 1}/{len(pipeline.stages)}] Pipeline stage '{stage.name}'...")

            if stage.name == "shallow":
                curiosities = await parse_curiosities_table(session)
            elif stage.name == "deep":
                curiosities = await deep_parse_curiosities(
                    session, curiosities, semaphore, args.pandoc_path
                )
            elif stage.name == "gemstones":
                curiosities = await resolve_gemstones(session, curiosities, semaphore)
            elif stage.name == "cases":
                curiosities = resolve_controversial_cases(curiosities)
            elif stage.name == "read":
                curiosities = read_curiosities(args.input)
            elif stage.name == "images":
                await download_curiosity_images(
                    session, curiosities, args.images_dir, semaphore
                )
            elif stage.name == "write":
                if write_count == 0:
                    fp = args.output
                else:
                    out_path = Path(args.output)
                    new_filename = f"{write_count}_{out_path.name}"
                    fp = str(out_path.parent / new_filename)

                write_curiosities(curiosities, fp)
                write_count += 1


def main() -> None:
    try:
        asyncio.run(async_main())
    except KeyboardInterrupt:
        print("\nInterrupted by user.")
        sys.exit(130)


if __name__ == "__main__":
    main()

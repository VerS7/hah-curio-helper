"""Constants used across the curio-dump crawler and parsers."""

BASE_PATH = "https://ringofbrodgar.com"

SOFTCAP_ATTRIBUTES: list[str] = [
    "Strength",
    "Agility",
    "Intelligence",
    "Constitution",
    "Perception",
    "Charisma",
    "Dexterity",
    "Will",
    "Psyche",
    "Unarmed Combat",
    "Melee Combat",
    "Marksmanship",
    "Exploration",
    "Stealth",
    "Sewing",
    "Smithing",
    "Masonry",
    "Carpentry",
    "Cooking",
    "Farming",
    "Survival",
    "Lore",
]

GEMSTONES: list[str] = [
    "Amber",
    "Amethyst",
    "Diamond",
    "Dust Jewel",
    "Emerald",
    "Jade",
    "Moonstone",
    "Onyx",
    "Opal",
    "Red Coral",
    "Ruby",
    "Sapphire",
    "Sugar Diamond",
    "Topaz",
    "Turquoise",
]

GEMSTONE_SIZES: list[str] = [
    "Tiny",
    "Small",
    "Fair",
    "Large",
    "Grand",
    "Jotun",
]

GEMSTONE_CUTS: list[str] = [
    "Rough",
    "Smooth",
    "Cabochon",
    "Pear",
    "Heart",
    "Brilliant",
]

DEFAULT_HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

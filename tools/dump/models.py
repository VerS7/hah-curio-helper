from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class BaseEntry:
    name: str = ""
    url: str = ""

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"name": self.name}
        if self.url:
            result["url"] = self.url
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Optional["BaseEntry"]:
        if not data or not data.get("name"):
            return None
        return cls(name=data.get("name", ""), url=data.get("url", ""))


@dataclass
class Quality:
    formula: str = ""
    params: list[str] = field(default_factory=list)
    softcap: list[str] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not self.formula and not self.params and not self.softcap

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        if self.formula:
            result["formula"] = self.formula
        if self.params:
            result["params"] = self.params
        if self.softcap:
            result["softcap"] = self.softcap
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Optional["Quality"]:
        if not data:
            return None
        return cls(
            formula=data.get("formula", ""),
            params=list(data.get("params", [])),
            softcap=list(data.get("softcap", [])),
        )


@dataclass
class Requirements:
    producer: BaseEntry | None = None
    quality: Quality | None = None
    skills: list[BaseEntry] = field(default_factory=list)
    materials: list[BaseEntry] = field(default_factory=list)

    def is_empty(self) -> bool:
        producer_empty = self.producer is None or not self.producer.name
        quality_empty = self.quality is None or self.quality.is_empty()
        skills_empty = not self.skills
        materials_empty = not self.materials
        return producer_empty and quality_empty and skills_empty and materials_empty

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        if self.producer and self.producer.name:
            result["producer"] = self.producer.to_dict()
        if self.quality and not self.quality.is_empty():
            result["quality"] = self.quality.to_dict()
        if self.skills:
            result["skills"] = [s.to_dict() for s in self.skills]
        if self.materials:
            result["materials"] = [m.to_dict() for m in self.materials]
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "Requirements":
        if not data:
            return cls()
        producer = BaseEntry.from_dict(data.get("producer"))
        quality = Quality.from_dict(data.get("quality"))
        skills = [
            s
            for item in data.get("skills", [])
            if (s := BaseEntry.from_dict(item)) is not None
        ]
        materials = [
            m
            for item in data.get("materials", [])
            if (m := BaseEntry.from_dict(item)) is not None
        ]
        return cls(
            producer=producer, quality=quality, skills=skills, materials=materials
        )


@dataclass
class Size:
    width: int = 0
    height: int = 0

    def is_empty(self) -> bool:
        return self.width == 0 and self.height == 0

    def to_dict(self) -> dict[str, int]:
        return {"width": self.width, "height": self.height}

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Optional["Size"]:
        if not data:
            return cls()
        return cls(width=int(data.get("width", 0)), height=int(data.get("height", 0)))


@dataclass
class Curiosity:
    name: str = ""
    image: str = ""
    url: str = ""
    baseLP: int = 0
    mentalWeight: int = 0
    expCost: int = 0
    studySeconds: float = 0.0
    size: Size = field(default_factory=Size)
    requirements: Requirements = field(default_factory=Requirements)

    def to_dict(self) -> dict[str, Any]:
        study_sec = (
            int(self.studySeconds)
            if isinstance(self.studySeconds, (int, float))
            and float(self.studySeconds).is_integer()
            else self.studySeconds
        )
        result: dict[str, Any] = {
            "name": self.name,
            "image": self.image,
            "url": self.url,
            "baseLP": self.baseLP,
            "mentalWeight": self.mentalWeight,
            "expCost": self.expCost,
            "studySeconds": study_sec,
        }
        if not self.size.is_empty():
            result["size"] = self.size.to_dict()
        if not self.requirements.is_empty():
            result["requirements"] = self.requirements.to_dict()
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Optional["Curiosity"]:
        return cls(
            name=data.get("name", ""),
            image=data.get("image", ""),
            url=data.get("url", ""),
            baseLP=int(data.get("baseLP", 0)),
            mentalWeight=int(data.get("mentalWeight", 0)),
            expCost=int(data.get("expCost", 0)),
            studySeconds=float(data.get("studySeconds", 0.0)),
            size=Size.from_dict(data.get("size")),
            requirements=Requirements.from_dict(data.get("requirements")),
        )

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field


@dataclass
class Stage:
    name: str
    unique: bool = True


DEFAULT_AVAILABLE_STAGES: dict[str, bool] = {
    "shallow": True,
    "deep": True,
    "gemstones": True,
    "cases": True,
    "controversial": True,  # Alias for 'cases'
    "images": True,
    "read": True,
    "write": False,
}


@dataclass
class Pipeline:
    stages: list[Stage] = field(default_factory=list)
    available_stages: dict[str, bool] = field(
        default_factory=lambda: dict(DEFAULT_AVAILABLE_STAGES)
    )

    def add_stage(self, name: str) -> None:
        canonical_name = name.strip()
        if not canonical_name:
            return

        # Support 'controversial' as alias for 'cases'
        if canonical_name == "controversial":
            canonical_name = "cases"

        if canonical_name not in self.available_stages:
            raise ValueError(
                f"Unknown stage '{canonical_name}'. "
                f"Available stages: {', '.join(k for k in self.available_stages if k != 'controversial')}"
            )

        is_unique = self.available_stages[canonical_name]
        if is_unique and any(st.name == canonical_name for st in self.stages):
            raise ValueError(f"Stage '{canonical_name}' must be unique")

        self.stages.append(Stage(name=canonical_name, unique=is_unique))

    @classmethod
    def from_string(cls, value: str) -> Pipeline:
        pipeline = cls()
        for part in value.split(","):
            part = part.strip()
            if part:
                pipeline.add_stage(part)
        return pipeline

    @classmethod
    def from_iterable(cls, stages: Sequence[str]) -> Pipeline:
        pipeline = cls()
        for stage in stages:
            pipeline.add_stage(stage)
        return pipeline

    def __iter__(self):
        return iter(self.stages)

    def __len__(self):
        return len(self.stages)

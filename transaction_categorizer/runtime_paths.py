from __future__ import annotations

import os
import sys
from pathlib import Path


APP_NAME = "Geldstrom"
REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_NAME = "all-MiniLM-L6-v2"
PORTABLE_MARKER = "portable_mode.flag"


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def resource_root() -> Path:
    if is_frozen() and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS).resolve()
    return REPO_ROOT


def install_root() -> Path:
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return REPO_ROOT


def portable_marker_path() -> Path:
    return install_root() / PORTABLE_MARKER


def is_portable_mode() -> bool:
    if os.environ.get("GELDSTROM_FORCE_PORTABLE") == "1":
        return True
    return is_frozen() and portable_marker_path().exists()


def persistent_root() -> Path:
    override = os.environ.get("GELDSTROM_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()

    if is_frozen():
        if is_portable_mode():
            return install_root()
        appdata_root = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if appdata_root:
            return Path(appdata_root) / APP_NAME
        return Path.home() / "AppData" / "Local" / APP_NAME

    return REPO_ROOT


def desktop_runtime_root() -> Path:
    if is_frozen() or os.environ.get("GELDSTROM_DATA_DIR"):
        return persistent_root()
    return REPO_ROOT / "desktop_app"


def ui_source_dir() -> Path:
    return resource_root() / "desktop_app" / "ui"


def runtime_ui_dir() -> Path:
    return desktop_runtime_root() / ".desktop_runtime"


def uploads_dir() -> Path:
    return desktop_runtime_root() / "uploads"


def categorizer_data_dir() -> Path:
    if is_frozen() or os.environ.get("GELDSTROM_DATA_DIR"):
        return persistent_root() / "transaction_categorizer"
    return REPO_ROOT / "transaction_categorizer"


def bundled_rules_path() -> Path:
    return resource_root() / "transaction_categorizer" / "rules" / "learned_rules.json"


def bundled_model_dir(model_name: str = MODEL_NAME) -> Path:
    return resource_root() / "transaction_categorizer" / "models" / model_name
from pathlib import Path

from runtime_paths import categorizer_data_dir


BASE_DIR = categorizer_data_dir()
DATA_PATH = BASE_DIR / "input" / "input.CSV"
OUTPUT_PATH = BASE_DIR / "output" / "result.json"
LEARNING_PATH = BASE_DIR / "rules" / "learned_rules.json"

DATE_FORMAT = "%d.%m.%y"
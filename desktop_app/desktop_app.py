from __future__ import annotations

import json
import os
import re
import shutil
import sys
import uuid
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

PROJECT_DIR = Path(__file__).resolve().parent.parent
TRANSACTION_CATEGORIZER_DIR = PROJECT_DIR / "transaction_categorizer"
if str(TRANSACTION_CATEGORIZER_DIR) not in sys.path:
    sys.path.insert(0, str(TRANSACTION_CATEGORIZER_DIR))

from categorizer import suggest_category
from clustering import create_clusters
from config import DATE_FORMAT, LEARNING_PATH
from learning import apply_learning, extract_keyword, load_rules, save_rules
from plotly.offline import get_plotlyjs
from PySide6.QtCore import QObject, QUrl, Slot
from PySide6.QtGui import QIcon
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QFileDialog, QMainWindow
import runtime_paths as runtime_paths_module


def configure_qt_runtime() -> None:
    if not getattr(sys, "frozen", False):
        return

    internal_root = Path(sys.executable).resolve().parent / "_internal"
    pyside_root = internal_root / "PySide6"
    plugins_root = pyside_root / "plugins"
    platforms_root = plugins_root / "platforms"
    webengine_process = pyside_root / "QtWebEngineProcess.exe"

    if plugins_root.exists():
        os.environ.setdefault("QT_PLUGIN_PATH", str(plugins_root))
    if platforms_root.exists():
        os.environ.setdefault("QT_QPA_PLATFORM_PLUGIN_PATH", str(platforms_root))
    if webengine_process.exists():
        os.environ.setdefault("QTWEBENGINEPROCESS_PATH", str(webengine_process))


configure_qt_runtime()


categorizer_data_dir = runtime_paths_module.categorizer_data_dir
install_root = runtime_paths_module.install_root
runtime_ui_dir = runtime_paths_module.runtime_ui_dir
ui_source_dir = runtime_paths_module.ui_source_dir
uploads_dir = runtime_paths_module.uploads_dir
is_portable_mode = getattr(runtime_paths_module, "is_portable_mode", lambda: False)

ROOT_DIR = install_root()
UPLOADS_DIR = uploads_dir()
UI_DIR = ui_source_dir()
RUNTIME_UI_DIR = runtime_ui_dir()
DATA_ROOT_DIR = categorizer_data_dir().parent
APP_ICON_PATH = runtime_paths_module.resource_root() / "resource" / "piggy_bank.png"

REQUIRED_CSV_COLUMNS = (
    "Buchungstag",
    "Betrag",
    "Buchungstext",
    "Verwendungszweck",
    "Beguenstigter/Zahlungspflichtiger",
)

CSV_ENCODING_CANDIDATES = ("utf-8", "utf-8-sig", "cp1252", "latin-1")


@dataclass
class UploadedFile:
    name: str
    path: Path
    data: list[dict]

    @property
    def count(self) -> int:
        return len(self.data)


@dataclass
class ReviewCandidate:
    row_index: int
    default_category: str
    default_rule_name: str
    rule_options: list[dict[str, str]]
    transaction: dict[str, object]


def normalize_payload(payload: object) -> list[dict]:
    if isinstance(payload, dict):
        return [payload]
    if isinstance(payload, list):
        if not all(isinstance(item, dict) for item in payload):
            raise ValueError("JSON-Listen dürfen nur Objekte enthalten.")
        return payload
    raise ValueError("JSON muss ein Objekt oder eine Liste von Objekten sein.")


def load_json_file(path: Path) -> list[dict]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Ungültiges JSON in {path.name}: {exc}") from exc
    return normalize_payload(payload)


def normalize_rule_name(value: object) -> str:
    normalized = str(value or "").strip().lower()
    return re.sub(r"\s+", " ", normalized)


def parse_csv_amount(value: object) -> float:
    normalized = str(value or "").strip().replace("€", "").replace(" ", "")
    if not normalized:
        return 0.0
    if "," in normalized and "." in normalized:
        normalized = normalized.replace(".", "").replace(",", ".")
    elif "," in normalized:
        normalized = normalized.replace(",", ".")
    return float(normalized)


def read_csv_with_fallbacks(source_path: Path) -> pd.DataFrame:
    last_error: UnicodeDecodeError | None = None
    for encoding in CSV_ENCODING_CANDIDATES:
        try:
            return pd.read_csv(source_path, sep=";", encoding=encoding)
        except UnicodeDecodeError as exc:
            last_error = exc

    tried_encodings = ", ".join(CSV_ENCODING_CANDIDATES)
    if last_error is not None:
        raise ValueError(
            f"Die CSV-Datei konnte mit keinem unterstützten Encoding gelesen werden ({tried_encodings}): {last_error}"
        ) from last_error
    raise ValueError("Die CSV-Datei konnte nicht gelesen werden.")


def load_processing_dataframe(source_path: Path) -> pd.DataFrame:
    if source_path.suffix.lower() != ".csv":
        raise ValueError("Nur CSV-Dateien können verarbeitet werden.")

    dataframe = read_csv_with_fallbacks(source_path)
    missing_columns = [column for column in REQUIRED_CSV_COLUMNS if column not in dataframe.columns]
    if missing_columns:
        missing = ", ".join(missing_columns)
        raise ValueError(f"Die CSV-Datei enthält nicht alle benötigten Spalten: {missing}.")

    dataframe = dataframe.copy()
    dataframe["Buchungstag"] = pd.to_datetime(dataframe["Buchungstag"], format=DATE_FORMAT)
    dataframe["Betrag"] = dataframe["Betrag"].apply(parse_csv_amount)

    for column in ("Buchungstext", "Verwendungszweck", "Beguenstigter/Zahlungspflichtiger"):
        dataframe[column] = dataframe[column].fillna("").astype(str)

    dataframe["Text"] = (
        dataframe["Buchungstext"]
        + " "
        + dataframe["Verwendungszweck"]
        + " "
        + dataframe["Beguenstigter/Zahlungspflichtiger"]
    ).str.strip()

    return dataframe


def build_keyword_candidates(text: str) -> list[str]:
    words = [
        word
        for word in re.findall(r"[a-zA-ZäöüÄÖÜ]+", text.lower())
        if word not in {
            "gmbh",
            "ag",
            "mbh",
            "und",
            "der",
            "die",
            "das",
            "zahlung",
            "kartenzahlung",
            "lastschrift",
            "debit",
            "paypal",
            "sepa",
        }
        and len(word) >= 3
    ]
    counter = Counter(words)
    ranked = sorted(counter.items(), key=lambda item: (-item[1], -len(item[0]), item[0]))
    candidates = [item[0] for item in ranked]
    fallback = normalize_rule_name(extract_keyword(text))
    if fallback and fallback not in candidates:
        candidates.append(fallback)
    return candidates


def shorten_label(value: str, limit: int = 56) -> str:
    compact = re.sub(r"\s+", " ", str(value or "").strip())
    if len(compact) <= limit:
        return compact
    return f"{compact[: limit - 1].rstrip()}…"


class TransactionRepository:
    def __init__(self, uploads_dir: Path):
        self.uploads_dir = uploads_dir
        self.ensure_uploads_dir()

    def ensure_uploads_dir(self) -> None:
        self.uploads_dir.mkdir(parents=True, exist_ok=True)

    def list_files(self) -> list[UploadedFile]:
        files: list[UploadedFile] = []
        for path in sorted(self.uploads_dir.glob("*.json"), key=lambda item: item.name.lower()):
            try:
                files.append(UploadedFile(path.name, path, load_json_file(path)))
            except ValueError:
                continue
        return files

    def copy_upload(self, source_path: Path, overwrite: bool = False) -> Path:
        if source_path.suffix.lower() != ".json":
            raise ValueError("Nur JSON-Dateien sind erlaubt.")

        load_json_file(source_path)
        destination = self.uploads_dir / source_path.name
        if destination.exists() and not overwrite:
            raise FileExistsError(f"{source_path.name} existiert bereits im uploads-Ordner.")

        shutil.copy2(source_path, destination)
        return destination

    def save_processed_upload(self, source_stem: str, data: list[dict]) -> Path:
        safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", source_stem).strip("._") or "upload"
        filename = f"{safe_stem}_{uuid.uuid4().hex}.json"
        destination = self.uploads_dir / filename
        destination.write_text(
            json.dumps(data, indent=4, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
        return destination

    def load_rules_text(self) -> str:
        if not LEARNING_PATH.exists():
            return "{}\n"
        payload = json.loads(LEARNING_PATH.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Die Rules-Datei muss ein JSON-Objekt enthalten.")
        return json.dumps(payload, indent=4, ensure_ascii=False)

    def save_rules_text(self, text: str) -> None:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Regeln-JSON ist ungültig: {exc}") from exc

        if not isinstance(payload, dict):
            raise ValueError("Die Rules-Datei muss ein JSON-Objekt enthalten.")

        LEARNING_PATH.parent.mkdir(parents=True, exist_ok=True)
        LEARNING_PATH.write_text(
            json.dumps(payload, indent=4, ensure_ascii=False),
            encoding="utf-8",
        )

    def delete_file(self, filename: str) -> None:
        self._resolve_filename(filename).unlink(missing_ok=False)

    def rename_file(self, current_name: str, new_name: str) -> str:
        target_name = new_name.strip()
        if not target_name:
            raise ValueError("Der neue Dateiname darf nicht leer sein.")
        if any(sep in target_name for sep in ("/", "\\")):
            raise ValueError("Dateinamen dürfen keine Pfadtrenner enthalten.")
        if not target_name.lower().endswith(".json"):
            target_name += ".json"

        source = self._resolve_filename(current_name)
        destination = self.uploads_dir / target_name
        if destination.exists() and destination != source:
            raise FileExistsError(f"{target_name} existiert bereits.")

        source.rename(destination)
        return destination.name

    def load_file_text(self, filename: str) -> str:
        path = self._resolve_filename(filename)
        payload = json.loads(path.read_text(encoding="utf-8"))
        return json.dumps(payload, indent=4, ensure_ascii=False)

    def save_file_text(self, filename: str, text: str) -> None:
        path = self._resolve_filename(filename)
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"JSON ist ungültig: {exc}") from exc

        normalize_payload(payload)
        path.write_text(json.dumps(payload, indent=4, ensure_ascii=False), encoding="utf-8")

    def _resolve_filename(self, filename: str) -> Path:
        clean_name = filename.strip()
        if not clean_name or any(sep in clean_name for sep in ("/", "\\")):
            raise ValueError("Ungültiger Dateiname.")
        path = self.uploads_dir / clean_name
        if not path.exists():
            raise FileNotFoundError(f"{clean_name} wurde nicht gefunden.")
        return path


class CategorizationSession:
    def __init__(self, source_path: Path, repository: TransactionRepository):
        self.session_id = uuid.uuid4().hex
        self.source_path = source_path
        self.repository = repository
        self.rules = load_rules()
        self.dataframe = load_processing_dataframe(source_path)
        if self.dataframe.empty:
            raise ValueError("Die CSV-Datei enthält keine Transaktionen.")

        self.categories: list[str | None] = [None] * len(self.dataframe)
        self.pending_candidates: list[ReviewCandidate] = []
        self.reviewed_count = 0
        self.cluster_names: dict[object, str] = {}
        self.category_catalog: set[str] = set()
        for uploaded_file in repository.list_files():
            for entry in uploaded_file.data:
                category = str(entry.get("Kategorie", "")).strip()
                if category:
                    self.category_catalog.add(category)

        self._prepare()

    def _prepare(self) -> None:
        self.dataframe["cluster"] = create_clusters(self.dataframe["Text"].tolist())
        for cluster_id in self.dataframe["cluster"].unique():
            texts = self.dataframe[self.dataframe["cluster"] == cluster_id]["Text"]
            cluster_name = suggest_category(texts)
            self.cluster_names[cluster_id] = cluster_name

        self._recompute_pending_candidates()

    def _match_rule_category(self, row: pd.Series) -> str | None:
        text = row["Text"]
        debtor_name = normalize_rule_name(row["Beguenstigter/Zahlungspflichtiger"])
        if debtor_name and debtor_name in self.rules:
            return self.rules[debtor_name]
        return apply_learning(text, self.rules)

    def _build_candidate(self, row_index: int, row: pd.Series) -> ReviewCandidate:
        text = row["Text"]
        debtor_name = normalize_rule_name(row["Beguenstigter/Zahlungspflichtiger"])
        default_category = self.cluster_names.get(row["cluster"]) or "Sonstiges"
        rule_options = self._build_rule_options(row, debtor_name, text)
        default_rule_name = rule_options[0]["value"] if rule_options else ""
        transaction = {
            "buchungstag": row["Buchungstag"].strftime("%d.%m.%Y"),
            "betrag": float(row["Betrag"]),
            "buchungstext": row["Buchungstext"],
            "verwendungszweck": row["Verwendungszweck"],
            "debitor": row["Beguenstigter/Zahlungspflichtiger"],
            "text": text,
        }
        return ReviewCandidate(
            row_index=row_index,
            default_category=default_category,
            default_rule_name=default_rule_name,
            rule_options=rule_options,
            transaction=transaction,
        )

    def _recompute_pending_candidates(self) -> None:
        pending_candidates: list[ReviewCandidate] = []
        for row_index, row in self.dataframe.iterrows():
            if self.categories[row_index] is not None:
                continue

            learned_category = self._match_rule_category(row)
            if learned_category:
                self.categories[row_index] = learned_category
                continue

            pending_candidates.append(self._build_candidate(row_index, row))

        self.pending_candidates = pending_candidates

    def _build_progress(self) -> dict[str, int]:
        assigned_count = sum(category is not None for category in self.categories)
        auto_resolved_count = max(assigned_count - self.reviewed_count, 0)
        return {
            "reviewed": self.reviewed_count,
            "remaining": len(self.pending_candidates),
            "autoResolved": auto_resolved_count,
            "totalTransactions": len(self.dataframe),
        }

    def _build_rule_options(self, row: pd.Series, debtor_name: str, text: str) -> list[dict[str, str]]:
        options: list[dict[str, str]] = []
        seen_values: set[str] = set()

        def add_option(value: str, label: str) -> None:
            normalized = normalize_rule_name(value)
            if not normalized or normalized in seen_values:
                return
            seen_values.add(normalized)
            options.append({"value": normalized, "label": label})

        debtor_label = row["Beguenstigter/Zahlungspflichtiger"].strip()
        if debtor_name:
            add_option(debtor_name, f"Debitor/Kreditor: {shorten_label(debtor_label)}")

        for candidate in build_keyword_candidates(text):
            add_option(candidate, f"Vorschlag: {candidate}")

        booking_text = row["Buchungstext"].strip()
        if booking_text:
            options.append({"value": "__BOOKING_TEXT__", "label": f"Buchungstext verwenden: {shorten_label(booking_text)}"})

        return options

    def current_payload(self) -> dict[str, object]:
        if not self.pending_candidates:
            return self.finalize()

        candidate = self.pending_candidates[0]
        return {
            "success": True,
            "completed": False,
            "sessionId": self.session_id,
            "sourceName": self.source_path.name,
            "progress": self._build_progress(),
            "transaction": candidate.transaction,
            "defaultCategory": candidate.default_category,
            "categoryOptions": sorted(self.category_catalog, key=lambda item: item.lower()),
            "ruleOptions": candidate.rule_options,
            "selectedRule": candidate.default_rule_name,
        }

    def submit_decision(self, category_name: str, rule_name: str) -> dict[str, object]:
        if not self.pending_candidates:
            return self.finalize()

        candidate = self.pending_candidates[0]
        selected_category = category_name.strip() or candidate.default_category
        if not selected_category:
            raise ValueError("Bitte wähle eine Kategorie oder gib eine neue Kategorie ein.")

        selected_rule = rule_name.strip() or candidate.default_rule_name
        resolved_rule_name = self._resolve_rule_name(selected_rule, candidate)
        if resolved_rule_name:
            self.rules[resolved_rule_name] = selected_category

        self.categories[candidate.row_index] = selected_category
        self.category_catalog.add(selected_category)
        self.reviewed_count += 1
        self._recompute_pending_candidates()
        return self.current_payload()

    def _resolve_rule_name(self, selected_rule: str, candidate: ReviewCandidate) -> str:
        if selected_rule == "__BOOKING_TEXT__":
            return normalize_rule_name(candidate.transaction["buchungstext"])
        return normalize_rule_name(selected_rule)

    def finalize(self) -> dict[str, object]:
        completed_categories = [category or "Sonstiges" for category in self.categories]
        self.dataframe["Kategorie"] = completed_categories
        self.dataframe["Debitor/Kreditor"] = self.dataframe["Beguenstigter/Zahlungspflichtiger"]
        save_rules(self.rules)

        result = self.dataframe[["Buchungstag", "Betrag", "Kategorie", "Debitor/Kreditor", "Text"]].to_dict(orient="records")
        saved_path = self.repository.save_processed_upload(self.source_path.stem, result)
        return {
            "success": True,
            "completed": True,
            "sessionId": self.session_id,
            "sourceName": self.source_path.name,
            "filename": saved_path.name,
            "transactionCount": len(result),
            "message": f"{saved_path.name} wurde verarbeitet und in uploads gespeichert.",
        }


class DesktopBridge(QObject):
    def __init__(self, repository: TransactionRepository, window: QMainWindow):
        super().__init__()
        self.repository = repository
        self.window = window
        self.sessions: dict[str, CategorizationSession] = {}

    def _payload(self, data: dict | list[dict]) -> str:
        return json.dumps(data, ensure_ascii=False)

    def _open_path(self, target_path: Path) -> dict[str, object]:
        try:
            target_path.mkdir(parents=True, exist_ok=True)
            os.startfile(str(target_path))
        except Exception as exc:
            return {"success": False, "error": str(exc)}
        return {"success": True, "path": str(target_path)}

    @Slot(result=str)
    def getStorageInfo(self) -> str:
        rules_path = LEARNING_PATH
        mode = "portable" if is_portable_mode() else "installed"
        return self._payload(
            {
                "success": True,
                "mode": mode,
                "dataRoot": str(DATA_ROOT_DIR),
                "uploadsDir": str(UPLOADS_DIR),
                "rulesDir": str(rules_path.parent),
                "rulesFile": str(rules_path),
            }
        )

    @Slot(result=str)
    def openDataFolder(self) -> str:
        return self._payload(self._open_path(DATA_ROOT_DIR))

    @Slot(result=str)
    def openUploadsFolder(self) -> str:
        return self._payload(self._open_path(UPLOADS_DIR))

    @Slot(result=str)
    def openRulesFolder(self) -> str:
        return self._payload(self._open_path(LEARNING_PATH.parent))

    @Slot(result=str)
    def listFiles(self) -> str:
        files = self.repository.list_files()
        return self._payload(
            [
                {
                    "filename": file.name,
                    "count": file.count,
                    "data": file.data,
                }
                for file in files
            ]
        )

    @Slot(result=str)
    def chooseUploadFile(self) -> str:
        file_path, _ = QFileDialog.getOpenFileName(
            self.window,
            "JSON-Datei auswählen",
            str(ROOT_DIR),
            "JSON-Dateien (*.json)",
        )
        if not file_path:
            return self._payload({"success": False, "cancelled": True})

        selected_path = Path(file_path)
        return self._payload(
            {
                "success": True,
                "path": str(selected_path),
                "name": selected_path.name,
                "exists": (self.repository.uploads_dir / selected_path.name).exists(),
            }
        )

    @Slot(result=str)
    def chooseCategorizerFile(self) -> str:
        file_path, _ = QFileDialog.getOpenFileName(
            self.window,
            "CSV-Datei zur Verarbeitung auswählen",
            str(PROJECT_DIR),
            "CSV-Dateien (*.csv)",
        )
        if not file_path:
            return self._payload({"success": False, "cancelled": True})

        selected_path = Path(file_path)
        return self._payload(
            {
                "success": True,
                "path": str(selected_path),
                "name": selected_path.name,
            }
        )

    @Slot(str, bool, result=str)
    def uploadFile(self, source_path: str, overwrite: bool = False) -> str:
        try:
            copied_path = self.repository.copy_upload(Path(source_path), overwrite=overwrite)
        except (ValueError, FileExistsError) as exc:
            return self._payload({"success": False, "error": str(exc)})

        return self._payload(
            {
                "success": True,
                "message": f"{copied_path.name} wurde nach uploads kopiert.",
                "filename": copied_path.name,
            }
        )

    @Slot(str, result=str)
    def startCategorizerUpload(self, source_path: str) -> str:
        try:
            session = CategorizationSession(Path(source_path), self.repository)
            response = session.current_payload()
            if not response.get("completed"):
                self.sessions[session.session_id] = session
        except Exception as exc:
            return self._payload({"success": False, "error": str(exc)})

        return self._payload(response)

    @Slot(str, str, str, result=str)
    def submitCategorizerDecision(self, session_id: str, category_name: str, rule_name: str) -> str:
        session = self.sessions.get(session_id)
        if session is None:
            return self._payload({"success": False, "error": "Der Upload-Vorgang wurde nicht gefunden oder wurde bereits beendet."})

        try:
            response = session.submit_decision(category_name, rule_name)
        except Exception as exc:
            return self._payload({"success": False, "error": str(exc)})

        if response.get("completed"):
            self.sessions.pop(session_id, None)
        return self._payload(response)

    @Slot(str, result=str)
    def cancelCategorizerUpload(self, session_id: str) -> str:
        self.sessions.pop(session_id, None)
        return self._payload({"success": True, "message": "Der Upload-Vorgang wurde abgebrochen."})

    @Slot(result=str)
    def getRulesContent(self) -> str:
        try:
            content = self.repository.load_rules_text()
        except ValueError as exc:
            return self._payload({"success": False, "error": str(exc)})
        return self._payload({"success": True, "content": content})

    @Slot(str, result=str)
    def saveRulesContent(self, content: str) -> str:
        try:
            self.repository.save_rules_text(content)
        except ValueError as exc:
            return self._payload({"success": False, "error": str(exc)})
        return self._payload({"success": True, "message": "Regeln wurden gespeichert."})

    @Slot(str, result=str)
    def getFileContent(self, filename: str) -> str:
        try:
            content = self.repository.load_file_text(filename)
        except (ValueError, FileNotFoundError) as exc:
            return self._payload({"success": False, "error": str(exc)})
        return self._payload({"success": True, "content": content})

    @Slot(str, str, result=str)
    def saveFileContent(self, filename: str, content: str) -> str:
        try:
            self.repository.save_file_text(filename, content)
        except ValueError as exc:
            return self._payload({"success": False, "error": str(exc)})
        return self._payload({"success": True, "message": f"{filename} wurde gespeichert."})

    @Slot(str, str, result=str)
    def renameFile(self, filename: str, new_name: str) -> str:
        try:
            updated_name = self.repository.rename_file(filename, new_name)
        except (ValueError, FileExistsError, FileNotFoundError) as exc:
            return self._payload({"success": False, "error": str(exc)})
        return self._payload(
            {
                "success": True,
                "filename": updated_name,
                "message": f"{filename} wurde in {updated_name} umbenannt.",
            }
        )

    @Slot(str, result=str)
    def deleteFile(self, filename: str) -> str:
        try:
            self.repository.delete_file(filename)
        except (ValueError, FileNotFoundError) as exc:
            return self._payload({"success": False, "error": str(exc)})
        return self._payload({"success": True, "message": f"{filename} wurde gelöscht."})


def prepare_runtime_ui() -> Path:
    RUNTIME_UI_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(UI_DIR / "index.html", RUNTIME_UI_DIR / "index.html")
    shutil.copy2(UI_DIR / "styles.css", RUNTIME_UI_DIR / "styles.css")
    shutil.copy2(UI_DIR / "app.js", RUNTIME_UI_DIR / "app.js")
    (RUNTIME_UI_DIR / "plotly.min.js").write_text(get_plotlyjs(), encoding="utf-8")
    return RUNTIME_UI_DIR / "index.html"


def main() -> None:
    app = QApplication(sys.argv)
    app.setApplicationName("Geldstrom")
    app.setStyle("Fusion")
    if APP_ICON_PATH.exists():
        app.setWindowIcon(QIcon(str(APP_ICON_PATH)))

    repository = TransactionRepository(UPLOADS_DIR)
    index_path = prepare_runtime_ui()

    window = QMainWindow()
    window.setWindowTitle("Geldstrom")
    window.resize(1480, 920)
    window.setMinimumSize(1180, 760)
    if APP_ICON_PATH.exists():
        window.setWindowIcon(QIcon(str(APP_ICON_PATH)))

    browser = QWebEngineView(window)
    channel = QWebChannel(browser.page())
    bridge = DesktopBridge(repository, window)
    channel.registerObject("backend", bridge)
    browser.page().setWebChannel(channel)
    browser.load(QUrl.fromLocalFile(str(index_path)))

    window.setCentralWidget(browser)
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()

import json
import os
from config import LEARNING_PATH
from runtime_paths import bundled_rules_path
import re


def ensure_rules_dir():
    rules_dir = os.path.dirname(str(LEARNING_PATH))
    if rules_dir:
        os.makedirs(rules_dir, exist_ok=True)


def normalize_learning_text(value):
    normalized = str(value or "").strip().lower()
    return re.sub(r"\s+", " ", normalized)

def extract_keyword(text):
    text = text.lower()

    # Entferne Zahlen & Datum
    words = re.findall(r'[a-zA-ZäöüÄÖÜ]+', text)

    # Stopwords raus
    stopwords = {
        "gmbh", "ag", "mbh", "und", "der", "die", "das",
        "zahlung", "kartenzahlung", "lastschrift",
        "debit", "paypal", "sepa"
    }

    words = [w for w in words if w not in stopwords and len(w) >= 3]

    if not words:
        return "sonstiges"

    # Nehme das häufigste Wort statt dem ersten
    from collections import Counter
    most_common = Counter(words).most_common(1)
    return most_common[0][0] if most_common else "sonstiges"

def load_rules():
    if not os.path.exists(LEARNING_PATH):
        default_rules_path = bundled_rules_path()
        if default_rules_path.exists():
            with open(default_rules_path, "r", encoding="utf-8") as f:
                rules = json.load(f)
            save_rules(rules)
            return rules
        return {}
    
    with open(LEARNING_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_rules(rules):
    ensure_rules_dir()
    with open(LEARNING_PATH, "w", encoding="utf-8") as f:
        json.dump(rules, f, indent=4, ensure_ascii=False)

def apply_learning(text, rules):
    normalized_text = normalize_learning_text(text)
    ranked_rules = sorted(
        rules.items(),
        key=lambda item: (-len(normalize_learning_text(item[0])), normalize_learning_text(item[0])),
    )

    for key, category in ranked_rules:
        normalized_key = normalize_learning_text(key)
        if normalized_key and normalized_key in normalized_text:
            return category
    return None
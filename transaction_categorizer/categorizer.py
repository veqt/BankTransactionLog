from collections import Counter
import re

def suggest_category(texts):
    words = []
    for t in texts:
        words += re.findall(r'\w+', t.lower())

    # Stopwords entfernen
    stopwords = {
        "gmbh", "ag", "mbh", "und", "der", "die", "das",
        "zahlung", "kartenzahlung", "lastschrift",
        "debit", "paypal", "sepa", "markt", "online", "shop"
    }

    words = [w for w in words if w not in stopwords and len(w) > 2]  # kurze Wörter raus

    if not words:
        return "Sonstiges"

    common = Counter(words).most_common(3)
    return " ".join([w[0].capitalize() for w in common])
from data_loader import load_data
from clustering import create_clusters
from categorizer import suggest_category
from learning import load_rules, apply_learning, save_rules, extract_keyword
from exporter import export_json
import re
from collections import Counter
import sys

def main():
    df = load_data()
    rules = load_rules()

    # Clustering
    df["cluster"] = create_clusters(df["Text"].tolist())

    # Cluster Kategorien erzeugen
    cluster_names = {}
    for cluster_id in df["cluster"].unique():
        texts = df[df["cluster"] == cluster_id]["Text"]
        cluster_names[cluster_id] = suggest_category(texts)

    # Finale Kategorie bestimmen

    rules = load_rules()
    categories = []

    for _, row in df.iterrows():
        text = row["Text"]
        debitor = row['Beguenstigter/Zahlungspflichtiger'].strip().lower() if isinstance(row['Beguenstigter/Zahlungspflichtiger'], str) and row['Beguenstigter/Zahlungspflichtiger'] else ''

        # Prüfe zuerst exakten Debitor/Kreditor
        if debitor and debitor in rules:
            category = rules[debitor]
        else:
            learned = apply_learning(text, rules)

            if learned:
                category = learned
            else:
                suggestion = cluster_names[row["cluster"]]

                # Ruleset: Zuerst Debitor/Kreditor, sonst häufigstes Wort aus Text
                words = [w for w in re.findall(r'[a-zA-ZäöüÄÖÜ]+', text.lower()) if w not in {
                    "gmbh", "ag", "mbh", "und", "der", "die", "das",
                    "zahlung", "kartenzahlung", "lastschrift",
                    "debit", "paypal", "sepa"
                } and len(w) >= 3]
                counter = Counter(words)
                most_common = sorted(counter.items(), key=lambda x: (-x[1], -len(x[0]), x[0]))
                keyword = debitor if debitor else (most_common[0][0] if most_common else extract_keyword(text))

                print("\n-----------------------------")
                print(f"Transaktion: {row['Verwendungszweck']}")
                print(f"Buchungstext: {row['Buchungstext']}")
                print(f"Debitor/Kreditor: {row['Beguenstigter/Zahlungspflichtiger']}")
                print(f"Betrag: {row['Betrag']}")
                print(f"Ruleset: {keyword}")

                user_input = input("Neue Kategorie (Enter = übernehmen, 'r' = neuer Ruleset, 'q' = abbrechen): ").strip()

                if user_input.lower() == 'q':
                    sys.exit("Programm abgebrochen.")

                if user_input == 'r':
                    ruleset_suggestion_index = 0
                    keyword = most_common[ruleset_suggestion_index][0] if most_common else 'sonstiges'
                    ruleset_suggestion_index += 1
                    print(f"Neuer Ruleset: {keyword}")
                    while True:
                        user_input = input("Neue Kategorie ('q' = abbrechen, 'r' = nächster Ruleset): ").strip()
                        if user_input.lower() == 'q':
                            sys.exit("Programm abgebrochen.")
                        if user_input == 'r':
                            if ruleset_suggestion_index < len(most_common):
                                keyword = most_common[ruleset_suggestion_index][0]
                                ruleset_suggestion_index += 1
                            else:
                                buchungstext_words = re.findall(r'[a-zA-ZäöüÄÖÜ]+', row['Buchungstext'].lower()) if row['Buchungstext'] else []
                                keyword = buchungstext_words[0] if buchungstext_words else 'sonstiges'
                            print(f"Neuer Ruleset: {keyword}")
                            continue
                        if user_input:
                            category = user_input
                            rules[keyword] = category
                            print(f"✔ Regel gespeichert: '{keyword}' → '{category}'")
                            break
                        else:
                            category = suggestion
                            break

                if user_input and user_input.lower() != 'r':
                    category = user_input
                    rules[keyword] = category
                    print(f"✔ Regel gespeichert: '{keyword}' → '{category}'")
                else:
                    category = suggestion

        categories.append(category)

    df["Kategorie"] = categories
    df["Debitor/Kreditor"] = df["Beguenstigter/Zahlungspflichtiger"]

    # Regeln speichern!
    save_rules(rules)

    # JSON Struktur
    result = df[[
        "Buchungstag",
        "Betrag",
        "Kategorie",
        "Debitor/Kreditor",
        "Text"
    ]].to_dict(orient="records")

    export_json(result)

    print("✅ Analyse abgeschlossen → transaction_categorizer/output/result.json")

if __name__ == "__main__":
    main()
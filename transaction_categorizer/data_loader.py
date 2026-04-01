import pandas as pd
from config import DATA_PATH, DATE_FORMAT


CSV_ENCODING_CANDIDATES = ("utf-8", "utf-8-sig", "cp1252", "latin-1")


def read_csv_with_fallbacks(path):
    last_error = None
    for encoding in CSV_ENCODING_CANDIDATES:
        try:
            return pd.read_csv(path, sep=";", encoding=encoding)
        except UnicodeDecodeError as exc:
            last_error = exc

    tried_encodings = ", ".join(CSV_ENCODING_CANDIDATES)
    raise ValueError(
        f"Die CSV-Datei konnte mit keinem unterstützten Encoding gelesen werden ({tried_encodings}): {last_error}"
    ) from last_error


def load_data():
    df = read_csv_with_fallbacks(DATA_PATH)

    df["Buchungstag"] = pd.to_datetime(df["Buchungstag"], format=DATE_FORMAT)
    df["Betrag"] = df["Betrag"].str.replace(",", ".").astype(float)

    # Relevante Felder zusammenführen
    df["Text"] = (
        df["Buchungstext"].fillna("") + " " +
        df["Verwendungszweck"].fillna("") + " " +
        df["Beguenstigter/Zahlungspflichtiger"].fillna("")
    )

    return df
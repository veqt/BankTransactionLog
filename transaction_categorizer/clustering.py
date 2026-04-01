import re

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import DBSCAN


def normalize_text(value: str) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "").strip().lower())
    return normalized or "leer"

def create_clusters(texts):
    normalized_texts = [normalize_text(text) for text in texts]
    if len(normalized_texts) < 2:
        return [0] * len(normalized_texts)

    vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=1)
    embeddings = vectorizer.fit_transform(normalized_texts)
    clustering = DBSCAN(eps=0.5, min_samples=2).fit(embeddings)
    return clustering.labels_
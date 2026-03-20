import numpy as np
import joblib
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = BACKEND_DIR / "models"
MODEL_PATH = MODEL_DIR / "classifier.pkl"
ENCODER_PATH = MODEL_DIR / "label_encoder.pkl"

# Must match the model used during training (768 dimensions)
EMBED_MODEL_NAME = "sentence-transformers/all-mpnet-base-v2"

_classifier = None
_label_encoder = None
_embed_model = None


def _load_models():
    global _classifier, _label_encoder, _embed_model

    if _classifier is None:
        print(f"Loading classifier from: {MODEL_PATH}")
        _classifier = joblib.load(MODEL_PATH)

    if _label_encoder is None:
        print(f"Loading label encoder from: {ENCODER_PATH}")
        _label_encoder = joblib.load(ENCODER_PATH)

    if _embed_model is None:
        print(f"Loading sentence-transformer: {EMBED_MODEL_NAME}")
        from sentence_transformers import SentenceTransformer
        _embed_model = SentenceTransformer(EMBED_MODEL_NAME)
        print("All ML models loaded!")


def predict_top3(text: str):
    if not text or not text.strip():
        return []

    _load_models()

    embedding = _embed_model.encode([text], normalize_embeddings=True)
    probs = _classifier.predict_proba(embedding)[0]
    top3_idx = np.argsort(probs)[-3:][::-1]
    top3_labels = _label_encoder.inverse_transform(top3_idx)
    top3_probs = probs[top3_idx]

    return [(str(label), float(prob)) for label, prob in zip(top3_labels, top3_probs)]

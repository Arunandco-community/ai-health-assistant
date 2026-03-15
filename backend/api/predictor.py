import numpy as np
import joblib
from sentence_transformers import SentenceTransformer
from pathlib import Path
import os

# =====================================================
# CONFIG — resolve paths relative to backend/ directory
# =====================================================

BACKEND_DIR = Path(__file__).resolve().parent.parent  # backend/
MODEL_DIR = BACKEND_DIR / "models"
MODEL_PATH = MODEL_DIR / "classifier.pkl"
ENCODER_PATH = MODEL_DIR / "label_encoder.pkl"

EMBED_MODEL_NAME = "sentence-transformers/all-mpnet-base-v2"

# =====================================================
# LOAD MODELS ONCE (IMPORTANT FOR PERFORMANCE)
# =====================================================

print(f"📂 Loading classifier from: {MODEL_PATH}")
print(f"📂 Loading label encoder from: {ENCODER_PATH}")

classifier = joblib.load(MODEL_PATH)
label_encoder = joblib.load(ENCODER_PATH)
embed_model = SentenceTransformer(EMBED_MODEL_NAME)

print("✅ All ML models loaded successfully!")

# =====================================================
# PREDICTION FUNCTION
# =====================================================

def predict_top3(text: str):
    """
    Returns top 3 predicted diseases with probabilities.
    Output format:
    [
        ("Disease_A", 0.82),
        ("Disease_B", 0.11),
        ("Disease_C", 0.04)
    ]
    """

    if not text or not text.strip():
        return []

    # Generate embedding (normalized for stability)
    embedding = embed_model.encode(
        [text],
        normalize_embeddings=True
    )

    # Get probability distribution
    probs = classifier.predict_proba(embedding)[0]

    # Sort probabilities descending
    top3_idx = np.argsort(probs)[-3:][::-1]

    top3_labels = label_encoder.inverse_transform(top3_idx)
    top3_probs = probs[top3_idx]

    # Convert numpy types to Python native floats
    results = [
        (str(label), float(prob))
        for label, prob in zip(top3_labels, top3_probs)
    ]

    return results
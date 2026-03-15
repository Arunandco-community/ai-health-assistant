from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# Import the predictor from the same package
from api.predictor import predict_top3

app = FastAPI(title="AI Health Assistant API")

# --------------------------------------------------
# CORS (allow frontend to communicate)
# --------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------
# Config
# --------------------------------------------------

CONFIDENCE_THRESHOLD = 0.75
LLM_THRESHOLD = 0.40

SYMPTOM_KEYWORDS = [
    "fever", "headache", "vomiting", "nausea", "pain",
    "chills", "rash", "cough", "fatigue", "diarrhea",
    "body pain", "joint pain", "sore throat",
    "dizziness", "abdominal pain", "weakness",
    "cold", "sneeze", "ache", "burning", "swelling",
    "breathless", "chest", "stomach",
]

# --------------------------------------------------
# Request Models
# --------------------------------------------------

class PredictRequest(BaseModel):
    text: Optional[str] = None
    message: Optional[str] = None

# --------------------------------------------------
# Health Check
# --------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}

# --------------------------------------------------
# POST /predict — simple disease prediction
# --------------------------------------------------

@app.post("/predict")
async def predict(req: PredictRequest):
    user_input = (req.text or req.message or "").strip()

    if not user_input:
        return {"mode": "error", "message": "Empty message received."}

    text = user_input.lower()

    # Detect medical keywords
    detected_symptoms = [kw for kw in SYMPTOM_KEYWORDS if kw in text]

    # If only 1 vague symptom → ask clarification
    if len(detected_symptoms) < 2 and any(
        word in text for word in ["fever", "pain", "cough", "weak"]
    ):
        return {
            "mode": "clarification",
            "message": (
                "I need a few more symptoms to provide an accurate prediction.\n\n"
                "Are you also experiencing:\n"
                "- Body pain?\n"
                "- Nausea or vomiting?\n"
                "- Cough or cold?\n"
                "- Fatigue or weakness?"
            )
        }

    # ML Prediction
    if detected_symptoms:
        try:
            top3 = predict_top3(user_input)

            if top3:
                top_disease, top_confidence = top3[0]
                confidence = float(top_confidence)

                # High confidence → final prediction
                if confidence >= CONFIDENCE_THRESHOLD:
                    return {
                        "mode": "ml_prediction",
                        "disease": top_disease.strip(),
                        "confidence": confidence,
                        "message": (
                            f"AI predicts {top_disease.strip()} "
                            f"with {confidence * 100:.2f}% confidence.\n\n"
                            "⚠ This is a preliminary assessment. "
                            "Please consult a qualified doctor."
                        )
                    }

                # Medium confidence → ask for more details
                elif confidence >= LLM_THRESHOLD:
                    return {
                        "mode": "ml_prediction",
                        "disease": top_disease.strip(),
                        "confidence": confidence,
                        "message": (
                            f"Based on your symptoms, the closest match is {top_disease.strip()} "
                            f"({confidence * 100:.2f}% confidence), but this is not certain.\n\n"
                            "Could you provide additional details such as:\n"
                            "- Duration of symptoms?\n"
                            "- Severity level?\n"
                            "- Any recent travel or food intake?\n\n"
                            "⚠ Please consult a doctor for accurate diagnosis."
                        )
                    }

                # Low confidence
                else:
                    return {
                        "mode": "ml_prediction",
                        "disease": top_disease.strip(),
                        "confidence": confidence,
                        "message": (
                            f"AI analysis suggests possible {top_disease.strip()} "
                            f"but confidence is low ({confidence * 100:.2f}%).\n\n"
                            "Please describe more symptoms or consult a healthcare professional."
                        )
                    }

        except Exception as e:
            print("ML prediction error:", e)

    # Fallback for non-medical or unrecognized input
    return {
        "mode": "llm_fallback",
        "message": (
            "I can help you analyze health symptoms. "
            "Please describe your symptoms in detail, for example:\n\n"
            "• \"I have fever, headache and body ache\"\n"
            "• \"Stomach pain with vomiting since 2 days\"\n"
            "• \"Cough, cold and sore throat\"\n\n"
            "The more symptoms you share, the more accurate my prediction will be."
        )
    }


# --------------------------------------------------
# POST /chat — alias endpoint (matches frontend)
# --------------------------------------------------

@app.post("/chat")
async def chat(request: Request):
    """
    Accepts any JSON with a text/message field.
    This endpoint mirrors /predict for frontend compatibility.
    """
    try:
        data = await request.json()
    except Exception:
        return {"mode": "error", "message": "Invalid JSON received."}

    # Extract user input from any key
    user_input = ""
    if isinstance(data, dict):
        user_input = (
            data.get("text")
            or data.get("message")
            or data.get("query")
            or next((v for v in data.values() if isinstance(v, str) and v.strip()), "")
        )

    user_input = user_input.strip() if user_input else ""

    if not user_input:
        return {"mode": "error", "message": "Empty message received."}

    # Reuse prediction logic
    req = PredictRequest(text=user_input)
    return await predict(req)
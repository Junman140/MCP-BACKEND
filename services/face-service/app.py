import os
import sys
import base64
import logging
import time
from io import BytesIO

import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("face-service")

app = Flask(__name__)
CORS(app)

face_model = None
MODEL_READY = False


def load_model():
    global face_model, MODEL_READY
    try:
        import insightface

        providers = ["CPUExecutionProvider"]
        ctx = int(os.environ.get("FACE_SERVICE_GPU", "-1"))
        if ctx >= 0:
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]

        log.info("Loading InsightFace model (buffalo_l)...")
        face_model = insightface.app.FaceAnalysis(
            name="buffalo_l", providers=providers
        )
        face_model.prepare(ctx_id=ctx)
        MODEL_READY = True
        log.info("InsightFace model loaded successfully.")
    except Exception as e:
        log.error(f"Failed to load InsightFace model: {e}")
        face_model = None
        MODEL_READY = False


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok" if MODEL_READY else "loading",
            "model": "buffalo_l (ArcFace)" if MODEL_READY else "not loaded",
            "provider": os.environ.get("FACE_SERVICE_GPU", "-1"),
        }
    )


@app.route("/extract-face", methods=["POST"])
def extract_face():
    if not MODEL_READY:
        return jsonify({"error": "Model not loaded yet. Try again in a few seconds."}), 503

    body = request.get_json(silent=True)
    if not body or "image_base64" not in body:
        return jsonify({"error": "Missing image_base64 field"}), 400

    try:
        img_b64 = body["image_base64"]
        if "," in img_b64 and img_b64.startswith("data:"):
            img_b64 = img_b64.split(",", 1)[1]

        img_bytes = base64.b64decode(img_b64)
        img = Image.open(BytesIO(img_bytes))

        if img.mode != "RGB":
            img = img.convert("RGB")
        img_np = np.array(img)

        img_bgr = img_np[:, :, ::-1]

        start = time.time()
        faces = face_model.get(img_bgr)
        elapsed = (time.time() - start) * 1000

        embeddings = []
        for face in faces:
            emb = face.embedding
            emb_bytes = emb.astype(np.float32).tobytes()
            emb_b64 = base64.b64encode(emb_bytes).decode("utf-8")
            embeddings.append(
                {
                    "embedding_b64": emb_b64,
                    "bbox": [
                        float(face.bbox[0]),
                        float(face.bbox[1]),
                        float(face.bbox[2]),
                        float(face.bbox[3]),
                    ],
                    "confidence": float(face.det_score) if hasattr(face, "det_score") else 1.0,
                }
            )

        log.info("Detected %d face(s) in %.1fms", len(embeddings), elapsed)

        return jsonify(
            {
                "embeddings": embeddings,
                "count": len(embeddings),
                "elapsed_ms": round(elapsed, 1),
            }
        )

    except Exception as e:
        log.error("Face extraction error: %s", e)
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    load_model()
    port = int(os.environ.get("FACE_SERVICE_PORT", 5056))
    log.info("Face service starting on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)

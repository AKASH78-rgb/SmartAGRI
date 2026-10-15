"""
SmartAgriCare ML Service — PlantX MobileNetV2 Crop Disease Detection
Serves the PlantX reference model (best_model.h5, 15 classes) via Flask on
port 5001 with the SAC-compatible JSON contract. Prediction comes from the
real trained model; disease info is enriched from plantx_class_info.py.
"""
import os
import io
import logging
import threading
import numpy as np
from datetime import datetime
from PIL import Image, ImageOps

os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')

import tensorflow as tf  # noqa: E402
from tensorflow import keras  # noqa: E402

from flask import Flask, request, jsonify  # noqa: E402
from flask_cors import CORS  # noqa: E402

from plantx_class_info import resolve_info  # noqa: E402

# ── Logging ───────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
_cors_origins = ['http://localhost:5000', 'http://127.0.0.1:5000']
if os.environ.get('BACKEND_URL'):
    _cors_origins.append(os.environ['BACKEND_URL'])
CORS(app, origins=_cors_origins)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10 MB max upload

# Serialize inference — Keras predict is not thread-safe on CPU
_inference_lock = threading.Lock()
tf.config.threading.set_intra_op_parallelism_threads(min(os.cpu_count() or 2, 4))
tf.config.threading.set_inter_op_parallelism_threads(2)

# Concurrency limiter — cap in-flight requests to prevent memory spikes
_max_concurrent = threading.Semaphore(8)

# PIL decompression bomb protection
Image.MAX_IMAGE_PIXELS = 4_000_000

# ── Paths ──────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
MODELS_DIR = os.path.join(ROOT_DIR, 'models')
MODEL_PATH = os.path.join(MODELS_DIR, 'best_model.h5')
CLASS_INDICES_PATH = os.path.join(MODELS_DIR, 'class_indices_reverse.json')
MODEL_URL = os.environ.get('MODEL_URL', '').strip()


def download_model(url):
    """Download the model checkpoint from MODEL_URL into the models/ folder."""
    import urllib.request
    os.makedirs(MODELS_DIR, exist_ok=True)
    tmp_path = MODEL_PATH + '.tmp'
    try:
        logger.info('Model file not found. Downloading from MODEL_URL...')
        with urllib.request.urlopen(url, timeout=180) as src, open(tmp_path, 'wb') as dst:
            import shutil
            shutil.copyfileobj(src, dst)
        os.replace(tmp_path, MODEL_PATH)
        logger.info('Model downloaded to %s', MODEL_PATH)
        return True
    except Exception as exc:
        logger.exception('Failed to download model from MODEL_URL: %s', exc)
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
        return False

# ── Reliability thresholds (PlantX reference) ──────────────────
CONFIDENCE_THRESHOLD = 0.70
CONFIDENCE_GAP_THRESHOLD = 0.20
ENTROPY_THRESHOLD = 1.60

TARGET_SIZE = (224, 224)


# ── Class label parsing ────────────────────────────────────────
_CROP_ALIASES = {
    'tomato': 'Tomato',
    'potato': 'Potato',
    'pepper': 'Bell Pepper',
}


def parse_class_label(raw):
    """
    Parse PlantVillage-style class labels into (crop_display, condition).
    Robust to the separators used across public models ('___', '__', '_', spaces):
      Tomato___Bacterial_spot                    -> ('Tomato', 'Bacterial spot')
      Pepper___bell___Bacterial_spot             -> ('Bell Pepper', 'Bacterial spot')
      Pepper__bell___healthy                     -> ('Bell Pepper', 'healthy')
      Tomato_Bacterial_spot                      -> ('Tomato', 'Bacterial spot')
      Tomato_Spider_mites_Two_spotted_spider_mite-> ('Tomato', 'Spider mites two spotted spider mite')
      Tomato__Tomato_YellowLeaf__Curl_Virus      -> ('Tomato', 'Yellow leaf curl virus')
    """
    s = str(raw).strip()
    tokens = [t for t in s.replace('___', ' ').replace('__', ' ').replace('_', ' ').split() if t]
    if not tokens:
        return s, 'Unknown'

    crop = None
    crop_idx = None
    for i, tok in enumerate(tokens):
        low = tok.lower()
        if low in _CROP_ALIASES:
            crop_idx = i
            crop = _CROP_ALIASES[low]
            if low == 'pepper' and i + 1 < len(tokens) and tokens[i + 1].lower() == 'bell':
                break
    if crop is None:
        return s, 'Unknown'

    cond_tokens = tokens[crop_idx + 1:]
    if cond_tokens and cond_tokens[0].lower() == 'bell':
        cond_tokens = cond_tokens[1:]
    crop_word = crop.lower().split()[0]
    if cond_tokens and cond_tokens[0].lower() == crop_word:
        cond_tokens = cond_tokens[1:]
    condition = ' '.join(cond_tokens)
    if not condition:
        condition = 'healthy'
    return crop, condition


_FEATURE_CHECKS = (
    ('healthy', 'healthy'),
    ('earlyblight', 'early_blight'),
    ('lateblight', 'late_blight'),
    ('bacterialspot', 'bacterial_spot'),
    ('leafmold', 'leaf_mold'),
    ('septoria', 'septoria_leaf_spot'),
    ('spider', 'spider_mite'),
    ('targetspot', 'target_spot'),
    ('mosaic', 'mosaic_virus'),
    ('yellowleafcurl', 'yellow_leaf_curl'),
    ('leafcurl', 'yellow_leaf_curl'),
)


def condition_key(condition):
    """Map a parsed condition to a canonical DISEASE_INFO key (order matters)."""
    if not condition:
        return None
    norm = ''.join(ch for ch in str(condition).lower() if ch.isalnum())
    for needle, key in _FEATURE_CHECKS:
        if needle in norm:
            return key
    return None


# ── Model loading ──────────────────────────────────────────────
model = None
class_indices = {}
model_error = ''
num_classes = 0


class _DepthwiseConv2DCompat(keras.layers.DepthwiseConv2D):
    def __init__(self, *args, groups=1, **kwargs):
        if groups != 1:
            raise ValueError(f'DepthwiseConv2D only supports groups=1, got {groups}')
        super().__init__(*args, **kwargs)


def ensure_model_and_classes():
    global model, class_indices, model_error, num_classes

    if model is not None:
        return True

    if not os.path.exists(MODEL_PATH):
        if MODEL_URL and download_model(MODEL_URL):
            pass
        else:
            hint = (' Set MODEL_URL to a hosted checkpoint or download it manually.' if MODEL_URL
                    else ' Set MODEL_URL or place best_model.h5 in the repo models/ folder.')
            model_error = f'Model file not found at {MODEL_PATH}.{hint}'
            return False
    if not os.path.exists(CLASS_INDICES_PATH):
        model_error = f'Class indices not found at {CLASS_INDICES_PATH}. Place class_indices_reverse.json in the repo models/ folder.'
        return False

    try:
        logger.info('Loading PlantX model from %s ...', MODEL_PATH)
        loaded = keras.models.load_model(
            MODEL_PATH,
            compile=False,
            custom_objects={'DepthwiseConv2D': _DepthwiseConv2DCompat},
        )
        with open(CLASS_INDICES_PATH, 'r', encoding='utf-8') as f:
            class_indices = {int(k): v for k, v in json_load(f).items()}
        model = loaded
        num_classes = len(class_indices)
        model_error = ''
        logger.info('Model loaded. %d classes.', num_classes)
        return True
    except Exception as exc:
        model = None
        model_error = f'Failed to load model: {exc}'
        logger.exception('Model load failed: %s', exc)
        return False


def json_load(fobj):
    import json
    return json.load(fobj)


attempted_load = False


def load_model_once():
    global attempted_load
    if model is not None:
        return True
    return ensure_model_and_classes()


# Attempt model load at startup (non-fatal in deployment).
load_model_once()


# ── Image preprocessing (PlantX reference: resize + /255.0) ────
def preprocess_image(img):
    img = img.resize(TARGET_SIZE)
    arr = np.array(img, dtype=np.float32) / 255.0
    return np.expand_dims(arr, axis=0)


def detect_blur(img_pil):
    gray = img_pil.convert('L')
    arr = np.array(gray, dtype=np.float32)
    gy, gx = np.gradient(arr)
    gxy, gxx = np.gradient(gx)
    gyy, _ = np.gradient(gy)
    laplacian = gxx + gyy
    return {'blurry': float(np.var(laplacian)) < 100.0, 'score': round(float(np.var(laplacian)), 2)}


def detect_darkness(img_pil):
    arr = np.array(img_pil.convert('RGB'), dtype=np.float32)
    avg = float(arr.mean())
    return {'dark': avg < 50.0, 'avg': round(avg, 2)}


# ── Advice text (mirrors PlantX basic advisory) ────────────────
def build_advice(status, disease, crop, confidence):
    if status == 'healthy':
        text = (f"Your {crop or 'crop'} appears to be HEALTHY (Confidence: {confidence:.1%}).\n\n"
                "General Recommendations:\n"
                "- Continue current care practices\n"
                "- Monitor regularly for any changes\n"
                "- Maintain proper watering and fertilization\n")
        summary = f"Detected: Healthy with {confidence:.1%} confidence"
    else:
        text = (f"Disease Detected: {disease} on {crop or 'crop'} (Confidence: {confidence:.1%})\n\n"
                "Immediate Actions:\n"
                "- Isolate affected plants if possible\n"
                "- Remove severely infected leaves\n"
                "- Improve air circulation and avoid overhead watering\n\n"
                "Treatment: Follow the recommended fungicide/bactericide schedule and product labels carefully.\n\n"
                "Prevention: Practice crop rotation, use resistant varieties, and monitor regularly.")
        summary = f"Detected: {disease} with {confidence:.1%} confidence"
    return {'summary': summary, 'full_advice': text}


# ── Routes ─────────────────────────────────────────────────────
@app.errorhandler(413)
def too_large(_e):
    return jsonify({'error': 'Image too large. Maximum size is 10 MB.'}), 413


@app.route('/health', methods=['GET'])
def health():
    ready = model is not None
    return jsonify({
        'status': 'ok' if ready else 'degraded',
        'model': 'mobilenetv2_plantx_224',
        'model_ready': ready,
        'model_error': model_error,
        'classes': num_classes or 15,
        'val_acc': 'N/A',
    })


@app.route('/predict', methods=['POST'])
def predict():
    if not _max_concurrent.acquire(blocking=False):
        return jsonify({'error': 'Service busy. Try again later.'}), 503

    img = None
    try:
        if model is None and not load_model_once():
            return jsonify({
                'error': 'Model is not available yet. Ensure best_model.h5 and class_indices_reverse.json are present in the models/ folder and retry.',
                'details': model_error,
            }), 503

        if 'image' not in request.files:
            return jsonify({'error': 'No image file. Send multipart with field "image".'}), 400

        file = request.files['image']

        content_length = request.content_length or 0
        if content_length > 10 * 1024 * 1024:
            return jsonify({'error': 'Image too large. Maximum size is 10 MB.'}), 413

        try:
            img = Image.open(file.stream)
            img = ImageOps.exif_transpose(img).convert('RGB')
        except (IOError, OSError, Image.DecompressionBombError):
            logger.warning('Invalid image upload')
            return jsonify({'error': 'Invalid image file.'}), 400

        w, h = img.size
        if w * h > 4_000_000:
            img.close()
            return jsonify({'error': 'Image dimensions too large. Max ~2000x2000 pixels.'}), 400

        blur_check = detect_blur(img)
        dark_check = detect_darkness(img)
        quality_standard = {'blur_score': blur_check['score'], 'brightness_avg': dark_check['avg']}

        # Layer 1: quality rejection
        if blur_check['blurry'] or dark_check['dark']:
            if blur_check['blurry'] and dark_check['dark']:
                msg = 'Image too dark and blurry. Please retake in good light with steady hands.'
            elif blur_check['blurry']:
                msg = 'Image too blurry. Please retake in good light with steady hands.'
            else:
                msg = 'Image too dark. Please retake in good lighting conditions.'
            img.close()
            return jsonify({'success': False, 'rejection_reason': 'blurry' if blur_check['blurry'] else 'dark',
                            'message': msg, 'quality': quality_standard}), 400

        tensor = preprocess_image(img)
        img.close()

        acquired = _inference_lock.acquire(timeout=30)
        if not acquired:
            del tensor
            return jsonify({'error': 'Service overloaded. Try again later.'}), 503

        try:
            probs = model.predict(tensor, verbose=0)[0]
        finally:
            _inference_lock.release()

        del tensor

        probs = np.asarray(probs, dtype=np.float64)
        eps = 1e-10
        entropy = float(-np.sum(probs * np.log(probs + eps)))
        sorted_idx = np.argsort(probs)[::-1]
        top1_idx = int(sorted_idx[0])
        top1 = float(probs[top1_idx])
        top2 = float(probs[sorted_idx[1]]) if len(sorted_idx) > 1 else 0.0
        margin = top1 - top2

        # Layer 2: reliability router (PlantX confidence + gap, plus entropy)
        reliable = (top1 >= CONFIDENCE_THRESHOLD and margin >= CONFIDENCE_GAP_THRESHOLD
                    and entropy <= ENTROPY_THRESHOLD)
        if not reliable or top1_idx not in class_indices:
            return jsonify({
                'success': True,
                'status': 'unrecognized',
                'disease': 'Unrecognized',
                'confidence': round(top1, 4),
                'crop': '',
                'cause': '',
                'treatment': [],
                'medication_timeline': [],
                'max_sprays': '',
                'is_viral': False,
                'viral_note': '',
                'stores': [],
                'message': 'The image could not be confidently matched to a supported crop leaf '
                           '(Tomato, Potato, or Bell Pepper). Please upload a clear, close-up photo '
                           'of one of these crops for accurate diagnosis.',
                '_rejection_reason': 'confidence' if not reliable else 'unknown_class',
                '_top1': round(top1, 4),
                '_margin': round(margin, 4),
                '_entropy': round(entropy, 3),
                'is_plant': True,
                'quality': quality_standard,
                'source': 'CNN Classification',
                'cnn_predictions': build_top3(probs, sorted_idx),
            })

        raw_name = class_indices[top1_idx]
        crop, condition = parse_class_label(raw_name)
        is_healthy = condition_key(condition) == 'healthy'
        info = resolve_info(condition_key(condition))

        disease_display = 'Healthy' if is_healthy else (info.get('disease', condition) if info else condition.title())
        crop_display = (info.get('crop') if info and info.get('crop') else crop)

        if is_healthy:
            info = info or resolve_info('healthy')
            return jsonify({
                'success': True,
                'status': 'healthy',
                'crop': crop_display,
                'disease': 'Healthy',
                'confidence': round(top1, 4),
                'message': (info.get('message') if info else 'No disease detected. Crop is healthy.'),
                'symptoms': [],
                'possible_causes': '',
                'recommended_treatment': [],
                'preventive_measures': (info.get('preventive_measures', []) if info else []),
                'severity_level': (info.get('severity_level', 'Low') if info else 'Low'),
                'is_plant': True,
                'quality': quality_standard,
                'source': 'CNN Classification',
                'cnn_predictions': build_top3(probs, sorted_idx),
                'advice': build_advice('healthy', 'Healthy', crop_display, top1),
            })

        return jsonify({
            'success': True,
            'status': 'diseased',
            'crop': crop_display,
            'disease': disease_display,
            'confidence': round(top1, 4),
            'cause': (info.get('cause', '') if info else ''),
            'treatment': (info.get('treatment', []) if info else []),
            'preventive_measures': (info.get('preventive_measures', []) if info else []),
            'symptoms': (info.get('symptoms', []) if info else []),
            'possible_causes': (info.get('cause', '') if info else ''),
            'recommended_treatment': (info.get('treatment', []) if info else []),
            'severity_level': (info.get('severity_level', '') if info else ''),
            'message': (info.get('message', '') if info else ''),
            'is_plant': True,
            'quality': quality_standard,
            'source': 'CNN Classification',
            'cnn_predictions': build_top3(probs, sorted_idx),
            'advice': build_advice('diseased', disease_display, crop_display, top1),
        })

    finally:
        if img is not None and hasattr(img, 'close'):
            try:
                img.close()
            except Exception:
                pass
        _max_concurrent.release()


def build_top3(probs, sorted_idx):
    top3 = []
    for i in range(min(3, len(sorted_idx))):
        idx = int(sorted_idx[i])
        if idx in class_indices:
            crop, condition = parse_class_label(class_indices[idx])
            is_h = condition_key(condition) == 'healthy'
            info = resolve_info(condition_key(condition))
            display = 'Healthy' if is_h else (info.get('disease', condition) if info else condition.title())
            top3.append({'disease': f'{crop} - {display}', 'confidence': round(float(probs[idx]), 4)})
    return {'top_3_predictions': top3}


if __name__ == '__main__':
    logger.info('PlantX ML Service starting on port 5001...')
    app.run(host='0.0.0.0', port=5001, debug=False, threaded=True)
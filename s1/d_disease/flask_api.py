"""
Flask REST API for plant disease detection.
Serves the TFLite model for the SmartAgriCare backend proxy.
Run: python flask_api.py  (listens on port 5001)
"""
import os
import io
import numpy as np
import cv2
from flask import Flask, request, jsonify

app = Flask(__name__)

# ── Class labels (PlantVillage 38-class subset) ──
CLASS_NAMES = [
    'Apple___Apple_scab', 'Apple___Black_rot', 'Apple___Cedar_apple_rust', 'Apple___healthy',
    'Blueberry___healthy', 'Cherry_(including_sour)___Powdery_mildew',
    'Cherry_(including_sour)___healthy', 'Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot',
    'Corn_(maize)___Common_rust_', 'Corn_(maize)___Northern_Leaf_Blight', 'Corn_(maize)___healthy',
    'Grape___Black_rot', 'Grape___Esca_(Black_Measles)', 'Grape___Leaf_blight_(Isariopsis_Leaf_Spot)',
    'Grape___healthy', 'Orange___Haunglongbing_(Citrus_greening)', 'Peach___Bacterial_spot',
    'Peach___healthy', 'Pepper,_bell___Bacterial_spot', 'Pepper,_bell___healthy',
    'Potato___Early_blight', 'Potato___Late_blight', 'Potato___healthy',
    'Raspberry___healthy', 'Soybean___healthy', 'Squash___Powdery_mildew',
    'Strawberry___Leaf_scorch', 'Strawberry___healthy', 'Tomato___Bacterial_spot',
    'Tomato___Early_blight', 'Tomato___Late_blight', 'Tomato___Leaf_Mold',
    'Tomato___Septoria_leaf_spot', 'Tomato___Spider_mites Two-spotted_spider_mite',
    'Tomato___Target_Spot', 'Tomato___Tomato_Yellow_Leaf_Curl_Virus', 'Tomato___Tomato_mosaic_virus',
    'Tomato___healthy',
]

# Basic treatment data per disease
TREATMENT_MAP = {
    'Apple___Apple_scab': ['Apply captan or myclobutanil fungicide', 'Remove infected leaves', 'Improve air circulation'],
    'Apple___Black_rot': ['Prune infected branches', 'Apply copper-based fungicide', 'Remove mummified fruits'],
    'Apple___Cedar_apple_rust': ['Apply myclobutanil at bud break', 'Remove cedar trees nearby if possible'],
    'Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot': ['Apply strobilurin fungicide', 'Rotate crops', 'Use resistant varieties'],
    'Corn_(maize)___Common_rust_': ['Apply fungicide at first sign', 'Plant resistant hybrids'],
    'Corn_(maize)___Northern_Leaf_Blight': ['Apply propiconazole fungicide', 'Use resistant varieties', 'Rotate crops'],
    'Grape___Black_rot': ['Apply mancozeb or captan', 'Remove infected berries and leaves', 'Prune for air circulation'],
    'Grape___Esca_(Black_Measles)': ['No effective chemical control — remove and destroy infected wood', 'Avoid pruning wounds'],
    'Grape___Leaf_blight_(Isariopsis_Leaf_Spot)': ['Apply copper fungicide', 'Remove infected leaves'],
    'Orange___Haunglongbing_(Citrus_greening)': ['No cure — remove infected trees', 'Control psyllid vectors with insecticide'],
    'Peach___Bacterial_spot': ['Apply copper-based bactericide', 'Use resistant varieties', 'Avoid overhead irrigation'],
    'Pepper,_bell___Bacterial_spot': ['Apply copper hydroxide spray', 'Use disease-free seeds', 'Avoid working in wet fields'],
    'Potato___Early_blight': ['Apply chlorothalonil or mancozeb', 'Remove infected leaves', 'Rotate crops'],
    'Potato___Late_blight': ['Apply metalaxyl or cymoxanil', 'Destroy infected plants immediately', 'Avoid overhead irrigation'],
    'Squash___Powdery_mildew': ['Apply sulfur or potassium bicarbonate', 'Improve air circulation', 'Avoid excess nitrogen'],
    'Strawberry___Leaf_scorch': ['Apply captan or thiram', 'Remove infected leaves', 'Use resistant varieties'],
    'Tomato___Bacterial_spot': ['Apply copper-based bactericide weekly', 'Use disease-free transplants', 'Avoid overhead watering'],
    'Tomato___Early_blight': ['Apply chlorothalonil or mancozeb every 7-10 days', 'Remove lower infected leaves', 'Stake plants for air flow'],
    'Tomato___Late_blight': ['Apply metalaxyl + mancozeb', 'Remove and destroy infected plants', 'Avoid wetting foliage'],
    'Tomato___Leaf_Mold': ['Apply copper fungicide', 'Improve greenhouse ventilation', 'Reduce humidity below 85%'],
    'Tomato___Septoria_leaf_spot': ['Apply chlorothalonil or copper fungicide', 'Remove infected lower leaves', 'Mulch to prevent soil splash'],
    'Tomato___Spider_mites Two-spotted_spider_mite': ['Apply abamectin or bifenazate miticide', 'Spray with water to dislodge mites', 'Introduce predatory mites'],
    'Tomato___Target_Spot': ['Apply chlorothalonil or azoxystrobin', 'Remove infected plant material', 'Rotate crops'],
    'Tomato___Tomato_Yellow_Leaf_Curl_Virus': ['No cure — remove infected plants', 'Control whitefly vectors with imidacloprid', 'Use resistant varieties'],
    'Tomato___Tomato_mosaic_virus': ['No cure — remove infected plants', 'Disinfect tools with bleach solution', 'Control aphid vectors'],
    'Cherry_(including_sour)___Powdery_mildew': ['Apply sulfur or myclobutanil', 'Prune for air circulation', 'Avoid excess nitrogen fertilizer'],
}

CROP_MAP = {
    'Apple': 'Apple', 'Blueberry': 'Blueberry', 'Cherry': 'Cherry',
    'Corn': 'Corn (Maize)', 'Grape': 'Grape', 'Orange': 'Orange',
    'Peach': 'Peach', 'Pepper,_bell': 'Bell Pepper', 'Potato': 'Potato',
    'Raspberry': 'Raspberry', 'Soybean': 'Soybean', 'Squash': 'Squash',
    'Strawberry': 'Strawberry', 'Tomato': 'Tomato',
}

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'plantdisease_model_optimized.tflite')
interpreter = None
model_ready = False
model_error = ''

def load_model():
    global interpreter, model_ready, model_error
    try:
        import tensorflow as tf
        interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
        interpreter.allocate_tensors()
        model_ready = True
    except Exception as e:
        model_error = str(e)
        model_ready = False

load_model()


def predict(image_bytes):
    img = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError('Could not decode image')
    img = cv2.resize(img, (224, 224))
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = img.astype('float32') / 255.0
    img = np.expand_dims(img, axis=0)
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    interpreter.set_tensor(input_details[0]['index'], img)
    interpreter.invoke()
    scores = interpreter.get_tensor(output_details[0]['index'])[0]
    idx = int(np.argmax(scores))
    confidence = float(scores[idx])
    return idx, confidence


@app.get('/health')
def health():
    return jsonify({
        'model_ready': model_ready,
        'model_error': model_error,
        'classes': len(CLASS_NAMES),
        'model': 'plantdisease_tflite',
    })


@app.post('/predict')
def detect():
    if not model_ready:
        return jsonify({'success': False, 'error': f'Model not available: {model_error}'}), 503

    if 'image' not in request.files:
        return jsonify({'success': False, 'error': 'No image file provided'}), 400

    file = request.files['image']
    image_bytes = file.read()
    if len(image_bytes) == 0:
        return jsonify({'success': False, 'error': 'Empty image file'}), 400

    try:
        idx, confidence = predict(image_bytes)
    except ValueError as e:
        return jsonify({'success': False, 'error': f'Invalid image: {e}'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': f'Prediction error: {e}'}), 500

    # OOD / low-confidence rejection — not a plant leaf photo
    CONFIDENCE_THRESHOLD = 0.55
    if confidence < CONFIDENCE_THRESHOLD:
        return jsonify({
            'success': False,
            'status': 'unrecognized',
            'low_confidence': True,
            'confidence': round(confidence, 4),
            'message': 'Please upload a genuine plant leaf photo. Only tomato, potato, bell pepper, and other supported crop leaves are recognized.',
        }), 200  # 200 so backend forwards it; frontend checks status field

    label = CLASS_NAMES[idx]
    crop_key = label.split('___')[0]
    disease_raw = label.split('___', 1)[-1].replace('_', ' ').strip()
    is_healthy = 'healthy' in disease_raw.lower()
    crop_name = CROP_MAP.get(crop_key, crop_key.replace('_', ' '))
    treatment = TREATMENT_MAP.get(label, ['Consult local agricultural extension officer for treatment advice'])

    return jsonify({
        'success': True,
        'status': 'healthy' if is_healthy else 'diseased',
        'disease': 'Healthy' if is_healthy else disease_raw,
        'crop': crop_name,
        'confidence': round(confidence, 4),
        'is_plant': True,
        'low_confidence': False,
        'cause': '' if is_healthy else f'{disease_raw} detected in {crop_name} plant.',
        'treatment': [] if is_healthy else treatment,
        'medication_timeline': [],
        'max_sprays': '',
        'is_viral': 'virus' in disease_raw.lower() or 'mosaic' in disease_raw.lower(),
        'viral_note': 'This is a viral disease. No chemical cure exists — remove infected plants and control insect vectors.' if ('virus' in disease_raw.lower() or 'mosaic' in disease_raw.lower()) else '',
        'stores': [],
        'symptoms': [],
        'preventive_measures': [],
        'severity_level': '',
        'possible_causes': '' if is_healthy else f'Caused by pathogen affecting {crop_name}.',
        'deficiencies': [],
        'disorders': [],
        'natural_organic_treatment': [],
        'message': f'{crop_name} plant appears healthy. Continue good agronomic practices.' if is_healthy else '',
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False)

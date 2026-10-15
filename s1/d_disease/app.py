import streamlit as st
import tensorflow as tf
import numpy as np
import cv2
import os


# Load and preprocess the image
def model_predict(image_bytes):
    interpreter = tf.lite.Interpreter(model_path="plantdisease_model_optimized.tflite")
    interpreter.allocate_tensors()

    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    img = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("The selected file could not be read as an image.")
    img = cv2.resize(img, (224, 224))
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = img.astype("float32") / 255.0
    img = np.expand_dims(img, axis=0)

    interpreter.set_tensor(input_details[0]['index'], img)
    interpreter.invoke()
    output = interpreter.get_tensor(output_details[0]['index'])

    scores = output[0]
    prediction = int(np.argmax(scores))
    confidence = float(scores[prediction])
    return prediction, confidence
 

#Sidebar
st.sidebar.title("Plant Disease Detection System for Sustainable Agriculture")
app_mode = st.sidebar.selectbox("Select Page",["HOME","DISEASE RECOGNITION"])
#app_mode = st.sidebar.selectbox("Select Page",["Home"," ","Disease Recognition"])

# import Image from pillow to open images
from PIL import Image

if os.path.exists("Diseases.png"):
    img = Image.open("Diseases.png")
    st.image(img)

#Main Page
if(app_mode=="HOME"):
    st.markdown("<h1 style='text-align: center;'>Plant Disease Detection System for Sustainable Agriculture", unsafe_allow_html=True)
    
#Prediction Page
elif(app_mode=="DISEASE RECOGNITION"):
    st.header("Plant Disease Detection System for Sustainable Agriculture")
    test_image = st.file_uploader(
        "Upload a plant leaf image:", type=["jpg", "jpeg", "png"]
    )

    if test_image is not None:
        st.image(test_image)

    if st.button("Predict", disabled=test_image is None):
        st.snow()
        class_name = ['Apple___Apple_scab', 'Apple___Black_rot', 'Apple___Cedar_apple_rust', 'Apple___healthy',
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
                      'Tomato___healthy']

        try:
            image_bytes = test_image.getvalue()
            result_index, confidence = model_predict(image_bytes)
        except ValueError as error:
            st.error(str(error))
        else:
            st.subheader("Prediction for this uploaded image")
            if confidence < 0.70:
                st.warning(
                    f"No reliable prediction (confidence: {confidence:.1%}). "
                    "Use a clear close-up photo of a supported plant leaf."
                )
            else:
                disease_name = class_name[result_index].split("___", 1)[-1].replace("_", " ").strip()
                st.success(f"{disease_name} ({confidence:.1%} confidence)")

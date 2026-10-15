"""
PlantX MobileNetV2 — class display info for the 15 supported classes.
Prediction always comes from the trained model; this data only enriches the
result with reliable agronomic symptoms/treatment for display.
"""

HEALTHY = {
    "crop": None,
    "disease": "Healthy",
    "cause": "",
    "message": "No disease detected. The crop looks healthy.",
    "symptoms": [],
    "treatment": [],
    "preventive_measures": [
        "Continue routine field monitoring",
        "Maintain proper watering and fertilization",
        "Ensure good air circulation between plants",
        "Rotate crops each season to avoid pathogen buildup",
    ],
    "severity_level": "Low",
}

# key: canonical condition (lowercase) → display info
DISEASE_INFO = {
    "bacterial_spot": {
        "disease": "Bacterial Spot",
        "cause": "Xanthomonas campestris pv. vesicatoria — spread by splashing water, rain, and wet handling.",
        "message": "Bacterial spot detected on the leaves. Act early to prevent fruit blemishing.",
        "symptoms": [
            "Small, water-soaked circular spots on older leaves",
            "Spots turn brown to black with a greasy, oily look",
            "Yellow halo around lesions; spots may merge",
            "Raised scabby spots on green or ripe fruit",
        ],
        "treatment": [
            "Remove and destroy severely infected lower leaves",
            "Apply copper-based bactericide (e.g. copper hydroxide) every 7–10 days",
            "Spray at the first sign and repeat after heavy rain",
            "Use fixed copper or mancozeb according to label in seedbeds",
        ],
        "preventive_measures": [
            "Use certified, disease-free seed or hot-water treated seed",
            "Avoid overhead irrigation; water at the base",
            "Crop rotation of 3–4 years away from tomato/pepper",
            "Stake plants to improve airflow after harvest of lower foliage",
        ],
        "severity_level": "Moderate",
    },
    "early_blight": {
        "disease": "Early Blight",
        "cause": "Alternaria solani fungus, favoured by warm, humid weather and wet foliage.",
        "message": "Early blight is spreading on the foliage. Act now to save the crop.",
        "symptoms": [
            "Dark brown lesions with concentric target-like rings (bull's-eye)",
            "Yellowing of older leaves starting at the base of the plant",
            "Lesions up to 1/2 inch with a distinct yellow halo",
            "Defoliation from the bottom upward as disease advances",
        ],
        "treatment": [
            "Strip and remove the lower infected leaves promptly",
            "Spray chlorothalonil or mancozeb protectant fungicide",
            "Apply every 7–10 days during humid periods",
            "Use azoxystrobin-based products if resistance is a concern (rotating chemistries)",
        ],
        "preventive_measures": [
            "Grow resistant/tolerant varieties",
            "Mulch around plants to prevent soil splash",
            "Water early in the day so foliage dries quickly",
            "Rotate with non-solanaceous crops for 2+ years",
        ],
        "severity_level": "High",
    },
    "late_blight": {
        "disease": "Late Blight",
        "cause": "Phytophthora infestans oomycete — a fast-spreading, destructive disease in cool, wet weather.",
        "message": "Late blight detected. This is an aggressive disease — treat immediately.",
        "symptoms": [
            "Large, greasy, water-soaked lesions on leaves",
            "White fuzzy mould growth on the underside of leaves in humid conditions",
            "Rapid browning and collapse of leaves and stems",
            "Dark, firm, greasy spots on fruits/tubers",
        ],
        "treatment": [
            "Apply a systemic fungicide immediately (e.g. metalaxyl-M, cymoxanil, or mancozeb)",
            "Repeat every 5–7 days in wet weather",
            "Destroy severely infected plants by bagging and removing",
            "Avoid working in the field while foliage is wet",
        ],
        "preventive_measures": [
            "Use certified disease-free seed/tubers",
            "Avoid overhead irrigation; provide good ventilation",
            "Scout daily during cool, wet spells",
            "Remove volunteer plants and cull piles",
        ],
        "severity_level": "High",
    },
    "leaf_mold": {
        "disease": "Leaf Mold",
        "cause": "Passalora fulva (Cladosporium fulvum) fungus — common in humid greenhouse conditions.",
        "message": "Leaf mold is colonising the foliage. Improve ventilation and treat promptly.",
        "symptoms": [
            "Pale yellow-green spots on upper leaf surfaces",
            "Olive-green to brown fuzzy mould on the lower leaf side below spots",
            "Leaf curl and drop when infection is severe",
            "Disease progresses upward through the canopy",
        ],
        "treatment": [
            "Improve ventilation and reduce humidity below 85%",
            "Remove and destroy severely affected lower leaves",
            "Spray chlorothalonil or mancozeb protectant",
            "Apply every 7 days while conditions favour the disease",
        ],
        "preventive_measures": [
            "Maintain wider plant spacing for airflow",
            "Water at the base, never wetting the foliage",
            "Avoid working among wet plants",
            "Use tolerant varieties where available",
        ],
        "severity_level": "Moderate",
    },
    "septoria_leaf_spot": {
        "disease": "Septoria Leaf Spot",
        "cause": "Septoria lycopersici fungus, spread by rain splash and frequent wetting of leaves.",
        "message": "Septoria leaf spot is active on the foliage. Remove infected lower leaves quickly.",
        "symptoms": [
            "Many small circular spots (1/16–1/8 inch) with dark borders",
            "Grey-white centre with tiny black fruiting bodies (pycnidia)",
            "Yellowing around lesions; spots start on lowest leaves",
            "Severe defoliation from the bottom upward",
        ],
        "treatment": [
            "Remove lower infected leaves and destroy them",
            "Spray chlorothalonil, mancozeb, or copper fungicide",
            "Start sprays early and repeat every 7–10 days",
            "Improve air circulation by pruning and spacing",
        ],
        "preventive_measures": [
            "Use 2–3 year crop rotation away from tomato",
            "Mulch to prevent rain splash",
            "Avoid overhead watering",
            "Remove plant debris at season end",
        ],
        "severity_level": "Moderate",
    },
    "spider_mite": {
        "disease": "Spider Mites (Two-spotted)",
        "cause": "Tetranychus urticae — tiny arachnid pests that explode in hot, dry conditions.",
        "message": "Two-spotted spider mite infestation detected. Act to prevent leaf loss.",
        "symptoms": [
            "Fine pale stippling (speckling) on upper leaf surfaces",
            "Yellowing and bronze/brown discolouration of leaves",
            "Fine webbing on the underside of leaves and stems",
            "Leaf curl, drop, and stunted plant growth",
        ],
        "treatment": [
            "Spray water jets to dislodge mites and reduce dust",
            "Apply miticide (e.g. abamectin, bifenazate, or spiromesifen)",
            "Repeat every 5–7 days; two-spotted mites reproduce fast",
            "Introduce predatory mites (Phytoseiulus persimilis) in greenhouses",
        ],
        "preventive_measures": [
            "Keep humidity moderate; mites thrive in hot, dry air",
            "Avoid excessive nitrogen fertiliser",
            "Scout leaf undersides weekly with a hand lens",
            "Remove heavily infested leaves",
        ],
        "severity_level": "Moderate",
    },
    "target_spot": {
        "disease": "Target Spot",
        "cause": "Corynespora cassiicola fungus — spread by rain splash and contaminated seed.",
        "message": "Target spot detected on the foliage. Treat with fungicide and improve airflow.",
        "symptoms": [
            "Small dark spots that enlarge into round lesions with concentric rings",
            "Lesions up to 1/2 inch with a pale tan centre",
            "Leaf yellowing and premature drop",
            "Lesions can also appear on stems and fruit",
        ],
        "treatment": [
            "Remove infected leaves and plant debris",
            "Apply a registered fungicide (e.g. azoxystrobin or chlorothalonil)",
            "Rotate fungicide chemistries to avoid resistance",
            "Repeat applications every 7–14 days as needed",
        ],
        "preventive_measures": [
            "Use disease-free seed and resistant varieties",
            "Mulch to prevent rain splash",
            "Avoid wet foliage; water at the base",
            "Rotate crops away from related hosts",
        ],
        "severity_level": "Moderate",
    },
    "mosaic_virus": {
        "disease": "Mosaic Virus",
        "cause": "Tobacco mosaic virus (TMV) — transmitted mechanically by hands, tools, and aphids.",
        "message": "Mosaic virus detected. There is no cure — manage vectors and rogue infected plants.",
        "symptoms": [
            "Mottled light- and dark-green mosaic pattern on leaves",
            "Leaf puckering, curling, and abnormal narrowing",
            "Stunted growth with reduced fruit set",
            "Fruit may show blotchy ripening",
        ],
        "treatment": [
            "Remove and destroy infected plants immediately (no cure)",
            "Disinfect tools, stakes, and greenhouse surfaces",
            "Ward off aphids with reflective mulch or insecticide",
            "Cull volunteers and weed hosts like Solanaceous weeds",
        ],
        "preventive_measures": [
            "Use certified virus-free seed and resistant varieties",
            "Wash hands with soap and milk before handling plants",
            "Control aphid vector populations",
            "Avoid cultivating or pruning when plants are wet",
        ],
        "severity_level": "High",
    },
    "yellow_leaf_curl": {
        "disease": "Yellow Leaf Curl Virus",
        "cause": "Tomato yellow leaf curl virus (TYLCV) — transmitted by whiteflies (Bemisia tabaci).",
        "message": "Yellow leaf curl virus detected. Control whiteflies and remove infected plants.",
        "symptoms": [
            "Upward curling and yellowing of leaves (margins roll inward)",
            "Leaves become thick, brittle, and stunted",
            "Plant growth is severely stunted; flowers abort",
            "Fruit set poor and yields sharply reduced",
        ],
        "treatment": [
            "Rogue out infected plants to remove virus sources",
            "Control whiteflies with yellow sticky traps and insecticides",
            "Use insect-proof netting in seedbeds",
            "Apply effective insecticide rotation targeting adult whiteflies",
        ],
        "preventive_measures": [
            "Use TYLCV-tolerant/resistant varieties",
            "Grow under floating row covers or netting early",
            "Remove weed whitefly hosts (e.g. nightshade)",
            "Monitor whitefly numbers from transplanting",
        ],
        "severity_level": "High",
    },
    "healthy": HEALTHY,
}

# extra: Potato healthy / Bell Pepper healthy reuse HEALTHY
PLANTX_CLASS_ALIASES = {
    "early blight": "early_blight",
    "late blight": "late_blight",
    "bacterial spot": "bacterial_spot",
    "leaf mold": "leaf_mold",
    "septoria leaf spot": "septoria_leaf_spot",
    "septoria": "septoria_leaf_spot",
    "spider mite": "spider_mite",
    "spider mites": "spider_mite",
    "target spot": "target_spot",
    "mosaic": "mosaic_virus",
    "mosaic virus": "mosaic_virus",
    "yellow leaf curl": "yellow_leaf_curl",
    "yellow leaf curl virus": "yellow_leaf_curl",
    "healthy": "healthy",
}


def resolve_info(condition_key):
    """Map a normalized condition key to its DISEASE_INFO entry."""
    return DISEASE_INFO.get(condition_key)
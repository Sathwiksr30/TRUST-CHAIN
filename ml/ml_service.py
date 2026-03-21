"""
TrustChain ML Verification Service
Complete document verification with PDF/DOCX parsing, ML classification, 
SHA-256 hashing, and IPFS integration
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import re
import hashlib
import os
from docx import Document
import PyPDF2
import pdfplumber
import joblib
from datetime import datetime

app = Flask(__name__)
CORS(app)

# Configuration
DATASET_FILE = 'certificate_dataset.csv'
MODEL_FILE = 'certificate_model.pkl'
VECTORIZER_FILE = 'tfidf_vectorizer.pkl'

# ==========================================
# STEP 1: EXTRACT DOCUMENT TEXT
# ==========================================

def extract_text_from_pdf(file_path):
    """Extract text from PDF using multiple methods for reliability"""
    text = ""
    
    # Try pdfplumber first (better for formatted documents)
    try:
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
        if text.strip():
            return text
    except Exception as e:
        print(f"[PDF] pdfplumber failed: {e}")
    
    # Fallback to PyPDF2
    try:
        with open(file_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            for page in pdf_reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
    except Exception as e:
        print(f"[PDF] PyPDF2 failed: {e}")
        raise Exception("Failed to extract text from PDF")
    
    return text

def extract_text_from_docx(file_path):
    """Extract text from DOCX file"""
    try:
        doc = Document(file_path)
        text = ""
        for para in doc.paragraphs:
            text += para.text + "\n"
        return text
    except Exception as e:
        raise Exception(f"Failed to extract text from DOCX: {e}")

def extract_document_text(file_path):
    """Main function to extract text based on file type"""
    file_ext = os.path.splitext(file_path)[1].lower()
    
    if file_ext == '.pdf':
        return extract_text_from_pdf(file_path)
    elif file_ext == '.docx':
        return extract_text_from_docx(file_path)
    else:
        raise Exception(f"Unsupported file type: {file_ext}")

# ==========================================
# NORMALIZE TEXT
# ==========================================

def normalize_text(text):
    """Normalize text for consistent processing"""
    text = text.replace("–", "-")
    text = text.replace("—", "-")
    text = " ".join(text.split())
    return text.strip()

# ==========================================
# STEP 2 & 3: ML CLASSIFICATION
# ==========================================

def classify_with_ml_model(text):
    """
    Classify document using trained ML model
    Returns: (prediction, confidence)
    """
    try:
        # Load model and vectorizer
        if not os.path.exists(MODEL_FILE) or not os.path.exists(VECTORIZER_FILE):
            # Fallback to rule-based verification
            return None, 0
        
        model = joblib.load(MODEL_FILE)
        vectorizer = joblib.load(VECTORIZER_FILE)
        
        # Transform text and predict
        text_vectorized = vectorizer.transform([text])
        prediction = model.predict(text_vectorized)[0]
        
        # Get probability if available
        if hasattr(model, 'predict_proba'):
            proba = model.predict_proba(text_vectorized)[0]
            confidence = max(proba) * 100
        else:
            confidence = 100 if prediction == 1 else 0
        
        return prediction, confidence
    except Exception as e:
        print(f"[ML] Model prediction failed: {e}")
        return None, 0

def verify_against_dataset(text):
    """
    Rule-based verification against known dataset
    Returns: (is_valid, score)
    """
    try:
        # Load dataset
        if not os.path.exists(DATASET_FILE):
            return False, 0
        
        df = pd.read_csv(DATASET_FILE)
        real_certificates = df[df['label'] == 1]
        
        # Normalize text
        normalized_text = normalize_text(text)
        
        # Extract patterns
        ids = re.findall(r'ID-\d{6}', normalized_text)
        dates = re.findall(r'\d{1,2}\s+\w+\s+\d{4}', normalized_text)
        
        # Validation checks
        if len(ids) != 1:
            return False, 20
        if len(dates) != 1:
            return False, 20
        
        extracted_id = ids[0]
        extracted_date = dates[0]
        
        # Check against real certificates
        id_matches = real_certificates[real_certificates['id'] == extracted_id]
        if len(id_matches) == 0:
            return False, 30
        
        date_matches = id_matches[id_matches['date'] == extracted_date]
        if len(date_matches) == 0:
            return False, 40
        
        return True, 100
    except Exception as e:
        print(f"[DATASET] Verification failed: {e}")
        return False, 0

def ml_classify_document(text):
    """
    Combined ML classification using both ML model and rule-based verification
    Returns: (is_real, confidence_score, method)
    """
    # Try ML model first
    ml_prediction, ml_confidence = classify_with_ml_model(text)
    
    # Always verify against dataset too
    dataset_valid, dataset_score = verify_against_dataset(text)
    
    # Decision logic: require both to pass for highest confidence
    if ml_prediction == 1 and dataset_valid:
        return True, min(ml_confidence, dataset_score), "ML + Dataset"
    elif dataset_valid:
        return True, dataset_score, "Dataset"
    elif ml_prediction == 1:
        return True, ml_confidence, "ML Model"
    else:
        return False, max(ml_confidence, dataset_score) if ml_prediction is not None else dataset_score, "Rejected"

# ==========================================
# GENERATE SHA-256 HASH
# ==========================================

def generate_sha256_hash(file_path):
    """Generate SHA-256 hash of document file"""
    sha256_hash = hashlib.sha256()
    
    with open(file_path, "rb") as f:
        # Read file in chunks for memory efficiency
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    
    return sha256_hash.hexdigest()

# ==========================================
# MAIN VERIFICATION ENDPOINT
# ==========================================

@app.route('/verify-document', methods=['POST'])
def verify_document():
    """
    Complete document verification flow:
    1. Extract Document Text
    2. ML Classification (Fake/Real)
    3. Return classification result
    Note: Backend handles SHA-256, IPFS, and Blockchain
    """
    
    # Check if file or text was provided
    if 'document' not in request.files and 'text' not in request.form:
        return jsonify({
            'status': 'ERROR',
            'message': 'No document file or text provided'
        }), 400
    
    # Generate document ID
    document_id = f"DOC-{datetime.now().strftime('%Y%m%d%H%M%S')}-{hash(str(datetime.now())) % 10000:04d}"
    
    result = {
        'documentId': document_id,
        'timestamp': datetime.utcnow().isoformat(),
        'flow': []
    }
    
    try:
        # Check if text was already provided
        if 'text' in request.form:
            extracted_text = request.form['text']
            result['flow'].append({
                'step': 1,
                'name': 'Text Provided',
                'status': 'completed',
                'textLength': len(extracted_text)
            })
        else:
            # Extract text from uploaded file
            file = request.files['document']
            
            if file.filename == '':
                return jsonify({
                    'status': 'ERROR',
                    'message': 'No file selected'
                }), 400
            
            # Save file temporarily
            upload_folder = 'uploads'
            os.makedirs(upload_folder, exist_ok=True)
            
            file_ext = os.path.splitext(file.filename)[1].lower()
            temp_filename = f"{document_id}{file_ext}"
            temp_path = os.path.join(upload_folder, temp_filename)
            
            file.save(temp_path)
            
            result['fileName'] = file.filename
            
            # ===== STEP 1: EXTRACT TEXT =====
            result['flow'].append({'step': 1, 'name': 'Extract Document Text', 'status': 'processing'})
            
            extracted_text = extract_document_text(temp_path)
            
            if not extracted_text or len(extracted_text.strip()) < 50:
                os.remove(temp_path)
                raise Exception("Insufficient text extracted from document")
            
            result['flow'][-1]['status'] = 'completed'
            result['flow'][-1]['textLength'] = len(extracted_text)
            
            # Clean up temporary file
            os.remove(temp_path)
        
        # ===== STEP 2: ML CLASSIFICATION =====
        result['flow'].append({'step': 2, 'name': 'ML Classification', 'status': 'processing'})
        
        is_real, confidence, method = ml_classify_document(extracted_text)
        
        result['flow'][-1]['status'] = 'completed'
        result['flow'][-1]['classification'] = 'Real' if is_real else 'Fake'
        result['flow'][-1]['confidence'] = f"{confidence:.1f}%"
        result['flow'][-1]['method'] = method
        
        result['verification'] = {
            'isReal': is_real,
            'confidence': f"{confidence:.1f}%",
            'method': method,
            'classification': 'REAL' if is_real else 'FAKE'
        }
        
        result['status'] = 'SUCCESS'
        result['message'] = f'Document classified as {result["verification"]["classification"]}'
        
        return jsonify(result), 200
        
    except Exception as e:
        result['status'] = 'ERROR'
        result['message'] = str(e)
        
        return jsonify(result), 500

# ==========================================
# HEALTH CHECK
# ==========================================

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    status = {
        'service': 'TrustChain ML Verification',
        'status': 'running',
        'timestamp': datetime.utcnow().isoformat(),
        'components': {
            'dataset': os.path.exists(DATASET_FILE),
            'ml_model': os.path.exists(MODEL_FILE),
            'vectorizer': os.path.exists(VECTORIZER_FILE)
        }
    }
    return jsonify(status), 200

@app.route('/', methods=['GET'])
def index():
    """Root endpoint"""
    return jsonify({
        'service': 'TrustChain ML Verification Service',
        'version': '1.0.0',
        'endpoints': {
            'verify': '/verify-document [POST]',
            'health': '/health [GET]'
        }
    }), 200

# ==========================================
# RUN SERVER
# ==========================================

if __name__ == '__main__':
    print("=" * 50)
    print("🚀 TrustChain ML Verification Service Starting...")
    print("=" * 50)
    print(f"✓ Dataset: {'Found' if os.path.exists(DATASET_FILE) else 'Missing'}")
    print(f"✓ ML Model: {'Found' if os.path.exists(MODEL_FILE) else 'Missing'}")
    print(f"✓ Vectorizer: {'Found' if os.path.exists(VECTORIZER_FILE) else 'Missing'}")
    print("=" * 50)
    
    app.run(host='0.0.0.0', port=5002, debug=True)

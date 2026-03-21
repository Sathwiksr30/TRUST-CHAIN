from flask import Flask, jsonify, request
import pandas as pd
import re
from docx import Document
from datetime import datetime
import requests
import os

app = Flask(__name__)

# IPFS Backend URL — MUST be set to the deployed backend URL in production
IPFS_UPLOAD_URL = os.environ.get("IPFS_UPLOAD_URL", "http://localhost:5000/upload-ipfs")

# -------------------------------
# READ DOCX ONLY
# -------------------------------

def read_docx(file):
    doc = Document(file)
    text = ""
    for para in doc.paragraphs:
        text += para.text + "\n"
    return text

# -------------------------------
# NORMALIZE TEXT
# -------------------------------

def normalize_text(text):
    text = text.replace("–", "-")
    text = text.replace("—", "-")
    text = " ".join(text.split())
    return text

# -------------------------------
# UPLOAD TO IPFS
# -------------------------------

def upload_to_ipfs(file_data, filename):
    """Upload file to IPFS via backend API"""
    try:
        files = {'file': (filename, file_data, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}
        response = requests.post(IPFS_UPLOAD_URL, files=files, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            return data.get('cid'), None
        else:
            return None, f"IPFS upload failed: {response.status_code}"
    except Exception as e:
        return None, f"IPFS error: {str(e)}"

# -------------------------------
# STRICT VERIFICATION LOGIC
# -------------------------------

def verify_document(uploaded_text):

    df = pd.read_csv("certificate_dataset.csv")
    real_certificates = df[df["label"] == 1]

    uploaded_text = normalize_text(uploaded_text)

    ids = re.findall(r'ID-\d{6}', uploaded_text)
    dates = re.findall(r'\d{1,2} \w+ \d{4}', uploaded_text)

    if len(ids) != 1:
        return False, 20

    if len(dates) != 1:
        return False, 20

    extracted_id = ids[0]
    extracted_date = dates[0]

    id_rows = real_certificates[
        real_certificates["id"] == extracted_id
    ]

    if len(id_rows) == 0:
        return False, 30

    match = id_rows[
        id_rows["date"] == extracted_date
    ]

    if len(match) == 0:
        return False, 40

    return True, 100


def build_verification_payload(uploaded_text):
    is_valid, score = verify_document(uploaded_text)
    return {
        "isReal": is_valid,
        "confidence": f"{score}%",
        "classification": "REAL" if is_valid else "FAKE",
        "method": "Dataset Verification"
    }

# -------------------------------
# HTML
# -------------------------------

UPLOAD_PAGE = """
<!DOCTYPE html>
<html>
<head>
<title>TrustChain - Upload Document</title>
</head>
<body style="font-family: Arial; padding:40px;">

<h2>Upload Certificate (DOCX only)</h2>

<form method="POST" action="/verify" enctype="multipart/form-data">
<input type="file" name="file" accept=".docx" required><br><br>
<button type="submit">Upload & Verify</button>
</form>

</body>
</html>
"""

@app.route("/")
def home():
    return UPLOAD_PAGE


@app.route("/health")
def health():
    return jsonify({
        "service": "TrustChain ML",
        "status": "running"
    })


@app.route("/verify-document", methods=["POST"])
def verify_document_api():
    uploaded_text = (request.form.get("text") or "").strip()

    if not uploaded_text:
        uploaded_file = request.files.get("document")
        if uploaded_file is None:
            return jsonify({"error": "Missing document or text"}), 400

        filename = (uploaded_file.filename or "").lower()
        if not filename.endswith(".docx"):
            return jsonify({"error": "Only DOCX files supported by ML service"}), 400

        uploaded_text = read_docx(uploaded_file)

    return jsonify({
        "verification": build_verification_payload(uploaded_text)
    })

@app.route("/verify", methods=["POST"])
def verify():

    file = request.files["file"]
    file_name = file.filename
    
    # Read file data for size and IPFS upload
    file_data = file.read()
    file_size_kb = round(len(file_data) / 1024, 1)
    file.seek(0)

    if not file_name.lower().endswith(".docx"):
        return "<h3>Only DOCX files supported</h3>"

    text = read_docx(file)

    verification = build_verification_payload(text)
    is_valid = verification["isReal"]
    score = int(verification["confidence"].rstrip("%"))

    document_id = f"DOC-{int(datetime.now().timestamp() * 1000)}"
    upload_date = datetime.now().strftime("%Y-%m-%d")

    status = "Verified" if is_valid else "Rejected"

    message = (
        "This document matches official dataset records."
        if is_valid
        else "This document failed strict authenticity verification."
    )

    # Upload to IPFS only if document is verified as REAL
    ipfs_cid = None
    ipfs_status = ""
    
    if is_valid:
        print(f"[ML] Document verified as REAL. Uploading to IPFS...")
        cid, error = upload_to_ipfs(file_data, file_name)
        
        if cid:
            ipfs_cid = cid
            ipfs_status = f"""
            <h2 style="color: #28a745;">✅ IPFS Storage</h2>
            <p><b>Status:</b> Document uploaded to IPFS successfully!</p>
            <p><b>IPFS CID:</b> <code style="background: #f0f0f0; padding: 5px; border-radius: 3px;">{cid}</code></p>
            <p style="font-size: 12px; color: #666;">You can retrieve this document anytime using its CID.</p>
            """
            print(f"[ML] IPFS upload successful! CID: {cid}")
        else:
            ipfs_status = f"""
            <h2 style="color: #ffc107;">⚠️ IPFS Storage</h2>
            <p><b>Status:</b> Document verified but IPFS upload failed</p>
            <p><b>Error:</b> {error}</p>
            """
            print(f"[ML] IPFS upload failed: {error}")
    else:
        ipfs_status = """
        <h2 style="color: #dc3545;">❌ IPFS Storage</h2>
        <p><b>Status:</b> Document NOT uploaded to IPFS (verification failed)</p>
        <p>Only verified documents are stored on IPFS.</p>
        """
        print(f"[ML] Document rejected. No IPFS upload.")

    # Build result page with color-coded status
    status_color = "#28a745" if is_valid else "#dc3545"
    score_color = "#28a745" if score >= 100 else "#dc3545"

    RESULT_PAGE = f"""
    <html>
    <head>
    <title>Verification Results - TrustChain</title>
    <style>
        body {{ font-family: Arial; padding: 40px; background: #f5f5f5; }}
        .container {{ max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
        .section {{ margin-bottom: 30px; padding: 20px; background: #f9f9f9; border-radius: 5px; }}
        h2 {{ margin-top: 0; }}
        code {{ background: #e8e8e8; padding: 2px 6px; border-radius: 3px; font-size: 14px; }}
        .btn {{ display: inline-block; padding: 10px 20px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }}
        .btn:hover {{ background: #5568d3; }}
    </style>
    </head>
    <body>
    <div class="container">
        <h1>📄 Document Verification Results</h1>
        
        <div class="section">
            <h2>📋 Document Information</h2>
            <p><b>Document ID:</b> {document_id}</p>
            <p><b>Upload Date:</b> {upload_date}</p>
            <p><b>Status:</b> <span style="color: {status_color}; font-weight: bold;">{status}</span></p>
            <p><b>File Name:</b> {file_name}</p>
            <p><b>File Size:</b> {file_size_kb} KB</p>
        </div>

        <div class="section">
            <h2>🔍 ML Verification Results</h2>
            <h3 style="color: {score_color};">Authenticity Score: {score}%</h3>
            <p>{message}</p>
        </div>

        <div class="section">
            {ipfs_status}
        </div>

        <a href="/" class="btn">📤 Upload Another Document</a>
    </div>
    </body>
    </html>
    """

    return RESULT_PAGE

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5002, debug=False, use_reloader=False)
import joblib

model = joblib.load("certificate_model.pkl")
vectorizer = joblib.load("tfidf_vectorizer.pkl")

def predict_certificate(text):
    text_vectorized = vectorizer.transform([text])
    prediction = model.predict(text_vectorized)[0]

    if prediction == 1:
        return "Real Certificate"
    else:
        return "Fake Certificate"

if __name__ == "__main__":

    sample_text = (
        "This is to certify that Rahul Sharma is officially registered with "
        "Delhi University Registration ID ID-458923 dated 16 May 2021."
    )

    result = predict_certificate(sample_text)
    print("Prediction:", result)
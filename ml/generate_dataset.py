import pandas as pd
import random

names = [
    "Rahul Sharma", "Priya Reddy", "Arjun Mehta",
    "Kavya Nair", "Rohan Verma",
    "Sneha Kapoor", "Vikram Singh", "Ananya Rao"
]

organizations = [
    "Apollo Hospital",
    "Delhi University",
    "National Property Council",
    "District Court Hyderabad",
    "AIIMS Delhi",
    "Osmania University"
]

months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]

data = []

for _ in range(240):

    name = random.choice(names)
    org = random.choice(organizations)

    year = random.randint(2020, 2024)
    month = random.choice(months)
    day = random.randint(1, 28)

    date_value = f"{day} {month} {year}"

    # UNIVERSAL ID FORMAT
    reg_id = f"ID-{random.randint(100000,999999)}"

    real_text = (
        f"This is to certify that {name} is officially registered with "
        f"{org}. Registration ID {reg_id} dated {date_value}."
    )

    fake_text = (
        f"{name} certificate instant approval from {org} "
        f"no official verification fast process."
    )

    data.append([real_text, reg_id, date_value, 1])
    data.append([fake_text, "", "", 0])

random.shuffle(data)

df = pd.DataFrame(data, columns=["document", "id", "date", "label"])
df.to_csv("certificate_dataset.csv", index=False)

print("Dataset generated successfully!")
print("Total samples:", len(df))
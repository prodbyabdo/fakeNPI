import os
import re
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv

# ==========================================
# Supabase Configuration
# ==========================================
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
TABLE_NAME = "npi_records"
CSV_FILE_PATH = r"c:\Users\ben.arthur\AppData\Local\Programs\Python\Python313\supaaaa.csv"

# Batch size for bulk inserts (500-1000 rows works well for PostgREST API)
BATCH_SIZE = 700


def sanitize_column_name(col_name: str) -> str:
    """
    Sanitizes raw CSV column names into Postgres-friendly lowercase identifier names.
    Example: 'Employer Identification Number (EIN)' -> 'employer_identification_number_ein'
    """
    cleaned = col_name.strip().lower()
    cleaned = re.sub(r'[\s/()\-\.,]+', '_', cleaned)
    cleaned = re.sub(r'_+', '_', cleaned).strip('_')
    return cleaned


def upload_csv_to_supabase():
    if not os.path.exists(CSV_FILE_PATH):
        print(f"Error: CSV file not found at {CSV_FILE_PATH}")
        return

    print("Initializing Supabase Client...")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    print(f"Reading and uploading dataset in chunks of {BATCH_SIZE} rows...")
    batch_num = 0
    total_rows = 0

    # Read CSV in chunks to prevent memory spikes and API payload limits
    for chunk in pd.read_csv(CSV_FILE_PATH, chunksize=BATCH_SIZE, low_memory=False):
        batch_num += 1

        # 1. Sanitize column headers for PostgreSQL compatibility
        chunk.columns = [sanitize_column_name(col) for col in chunk.columns]

        # 2. Convert NaNs/empty values to None so Postgres stores them as NULL
        chunk = chunk.astype(object).where(pd.notnull(chunk), None)

        # 3. Convert to list of dictionaries
        records = chunk.to_dict(orient="records")

        # 4. Insert batch into Supabase
        try:
            supabase.table(TABLE_NAME).insert(records).execute()
            total_rows += len(records)
            print(f"Batch {batch_num} uploaded: {len(records)} rows (Total: {total_rows})")
        except Exception as e:
            print(f"Error uploading batch {batch_num}: {e}")
            break

    print(f"Upload process finished. Total rows inserted: {total_rows}")


if __name__ == "__main__":
    try:
        upload_csv_to_supabase()
    except Exception:
        import traceback
        traceback.print_exc()
    input("\nPress Enter to exit...")
    

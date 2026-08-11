# Database Schema Guide

This document documents the PostgreSQL database schema, column mappings, indexes, and bulk ingestion strategies for **fakeNPI**.

---

## 🗄️ Table Overview: `npi_records`

The database schema stores provider records in a single flattened PostgreSQL table named `npi_records`. This structure optimizes lookup speed and simplifies raw CSV bulk imports from CMS NPPES dissemination files.

---

## 📊 Column Definitions & CMS Mappings

| Column Name | Data Type | Nullable | Description & CMS Mapping |
| :--- | :--- | :--- | :--- |
| `npi` | `VARCHAR(10)` | ❌ **PRIMARY KEY** | 10-digit National Provider Identifier. |
| `enumerationtype` | `VARCHAR(10)` | ❌ | Provider type: `NPI-1` (Individual) or `NPI-2` (Organization). |
| `name` | `TEXT` | 1 | Provider legal name (or `"LastName, FirstName"` for individuals). |
| `isorganization` | `BOOLEAN` | ❌ | `TRUE` if organization, `FALSE` if individual. |
| `status` | `VARCHAR(10)` | 1 | Entity status (`A` = Active). |
| `address_line1` | `TEXT` | 1 | Provider primary practice address line 1. |
| `address_line2` | `TEXT` | 1 | Provider primary practice address line 2. |
| `address_city` | `TEXT` | 1 | Practice location city name. |
| `address_state` | `VARCHAR(2)` | 1 | 2-letter state code (e.g., `KY`, `CA`). |
| `address_postalcode` | `VARCHAR(20)` | 1 | Zip code or postal code. |
| `address_countrycode` | `VARCHAR(5)` | 1 | 2-letter ISO country code (e.g., `US`). |
| `phone` | `VARCHAR(20)` | 1 | Primary telephone number. |
| `taxonomy_code` | `VARCHAR(10)` | 1 | Primary healthcare provider taxonomy code. |
| `taxonomy_description` | `TEXT` | 1 | Healthcare provider taxonomy description text. |
| `taxonomy_license` | `TEXT` | 1 | State license number associated with primary taxonomy. |
| `taxonomy_state` | `VARCHAR(2)` | 1 | State issuing license. |
| `authorizedofficial_firstname` | `TEXT` | 1 | Authorized official first name (Organizations). |
| `authorizedofficial_lastname` | `TEXT` | 1 | Authorized official last name (Organizations). |
| `authorizedofficial_credential` | `TEXT` | 1 | Authorized official credentials/suffix. |
| `authorizedofficial_title` | `TEXT` | 1 | Authorized official title or position. |
| `authorizedofficial_phone` | `VARCHAR(20)` | 1 | Authorized official telephone number. |
| `lastupdated` | `VARCHAR(20)` | 1 | Record last updated date (`YYYY-MM-DD`). |

---

## ⚡ Indexing Strategy

To support case-insensitive searches and fast exact lookups on large datasets, the following PostgreSQL indexes are recommended:

```sql
-- Primary key index (automatically created)
ALTER TABLE public.npi_records ADD CONSTRAINT npi_records_pkey PRIMARY KEY (npi);

-- State filter index
CREATE INDEX IF NOT EXISTS idx_npi_records_state 
ON public.npi_records (address_state);

-- Enumeration type index
CREATE INDEX IF NOT EXISTS idx_npi_records_enum_type 
ON public.npi_records (enumerationtype);

-- Trigram / Expression indexes for case-insensitive ILIKE pattern matching
CREATE INDEX IF NOT EXISTS idx_npi_records_city_lower 
ON public.npi_records (LOWER(address_city));

CREATE INDEX IF NOT EXISTS idx_npi_records_name_trgm 
ON public.npi_records USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_npi_records_taxonomy_trgm 
ON public.npi_records USING gin (taxonomy_description gin_trgm_ops);
```

---

## 📥 Data Ingestion & Migration

When importing large CMS NPPES dissemination CSV files (e.g., 100MB+ with 200,000+ rows):

### 1. DDL Table Creation Script
Execute the following SQL in your Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS public.npi_records (
    npi VARCHAR(10) PRIMARY KEY,
    enumerationtype VARCHAR(10) NOT NULL,
    name TEXT,
    isorganization BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(10),
    address_line1 TEXT,
    address_line2 TEXT,
    address_city TEXT,
    address_state VARCHAR(2),
    address_postalcode VARCHAR(20),
    address_countrycode VARCHAR(5) DEFAULT 'US',
    phone VARCHAR(20),
    taxonomy_code VARCHAR(10),
    taxonomy_description TEXT,
    taxonomy_license TEXT,
    taxonomy_state VARCHAR(2),
    authorizedofficial_firstname TEXT,
    authorizedofficial_lastname TEXT,
    authorizedofficial_credential TEXT,
    authorizedofficial_title TEXT,
    authorizedofficial_phone VARCHAR(20),
    lastupdated VARCHAR(20)
);
```

### 2. Python Batch Chunk Upload Strategy
For batch ingestion via Python using `pandas` and `supabase-py`:

```python
import pandas as pd
from supabase import create_client

url = "https://your-supabase-project.supabase.co"
key = "your-supabase-service-role-key"
supabase = create_client(url, key)

CHUNK_SIZE = 500

for chunk in pd.read_csv("nppes_data.csv", chunksize=CHUNK_SIZE, dtype=str):
    # Clean headers & missing values
    chunk = chunk.where(pd.notnull(chunk), None)
    records = chunk.to_dict(orient="records")
    
    # Upsert into PostgreSQL
    response = supabase.table("npi_records").upsert(records).execute()
    print(f"Uploaded batch of {len(records)} records.")
```

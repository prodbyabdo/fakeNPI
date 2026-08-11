# API Reference Guide

This document provides complete documentation for the **fakeNPI** REST API endpoints, query parameters, response structures, and error codes.

---

## 📍 Base URL

- **Production (Supabase Edge Function)**:
  `https://<your-supabase-project>.supabase.co/functions/v1/nppes-search`
- **Local Development**:
  `http://localhost:54321/functions/v1/nppes-search`

---

## 📌 Endpoints Summary

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/` | Main NPI lookup and search endpoint. |
| `GET` | `/api` | Redirects to `/api/` with HTTP 301. |
| `GET` | `/` | Health check endpoint returning system status and version. |

---

## 🔍 Query Parameters

Requests to `/api/` accept the following query parameters:

| Parameter | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `number` | String | No | 10-digit NPI number. When present, performs an exact lookup and ignores all other filters. | `1720081763` |
| `enumeration_type` | String | No | Provider type: `NPI-1` (Individual) or `NPI-2` (Organization). | `NPI-2` |
| `organization_name` | String | No | Case-insensitive partial search (`ILIKE %val%`) against provider or organization name. | `TOWNE` |
| `city` | String | No | Case-insensitive city search. | `Louisville` |
| `state` | String | No | 2-letter state code (automatically uppercased). | `KY` |
| `taxonomy_description` | String | No | Case-insensitive partial match against taxonomy description. | `Pharmacy` |
| `limit` | Integer | No | Results per page (Default: `20`, Min: `1`, Max: `200`). | `10` |
| `skip` | Integer | No | Number of records to skip for offset pagination (Default: `0`). | `20` |
| `version` | String | No | API version string (accepted and ignored for CMS compatibility; default: `"2.1"`). | `2.1` |

> ⚠️ **Note**: A request must supply either `number` OR at least one search filter (`enumeration_type`, `organization_name`, `city`, `state`, `taxonomy_description`). Supplying no search criteria returns a `400 Bad Request`.

---

## 📄 Response Formats

### 1. Success Response (`200 OK`)

The endpoint returns a JSON object containing total match count and an array of provider results:

```json
{
  "result_count": 1,
  "results": [
    {
      "created_epoch": null,
      "enumeration_type": "NPI-2",
      "last_updated_epoch": null,
      "number": "1720081763",
      "basic": {
        "status": "A",
        "last_updated": "2021-12-18",
        "enumeration_type": "NPI-2",
        "organization_name": "TOWNE & COUNTRY PHARMACY FLORIST & GIFTS INC",
        "authorized_official_first_name": "LORI",
        "authorized_official_last_name": "HENNING",
        "authorized_official_credential": "OWNER/PHARMACIST",
        "authorized_official_title_or_position": "OWNER/PHARMACIST",
        "authorized_official_telephone_number": "2707562151"
      },
      "addresses": [
        {
          "address_1": "100 MAIN ST",
          "address_2": "",
          "city": "HARDINSBURG",
          "state": "KY",
          "postal_code": "401430675",
          "country_code": "US",
          "country_name": "United States",
          "address_type": "LOCATION",
          "telephone_number": "2707562151"
        },
        {
          "address_1": "100 MAIN ST",
          "address_2": "",
          "city": "HARDINSBURG",
          "state": "KY",
          "postal_code": "401430675",
          "country_code": "US",
          "country_name": "United States",
          "address_type": "MAILING",
          "telephone_number": "2707562151"
        }
      ],
      "practiceLocations": [],
      "taxonomies": [
        {
          "code": "3336C0003X",
          "desc": "Community/Retail Pharmacy",
          "primary": true,
          "state": "KY",
          "license": "12345"
        }
      ],
      "identifiers": [],
      "endpoints": [],
      "other_names": []
    }
  ]
}
```

---

### 2. Error Response Format (`400` / `500`)

Errors follow the CMS NPPES standard error response schema containing an `Errors` array:

```json
{
  "Errors": [
    {
      "description": "Please enter a value in at least one of the search criteria fields.",
      "field": "NPI/Number",
      "number": "2002"
    }
  ]
}
```

---

## 🚨 Error Codes Reference

| HTTP Code | Error Number | Description | Resolution / Action |
| :--- | :--- | :--- | :--- |
| `400` | `2002` | Missing search criteria. | Supply at least one search filter or `number`. |
| `500` | `5000` | Database runtime or query error. | Check Supabase database connectivity and table existence. |
| `500` | `5001` | Server environment misconfiguration. | Verify `SERVICE_ROLE_KEY` and `SUPABASE_URL` environment variables. |

---

## 💻 Example Requests

### Example 1: Exact NPI Lookup
```bash
curl -X GET "https://<your-supabase-project>.supabase.co/functions/v1/nppes-search/api/?number=1720081763"
```

### Example 2: Filtered Search by Location & Type
```bash
curl -X GET "https://<your-supabase-project>.supabase.co/functions/v1/nppes-search/api/?state=KY&city=Louisville&enumeration_type=NPI-2&limit=5"
```

### Example 3: Search by Taxonomy Description
```bash
curl -X GET "https://<your-supabase-project>.supabase.co/functions/v1/nppes-search/api/?taxonomy_description=Pharmacy&limit=10"
```

# Local Development Guide

This guide covers local environment setup, configuration, running Supabase Edge Functions locally, and debugging.

---

## 🛠️ Prerequisites

Make sure you have the following installed on your developer machine:

- **Node.js**: v18.x or higher
- **Supabase CLI**:
  ```bash
  npm install -g supabase
  ```
- **Deno** (Optional for local IDE type checking): Included with Supabase CLI runtime.

---

## 📂 Repository Structure

```
fakeNPI/
├── README.md                              # Main overview & entry point
├── AGENTS.md                              # Repository agents & coding guidelines
├── package.json                           # Workspace dependencies & scripts
├── docs/                                  # Documentation suite
│   ├── ARCHITECTURE.md
│   ├── API_REFERENCE.md
│   ├── DATABASE_SCHEMA.md
│   ├── DEVELOPMENT_GUIDE.md
│   ├── DEPLOYMENT_GUIDE.md
│   └── CONTRIBUTING.md
├── supabase/
│   └── functions/
│       └── nppes-search/
│           ├── index.ts                   # Main Hono edge function implementation
│           └── openapi.yaml               # OpenAPI 3.1 specification
└── my-app/                                # Supplementary Deno utility scripts
```

---

## ⚙️ Environment Configuration

1. Create a `.env` file in the root directory:
   ```env
   SUPABASE_URL=https://<your-supabase-project>.supabase.co
   SERVICE_ROLE_KEY=your-supabase-service-role-key-here
   ```

2. Validate environment file loading:
   - `SUPABASE_URL`: Point to your target Supabase project URL.
   - `SERVICE_ROLE_KEY`: Service role secret key (bypasses Row-Level Security). Note: Custom secrets in Supabase Edge Functions must not use the `SUPABASE_` prefix (hence `SERVICE_ROLE_KEY`).

---

## 🏃 Running Edge Functions Locally

Start the local Supabase Edge Function runner:

```bash
npx supabase functions serve nppes-search --no-verify-jwt --env-file .env
```

The function will start listening locally at:
`http://localhost:54321/functions/v1/nppes-search`

---

## 🧪 Testing Local Endpoints

### 1. Healthcheck
```bash
curl http://localhost:54321/functions/v1/nppes-search/
```
**Response:**
```json
{ "status": "ok", "version": "1.0.0" }
```

### 2. Search Filter Query
```bash
curl "http://localhost:54321/functions/v1/nppes-search/api/?state=KY&city=Hardinsburg&limit=5"
```

### 3. Exact NPI Lookup
```bash
curl "http://localhost:54321/functions/v1/nppes-search/api/?number=1720081763"
```

---

## 🐛 Troubleshooting & Debugging

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| `Missing env vars` (HTTP 500) | `SERVICE_ROLE_KEY` or `SUPABASE_URL` is empty. | Ensure `.env` is loaded with `--env-file .env`. |
| `relation "npi_records" does not exist` | Table missing in database. | Run table DDL script from [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md). |
| CORS or JWT error | JWT verification enabled. | Start local server with `--no-verify-jwt` flag. |

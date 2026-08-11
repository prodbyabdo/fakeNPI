# Production Deployment Guide

This document covers production deployment workflows, environment secret configuration, domain routing, and logging for **fakeNPI**.

---

## 🚀 Deployment Workflow

Deployment is managed via the Supabase CLI.

### Step 1: Link Supabase Project
If deploying for the first time, authenticate and link your local workspace to your cloud Supabase project:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
```

---

### Step 2: Configure Production Secrets
Edge functions require access to your database via `SERVICE_ROLE_KEY`.

Set the secret in production using the Supabase CLI:

```bash
npx supabase secrets set SERVICE_ROLE_KEY=your-supabase-service-role-key
```

> 💡 **Tip**: Verify set secrets in the Supabase Dashboard:
> `Dashboard -> Functions -> nppes-search -> Secrets`

---

### Step 3: Deploy the Edge Function
Deploy the `nppes-search` function using the `--no-verify-jwt` flag so it serves as a public API:

```bash
npx supabase functions deploy nppes-search --no-verify-jwt
```

Upon successful deployment, the CLI outputs your live endpoint URL:
`https://<your-project-ref>.supabase.co/functions/v1/nppes-search`

---

## 🌐 Custom Domain & Cloudflare Worker Routing

If you are replacing the official CMS endpoint (`https://npiregistry.cms.hhs.gov/api/`) in existing frontend or worker code:

1. Update your client app's `BASE_URL` environment variable:
   ```env
   # Before (Official CMS API)
   NPI_API_BASE_URL=https://npiregistry.cms.hhs.gov/api/

   # After (fakeNPI Supabase Edge Function)
   NPI_API_BASE_URL=https://<your-project-ref>.supabase.co/functions/v1/nppes-search/api/
   ```

2. No normalization logic changes are needed since **fakeNPI** returns exact NPPES JSON payload shapes (`results`, `basic`, `addresses`, `taxonomies`).

---

## 📋 Inspection & Log Monitoring

Monitor live requests, execution times, and errors in production:

### CLI Log Streaming
```bash
npx supabase functions logs nppes-search --tail
```

### Dashboard Log Inspection
Navigate to:
`Supabase Dashboard -> Edge Functions -> nppes-search -> Logs`

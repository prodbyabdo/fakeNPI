# Contributing & Collaborator Guide

Welcome to **fakeNPI**! This document provides guidelines for collaborators contributing to the codebase, maintaining API parity, and updating technical documentation.

---

## 📋 General Principles

1. **Parity First**: Any change to `supabase/functions/nppes-search/index.ts` must maintain strict parity with the official CMS NPPES NPI Registry API v2.1 response schemas.
2. **Intentional Deviation Rule**: The only allowed structural deviation from the CMS specification is removing the upper bound cap on the `skip` offset parameter (to allow full dataset access).
3. **Documentation Hygiene**: Whenever code or API behavior is edited, update all affected markdown documentation files in `docs/` and `openapi.yaml`.

---

## 💻 Development Workflow

### 1. Code Standards
- **TypeScript / Deno**: Use strict typing and explicit domain interfaces (`NpiRecord`, `NppesAddress`, `NppesResult`).
- **Framework**: Use [Hono](https://hono.dev/) routing patterns inside `index.ts`.
- **Validation**: Enforce exact parameter checks (e.g. 10-digit regex for `number`, `NPI-1`/`NPI-2` for `enumeration_type`) returning NPPES standard error objects (`Errors` array).

### 2. Updating the API Specification
When adding or modifying query parameters or response fields:
1. Update `supabase/functions/nppes-search/index.ts`.
2. Update `supabase/functions/nppes-search/openapi.yaml`.
3. Update `docs/API_REFERENCE.md`.

---

## 🧪 Testing Guidelines

Before opening a pull request or committing changes:

1. **Run Local Server**:
   ```bash
   npx supabase functions serve nppes-search --no-verify-jwt --env-file .env
   ```

2. **Verify Target Scenarios**:
   - Exact NPI lookup (`?number=1043461353`)
   - Individual search by first/last name (`?first_name=GARY&last_name=DALEY`)
   - Wildcard city search (`?city=arlin&state=TX`)
   - Large offset pagination (`?skip=5000`)
   - Missing search criteria error validation (`?limit=10` with no filters -> Error `2002`)
   - Invalid NPI number validation (`?number=123` -> Error `2001`)

---

## 📝 Commit Message Guidelines

Follow standard Conventional Commit conventions. Suggested formats:

- **Short Conventional**:
  `feat(api): rewrite nppes-search edge function for cms v2.1 parity`

- **Descriptive**:
  `feat: bring nppes-search Edge Function into 1:1 parity with CMS NPPES API v2.1`

- **Detailed**:
  `feat(api): overhaul nppes-search function for exact CMS NPPES v2.1 compliance; fix address_purpose/type fields, add name/postal search filters, and generate complete developer documentation`

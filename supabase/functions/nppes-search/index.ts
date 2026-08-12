// nppes-search/index.ts
// Supabase Edge Function: mirrors https://npiregistry.cms.hhs.gov/api/ v2.1 response shape exactly.
// Deploy: supabase functions deploy nppes-search --no-verify-jwt
//
// Secrets required (Dashboard → Functions → nppes-search → Secrets):
//   SERVICE_ROLE_KEY  — Supabase service-role key
//   SUPABASE_URL      — injected automatically
//
// Intentional deviations from the official API:
//   - No cap on `skip` (official caps at ~1000; we remove this to expose the full dataset)
//   - Every result's `medicare` field is CMS DMEPOS supplier enrichment
//     (total_claims, total_services, total_beneficiaries, medicare_payment,
//     medicare_allowed) joined in from npi_cms_enrichment, keyed on NPI --
//     not part of the real NPPES API at all, added so callers get both in
//     one request instead of a separate CMS lookup per NPI.

import { Hono } from "jsr:@hono/hono@^4.13.1";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@^2";

// ── Domain types ─────────────────────────────────────────────────────────────

interface CmsEnrichment {
  total_claims: number | null;
  total_services: number | null;
  total_beneficiaries: number | null;
  medicare_payment: number | null;
  medicare_allowed: number | null;
}

interface NpiRecord {
  npi: string;
  enumerationtype: string | null;
  name: string | null;
  isorganization: boolean;
  status: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postalcode: string | null;
  address_countrycode: string | null;
  phone: string | null;
  taxonomy_code: string | null;
  taxonomy_description: string | null;
  taxonomy_license: string | null;
  taxonomy_state: string | null;
  authorizedofficial_firstname: string | null;
  authorizedofficial_lastname: string | null;
  authorizedofficial_credential: string | null;
  authorizedofficial_title: string | null;
  authorizedofficial_phone: string | null;
  lastupdated: string | null;
  enumeration_date: string | null;
  // Embedded via the npi_cms_enrichment FK -- PostgREST returns a single
  // object (not an array) here since npi_cms_enrichment.npi is both PK and
  // FK, a genuine one-to-one, but we normalize defensively in formatResult
  // in case that ever comes back as a one-element array instead.
  npi_cms_enrichment: CmsEnrichment | CmsEnrichment[] | null;
}

interface NppesAddress {
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
  country_name: string;
  address_purpose: "MAILING" | "LOCATION";
  address_type: "DOM" | "FGN" | "MIL";
  telephone_number?: string;
  fax_number?: string | null;
}

interface NppesTaxonomy {
  code: string;
  taxonomy_group: string;
  desc: string;
  state: string | null;
  license: string | null;
  primary: boolean;
}

interface NppesMedicare {
  total_claims: number | null;
  total_services: number | null;
  total_beneficiaries: number | null;
  medicare_payment: number | null;
  medicare_allowed: number | null;
}

interface NppesResult {
  created_epoch: string | null;
  enumeration_type: string;
  last_updated_epoch: string | null;
  number: string;
  addresses: NppesAddress[];
  practiceLocations: never[];
  basic: Record<string, string | null | boolean | undefined>;
  taxonomies: NppesTaxonomy[];
  identifiers: never[];
  endpoints: never[];
  other_names: never[];
  medicare: NppesMedicare | null;
}

interface NppesErrorResponse {
  Errors: Array<{ description: string; field?: string; number: string }>;
}

// ── Type guard ───────────────────────────────────────────────────────────────

function isNpiRecord(row: unknown): row is NpiRecord {
  return (
    typeof row === "object" &&
    row !== null &&
    "npi" in row &&
    typeof (row as Record<string, unknown>).npi === "string"
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a date string (YYYY-MM-DD or ISO) to a millisecond epoch string. */
function toEpochMs(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const ms = Date.parse(dateStr);
  return isNaN(ms) ? null : String(ms);
}

/** Derive DOM / FGN / MIL from a country code. */
function deriveAddressType(countryCode: string | null): "DOM" | "FGN" | "MIL" {
  const c = (countryCode ?? "US").toUpperCase();
  if (c === "US") return "DOM";
  if (c === "ZZ") return "MIL"; // military / APO
  return "FGN";
}

function deriveCountryName(countryCode: string | null): string {
  const c = (countryCode ?? "US").toUpperCase();
  if (c === "US") return "United States";
  return c;
}

function nppesError(description: string, number = "5000", field?: string): NppesErrorResponse {
  return { Errors: [{ description, number, ...(field ? { field } : {}) }] };
}

/** Normalizes the embedded npi_cms_enrichment relation (object or
 * single-element array, see the NpiRecord.npi_cms_enrichment comment)
 * into the flat `medicare` shape callers actually want. */
function formatMedicare(embedded: CmsEnrichment | CmsEnrichment[] | null | undefined): NppesMedicare | null {
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  if (!row) return null;
  return {
    total_claims: row.total_claims ?? null,
    total_services: row.total_services ?? null,
    total_beneficiaries: row.total_beneficiaries ?? null,
    medicare_payment: row.medicare_payment ?? null,
    medicare_allowed: row.medicare_allowed ?? null,
  };
}

// ── Formatter ────────────────────────────────────────────────────────────────

function formatResult(row: NpiRecord): NppesResult {
  const enumerationType = row.enumerationtype ?? (row.isorganization ? "NPI-2" : "NPI-1");

  // ── addresses ──────────────────────────────────────────────────────────────
  // Real API: MAILING has no phone/fax; LOCATION has telephone_number + fax_number.
  const addresses: NppesAddress[] = [];

  if (row.address_line1 || row.address_city) {
    const addrType = deriveAddressType(row.address_countrycode);
    const cCode = (row.address_countrycode ?? "US").toUpperCase();
    const cName = deriveCountryName(row.address_countrycode);

    const mailing: NppesAddress = {
      address_1: row.address_line1 ?? "",
      address_2: row.address_line2 ?? "",
      city: row.address_city ?? "",
      state: row.address_state ?? "",
      postal_code: row.address_postalcode ?? "",
      country_code: cCode,
      country_name: cName,
      address_purpose: "MAILING",
      address_type: addrType,
      // No telephone_number or fax_number on MAILING
    };

    const location: NppesAddress = {
      ...mailing,
      address_purpose: "LOCATION",
      telephone_number: row.phone ?? undefined,
      fax_number: null, // fax not stored in our DB
    };

    addresses.push(mailing, location);
  }

  // ── basic ──────────────────────────────────────────────────────────────────
  const basic: Record<string, string | null | boolean | undefined> = {
    status: row.status,
    last_updated: row.lastupdated,
    enumeration_date: row.enumeration_date ?? null,
  };

  if (row.isorganization) {
    // NPI-2
    basic.organization_name = row.name;
    basic.organizational_subpart = "NO";
    if (row.authorizedofficial_firstname)
      basic.authorized_official_first_name = row.authorizedofficial_firstname;
    if (row.authorizedofficial_lastname)
      basic.authorized_official_last_name = row.authorizedofficial_lastname;
    if (row.authorizedofficial_credential)
      basic.authorized_official_credential = row.authorizedofficial_credential;
    if (row.authorizedofficial_title)
      basic.authorized_official_title_or_position = row.authorizedofficial_title;
    if (row.authorizedofficial_phone)
      basic.authorized_official_telephone_number = row.authorizedofficial_phone;
  } else {
    // NPI-1 — name is stored as "LAST, FIRST MIDDLE" or "LAST, FIRST"
    let lastName: string | null = null;
    let firstName: string | null = null;
    let middleName = "";

    if (row.name?.includes(",")) {
      const commaIdx = row.name.indexOf(",");
      lastName = row.name.slice(0, commaIdx).trim();
      const rest = row.name.slice(commaIdx + 1).trim();
      const parts = rest.split(/\s+/);
      firstName = parts[0] ?? null;
      middleName = parts.slice(1).join(" ");
    } else {
      lastName = row.name;
    }

    basic.last_name = lastName;
    basic.first_name = firstName;
    basic.middle_name = middleName || "";
    basic.credential = "";
    basic.sole_proprietor = "NO";
    basic.gender = "";
    basic.certification_date = null;
    basic.name_prefix = "";
    basic.name_suffix = "";
  }

  // ── taxonomies ─────────────────────────────────────────────────────────────
  const taxonomies: NppesTaxonomy[] = row.taxonomy_code
    ? [
        {
          code: row.taxonomy_code,
          taxonomy_group: "",
          desc: row.taxonomy_description ?? "",
          // Real API returns null (not "") when state/license are absent
          state: row.taxonomy_state || null,
          license: row.taxonomy_license || null,
          primary: true,
        },
      ]
    : [];

  return {
    created_epoch: null, // not stored in our DB
    enumeration_type: enumerationType,
    last_updated_epoch: toEpochMs(row.lastupdated),
    number: row.npi,
    addresses,
    practiceLocations: [],
    basic,
    taxonomies,
    identifiers: [],
    endpoints: [],
    other_names: [],
    medicare: formatMedicare(row.npi_cms_enrichment),
  };
}

// ── Module-level Supabase client ──────────────────────────────────────────────

const supabaseUrl    = Deno.env.get("SUPABASE_URL")    ?? "";
const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const supabase: SupabaseClient | null =
  supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

// Every query selects the same columns -- npi_records' own plus the
// embedded npi_cms_enrichment relation (PostgREST auto-detects the join
// from the FK on npi_cms_enrichment.npi, no explicit ON clause needed).
const SELECT_WITH_CMS =
  "*, npi_cms_enrichment(total_claims, total_services, total_beneficiaries, medicare_payment, medicare_allowed)";

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new Hono({ basePath: "/functions/v1/nppes-search" });

app.get("/api/", async (c) => {
  if (!supabase) {
    return c.json(nppesError("Server misconfiguration: missing env vars.", "5001"), 500);
  }

  const q = c.req.query();

  // `version` and `pretty` are accepted but not required (ignored server-side)
  // Limit: 1–200, default 10 — matches official API
  // Skip: NO upper cap — our key deviation; official API caps at ~1000
  const limit = Math.min(Math.max(1, parseInt(q.limit ?? "10", 10) || 10), 200);
  const skip  = Math.max(0, parseInt(q.skip  ?? "0",  10) || 0);

  // ── Branch 1: exact NPI lookup ────────────────────────────────────────────
  if (q.number) {
    const npi = q.number.trim();
    if (!/^\d{10}$/.test(npi)) {
      return c.json(
        nppesError("NPI must be exactly 10 digits.", "2001", "number"),
        400,
      );
    }

    const { data, error } = await supabase
      .from("npi_records")
      .select(SELECT_WITH_CMS)
      .eq("npi", npi)
      .limit(1);

    if (error) return c.json(nppesError(error.message), 500);

    const results = (Array.isArray(data) ? data.filter(isNpiRecord) : []).map(formatResult);
    return c.json({ result_count: results.length, results });
  }

  // ── Validate enumeration_type if provided ─────────────────────────────────
  if (q.enumeration_type && !["NPI-1", "NPI-2"].includes(q.enumeration_type.toUpperCase())) {
    return c.json(
      nppesError("Invalid Enumeration Type. Allowed values: NPI-1, NPI-2.", "2004", "enumeration_type"),
      400,
    );
  }

  // ── Branch 2: filtered search ─────────────────────────────────────────────
  const hasFilter =
    q.enumeration_type ||
    q.organization_name ||
    q.first_name ||
    q.last_name ||
    q.city ||
    q.state ||
    q.postal_code ||
    q.country_code ||
    q.taxonomy_description ||
    q.taxonomy_code;

  if (!hasFilter) {
    return c.json(
      nppesError(
        "Please enter a value in at least one of the search criteria fields.",
        "2002",
        "NPI/Number",
      ),
      400,
    );
  }

  let query = supabase.from("npi_records").select(SELECT_WITH_CMS, { count: "exact" });

  if (q.enumeration_type)
    query = query.eq("enumerationtype", q.enumeration_type.toUpperCase());

  // Organization name: contains wildcard (matches official API)
  if (q.organization_name)
    query = query.ilike("name", `%${q.organization_name}%`);

  // Individual name filters — name stored as "LAST, FIRST [MIDDLE]"
  if (q.last_name)
    query = query.ilike("name", `${q.last_name}%`);
  if (q.first_name)
    query = query.ilike("name", `%, ${q.first_name}%`);

  // Address filters
  if (q.city)         query = query.ilike("address_city",      `${q.city}%`);        // starts-with
  if (q.state)        query = query.eq("address_state",         q.state.toUpperCase());
  if (q.postal_code)  query = query.ilike("address_postalcode", `${q.postal_code}%`); // starts-with
  if (q.country_code) query = query.eq("address_countrycode",   q.country_code.toUpperCase());

  if (q.taxonomy_description)
    query = query.ilike("taxonomy_description", `%${q.taxonomy_description}%`);
  if (q.taxonomy_code)
    query = query.eq("taxonomy_code", q.taxonomy_code);

  query = query.range(skip, skip + limit - 1);

  const { data, error, count } = await query;

  if (error) return c.json(nppesError(error.message), 500);

  const results = (Array.isArray(data) ? data.filter(isNpiRecord) : []).map(formatResult);
  return c.json({ result_count: count ?? results.length, results });
});

app.get("/api", (c) => c.redirect("/api/", 301));
app.get("/", (c) => c.json({ status: "ok", version: "1.0.0" }));

Deno.serve(app.fetch);

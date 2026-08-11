// nppes-search/index.ts — corrected
// Supabase Edge Function: mirrors https://npiregistry.cms.hhs.gov/api/ response shape.
// Deploy: supabase functions deploy nppes-search --no-verify-jwt
//
// Secrets required (Dashboard → Functions → nppes-search → Secrets):
//   SERVICE_ROLE_KEY  — Supabase service-role key (cannot use SUPABASE_ prefix for custom secrets)
//   SUPABASE_URL      — injected automatically

import { Hono } from "jsr:@hono/hono@^4.13.1";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@^2";

// ── Domain types ─────────────────────────────────────────────────────────────

interface NpiRecord {
  npi: string;
  enumerationtype: string;
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
}

interface NppesAddress {
  address_1: string | null;
  address_2: string;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country_code: string;
  country_name: string;
  address_type: "LOCATION" | "MAILING";
  telephone_number: string | null;
}

interface NppesTaxonomy {
  code: string;
  desc: string;
  primary: boolean;
  state: string;
  license: string;
}

interface NppesResult {
  created_epoch: null;
  enumeration_type: string;
  last_updated_epoch: null;
  number: string;
  addresses: NppesAddress[];
  practiceLocations: never[];
  basic: Record<string, string | null | boolean | undefined>;
  taxonomies: NppesTaxonomy[];
  identifiers: never[];
  endpoints: never[];
  other_names: never[];
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

// ── Formatter ────────────────────────────────────────────────────────────────

function formatResult(row: NpiRecord): NppesResult {
  const enumerationType = row.enumerationtype ?? (row.isorganization ? "NPI-2" : "NPI-1");

  const basic: Record<string, string | null | boolean | undefined> = {
    status: row.status,
    last_updated: row.lastupdated,
    enumeration_type: enumerationType,
  };

  if (row.isorganization) {
    basic.organization_name = row.name;
    basic.authorized_official_first_name = row.authorizedofficial_firstname;
    basic.authorized_official_last_name = row.authorizedofficial_lastname;
    basic.authorized_official_credential = row.authorizedofficial_credential;
    basic.authorized_official_title_or_position = row.authorizedofficial_title;
    basic.authorized_official_telephone_number = row.authorizedofficial_phone;
  } else {
    if (row.name?.includes(",")) {
      const [last, first] = row.name.split(",").map((s) => s.trim());
      basic.last_name = last;
      basic.first_name = first ?? null;
    } else {
      basic.last_name = row.name;
    }
  }

  const addresses: NppesAddress[] = [];
  if (row.address_line1 || row.address_city) {
    const loc: NppesAddress = {
      address_1: row.address_line1,
      address_2: row.address_line2 ?? "",
      city: row.address_city,
      state: row.address_state,
      postal_code: row.address_postalcode,
      country_code: row.address_countrycode ?? "US",
      country_name:
        !row.address_countrycode || row.address_countrycode === "US"
          ? "United States"
          : row.address_countrycode,
      address_type: "LOCATION",
      telephone_number: row.phone,
    };
    addresses.push(loc, { ...loc, address_type: "MAILING" });
  }

  const taxonomies: NppesTaxonomy[] = row.taxonomy_code
    ? [
        {
          code: row.taxonomy_code,
          desc: row.taxonomy_description ?? "",
          primary: true,
          state: row.taxonomy_state ?? "",
          license: row.taxonomy_license ?? "",
        },
      ]
    : [];

  return {
    created_epoch: null,
    enumeration_type: enumerationType,
    last_updated_epoch: null,
    number: row.npi,
    addresses,
    practiceLocations: [],
    basic,
    taxonomies,
    identifiers: [],
    endpoints: [],
    other_names: [],
  };
}

function nppesError(description: string, number = "5000", field?: string): NppesErrorResponse {
  return { Errors: [{ description, number, ...(field ? { field } : {}) }] };
}

// ── Module-level client (avoid re-creating on every request) ─────────────────

const supabaseUrl    = Deno.env.get("SUPABASE_URL")    ?? "";
const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
let supabase: SupabaseClient | null =
  supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

// ── Hono app ─────────────────────────────────────────────────────────────────

const app = new Hono();

app.get("/api/", async (c) => {
  if (!supabase) {
    return c.json(nppesError("Server misconfiguration: missing env vars.", "5001"), 500);
  }

  const q     = c.req.query();
  const limit = Math.min(Math.max(1, parseInt(q.limit ?? "20", 10) || 20), 200);
  const skip  = Math.max(0, parseInt(q.skip  ?? "0",  10) || 0);

  // Branch 1: exact NPI lookup
  if (q.number) {
    const { data, error } = await supabase
      .from("npi_records")
      .select("*")
      .eq("npi", q.number.trim())
      .limit(1);

    if (error) {
      return c.json(nppesError(error.message), 500);
    }

    const results = (Array.isArray(data) ? data.filter(isNpiRecord) : []).map(formatResult);
    return c.json({ result_count: results.length, results });
  }

  // Branch 2: filtered search
  const hasFilter =
    q.enumeration_type || q.organization_name || q.city || q.state || q.taxonomy_description;

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

  let query = supabase.from("npi_records").select("*", { count: "exact" });

  if (q.enumeration_type) query = query.eq("enumerationtype", q.enumeration_type.toUpperCase());
  if (q.organization_name) query = query.ilike("name", `%${q.organization_name}%`);
  if (q.city)  query = query.ilike("address_city", q.city);        // ILIKE = case-insensitive exact
  if (q.state) query = query.eq("address_state", q.state.toUpperCase());
  if (q.taxonomy_description)
    query = query.ilike("taxonomy_description", `%${q.taxonomy_description}%`);

  query = query.range(skip, skip + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return c.json(nppesError(error.message), 500);
  }

  const results = (Array.isArray(data) ? data.filter(isNpiRecord) : []).map(formatResult);
  return c.json({ result_count: count ?? results.length, results });
});

app.get("/api", (c) => c.redirect("/api/", 301));
app.get("/", (c) => c.json({ status: "ok", version: "1.0.0" }));

Deno.serve(app.fetch);

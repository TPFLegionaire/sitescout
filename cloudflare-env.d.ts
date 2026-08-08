declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    EVIDENCE: R2Bucket;
    QUALITY_OWNER_EMAIL?: string;
    QUALITY_ADMIN_EMAILS?: string;
    QUALITY_VALIDATOR_EMAILS?: string;
    QUALITY_FINDING_OWNER_EMAILS?: string;
    QUALITY_REPORTER_EMAILS?: string;
    QUALITY_MANAGEMENT_VIEWER_EMAILS?: string;
    QUALITY_AUTH_MODE?: string;
    QUALITY_CF_ACCESS_TEAM_DOMAIN?: string;
    QUALITY_CF_ACCESS_AUD?: string;
    QUALITY_PUBLIC_DEMO?: string;
    QUALITY_AI_ASSIST_ENABLED?: string;
    QUALITY_AI_MODEL?: string;
    OPENAI_API_KEY?: string;
    QUALITY_SEO_ENABLED?: string;
    QUALITY_SEO_PER_OPERATION_CAP_USD?: string;
    QUALITY_SEO_MONTHLY_CAP_USD?: string;
    QUALITY_SEO_COUNTRY?: string;
    QUALITY_SEO_LANGUAGE?: string;
    QUALITY_SEO_LOCATION_CODE?: string;
    DATAFORSEO_LOGIN?: string;
    DATAFORSEO_PASSWORD?: string;
    DATAFORSEO_BASE_URL?: string;
  }
}

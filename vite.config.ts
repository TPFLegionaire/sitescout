import vinext from "vinext";
import { defineConfig } from "vite";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const disposableStatePath = process.env.QUALITY_LOCAL_STATE_PATH?.trim();
const disableInspector = process.env.QUALITY_DISABLE_INSPECTOR?.trim().toLowerCase() === "true";
const externalCloudflareConfigPath = process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH?.trim();
const localApplicationVariableNames = [
  "QUALITY_OWNER_EMAIL",
  "QUALITY_ADMIN_EMAILS",
  "QUALITY_VALIDATOR_EMAILS",
  "QUALITY_FINDING_OWNER_EMAILS",
  "QUALITY_SECURITY_REVIEWER_EMAILS",
  "QUALITY_REPORTER_EMAILS",
  "QUALITY_MANAGEMENT_VIEWER_EMAILS",
  "QUALITY_SECURITY_IMPORT_TARGET_IDS",
  "QUALITY_SECURITY_ARTIFACT_RETENTION_DAYS",
  "QUALITY_AUTH_MODE",
  "QUALITY_CF_ACCESS_TEAM_DOMAIN",
  "QUALITY_CF_ACCESS_AUD",
  "QUALITY_PUBLIC_DEMO",
  "QUALITY_AI_ASSIST_ENABLED",
  "QUALITY_AI_MODEL",
  "OPENAI_API_KEY",
  "QUALITY_SEO_ENABLED",
  "QUALITY_SEO_PER_OPERATION_CAP_USD",
  "QUALITY_SEO_MONTHLY_CAP_USD",
  "QUALITY_SEO_COUNTRY",
  "QUALITY_SEO_LANGUAGE",
  "QUALITY_SEO_LOCATION_CODE",
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "DATAFORSEO_BASE_URL",
] as const;

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [
        {
          binding: "DB",
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ],
  r2_buckets: [
        {
          binding: "EVIDENCE",
          bucket_name: "site-creator-r2",
        },
      ],
};

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const localApplicationVars = command === "serve"
    ? Object.fromEntries(
        localApplicationVariableNames
          .map((name) => [name, process.env[name]?.trim()] as const)
          .filter((entry): entry is readonly [typeof localApplicationVariableNames[number], string] => Boolean(entry[1])),
      )
    : {};

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        // Inline Cloudflare configs do not automatically expose the parent
        // shell's application variables to workerd. Bind them only while
        // serving locally so named-role tests work without packaging local
        // allowlists or secrets into production build output.
        ...(externalCloudflareConfigPath
          ? { configPath: externalCloudflareConfigPath }
          : {
              config: Object.keys(localApplicationVars).length
                ? { ...localBindingConfig, vars: localApplicationVars }
                : localBindingConfig,
            }),
        ...(disposableStatePath ? { persistState: { path: disposableStatePath } } : {}),
        ...(disableInspector ? { inspectorPort: false } : {}),
      }),
    ],
  };
});

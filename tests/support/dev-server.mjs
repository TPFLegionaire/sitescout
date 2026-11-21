// Starts `vinext dev` in local-test mode on disposable state, so tests can act as
// named roles over HTTP. Local-test identities exist only on a development server;
// a production build ignores them.
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export const users = Object.freeze({
  administrator: "admin1@pilot.invalid",
  validator: "validator1@pilot.invalid",
  secondValidator: "validator2@pilot.invalid",
  owner: "owner1@pilot.invalid",
  otherOwner: "owner2@pilot.invalid",
  reporter: "reporter1@pilot.invalid",
  otherReporter: "reporter2@pilot.invalid",
  viewer: "viewer1@pilot.invalid",
});

const roleEnvironment = {
  QUALITY_ADMIN_EMAILS: users.administrator,
  QUALITY_VALIDATOR_EMAILS: `${users.validator},${users.secondValidator}`,
  QUALITY_FINDING_OWNER_EMAILS: `${users.owner},${users.otherOwner}`,
  QUALITY_REPORTER_EMAILS: `${users.reporter},${users.otherReporter}`,
  QUALITY_MANAGEMENT_VIEWER_EMAILS: users.viewer,
};

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function stopProcessTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  // The dev server starts workerd children; stopping only the parent leaves them holding files and ports.
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
  }
}

export async function startDevServer({ startupTimeoutMs = 180_000 } = {}) {
  const stateDirectory = await mkdtemp(join(tmpdir(), "sitescout-integration-"));
  const port = await freePort();
  const baseUrl = `http://localhost:${port}`;
  const child = spawn(process.execPath, [join(root, "node_modules", "vinext", "dist", "cli.js"), "dev", "--port", String(port)], {
    cwd: root,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...roleEnvironment,
      QUALITY_AUTH_MODE: "local-test",
      QUALITY_PUBLIC_DEMO: "false",
      QUALITY_AI_ASSIST_ENABLED: "false",
      QUALITY_DISABLE_INSPECTOR: "true",
      QUALITY_LOCAL_STATE_PATH: join(stateDirectory, "state"),
      MINIFLARE_REGISTRY_PATH: join(stateDirectory, "registry"),
      WRANGLER_LOG_PATH: join(stateDirectory, "logs"),
      WRANGLER_SEND_METRICS: "false",
    },
  });
  let output = "";
  const capture = (chunk) => { output = `${output}${chunk}`.slice(-8000); };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  async function stop() {
    const exited = child.exitCode !== null ? Promise.resolve() : once(child, "exit");
    stopProcessTree(child);
    await Promise.race([exited, delay(10_000)]);
    await rm(stateDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }

  /** Sends a request as the given allow-listed email and returns the status with the parsed body. */
  function as(email) {
    return async (path, init = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        redirect: "manual",
        ...init,
        headers: { "x-sitescout-test-user-id": `test:${email}`, "x-sitescout-test-user-email": email, "x-sitescout-test-user-name": email, ...(init.headers ?? {}) },
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const text = bytes.toString("utf8");
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: response.status, json, text, bytes, contentType: response.headers.get("content-type") ?? "" };
    };
  }

  const deadline = Date.now() + startupTimeoutMs;
  for (;;) {
    if (child.exitCode !== null) {
      await stop();
      throw new Error(`The development server exited during startup.\n${output}`);
    }
    try {
      const health = await as(users.administrator)("/api/health");
      if (health.status === 200) break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`The development server did not become healthy within ${startupTimeoutMs} ms.\n${output}`);
    }
    await delay(500);
  }

  return { baseUrl, as, stop };
}

/** JSON request body helper. */
export function json(body, method = "POST") {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import postgres from "postgres";

const command = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function eventNames(raw) {
  return (raw || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9_.:-]{1,64}$/.test(value));
}

function slug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function funnelSteps(raw) {
  return (raw || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const separator = token.indexOf(":");
      if (separator < 1) return null;
      const kind = token.slice(0, separator).trim().toLowerCase();
      const rawValue = token.slice(separator + 1).trim();
      const value = kind === "event" ? rawValue.toLowerCase() : rawValue;
      if (!value || !["page", "event", "label"].includes(kind)) return null;
      return { kind, value: value.slice(0, 2048) };
    })
    .filter(Boolean);
}

try {
  if (command === "migrate") {
    const directory = new URL("../db/", import.meta.url);
    const migrations = (await readdir(directory))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort((a, b) => (parseInt(a, 10) - parseInt(b, 10)) || a.localeCompare(b));

    for (const file of migrations) {
      const migration = await readFile(new URL(file, directory), "utf8");
      await sql.unsafe(migration);
      console.log(`Applied ${file}`);
    }
  } else if (command === "site:create") {
    const id = arg("id");
    const name = arg("name");
    const domain = arg("domain");

    if (!id || !name || !domain) {
      console.error(
        'Usage: npm run site:create -- --id my-site --name "My Site" --domain example.com',
      );
      process.exitCode = 1;
    } else {
      const secret = randomBytes(32).toString("base64url");
      const secretHash = createHash("sha256").update(secret).digest("hex");

      await sql`
        INSERT INTO sites (id, name, domain, secret_hash)
        VALUES (${id}, ${name}, ${domain}, ${secretHash})
      `;

      console.log("");
      console.log(`Created ${name} (${id})`);
      console.log(`MINILYTICS_SITE_ID=${id}`);
      console.log(`MINILYTICS_SITE_SECRET=${secret}`);
      console.log("");
      console.log("The secret is only shown now. Put it in the tracked site's server-side environment.");
    }
  } else if (command === "site:goals") {
    const id = arg("id");
    const events = eventNames(arg("events"));

    if (!id || !events.length) {
      console.error(
        "Usage: npm run site:goals -- --id my-site --events outbound,lead,signup",
      );
      process.exitCode = 1;
    } else {
      const result = await sql`
        UPDATE sites
        SET key_events = ${sql.json(events)}
        WHERE id = ${id}
        RETURNING id
      `;
      if (!result.length) throw new Error(`Unknown site: ${id}`);
      console.log(`Key events for ${id}: ${events.join(", ")}`);
    }
  } else if (command === "site:funnel") {
    const id = arg("id");
    const name = arg("name");
    const steps = funnelSteps(arg("steps"));

    if (!id || !name || steps.length < 2) {
      console.error(
        'Usage: npm run site:funnel -- --id my-site --name "Lead funnel" --steps "page:/leasing/*,event:outbound,event:lead"',
      );
      process.exitCode = 1;
    } else {
      const [site] = await sql`SELECT funnels FROM sites WHERE id = ${id} LIMIT 1`;
      if (!site) throw new Error(`Unknown site: ${id}`);

      const funnel = { id: slug(name) || `funnel-${Date.now()}`, name, steps };
      const existing = Array.isArray(site.funnels) ? site.funnels : [];
      const funnels = [...existing.filter((item) => item?.id !== funnel.id), funnel];

      await sql`
        UPDATE sites
        SET funnels = ${sql.json(funnels)}
        WHERE id = ${id}
      `;
      console.log(`Saved funnel ${name} for ${id}.`);
    }
  } else {
    console.error(
      "Usage: node scripts/setup.mjs <migrate|site:create|site:goals|site:funnel>",
    );
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}

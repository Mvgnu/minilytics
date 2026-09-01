import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
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

try {
  if (command === "migrate") {
    const migration = await readFile(
      new URL("../db/001_init.sql", import.meta.url),
      "utf8",
    );
    await sql.unsafe(migration);
    console.log("Database migrated.");
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
  } else {
    console.error("Usage: node scripts/setup.mjs <migrate|site:create>");
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}

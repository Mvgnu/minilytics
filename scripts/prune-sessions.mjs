import postgres from 'postgres';
const sql=postgres(process.env.DATABASE_URL,{max:1,connection:{statement_timeout:5000,application_name:'minilytics-session-cleanup'}});
try {
 await sql`DELETE FROM analytics_network_sessions WHERE expires_at <= now()`;
 // Attribution is already copied into events. An inactive lookup is unnecessary.
 await sql`DELETE FROM analytics_sessions WHERE last_seen_at < now() - interval '1 day'`;
} finally {await sql.end();}

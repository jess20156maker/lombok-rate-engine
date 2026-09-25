# Lombok Rate Engine

Read HANDOFF.md first: what is built, how data flows (collector -> data/ files -> Supabase -> web dashboard), and what is next.

- Collector: TypeScript in src/, run with npm scripts (discover, daily, sync, hydrate, check-env).
- Dashboard: Next.js in web/ (read web/AGENTS.md before changing it).
- Secrets live in .env (never commit or print it). GitHub remote uses the SSH host alias github-personal (account jess20156maker).

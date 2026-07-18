# The Heart Archive

Phase 1 prototype for a calm online archive of accidental heart shapes found in the world.

## What is included

- Public archive gallery
- Individual heart detail pages
- Sharing flow with photo upload and location visibility
- Supabase-backed archive data and photo storage
- Review handoff through the Supabase dashboard

## Run locally

```bash
npm run dev
```

Then open the local URL shown in the terminal.

## Database

The app is connected to the `batta-hub's Project` Supabase project. Public
visitors can share hearts, and the public archive displays approved hearts.
Pending shared hearts are reviewed in Supabase for now.

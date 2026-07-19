# The Heart Archive

A calm online archive of accidental heart shapes found in the world.

## What is included

- Public archive gallery
- Individual heart detail pages
- Authenticated, anonymous heart sharing
- Private My Archive contribution history
- Same-device draft recovery for unfinished titles, locations, and notes
- Supabase-backed archive data and photo storage
- Private admin review studio

## Run locally

```bash
npm run dev
```

Then open the local URL shown in the terminal.

## Database

The app is connected to the `batta-hub's Project` Supabase project. Public
visitors can browse approved hearts. Signed-in contributors can share hearts
anonymously and privately revisit their own history. Pending hearts are reviewed
in the admin studio before they join the public archive.

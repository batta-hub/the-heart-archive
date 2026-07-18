# Supabase Setup

The Heart Archive database is set up in Supabase under:

- Project: `batta-hub's Project`
- Project ref: `syufjyazsarkkvbebpsb`
- Project URL: `https://syufjyazsarkkvbebpsb.supabase.co`
- Region: `us-east-2`
- Storage bucket: `heart-photos`

## Tables

- `profiles`
- `categories`
- `hearts`
- `moderation_events`
- `reports`

## Moderation Model

Every heart starts as `pending`.

Only hearts with `status = 'approved'` are public.

Supported heart statuses:

- `pending`
- `approved`
- `rejected`
- `archived`

Supported profile roles:

- `contributor`
- `moderator`
- `admin`

## Security

Row Level Security is enabled on all public app tables.

Public visitors can:

- view active categories
- view approved hearts
- report approved hearts

Signed-in contributors can:

- share pending hearts
- upload photos to `heart-photos`

Moderators/admins can:

- view pending shared hearts
- approve/reject/archive hearts
- view moderation events
- review reports

Admins can:

- manage categories
- manage profile roles

The public archive does not display names, usernames, or emails. Auth is used only
to keep sharing and review trusted behind the scenes.

## Notes

Internal RLS helper functions live in the `private` schema so they are not exposed as public API endpoints.

The `heart-photos` bucket is public for image delivery, but object listing is not publicly allowed.

Uploads preserve the original photo in storage and create a pending database row through the `convert-heart` Edge Function. Browser-friendly images can be shown directly for JPEG, PNG, WebP, GIF, and AVIF uploads. HEIC/HEIF originals are accepted into the review queue first, then need a separate conversion step before they can display in the public archive.

The `convert-heart` Edge Function requires a signed-in user's access token and
stores that user's ID privately in `hearts.submitter_id`.

To make the first admin after signup, update that person's profile role in
Supabase:

```sql
update public.profiles
set role = 'admin'
where email = 'you@example.com';
```

## HEIC Display Pipeline

The database now tracks image conversion state on each heart:

- `conversion_status`: `not_needed`, `pending`, `processing`, `ready`, or `failed`
- `image_original_mime_type`
- `image_original_size_bytes`
- `conversion_error`
- `conversion_attempts`
- `conversion_requested_at`
- `conversion_started_at`
- `converted_at`

The share flow should stay lightweight: it saves the original photo and creates the review row. If a photo is HEIC/HEIF, it is marked `pending` for conversion and the site shows an intentional preparing-image placeholder until a browser-friendly display image is available.

Run the local converter with:

```bash
npm run convert:heic
```

The converter uses macOS `sips` to create JPEG display and thumbnail files, uploads them to:

- `heart-photos/display/{heart_id}.jpg`
- `heart-photos/thumbnails/{heart_id}.jpg`

If `SUPABASE_SERVICE_ROLE_KEY` is available in the environment, the converter also finalizes the database row automatically. Without that key, it still converts and uploads the images, then prints the SQL needed to finalize the row.

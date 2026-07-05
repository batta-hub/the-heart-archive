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
- submit pending hearts
- report approved hearts
- upload photos to `heart-photos`

Moderators/admins can:

- view pending submissions
- approve/reject/archive hearts
- view moderation events
- review reports

Admins can:

- manage categories
- manage profile roles

## Notes

Internal RLS helper functions live in the `private` schema so they are not exposed as public API endpoints.

The `heart-photos` bucket is public for image delivery, but object listing is not publicly allowed.

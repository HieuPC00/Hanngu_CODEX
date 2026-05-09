# Hán Ngữ

Mobile-first PWA for learning Chinese from uploaded images.

## Stack

- Next.js App Router on Vercel
- Supabase Auth with Google OAuth
- Supabase Postgres + RLS
- Gemini Vision API through `/api/extract`

## Environment Variables

Set these in Vercel Project Settings. Do not commit real secrets to Git.

```text
NEXT_PUBLIC_SUPABASE_URL=https://loxbneuilhdkneuuouhr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_publishable_or_anon_key
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

## Supabase Setup

1. Run `supabase-schema.sql` in Supabase SQL Editor.
2. Enable Google provider in Authentication.
3. Add Vercel URLs to Authentication redirect URLs:

```text
https://your-app.vercel.app/**
https://your-app.vercel.app/auth/callback
```

## Routes

- `/login`: Google OAuth login
- `/`: flashcard study
- `/upload`: image upload, Gemini extraction, editable preview
- `/library`: saved items

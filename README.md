# Mandarin Capture

Static PWA for creating and studying Mandarin flashcards from images or Chinese text.

## Public Web With Login

Use the free path:

1. Push this folder to GitHub.
2. Deploy the repo to Vercel as a static site. No build command is required.
3. Create a free Supabase project.
4. Run `supabase-schema.sql` in Supabase SQL Editor.
5. In Supabase Auth settings, add your Vercel domain to allowed redirect URLs.
6. Copy Supabase Project URL and anon public key into `config.js`.

`config.js`:

```js
window.MANDARIN_CAPTURE_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_ANON_PUBLIC_KEY"
};
```

The anon key is designed for browser apps. Row Level Security in `supabase-schema.sql` ensures each user only reads/writes their own deck.

## Current Features

- Email magic-link login.
- Local study when logged out.
- Cloud sync when logged in.
- JSON backup import/export.
- Image input placeholder and text-to-card creation.

## Next Work

- Add OCR with Tesseract.js.
- Add full pinyin generation.
- Add offline dictionary data.

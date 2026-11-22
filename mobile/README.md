# Fatherhood.School app (iOS and Android)

The members' app, built with Expo (SDK 58, React Native 0.88, Expo Router). Version 1 covers:

- **Sign in** with the email and password members use on the website. There is no sign-up and no
  purchase in the app (see "Store rules" below). The session token lives in the iOS Keychain /
  Android Keystore (`expo-secure-store`) and is sent as `Authorization: Bearer …`.
- **Home**: continue watching, courses in progress, the coach's next step, trending stories.
- **Learn**: the Academy's courses and lessons, with progress. Lessons that aren't free previews
  show "For members" to people without a membership.
- **Stories**: Community Voices, by newest, trending or top rated, filtered by theme.
- **Player** (`expo-video`, HLS): resumes where he left off, picture-in-picture and full screen,
  and the same 15-second heartbeats as the website (views, the creator pool, his place).
- **Downloads** for members: up to 40 videos, each licensed for 30 days and renewed whenever the app
  is online. Files are deleted when a license runs out or is revoked (membership ended, video taken
  down), when he removes them, and when he signs out. Watching a download offline saves his place
  and completion when the app is next online, but counts no views or creator-pool time.
- **Coach**: conversations (replies stream in), the learning path, "About you", and the crisis
  resources. Links in the coach's replies open the lesson or story in the app.
- **Account**: membership status (no prices), sign out, and delete account.

Not in version 1: Discussions, push notifications, Google sign-in, and a password reset (members
who signed up with Google, or forgot their password, can't sign in to the app yet).

## Running it

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<your computer's LAN address>:3000 npx expo start
```

Open it in a development build or Expo Go on a phone on the same network. Without
`EXPO_PUBLIC_API_URL` the app talks to https://fatherhood.school.

- `npm run typecheck`: TypeScript, including Expo Router's typed routes (run `npx expo start` once
  first to generate them).
- The pure modules (heartbeat meter, offline progress queue, license rules, the coach's stream
  parser, formatting) are tested from the repository root with `npm test`.
- `npm run export:web` builds a web version. It's only for checking screens in a browser:
  downloads are off there, and the site's sign-in needs the request to come from a phone (a
  browser sends fetch-metadata headers, so Better Auth asks for a trusted Origin).

The app shares two small files with the website, `src/lib/coach/format.ts` and
`src/lib/mobile/targets.ts`; `metro.config.js` lets the bundler reach them.

## Building and releasing

Builds run on EAS (`eas.json`): `npx eas build --platform ios --profile production` (and
`android`), then `npx eas submit`. Before the first build:

1. Create the app in App Store Connect (bundle id `school.fatherhood.app`) and in the Google Play
   Console (package `school.fatherhood.app`), and run `npx eas init` to link an Expo project.
2. Check the icons in `assets/` (generated from the website's mark).
3. Fill in the privacy questionnaires: the app sends account, viewing progress and coach messages to
   our servers; nothing is used for tracking or advertising.

## Store rules

The app is a "reader" app: people sign in to a membership bought on the website. To stay within
Apple's guideline 3.1.3(a) and Google Play's equivalent, it shows no prices, no buy or upgrade
buttons and no links to the pricing page; locked content just says it is for members. Account
deletion is in the app (Apple asks for it).

## Server side

The app uses the website's API: `/api/mobile/v1/*` (src/app/api/mobile/v1) for its screens and
downloads, plus the existing playback, progress and coach endpoints. Better Auth's bearer plugin
accepts the token. Downloads use Cloudflare Stream's MP4 downloads: the first request for a video
asks Stream to make the file (the app shows "Preparing…" and asks again every 10 seconds), and
each download link is a signed token with Stream's `downloadable` claim, so the signing key in
`CLOUDFLARE_STREAM_SIGNING_KEY_*` is required.

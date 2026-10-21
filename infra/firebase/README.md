# Firebase Realtime Database: opt-in capability rules

These files do **not** deploy or change an existing Firebase project automatically. They describe the app's existing personal, shared-secret synchronization protocol and supply reproducible emulator checks. No project credentials, real database URLs or user keys belong here.

## Security model and limits

The app does not use Firebase Authentication. Its credential is the unguessable `syncKey` in these paths:

- `users/<syncKey>`: schedule, progress and synchronized state, including `lock`.
- `audio/<syncKey>`: the same user's recordings.

Anyone possessing a key can read and write that key's paths, including from an unauthenticated client. A Firebase Auth `uid`, password, session or role is **not** checked. Knowing another valid key grants access to that key; the tests explicitly verify this capability behavior instead of claiming account isolation.

The rules deny reads/writes at the database root, parent collection enumeration and every unlisted collection. They allow only 20–768 character ASCII keys using `A–Z a–z 0–9 _ -`. They preserve the app's existing state format, incremental writes and audio paths; they do not introduce a database-schema migration. Existing keys outside these bounds must be migrated before adopting this exact policy. These are syntax bounds, not a promise that every key length is usable at every path: Firebase also limits the complete path to 768 bytes. For example, a 768-character key cannot be addressed under `users/` or `audio/`; child paths leave less room. Existing 200-character keys are verified, and the app-generated short keys remain recommended.

The site's generated key has 90 random bits plus a timestamp suffix. Use the generator or a password manager. A long, easily guessed manually entered key is still unsafe; syntax/length checks cannot prove entropy. Treat the sync link and Shortcut lock URL as credentials. Do not publish them, place them in logs or send them to unrelated services. A path credential does not support revoking one device independently; rotating the capability and moving the data is an operational migration.

The Shortcut uses an unauthenticated read of `users/<syncKey>/lock.json`. It remains compatible with these rules. Granting `.read` at `users` or at the database root to make the Shortcut work would expose every user's state and is unnecessary.

**Public multi-user launch boundary:** these capability rules are not a replacement for an account-authentication and server-side authorization design. Applications needing sign-in, password recovery, independent device revocation, tenant membership or roles must implement and test that design separately. Do not enable broad parent reads/writes as a shortcut.

## Reproducible isolated verification

Run from the repository root with Python 3.11+, Node 20+, Java 21, and a supported system Chromium. Install only the repository's locked test dependencies and cache the pinned public SDK bytes:

```sh
npm ci --prefix tools/runner --ignore-scripts --no-audit --no-fund
python3 tools/audit/cache-cdn.py
python3 tools/audit/run-firebase.py
node tools/audit/security-firebase-config.cjs
```

Use `CHROMIUM_PATH` or `CHROME_PATH` for a non-default Chromium location (`/usr/bin/chromium` is the default), and `AI_CDN_CACHE` for a non-default external CDN fixture cache. CI provides these explicitly.

`run-firebase.py` downloads the fixed official Firebase Database emulator **4.11.2**, verifies its pinned size and SHA-256, chooses an ephemeral loopback port, and starts the real Java emulator. `FIREBASE_EMULATOR_JAR` may select an already downloaded JAR, but it must pass the same verification. No Firebase CLI or production credentials are required. The harness forces the synthetic `demo-uqu-audit` namespace, imposes readiness/suite deadlines, and stops its owned emulator and child process groups on success or failure. SDK bytes are hash-verified against `tools/audit/cdn-fixtures.json`; unexpected external requests are blocked.

The three emulator suites run sequentially:

- `security-firebase.test.cjs`: **16** checks for real rule compilation, anonymous/authenticated access boundaries, denied enumeration, state/audio persistence, Shortcut lock reads, unknown-path denial, atomic rollback, tombstones and reset compatibility. Keys of 20, 128 and 200 characters work with fixture child data. The test also verifies the real total-path limit (762-character bare key and 757-character key plus `/lock` fit a 768-byte path; 768/769-character nested keys are rejected by the database). Authentication-dependent fixture rules first prove that the test JWT is recognized.
- `state-epochs.cjs`: **9** checks using three actual Firebase **10.12.2** browser SDK clients and the current production `fbAdapter`: initial parallel writes, repeated same-epoch concurrent edits, a genuine cold-cache null callback, an already queued offline stale edit released after a newer reset, older reset rejection, identical reset replay preserving a later edit, current-epoch recovery, and `applyLocally=false`.
- `state-longpoll.cjs`: **2** checks using the full app's original hash-authorized script and SRI loader. The original CDN-only CSP control blocks actual cross-origin Firebase JSONP; the production `strict-dynamic` policy permits the legitimate long-poll descendant. The successful fixture uses no WebSockets and produces no console errors. Chromium's local-network permission is granted solely for the cross-origin loopback fixture; CSP is never bypassed.

The separate full-app configuration suite has **4** checks across valid legacy/regional/derived config, copied JavaScript config, preserved 20/128/200/768-character key syntax, and 20 hostile configurations for both imported-link and saved-config startup paths. Invalid endpoints, credentials in URLs, non-HTTPS URLs and malformed values must be rejected before any SDK/backend request. Key syntax acceptance does not override the database's complete-path limit.

These tests use only synthetic fixture data and remove it afterwards. They verify the checked-in policy and current client code in an emulator, **not the rules or integration versions deployed to any live service**. Updating clients to use transaction fencing is necessary: older open clients and direct bearer-capability callers are not forced by these schema-compatible rules to use the new transaction protocol.

## Explicit operator deployment

Nothing in this audit or the existing application workflows deploys these rules. The currently deployed policy was not accessed. Before adopting this policy, export the database and current rules from the Firebase console, inspect compatibility with other applications sharing the database, and run the emulator checks against the intended data shape.

An authenticated operator can explicitly paste this policy in the Firebase console or deploy **database rules only** using their existing Firebase deployment toolchain, from this directory:

```sh
firebase deploy --only database --config firebase.json --project YOUR_REAL_PROJECT_ID
```

Then independently verify with test data that root/parent reads are denied, a known capability synchronizes state and audio, and the Shortcut reads its supplied `lock` leaf. Do not probe or print real users' data in CI. Never treat a passing `demo-` emulator run as proof that production has been secured.

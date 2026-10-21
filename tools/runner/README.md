# GitHub worker

The worker runs the checked-out site in Chromium as an additional synchronized device. It reads `UQU_RUNNER` and the job-scoped `GH_TOKEN`; it never needs a separate database or a deployed Node server.

```sh
npm ci --prefix tools/runner --ignore-scripts
npm test --prefix tools/runner
node tools/runner/run.mjs
```

Node 22 or later and a Chromium installation are required. `CHROME_PATH` selects the runtime executable; the browser tests use `CHROMIUM_PATH`. The remaining variables are `GITHUB_REPOSITORY`, `RUNNER_MAX_MIN` (default 50, maximum 55), and `RUNNER_STATE` (an optional cache snapshot). An unset `UQU_RUNNER` is an intentional no-op; malformed configured settings fail the run with a static, non-sensitive message.

The runner validates the site's Firebase settings before opening Chromium: an ASCII capability key of 20–768 characters, a nonempty public API key, and an HTTPS database URL on the official `firebaseio.com` or `firebasedatabase.app` domain. Embedded URL credentials, custom paths, query strings and fragments are rejected.

Browser web security stays enabled. A local streaming bridge accepts only the two exact Moonshot chat-completion endpoints, requires a per-run nonce, checks Host/Origin, bounds request size, preserves retry metadata, aborts disconnected requests, and disallows upstream redirects. The transport respects inherited HTTP(S) proxy and `NO_PROXY` configuration. No credentials are injected into an off-origin document or an iframe; top-level navigation away from the local application is blocked.

Every exit path closes the browser, local server and transport and removes the temporary profile. Unresponsive browser evaluations have a deadline. A configured worker that never obtains its synchronized state fails rather than silently reporting success.

The cache is an atomic, bounded whitelist of meter values, attempt counts, validated `am`/`rq`/`wk` job identifiers and learned limits. Private bookmark questions, lecture text, credentials, arbitrary localStorage keys and extra job arguments are never retained. The v2 cache namespace prevents restoring older unsanitized snapshots. Previously generated Actions caches are outside this checkout and should be removed or allowed to expire separately.

The regression suite uses fabricated credentials, isolated browsers, mocked upstream responses and temporary local Git repositories. It makes no paid AI request and performs no writes to live user data. `RUNNER_HOOK` remains an environment-only test hook; it is not accepted from synchronized state or from a job payload.

Playwright is pinned to 1.62.1 and audit browser scripts prefer this repository's installed copy. This tested minor update retains the runner APIs and moves the Linux WebKit checks to 26.5; the older 26.0 port encountered native reload crashes. WebKit engine checks do not replace testing Safari on a real Apple device.

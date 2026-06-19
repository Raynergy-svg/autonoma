---
title: Autonoma UI loads and shows sign-in
baseUrl: http://localhost:3000
criticality: high
flow: smoke
---

Verify the locally-running Autonoma web app loads correctly:

1. Navigate to the base URL.
2. Confirm the page renders without a blank screen or an error overlay (no "Application error", no uncaught-exception screen).
3. Confirm the app shell is present — a heading/logo for Autonoma and a primary call-to-action to sign in or get started.
4. Confirm there are no fatal console errors that break rendering.

Pass if the app shell + a sign-in / get-started affordance are visible. Fail if the page is blank, shows an error boundary, or the sign-in entry point is missing.

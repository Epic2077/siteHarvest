# Site adapters

Adapters are deliberately separate from the crawler.

The core crawler knows how to:

- fetch pages
- respect the crawler's basic robots policy
- deduplicate URLs
- detect technologies
- persist pages

An adapter knows how a particular site exposes its catalog.

For Darukade, the next step is to inspect the actual network requests and HTML/JSON structure and then implement:

1. category discovery
2. pagination
3. product URL discovery
4. product extraction
5. ingredient extraction
6. product/category mapping

Do not guess selectors before inspecting the live site. Prefer an internal JSON/API response if the site exposes one; otherwise fall back to structured JSON-LD and then HTML selectors.

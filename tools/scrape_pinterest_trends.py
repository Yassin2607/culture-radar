#!/usr/bin/env python3
"""
Pinterest Trends scraper — WAT Layer 3 Tool

Scrapes trending search terms from trends.pinterest.com for a given region.

Note: Pinterest Trends renders all data on a single page (no per-category sub-pages).
The `categories` parameter from the original spec was removed after exploratory discovery.

All trend data lives on the single landing page in distinct sections:
  - "Trends in de schijnwerpers" (spotlight) — via [data-test-id="topic-card"]
  - "Winkeltrends" (shopping) — via [data-test-id*="product-category-card"]
  - "Trends zoeken" (search keywords) — via [data-test-id*="trends-keyword-preview-table-row-term"]
  - "Keuze van de redactie" (editorial picks) — via [data-test-id*="trend-pill"]

Usage:
    python3 scrape_pinterest_trends.py '{"region": "US"}'
    python3 scrape_pinterest_trends.py '{"region": "BENELUX"}'

Output (stdout):
    {"trends": [...], "scrapedAt": "...", "count": N, "debug": {...}}
"""

import sys
import json
import os
import re
import unicodedata
from datetime import datetime, timezone
from typing import Optional


def normalize_keyword(keyword: str) -> str:
    """Normalize keyword: strip diacritics and lowercase for dedup comparison."""
    nfkd = unicodedata.normalize('NFD', keyword)
    return ''.join(c for c in nfkd if unicodedata.category(c) != 'Mn').lower().strip()


def get_iso_week() -> str:
    now = datetime.now(timezone.utc)
    year, week, _ = now.isocalendar()
    return f"{year}-W{week:02d}"


def parse_growth(growth_str: str) -> Optional[float]:
    """Parse growth strings like '+150%', '1.000%', '-20%' into numeric values."""
    if not growth_str:
        return None
    # Remove thousand separators (dots in NL locale)
    cleaned = growth_str.replace(".", "").replace(",", ".")
    match = re.search(r'([+-]?\d+)', cleaned)
    if match:
        return float(match.group(1))
    return None


def load_credentials() -> tuple[Optional[str], Optional[str]]:
    """Load Pinterest credentials from .env.local"""
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env.local")
    email = None
    password = None
    try:
        with open(env_path, "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("PINTEREST_EMAIL="):
                    email = line.split("=", 1)[1]
                elif line.startswith("PINTEREST_PASSWORD="):
                    password = line.split("=", 1)[1]
    except FileNotFoundError:
        pass
    return email, password


def scrape_trends(region: str) -> dict:
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError
    except ImportError:
        return {"trends": [], "count": 0, "error": "playwright_not_installed"}

    trends = []
    errors = []
    logged_in = False
    tmp_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".tmp")
    os.makedirs(tmp_dir, exist_ok=True)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/121.0.0.0 Safari/537.36"
                ),
                locale="nl-NL",
                extra_http_headers={"Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8"},
            )
            page = context.new_page()

            # ── Login to Pinterest (optional, unlocks full search trends) ──
            email, password = load_credentials()
            if email and password:
                try:
                    page.goto("https://www.pinterest.com/login/", wait_until="networkidle", timeout=30000)
                    page.wait_for_timeout(2000)

                    # Fill email
                    email_input = page.locator('input[name="id"], input[type="email"], #email').first
                    email_input.fill(email, timeout=5000)

                    # Fill password
                    pw_input = page.locator('input[name="password"], input[type="password"], #password').first
                    pw_input.fill(password, timeout=5000)

                    # Click login button
                    login_btn = page.locator('button[type="submit"], button:has-text("Inloggen"), button:has-text("Log in")').first
                    login_btn.click(timeout=5000)
                    page.wait_for_timeout(5000)

                    # Check if login succeeded (redirected away from /login/)
                    if "/login" not in page.url:
                        logged_in = True
                    else:
                        page.screenshot(path=os.path.join(tmp_dir, "pinterest-login-failed.png"), full_page=True)
                        errors.append("login: still on login page after attempt")
                except Exception as e:
                    errors.append(f"login: {e}")
                    page.screenshot(path=os.path.join(tmp_dir, "pinterest-login-error.png"), full_page=True)

            # Navigate to Pinterest Trends landing page
            try:
                page.goto("https://trends.pinterest.com", wait_until="networkidle", timeout=30000)
            except PWTimeoutError:
                pass  # Page may still have content
            except Exception as e:
                browser.close()
                return {"trends": [], "count": 0, "error": f"navigation_failed: {e}"}

            # Dismiss cookie banner
            cookie_selectors = [
                "button[data-testid='cookie-accept']",
                "button:has-text('Accept')",
                "button:has-text('Accepteren')",
                "button:has-text('Alle accepteren')",
                "button:has-text('Accept all')",
                "[id*='onetrust-accept']",
                "[class*='cookie'] button",
            ]
            for selector in cookie_selectors:
                try:
                    btn = page.locator(selector).first
                    if btn.is_visible(timeout=2000):
                        btn.click(timeout=3000)
                        page.wait_for_timeout(1000)
                        break
                except Exception:
                    continue

            # ── Region selection via <select> dropdown ──
            # Pinterest Trends has a <select> element with region options.
            # Values: "US" (default), "NL+BE+LU" (Benelux), "DE" (Germany), etc.
            REGION_VALUES = {
                "US": "US",
                "BENELUX": "NL+BE+LU",
                "NL": "NL+BE+LU",
                "BE": "NL+BE+LU",
                "UK": "GB+IE",
                "GB": "GB+IE",
                "DE": "DE",
                "FR": "FR",
            }
            select_value = REGION_VALUES.get(region.upper(), region.upper())

            if select_value != "US":
                try:
                    select_el = page.locator("select").first
                    if select_el.is_visible(timeout=3000):
                        select_el.select_option(value=select_value, timeout=3000)
                        page.wait_for_timeout(5000)  # Wait for page to reload with new region data
                    else:
                        errors.append("region_selection: select element not found")
                except Exception as e:
                    errors.append(f"region_selection: {e}")

                # Save screenshot after region selection
                page.screenshot(
                    path=os.path.join(tmp_dir, "pinterest-trends-after-region.png"),
                    full_page=True,
                )

            # Wait for dynamic content
            page.wait_for_timeout(3000)

            # Save debug screenshot and HTML
            page.screenshot(
                path=os.path.join(tmp_dir, "pinterest-trends-landing.png"),
                full_page=True,
            )
            with open(os.path.join(tmp_dir, "pinterest-trends-landing.html"), "w", encoding="utf-8") as f:
                f.write(page.content())

            # ── Section 0: Top trends carousel (Benelux/non-US regions) ──
            # Non-US regions use "trends-top-trends-card-text" instead of "topic-card"
            try:
                top_trends = page.evaluate("""() => {
                    const results = [];
                    const cards = document.querySelectorAll('[data-test-id="trends-top-trends-card-text"]');
                    cards.forEach(card => {
                        const text = (card.innerText || '').trim();
                        if (text) results.push({ keyword: text });
                    });
                    return results;
                }""")
                # Click carousel right arrow to reveal more items
                for _ in range(3):
                    try:
                        arrow = page.locator('[data-test-id="top-trends-carousel-right-arrow"]').first
                        if arrow.is_visible(timeout=1000):
                            arrow.click(timeout=2000)
                            page.wait_for_timeout(1000)
                            more = page.evaluate("""() => {
                                const results = [];
                                document.querySelectorAll('[data-test-id="trends-top-trends-card-text"]').forEach(card => {
                                    results.push({ keyword: (card.innerText || '').trim() });
                                });
                                return results;
                            }""")
                            for item in more:
                                kw = item.get("keyword", "").strip()
                                if kw and len(kw) > 1 and not any(t["keyword"] == kw for t in trends):
                                    trends.append({
                                        "keyword": kw,
                                        "category": "popular",
                                        "growth_raw": None,
                                        "growth_pct": None,
                                        "region": region,
                                    })
                    except Exception:
                        break
                for item in top_trends:
                    kw = item.get("keyword", "").strip()
                    if kw and len(kw) > 1:
                        trends.append({
                            "keyword": kw,
                            "category": "popular",
                            "growth_raw": None,
                            "growth_pct": None,
                            "region": region,
                        })
            except Exception as e:
                errors.append(f"top_trends_carousel: {e}")

            # ── Section 1: Spotlight trends ("Trends in de schijnwerpers") ──
            try:
                spotlight = page.evaluate("""() => {
                    const results = [];
                    const cards = document.querySelectorAll('[data-test-id="topic-card"]');
                    cards.forEach(card => {
                        const lines = (card.innerText || '').split('\\n').map(l => l.trim()).filter(Boolean);
                        // lines[0] = rank number, lines[1] = keyword, lines[2+] = growth + category
                        if (lines.length >= 2) {
                            const keyword = lines[1];
                            let growth = null;
                            let category = null;
                            for (const line of lines.slice(2)) {
                                if (line.includes('%') || line.includes('MoM')) {
                                    growth = line;
                                }
                                // Category label from interest-name elements
                                const catEl = card.querySelector('[data-test-id*="interest-name"]');
                                if (catEl) category = catEl.getAttribute('data-test-id').replace('interest-name-', '');
                            }
                            // Fallback: look for category in text
                            if (!category) {
                                const lastLine = lines[lines.length - 1];
                                if (lastLine && !lastLine.includes('%') && !lastLine.includes('MoM')) {
                                    category = lastLine;
                                }
                            }
                            results.push({ keyword, growth, category });
                        }
                    });
                    return results;
                }""")
                for item in spotlight:
                    kw = item.get("keyword", "").strip()
                    if kw and len(kw) > 2:
                        growth_raw = item.get("growth")
                        trends.append({
                            "keyword": kw,
                            "category": item.get("category") or "spotlight",
                            "growth_raw": growth_raw,
                            "growth_pct": parse_growth(growth_raw) if growth_raw else None,
                            "region": region,
                        })
            except Exception as e:
                errors.append(f"spotlight: {e}")

            # ── Section 1b: Spotlight per interest category (US only) ──
            # The second <select> on the page filters spotlight trends by interest.
            INTEREST_FILTERS = {
                "architectuur":           "918105274631",
                "doe-het-zelf en knutselen": "934876475639",
                "eten en drinken":        "918530398158",
                "evenementenplanning":    "941870572865",
                "gezondheid":             "898620064290",
                "huisinrichting":         "935249274030",
                "kunst":                  "961238559656",
                "mode":                   "FASHION",
                "ouderschap":             "920236059316",
                "reizen":                 "908182459161",
                "tuinieren":              "909983286710",
                "verzorging":             "935541271955",
            }
            try:
                selects = page.locator("select")
                interest_select = selects.nth(1) if selects.count() >= 2 else None
                if interest_select and interest_select.is_visible(timeout=2000):
                    for interest_name, interest_value in INTEREST_FILTERS.items():
                        try:
                            interest_select.select_option(value=interest_value, timeout=3000)
                            page.wait_for_timeout(3000)

                            cat_spotlight = page.evaluate("""() => {
                                const results = [];
                                const cards = document.querySelectorAll('[data-test-id="topic-card"]');
                                cards.forEach(card => {
                                    const lines = (card.innerText || '').split('\\n').map(l => l.trim()).filter(Boolean);
                                    if (lines.length >= 2) {
                                        const keyword = lines[1];
                                        let growth = null;
                                        for (const line of lines.slice(2)) {
                                            if (line.includes('%') || line.includes('MoM')) {
                                                growth = line;
                                                break;
                                            }
                                        }
                                        results.push({ keyword, growth });
                                    }
                                });
                                return results;
                            }""")
                            for item in cat_spotlight:
                                kw = item.get("keyword", "").strip()
                                if kw and len(kw) > 2:
                                    growth_raw = item.get("growth")
                                    trends.append({
                                        "keyword": kw,
                                        "category": interest_name,
                                        "growth_raw": growth_raw,
                                        "growth_pct": parse_growth(growth_raw) if growth_raw else None,
                                        "region": region,
                                    })
                        except Exception as e:
                            errors.append(f"interest_{interest_name}: {e}")

                    # Reset filter to "Alle"
                    try:
                        interest_select.select_option(value="ALL", timeout=3000)
                        page.wait_for_timeout(2000)
                    except Exception:
                        pass
            except Exception as e:
                errors.append(f"interest_filters: {e}")

            # ── Section 2: Shopping trends ("Winkeltrends") ──
            try:
                shopping = page.evaluate("""() => {
                    const results = [];
                    const cards = document.querySelectorAll('[data-test-id*="product-category-card"]');
                    cards.forEach(card => {
                        const lines = (card.innerText || '').split('\\n').map(l => l.trim()).filter(Boolean);
                        // Heading is inside an h3; growth is nearby
                        const h3 = card.querySelector('h3');
                        const keyword = h3 ? h3.innerText.trim() : (lines[0] || '');
                        let growth = null;
                        const growthEl = card.querySelector('[data-test-id="OUTBOUND_CLICK-growth-summary"]');
                        if (growthEl) {
                            growth = growthEl.innerText.trim();
                        } else {
                            for (const line of lines) {
                                if (line.includes('%') && line.includes('MoM')) {
                                    growth = line;
                                    break;
                                }
                            }
                        }
                        if (keyword) results.push({ keyword, growth });
                    });
                    return results;
                }""")
                for item in shopping:
                    kw = item.get("keyword", "").strip()
                    if kw and len(kw) > 2:
                        growth_raw = item.get("growth")
                        trends.append({
                            "keyword": kw,
                            "category": "shopping",
                            "growth_raw": growth_raw,
                            "growth_pct": parse_growth(growth_raw) if growth_raw else None,
                            "region": region,
                        })
            except Exception as e:
                errors.append(f"shopping: {e}")

            # ── Navigate to full search trends page (if logged in) ──
            if logged_in:
                try:
                    # Go back to trends overview first (interest filters may have changed the page)
                    page.goto("https://trends.pinterest.com", wait_until="networkidle", timeout=30000)
                    page.wait_for_timeout(3000)

                    # Re-select region if needed
                    if select_value != "US":
                        try:
                            sel = page.locator("select").first
                            if sel.is_visible(timeout=3000):
                                sel.select_option(value=select_value, timeout=3000)
                                page.wait_for_timeout(5000)
                        except Exception:
                            pass

                    view_btn = page.locator('[data-test-id="view-shopping-trends-button"]').first
                    if view_btn.is_visible(timeout=3000):
                        view_btn.click(timeout=5000)
                        page.wait_for_timeout(5000)
                        for _ in range(5):
                            page.keyboard.press("End")
                            page.wait_for_timeout(1000)
                except Exception as e:
                    errors.append(f"view_search_trends: {e}")

            # ── Section 3: Search keyword trends ("Trends zoeken" / "Populaire trefwoorden") ──
            try:
                search_trends = page.evaluate("""() => {
                    const results = [];

                    // Strategy A: Full table (logged in) — uses "trends-table-term" + <tr>/<td>
                    const fullTerms = document.querySelectorAll('[data-test-id="trends-table-term"]');
                    if (fullTerms.length > 0) {
                        const rows = document.querySelectorAll('tr');
                        rows.forEach(row => {
                            const cells = row.querySelectorAll('td');
                            if (cells.length >= 4) {
                                const termEl = row.querySelector('[data-test-id="trends-table-term"]');
                                const keyword = termEl ? termEl.innerText.trim() : cells[0].innerText.trim();
                                const wow = cells[1] ? cells[1].innerText.trim() : null;
                                const mom = cells[2] ? cells[2].innerText.trim() : null;
                                const yoy = cells[3] ? cells[3].innerText.trim() : null;
                                if (keyword) results.push({ keyword, wow, mom, yoy });
                            }
                        });
                        return results;
                    }

                    // Strategy B: Preview table (not logged in) — uses "trends-keyword-preview-table-row-*"
                    const termCells = document.querySelectorAll('[data-test-id="trends-keyword-preview-table-row-term"]');
                    const weeklyCells = document.querySelectorAll('[data-test-id="trends-keyword-preview-table-row-wow"]');
                    const monthlyCells = document.querySelectorAll('[data-test-id="trends-keyword-preview-table-row-mom"]');
                    const yearlyCells = document.querySelectorAll('[data-test-id="trends-keyword-preview-table-row-yoy"]');

                    termCells.forEach((cell, i) => {
                        const keyword = (cell.innerText || '').trim();
                        const wow = i < weeklyCells.length ? (weeklyCells[i].innerText || '').trim() : null;
                        const mom = i < monthlyCells.length ? (monthlyCells[i].innerText || '').trim() : null;
                        const yoy = i < yearlyCells.length ? (yearlyCells[i].innerText || '').trim() : null;
                        if (keyword) results.push({ keyword, wow, mom, yoy });
                    });
                    return results;
                }""")
                for item in search_trends:
                    kw = item.get("keyword", "").strip()
                    if kw and len(kw) > 2:
                        mom = item.get("mom")
                        wow = item.get("wow")
                        yoy = item.get("yoy")
                        # Combine MoM, WoW, and YoY into a single growth_raw string
                        parts = []
                        if mom:
                            parts.append(f"MoM:{mom}")
                        if wow:
                            parts.append(f"WoW:{wow}")
                        if yoy:
                            parts.append(f"YoY:{yoy}")
                        growth_raw = " | ".join(parts) if parts else None
                        trends.append({
                            "keyword": kw,
                            "category": "search",
                            "growth_raw": growth_raw,
                            "growth_pct": parse_growth(mom) if mom else None,
                            "region": region,
                        })
            except Exception as e:
                errors.append(f"search: {e}")

            # ── Section 4: Editorial picks ("Keuze van de redactie") ──
            try:
                editorial = page.evaluate("""() => {
                    const results = [];
                    const pills = document.querySelectorAll('[data-test-id*="trend-pill"]');
                    pills.forEach(pill => {
                        const testId = pill.getAttribute('data-test-id') || '';
                        // data-test-id format: "trend-pill-frozen-yogurt-bark-+30%"
                        const raw = testId.replace('trend-pill-', '');
                        const text = (pill.innerText || '').trim();
                        results.push({ keyword: text || raw, testId: raw });
                    });

                    // Also get editorial article titles
                    const articles = document.querySelectorAll('[data-test-id*="trends-editorial-article"]');
                    const seen = new Set();
                    articles.forEach(article => {
                        const testId = article.getAttribute('data-test-id') || '';
                        if (testId.includes('tap-area')) return;  // skip tap-area duplicates
                        const lines = (article.innerText || '').split('\\n').map(l => l.trim()).filter(Boolean);
                        const title = lines[0] || '';
                        if (title && !seen.has(title)) {
                            seen.add(title);
                            // Find associated category
                            let category = null;
                            for (const line of lines) {
                                if (line.startsWith('Populair in')) {
                                    category = lines[lines.indexOf(line) + 1] || null;
                                    break;
                                }
                            }
                            results.push({ keyword: title, category, isArticle: true });
                        }
                    });
                    return results;
                }""")
                for item in editorial:
                    kw = item.get("keyword", "").strip()
                    if kw and len(kw) > 2:
                        # Parse growth from pill keywords like "frozen yogurt bark +30%"
                        growth_raw = None
                        match = re.search(r'[+-]\d+%', kw)
                        if match:
                            growth_raw = match.group(0)
                            kw = kw[:match.start()].strip()
                        trends.append({
                            "keyword": kw,
                            "category": item.get("category") or "editorial",
                            "growth_raw": growth_raw,
                            "growth_pct": parse_growth(growth_raw) if growth_raw else None,
                            "region": region,
                        })
            except Exception as e:
                errors.append(f"editorial: {e}")

            browser.close()

    except Exception as e:
        return {"trends": [], "count": 0, "error": str(e)}

    # ── Deduplicate: same keyword (ignoring diacritics) keeps the one with most data ──
    seen: dict[str, int] = {}
    deduped: list[dict] = []
    for t in trends:
        norm = normalize_keyword(t["keyword"])
        if norm in seen:
            existing = deduped[seen[norm]]
            # Keep the one with growth_raw data; if both have it, keep search over popular
            if not existing.get("growth_raw") and t.get("growth_raw"):
                deduped[seen[norm]] = t
            elif existing.get("category") == "popular" and t.get("category") == "search":
                deduped[seen[norm]] = t
        else:
            seen[norm] = len(deduped)
            deduped.append(t)
    trends = deduped

    result = {
        "trends": trends,
        "scrapedAt": datetime.now(timezone.utc).isoformat(),
        "count": len(trends),
        "week": get_iso_week(),
        "region": region,
        "debug": {
            "screenshotDir": tmp_dir,
            "loggedIn": logged_in,
            "errors": errors,
            "sections": {
                "popular": len([t for t in trends if t.get("category") == "popular"]),
                "spotlight": len([t for t in trends if t.get("category") == "spotlight"]),
                "shopping": len([t for t in trends if t.get("category") == "shopping"]),
                "search": len([t for t in trends if t.get("category") == "search"]),
                "editorial": len([t for t in trends if t.get("category") == "editorial"]),
            },
        },
    }

    if len(trends) == 0:
        result["error"] = "no_trends_extracted"

    return result


def main():
    if len(sys.argv) < 2:
        payload = {}
    else:
        try:
            payload = json.loads(sys.argv[1])
        except json.JSONDecodeError:
            print(json.dumps({"trends": [], "count": 0, "error": "invalid_json"}))
            sys.exit(1)

    region = payload.get("region", "US")

    result = scrape_trends(region)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

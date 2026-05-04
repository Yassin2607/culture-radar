# Your Next Viral Product Is Already Trending — You're Just Not Listening

**From Gut Feeling to Signal Detection: How We Built a Trend Forecasting Engine for Retail**

---

How do you decide which products deserve social content?

If you're like most retail marketing teams, someone scrolls through the new arrivals, picks what "feels right," and briefs a creator. Maybe the product looks good on camera. Maybe it worked last time. Maybe it's just someone's gut feeling.

Here's the problem: by the time your content goes live, the trend window may already be closing. And the product that actually would've gone viral? It's sitting in the warehouse, untouched by your content calendar.

## The signal is already there

Every day, thousands of people are telling you what they want — through search queries, Reddit threads, TikTok captions, and YouTube comments. The data exists. It's just scattered across platforms, buried in noise, and moving faster than any human can track manually.

So we asked ourselves: what if we could listen to all of it at once?

## What we're building

In short: an automated pipeline that collects trend signals from 8+ platforms, scores every new product against them, and outputs a ranked list — so the content team picks from data, not gut feeling.

Here's how the pipeline actually works, step by step:

1. **Scrape trend data** — We pull live signals from Google Trends, Pinterest trending searches, Reddit communities, TikTok engagement data, YouTube trending content, and industry feeds like Exploding Topics and Social Media Today.
2. **Scrape new arrivals** — Every time new products hit the shelves, the system automatically pulls them from the arrivals page.
3. **Normalize and match** — The raw trend data gets cleaned, deduplicated, and matched against product categories. A Pinterest spike for "sunset lamp aesthetic" needs to connect to the actual LED lamp sitting in inventory.
4. **Score each product** — Every product runs through a multi-dimensional scoring model. Not a single "trending or not" label — but six factors, each scored 1-10:

- **Price-Quality Ratio** — Does the price point hit a sweet spot for impulse buys?
- **Innovation Factor** — Is this something people haven't seen before at this price?
- **Practical Utility** — Does it solve a real, everyday problem?
- **Gift Potential** — Would someone buy this for someone else?
- **Seasonal Relevance** — Does it align with what people are thinking about right now?
- **Viral Potential** — Does it have the visual or emotional hook that makes people share?

5. **Output a ranked list** — The result is a ranked list with specific reasoning behind each score, pushed to a spreadsheet where the content team can act on it.

## What this looks like in practice

Let's take a real example. Say there's a **LED sunset projection lamp, priced at EUR 14.95**.

The pipeline picks up:
- Pinterest trending: "golden hour aesthetic" searches up 280% this month
- Reddit: r/RoomDecor and r/CozyPlaces are buzzing about ambient lighting setups
- TikTok: "sunset lamp" videos collectively pulled 12M+ views this week
- Google Trends: "room makeover budget" is spiking as spring kicks in

The model scores it:
- **Price-Quality Ratio:** 9/10 — classic impulse buy territory
- **Innovation Factor:** 5/10 — been around, but still fresh to many audiences
- **Practical Utility:** 4/10 — decorative, not functional
- **Gift Potential:** 8/10 — easy, visual, affordable gift
- **Seasonal Relevance:** 9/10 — spring refresh + golden hour content season
- **Viral Potential:** 9/10 — highly visual, proven TikTok format

**Composite Trend Score: 73/100** — with a clear note: "High viral potential. Best window: next 2-3 weeks. Recommended angle: budget room makeover or aesthetic gift guide."

Compare that to just scrolling past it because someone on the team already picked three other products that morning.

## What surprised us

Building this, a few things caught us off guard:

- **Pinterest turned out to be one of the strongest signals.** We initially treated it as secondary to Google Trends, but Pinterest trending searches are more specific and often lead Google spikes by 1-2 weeks. People pin what they want before they search for where to buy it.
- **Not all Reddit buzz translates to buying intent.** A product can be all over r/InternetIsBeautiful and still score low — because the audience is there to look, not to shop. We had to weight subreddit type into the model.
- **Seasonal context changes everything.** The same product can score 40 in July and 85 in November. Without time-awareness baked into the model, the scores were basically meaningless.

## Why this matters

When you know *why* something is likely to trend, you can act on it. You can brief creators with confidence, prioritize the right products, and time your content to ride a wave instead of chasing it.

The shift from gut feeling to signal detection isn't about replacing creativity — it's about pointing creativity in the right direction. The best content still needs a human touch. But the decision of *what* to create content about? That's a data problem. And data problems have data solutions.

Your next viral product is already out there. The question is whether you're listening.

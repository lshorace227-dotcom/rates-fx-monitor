// test/news.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRss, newsQueryFor } from "../lib/news.js";

const XML = `<?xml version="1.0"?><rss><channel>
<item><title>Fed holds rates steady</title><link>https://ex.com/a</link>
<pubDate>Wed, 03 Jun 2026 10:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item>
<item><title><![CDATA[Yuan slips vs dollar]]></title><link>https://ex.com/b</link>
<pubDate>Thu, 04 Jun 2026 08:00:00 GMT</pubDate><source url="https://ft.com">FT</source></item>
</channel></rss>`;

test("parseRss extracts title/url/source/pubDate, handles CDATA", () => {
  const items = parseRss(XML, 6);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Fed holds rates steady");
  assert.equal(items[0].url, "https://ex.com/a");
  assert.equal(items[0].source, "Reuters");
  assert.equal(items[1].title, "Yuan slips vs dollar"); // CDATA stripped
});

test("parseRss respects n limit and drops items missing title/url", () => {
  assert.equal(parseRss(XML, 1).length, 1);
  assert.equal(parseRss("<rss></rss>").length, 0);
});

test("newsQueryFor maps known ids, falls back to label", () => {
  assert.match(newsQueryFor("HIBOR_3M"), /HIBOR/);
  assert.equal(newsQueryFor("UNKNOWN", "我的标的"), "我的标的");
});

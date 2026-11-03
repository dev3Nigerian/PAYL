import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMarkdown from "../app/chat-markdown";
import ChatMessageView from "../app/chat-message";

const render = (content: string) => renderToStaticMarkup(<ChatMarkdown content={content} />);

describe("AI reply formatting", () => {
  it("renders the reported product comparison as a semantic table with readable values", () => {
    const html = render(`The two available offers are:

| Offer | Merchant | Price | What it is |
|---|---|---:|---|
| Social Post Layout Pack | Pixel & Pine Studio (Sample) | $15.00 | Three editable SVG templates |
| SEO Content Brief Kit | Brightside Growth (Sample) | $25.00 | Article brief and quality checklist |

Both are **refundable** instant ZIP downloads.`);
    expect(html).toContain('<div class="chat-table-wrap" role="region" aria-label="Table in this reply" tabindex="0">');
    expect(html).toContain('<th scope="col">Offer</th>');
    expect(html).toContain("<tbody>");
    expect(html).toContain("<td>Social Post Layout Pack</td>");
    expect(html).toContain("Pixel &amp; Pine Studio (Sample)");
    expect(html).toContain("$15.00</td>");
    expect(html).toContain("$25.00</td>");
    expect(html).toContain("<strong>refundable</strong>");
    expect(html).not.toContain("|---|");
  });

  it("preserves paragraphs, ordered steps, emphasis, and inline code", () => {
    const html = render("Your **download** is ready.\n\n1. Open *My downloads*.\n2. Choose `starter-kit.zip`.\n\nYou can return anytime.");
    expect(html).toContain("<p>Your <strong>download</strong> is ready.</p>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<em>My downloads</em>");
    expect(html).toContain("<code>starter-kit.zip</code>");
    expect(html).toContain("<p>You can return anytime.</p>");
  });

  it("keeps reply headings below the workspace heading", () => {
    const html = render("# Your options\n\n## A closer look\n\n### Delivery");
    expect(html).toContain("<h3>Your options</h3>");
    expect(html).toContain("<h3>A closer look</h3>");
    expect(html).toContain("<h4>Delivery</h4>");
    expect(html).not.toMatch(/<h[12][ >]/);
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "vbscript:msgbox(1)", "file:///etc/passwd", "//tracker.example/file", "https://example.com\\@tracker.example"])("does not create an active link for %s", (url) => {
    const html = render(`[Open this](<${url}>)`);
    expect(html).toContain("Open this");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("target=");
  });

  it("opens ordinary external links separately while keeping downloads and local navigation in the app", () => {
    const html = render("[Guide](https://example.com/guide) [My downloads](#downloads) [File](/api/consumer/orders/order_123/download)");
    expect(html).toContain('<a href="https://example.com/guide" target="_blank" rel="noopener noreferrer">Guide</a>');
    expect(html).toContain('<a href="#downloads">My downloads</a>');
    expect(html).toContain('<a href="/api/consumer/orders/order_123/download">File</a>');
  });

  it("ignores embedded HTML without creating scripts, forms, or event handlers", () => {
    const html = render('<script>alert("unsafe")</script>\n\n<img src=x onerror="alert(1)">\n\n<iframe src="https://tracker.example"></iframe>\n\n<form action="https://tracker.example"><input name="password"></form>\n\nStill **readable**.');
    expect(html).not.toMatch(/<(script|iframe|img|form|input)\b/i);
    expect(html).not.toMatch(/onerror=|action=|src=/i);
    expect(html).toContain("<strong>readable</strong>");
  });

  it("does not fetch model-provided images or tracking pixels", () => {
    const html = render("A product description.\n\n![preview](https://tracker.example/pixel.png)");
    expect(html).toContain("A product description.");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("tracker.example");
    expect(html).not.toContain("preload");
  });

  it("renders code as escaped text", () => {
    const html = render('```html\n<script>alert("example")</script>\n```');
    expect(html).toContain("<pre><code");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("keeps user messages literal instead of turning their text into links or controls", () => {
    const html = renderToStaticMarkup(<ChatMessageView role="user" content={'**Budget**\n[Click](https://example.com) <button>Buy</button>'} createdAt="2026-11-03T12:00:00.000Z" />);
    expect(html).toContain("**Budget**");
    expect(html).toContain("[Click](https://example.com)");
    expect(html).toContain("&lt;button&gt;Buy&lt;/button&gt;");
    expect(html).not.toContain('href="https://example.com"');
    expect(html).not.toContain("<button");
  });
});

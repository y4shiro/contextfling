import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  MAX_SELECTION_LENGTH,
  normalizeSelection,
  normalizeSelectionDetailed,
} from "../src/core/selection.js";
import { normalizeXUrl, sanitizeXUrl } from "../src/core/url.js";
import {
  chooseNearestStatusLink,
  extractNearestStatusHref,
} from "../src/sources/x/extractor.js";

const projectRoot = process.cwd();

test("status URL は HTTPS、許可 host、status id へ正規化する", () => {
  assert.deepEqual(
    normalizeXUrl("https://x.com/alice/status/123456?utm_source=test#photo/1"),
    {
      value: "https://x.com/alice/status/123456",
      host: "x.com",
      kind: "status",
    },
  );
  assert.equal(
    sanitizeXUrl(
      "https://www.twitter.com/alice/status/123456/photo/1?ref=home#top",
    ),
    "https://www.twitter.com/alice/status/123456",
  );
});

test("status 以外の current page fallback は query/hash のみ除去する", () => {
  assert.deepEqual(normalizeXUrl("https://twitter.com/home?f=live#timeline"), {
    value: "https://twitter.com/home",
    host: "twitter.com",
    kind: "page",
  });
  assert.equal(sanitizeXUrl("https://x.com/"), "https://x.com/");
});

test("危険または unsupported な URL は拒否する", () => {
  const rejectedUrls = [
    "http://x.com/alice/status/123",
    "https://alice:secret@x.com/alice/status/123",
    "https://x.com.evil.example/alice/status/123",
    "https://x.com:8443/alice/status/123",
    "https://x.com/alice/status/not-a-number",
    "https://x.com/alice/status/123%2Fphoto",
    "https://x.com/alice/%zz/123",
    "javascript:alert(1)",
  ];
  for (const url of rejectedUrls) {
    assert.equal(normalizeXUrl(url), null, url);
  }
});

test("selection は改行を LF 化し、空と上限超過を拒否する", () => {
  assert.equal(
    normalizeSelection("  first\r\nsecond\rthird  "),
    "first\nsecond\nthird",
  );
  assert.deepEqual(normalizeSelectionDetailed("\r\n \t"), {
    ok: false,
    reason: "empty",
  });
  assert.deepEqual(
    normalizeSelectionDetailed("x".repeat(MAX_SELECTION_LENGTH + 1)),
    {
      ok: false,
      reason: "too-long",
    },
  );
  assert.deepEqual(normalizeSelectionDetailed(null), {
    ok: false,
    reason: "not-string",
  });
});

test("status link 候補は距離、同距離なら DOM 順で一つに絞る", () => {
  assert.equal(
    chooseNearestStatusLink([
      { href: "https://x.com/a/status/1", distance: 4, documentOrder: 1 },
      { href: "https://x.com/a/status/2", distance: 2, documentOrder: 3 },
      { href: "https://x.com/a/status/3", distance: 2, documentOrder: 0 },
    ]),
    "https://x.com/a/status/3",
  );
  assert.equal(
    chooseNearestStatusLink([
      {
        href: "https://x.com/a/status/1",
        distance: Number.NaN,
        documentOrder: 0,
      },
      { href: "https://x.com/a/status/2", distance: 1, documentOrder: -1 },
    ]),
    null,
  );
});

class FakeNode {
  public parentNode: FakeNode | null = null;
  public readonly parentElement: FakeElement | null;
  public readonly nodeType: number;

  public constructor(
    nodeType: number,
    parentElement: FakeElement | null = null,
  ) {
    this.nodeType = nodeType;
    this.parentElement = parentElement;
  }
}

class FakeElement extends FakeNode {
  public readonly children: FakeNode[] = [];
  public readonly attributes = new Map<string, string>();
  public readonly tagName: string;

  public constructor(tagName: string, parent: FakeElement | null = null) {
    super(1, parent);
    this.tagName = tagName;
    this.parentNode = parent;
    parent?.children.push(this);
  }

  public appendChild(child: FakeNode): void {
    child.parentNode = this;
    if (child instanceof FakeElement) {
      Object.defineProperty(child, "parentElement", { value: this });
    }
    this.children.push(child);
  }

  public closest(selector: string): FakeElement | null {
    let current: FakeNode | null = this;
    while (current instanceof FakeElement) {
      if (selector === "article" && current.tagName === "ARTICLE") {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  public querySelectorAll(selector: string): FakeAnchor[] {
    const result: FakeAnchor[] = [];
    const visit = (node: FakeNode): void => {
      if (node instanceof FakeAnchor && selector === "a[href]") {
        result.push(node);
      }
      if (node instanceof FakeElement) {
        node.children.forEach(visit);
      }
    };
    this.children.forEach(visit);
    return result;
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

class FakeAnchor extends FakeElement {
  public readonly href: string;

  public constructor(href: string, parent: FakeElement) {
    super("A", parent);
    this.href = href;
    this.attributes.set("href", href);
  }
}

class FakeText extends FakeNode {
  public constructor(parent: FakeElement) {
    super(3, parent);
    this.parentNode = parent;
  }
}

test("DOM extractor は選択位置の article 内 status link だけを読む", async () => {
  const fixture = await readFile(
    resolve(projectRoot, "tests/fixtures/x/target-post.html"),
    "utf8",
  );
  assert.match(fixture, /status\/123456/);

  const article = new FakeElement("ARTICLE");
  const body = new FakeElement("DIV", article);
  const selected = new FakeElement("SPAN", body);
  const selectedText = new FakeText(selected);
  selected.appendChild(selectedText);
  const unrelated = new FakeAnchor("https://example.com/nope", article);
  const target = new FakeAnchor(
    "/alice/status/123456?utm_source=test",
    selected,
  );
  const selection = { anchorNode: selectedText } as unknown as Selection;
  const document = {} as Document;

  assert.equal(
    extractNearestStatusHref(
      document,
      selection,
      "https://x.com/alice/status/123456",
    ),
    "https://x.com/alice/status/123456?utm_source=test",
  );
  assert.equal(unrelated.href, "https://example.com/nope");
  assert.equal(
    target.getAttribute("href"),
    "/alice/status/123456?utm_source=test",
  );
});

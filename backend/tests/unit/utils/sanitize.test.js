import { stripHtml, escapeRegex, stripMongoOperators } from "../../../src/utils/sanitize.js";

const NBSP = String.fromCharCode(0xa0); // U+00A0, invisible in source

describe("stripHtml", () => {
  it.each([
    ["<b>bold</b>", "bold"],
    ["<script>alert(1)</script>safe", "safe"],
    ["<img src=x onerror=alert(1)>hi", "hi"],
    ["plain text", "plain text"],
    ["  padded  ", "padded"],
  ])("%s -> %s", (input, expected) => {
    expect(stripHtml(input)).toBe(expected);
  });

  it("removes the script CONTENTS, not just the tags", () => {
    expect(stripHtml("<script>alert(1)</script>")).toBe("");
    expect(stripHtml("<SCRIPT>alert(1)</SCRIPT>")).toBe("");
  });

  it("leaves the text of non-script tags", () => {
    expect(stripHtml("<div>keep <b>this</b></div>")).toBe("keep this");
  });

  it("removes comments", () => {
    expect(stripHtml("<!-- sneaky -->hi")).toBe("hi");
  });

  it("does not let a nested tag reassemble once the inner one is removed", () => {
    expect(stripHtml("<scr<b>ipt>x</script>")).not.toContain("<");
  });

  it("coerces null and undefined to an empty string", () => {
    expect(stripHtml(null)).toBe("");
    expect(stripHtml(undefined)).toBe("");
  });

  // The old implementation entity-encoded the text it kept — users literally saw
  // "Tom &amp; Jerry" — and its HTML parser swallowed everything after a bare "<",
  // so "if a<b then" was stored as "if a".
  describe("does not mangle ordinary prose", () => {
    it.each([
      ["Tom & Jerry", "Tom & Jerry"],
      ["5 > 3 and 2 < 4", "5 > 3 and 2 < 4"],
      ["if a<b then", "if a<b then"],
      ["2 < 3 && 5 > 4 🚀", "2 < 3 && 5 > 4 🚀"],
      ['she said "hi"', 'she said "hi"'],
      ["it's fine", "it's fine"],
      ["hello, world!", "hello, world!"],
    ])("%s -> %s", (input, expected) => {
      expect(stripHtml(input)).toBe(expected);
    });

    it("is idempotent, so a second edit cannot compound &amp;amp;", () => {
      const once = stripHtml("Tom & Jerry <b>and</b> 5 > 3");

      expect(once).toBe("Tom & Jerry and 5 > 3");
      expect(stripHtml(once)).toBe(once);
    });
  });

  it("treats a body of Unicode whitespace as empty, not as a blank bubble", () => {
    expect(stripHtml(NBSP)).toBe("");
    expect(stripHtml(` ${NBSP} \n`)).toBe("");
    expect(stripHtml(`${NBSP}hi${NBSP}`)).toBe("hi");
  });
});

describe("escapeRegex", () => {
  it("makes a catastrophic-backtracking pattern match only itself", () => {
    const pattern = new RegExp(`^${escapeRegex("(a+)+$")}`);

    expect(pattern.test("(a+)+$ is a bad idea")).toBe(true);
    expect(pattern.test("aaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });
});

describe("stripMongoOperators", () => {
  it("removes $-prefixed keys", () => {
    expect(stripMongoOperators({ username: { $ne: null } })).toEqual({ username: {} });
  });

  it("removes dotted keys used for path traversal", () => {
    expect(stripMongoOperators({ "a.b": 1, ok: 2 })).toEqual({ ok: 2 });
  });

  it("recurses into nested objects", () => {
    const input = { filter: { nested: { $gt: 5, keep: 1 } } };

    expect(stripMongoOperators(input)).toEqual({ filter: { nested: { keep: 1 } } });
  });

  it("mutates in place — req.query is getter-only and cannot be reassigned", () => {
    const query = { q: "hi", $where: "evil" };

    const returned = stripMongoOperators(query);

    expect(returned).toBe(query); // same reference
    expect(query).toEqual({ q: "hi" }); // original object was cleaned
  });

  it("leaves clean payloads untouched", () => {
    expect(stripMongoOperators({ name: "lobby", visibility: "public" })).toEqual({
      name: "lobby",
      visibility: "public",
    });
  });

  it.each([[null], [undefined], ["a string"], [42]])(
    "passes through non-objects (%p)",
    (value) => {
      expect(stripMongoOperators(value)).toBe(value);
    }
  );
});
require("../mcp/dom-shim.js");

const assert = require("assert");
const path = require("path");
const { extractPdfPage } = require("../mcp/pdf");

suite("extractPdfPage helper", () => {
  const samplePdf = path.resolve(__dirname, "fixtures", "sample.pdf");

  test("extracts text from the first page", async () => {
    const result = await extractPdfPage(samplePdf, 1);
    assert.strictEqual(result.page, 1);
    assert.ok(result.pageCount >= 1, "should report at least one page");
    assert.ok(
      /hello pdf tool sample/i.test(result.text),
      `expected text to include 'Hello PDF Tool Sample', got: ${result.text}`
    );
  });

  test("rejects out-of-range page numbers", async () => {
    await assert.rejects(
      () => extractPdfPage(samplePdf, 999),
      (err) => err instanceof RangeError && /out of range/i.test(err.message)
    );
  });
});

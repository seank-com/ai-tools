const fs = require("fs").promises;
const { pathToFileURL } = require("node:url");

let pdfjsPromise;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // Import both the library and the worker *first*
      const [libNs, workerNs] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
      ]);

      const pdfjs = libNs?.default ?? libNs;

      // Ensure fake-worker path is taken in every host (Node, Electron ext host, etc.)
      if (!globalThis.pdfjsWorker) {
        globalThis.pdfjsWorker = workerNs; // exposes WorkerMessageHandler
      }

      // Optional: set workerSrc to a file:// URL as a safety net in case code paths read it.
      try {
        const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
      } catch {}

      return pdfjs;
    })().catch(err => {
      pdfjsPromise = undefined;
      throw err;
    });
  }
  return pdfjsPromise;
}

const DEG_NEAR = (a, b, eps = 0.5) => Math.abs(((a - b + 540) % 360) - 180) <= eps;

function angleDegFromTransform(a, b) {
  // atan2(b, a) is the rotation of the text matrix
  const deg = Math.atan2(b, a) * 180 / Math.PI;
  return (deg + 360) % 360; // normalize
}

function quantile(sortedNums, q) {
  if (sortedNums.length === 0) return 0;
  const pos = (sortedNums.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedNums[base + 1] !== undefined) {
    return sortedNums[base] + rest * (sortedNums[base + 1] - sortedNums[base]);
  } else {
    return sortedNums[base];
  }
}

function median(nums) {
  const v = nums.slice().sort((x, y) => x - y);
  return quantile(v, 0.5);
}

// Group text items into lines based on baseline Y with an adaptive tolerance.
// Also collect diagnostics for "confidence" flags.
function clusterLinesWithDiagnostics(items, stylesMap, pageRotationDeg = 0) {
  const lines = [];
  const yOffsets = []; // |y - assignedLine.y| in px
  const itemHeights = [];
  const itemStrLens = [];
  let totalItems = 0;

  // angle/skew/vertical counters
  let deg0 = 0, deg90 = 0, deg180 = 0, deg270 = 0, degOther = 0;
  let skewCount = 0;
  let verticalCount = 0;

  for (const it of items) {
    const t = it.transform || [1,0,0,1,0,0];
    const [a,b,c,d,e,f] = t;
    const x = e;
    const y = f;
    const h = it.height || Math.abs(d) || 9;
    const str = typeof it.str === "string" ? it.str : "";

    totalItems++;
    itemHeights.push(h);
    itemStrLens.push(str.length);

    // Rotation angle
    const deg = angleDegFromTransform(a, b);
    if (DEG_NEAR(deg, 0)) deg0++;
    else if (DEG_NEAR(deg, 90)) deg90++;
    else if (DEG_NEAR(deg, 180)) deg180++;
    else if (DEG_NEAR(deg, 270)) deg270++;
    else degOther++;

    // Skew detection: significant non-zero off-diagonals
    const EPS = 1e-3;
    if (Math.abs(b) > EPS || Math.abs(c) > EPS) skewCount++;

    // Vertical writing (when provided in styles)
    if (stylesMap && it.fontName && stylesMap[it.fontName]?.vertical) {
      verticalCount++;
    }

    // Line clustering with adaptive tolerance
    const tol = Math.max(2, Math.min(8, h * 0.5)); // 2..8 px
    let chosen = null;
    for (const L of lines) {
      if (Math.abs(L.y - y) <= tol) { chosen = L; break; }
    }
    if (!chosen) {
      chosen = { y, items: [] };
      lines.push(chosen);
    }
    chosen.items.push({ x, text: str, y, h });

    // Track offset for jitter stats
    yOffsets.push(Math.abs(chosen.y - y));
  }

  // Compute a representative X per line (median X), useful for 90/270°
  for (const L of lines) {
    const xs = L.items.map(i => i.x).sort((a, b) => a - b);
    const mid = Math.floor(xs.length / 2);
    L.x = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  }

  // Choose sort axis & direction based on page rotation.
  // PDF coords typically have larger Y = higher on the page.
  // We want visual top→bottom:
  const rot = ((pageRotationDeg % 360) + 360) % 360;
  let axis = "y";
  let dir = -1; // -1 => sort descending on the axis (top first)
  if (rot === 180) { axis = "y"; dir = +1; }       // flipped
  else if (rot === 90) { axis = "x"; dir = +1; }   // left→right becomes top→bottom
  else if (rot === 270) { axis = "x"; dir = -1; }  // right→left becomes top→bottom

  lines.sort((a, b) => dir * (a[axis] - b[axis]));

  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x);
  }

  // Diagnostics
  const heightsMedian = median(itemHeights);
  const ySorted = yOffsets.slice().sort((x, y) => x - y);
  const jitterP95 = quantile(ySorted, 0.95);  // 95th percentile of vertical jitter

  return {
    lines,
    diag: {
      totalItems,
      totalLines: lines.length,
      angles: { deg0, deg90, deg180, deg270, other: degOther },
      skewCount,
      verticalCount,
      heightsMedian,
      jitterPxP95: jitterP95,
      medianItemStrLen: median(itemStrLens),
    }
  };
}

async function extractPdfPage(absPath, pageNumber = 1) {
  const pdfjs = await loadPdfjs();
  const data = await fs.readFile(absPath);
  const uint8Array = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  const doc = await pdfjs.getDocument({
    data: uint8Array,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
    disableFontFace: true,
    useSystemFonts: true
  }).promise;

  try {
    const pageCount = doc.numPages;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new RangeError(
        `Requested page ${pageNumber} is out of range. Valid range is 1-${pageCount}.`
      );
    }

    const page = await doc.getPage(pageNumber);

    const textContent = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false
    });

    const rotation = ((page.rotate || 0) % 360 + 360) % 360;
    const { lines, diag }  = clusterLinesWithDiagnostics(
      textContent.items ?? [], 
      textContent.styles ?? {}, 
      rotation
    );

    const text = lines.map(L =>
      L.items.map(i => i.text.trim()).filter(Boolean).join(" ")
    ).join("\n");

    const angleTotals = diag.angles.deg0 + diag.angles.deg90 + diag.angles.deg180 + diag.angles.deg270 + diag.angles.other;
    const nonOrthFrac = angleTotals ? (diag.angles.other / angleTotals) : 0;

    const flags = {
      pageRotated: ((page.rotate || 0) % 360 + 360) % 360 !== 0,
      rotatedTextDetected: (diag.angles.deg90 + diag.angles.deg270 + diag.angles.other) > 0,
      nonOrthogonalAnglesDetected: diag.angles.other > 0,
      skewDetected: diag.skewCount > 0,
      verticalTextDetected: diag.verticalCount > 0,
      highLineJitter: diag.jitterPxP95 > Math.max(6, diag.heightsMedian * 0.75),
      manyTinyItems: (diag.totalItems >= 400) && (diag.medianItemStrLen <= 2),
      // Optional: warn if lots of non-orthogonal angles
      suspiciousAnglesShare: nonOrthFrac > 0.02, // >2% of items at odd angles
    };

    const metrics = {
      totalItems: diag.totalItems,
      totalLines: diag.totalLines,
      angles: diag.angles,
      jitterPxP95: Number(diag.jitterPxP95.toFixed(2)),
      medianItemHeight: Number(diag.heightsMedian.toFixed(2)),
      medianItemStrLen: diag.medianItemStrLen,
    };

    return { page: pageNumber, pageCount, text, flags, metrics };
  } finally {
    try {
      if (typeof doc.cleanup === "function") {
        doc.cleanup();
      }
    } catch (err) {
      console.warn("ai-tools: pdf doc cleanup warning", err);
    }

    if (typeof doc.destroy === "function") {
      doc.destroy();
    }
  }
}

module.exports = {
  extractPdfPage
};

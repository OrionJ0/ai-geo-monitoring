function finitePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive number`);
  }
  return number;
}

/**
 * @param {{
 *   canvasWidth: number,
 *   canvasHeight: number,
 *   contentWidth: number,
 *   contentHeight: number,
 *   breakpoints?: number[]
 * }} input
 */
function createPdfPageSlices({
  canvasWidth,
  canvasHeight,
  contentWidth,
  contentHeight,
  breakpoints = [],
}) {
  const width = finitePositive(canvasWidth, 'canvasWidth');
  const height = finitePositive(canvasHeight, 'canvasHeight');
  const targetWidth = finitePositive(contentWidth, 'contentWidth');
  const targetHeight = finitePositive(contentHeight, 'contentHeight');
  const sourcePageHeight = Math.max(1, Math.floor((width * targetHeight) / targetWidth));
  const safeBreakpoints = (Array.isArray(breakpoints) ? breakpoints : [])
    .map(Number)
    .filter((point) => Number.isFinite(point) && point > 0 && point < height)
    .sort((a, b) => a - b);
  const slices = [];

  for (let sourceY = 0; sourceY < height;) {
    const idealEnd = Math.min(sourceY + sourcePageHeight, height);
    const minimumUsefulEnd = sourceY + sourcePageHeight * 0.55;
    const canFinishWithSmallOverflow = height - sourceY <= sourcePageHeight * 1.15;
    const preferredEnd = idealEnd < height && !canFinishWithSmallOverflow
      ? safeBreakpoints.filter((point) => point >= minimumUsefulEnd && point <= idealEnd).at(-1)
      : null;
    const sourceEnd = canFinishWithSmallOverflow ? height : preferredEnd || idealEnd;
    const sourceHeight = sourceEnd - sourceY;
    slices.push({
      sourceY,
      sourceHeight,
      outputHeight: (sourceHeight * targetWidth) / width,
    });
    sourceY = sourceEnd;
  }
  return slices;
}

function ascii(value) {
  return new TextEncoder().encode(String(value));
}

function concatenate(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function pdfNumber(value) {
  return Number(value.toFixed(3)).toString();
}

function buildImagePdf({
  pages,
  pageWidth,
  pageHeight,
  margin,
}) {
  if (!Array.isArray(pages) || !pages.length) {
    throw new TypeError('pages must contain at least one image');
  }
  const width = finitePositive(pageWidth, 'pageWidth');
  const height = finitePositive(pageHeight, 'pageHeight');
  const safeMargin = Number(margin);
  if (!Number.isFinite(safeMargin) || safeMargin < 0 || safeMargin * 2 >= Math.min(width, height)) {
    throw new TypeError('margin must fit inside the page');
  }

  const objectCount = 2 + pages.length * 3;
  const pageObjectIds = pages.map((_, index) => 3 + index * 3);
  const objects = new Map();
  objects.set(1, [ascii('<< /Type /Catalog /Pages 2 0 R >>')]);
  objects.set(2, [ascii(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  )]);

  pages.forEach((page, index) => {
    const imageWidth = finitePositive(page.width, 'page.width');
    const imageHeight = finitePositive(page.height, 'page.height');
    const jpeg = page.jpeg instanceof Uint8Array ? page.jpeg : new Uint8Array(page.jpeg);
    if (!jpeg.length) throw new TypeError('page.jpeg must not be empty');

    const pageObjectId = pageObjectIds[index];
    const imageObjectId = pageObjectId + 1;
    const contentObjectId = pageObjectId + 2;
    const maximumWidth = width - safeMargin * 2;
    const maximumHeight = height - safeMargin * 2;
    const scale = Math.min(maximumWidth / imageWidth, maximumHeight / imageHeight);
    const drawWidth = imageWidth * scale;
    const drawHeight = imageHeight * scale;
    const drawX = safeMargin + (maximumWidth - drawWidth) / 2;
    const drawY = height - safeMargin - drawHeight;
    const pageNumberLabel = `${index + 1} / ${pages.length}`;
    const content = ascii([
      `q\n${pdfNumber(drawWidth)} 0 0 ${pdfNumber(drawHeight)} ${pdfNumber(drawX)} ${pdfNumber(drawY)} cm\n/Im0 Do\nQ`,
      `BT\n/F1 9 Tf\n${pdfNumber(width - safeMargin - 28)} 10 Td\n(${pageNumberLabel}) Tj\nET`,
    ].join('\n'));

    objects.set(pageObjectId, [ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(width)} ${pdfNumber(height)}] `
      + `/Resources << /XObject << /Im0 ${imageObjectId} 0 R >> `
      + `/Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> `
      + `/Contents ${contentObjectId} 0 R >>`,
    )]);
    objects.set(imageObjectId, [
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${Math.round(imageWidth)} /Height ${Math.round(imageHeight)} `
        + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      ascii('\nendstream'),
    ]);
    objects.set(contentObjectId, [
      ascii(`<< /Length ${content.length} >>\nstream\n`),
      content,
      ascii('\nendstream'),
    ]);
  });

  const chunks = [
    concatenate([ascii('%PDF-1.4\n%'), new Uint8Array([255, 255, 255, 255, 10])]),
  ];
  const offsets = new Array(objectCount + 1).fill(0);
  let byteLength = chunks[0].length;

  for (let objectId = 1; objectId <= objectCount; objectId += 1) {
    offsets[objectId] = byteLength;
    const objectChunk = concatenate([
      ascii(`${objectId} 0 obj\n`),
      ...objects.get(objectId),
      ascii('\nendobj\n'),
    ]);
    chunks.push(objectChunk);
    byteLength += objectChunk.length;
  }

  const xrefOffset = byteLength;
  const xref = [
    `xref\n0 ${objectCount + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\n`,
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join('');
  chunks.push(ascii(xref));
  return concatenate(chunks);
}

module.exports = {
  buildImagePdf,
  createPdfPageSlices,
};

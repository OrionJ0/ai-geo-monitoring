/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pdfUtilityPath = path.resolve(__dirname, 'questionSetReportPdf.cjs');
const pdfClientPath = path.resolve(__dirname, 'downloadQuestionSetReportPdf.ts');

test('PDF 分页完整覆盖原始画布且不产生空白页', () => {
  assert.equal(fs.existsSync(pdfUtilityPath), true, 'PDF 生成工具应存在');
  const { createPdfPageSlices } = require(pdfUtilityPath);
  const slices = createPdfPageSlices({
    canvasWidth: 1000,
    canvasHeight: 2500,
    contentWidth: 281,
    contentHeight: 194,
  });

  assert.equal(slices.length, 4);
  assert.equal(slices[0].sourceY, 0);
  assert.equal(slices.at(-1).sourceY + slices.at(-1).sourceHeight, 2500);
  assert.equal(
    slices.reduce((total, slice) => total + slice.sourceHeight, 0),
    2500,
  );
  assert.ok(slices.every((slice) => slice.sourceHeight > 0 && slice.outputHeight > 0));
});

test('PDF 分页优先在表格行边界处换页', () => {
  const { createPdfPageSlices } = require(pdfUtilityPath);
  const slices = createPdfPageSlices({
    canvasWidth: 1000,
    canvasHeight: 1500,
    contentWidth: 281,
    contentHeight: 194,
    breakpoints: [600, 1200],
  });

  assert.deepEqual(
    slices.map((slice) => [slice.sourceY, slice.sourceHeight]),
    [[0, 600], [600, 600], [1200, 300]],
  );
});

test('PDF 分页避免为最后一行单独生成大面积空白页', () => {
  const { createPdfPageSlices } = require(pdfUtilityPath);
  const slices = createPdfPageSlices({
    canvasWidth: 1000,
    canvasHeight: 1300,
    contentWidth: 281,
    contentHeight: 194,
    breakpoints: [600, 1200],
  });

  assert.deepEqual(
    slices.map((slice) => [slice.sourceY, slice.sourceHeight]),
    [[0, 600], [600, 700]],
  );
});

test('PDF 编码器生成可下载的多页 PDF 二进制结构', () => {
  const { buildImagePdf } = require(pdfUtilityPath);
  const tinyJpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==',
    'base64',
  );
  const bytes = buildImagePdf({
    pages: [
      { jpeg: tinyJpeg, width: 100, height: 100 },
      { jpeg: tinyJpeg, width: 100, height: 50 },
    ],
    pageWidth: 595.28,
    pageHeight: 841.89,
    margin: 24,
  });
  const source = Buffer.from(bytes).toString('latin1');

  assert.match(source, /^%PDF-1\.4/);
  assert.match(source, /\/Count 2/);
  assert.match(source, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(source, /\/Filter \/DCTDecode/);
  assert.match(source, /\/BaseFont \/Helvetica/);
  assert.match(source, /\(1 \/ 2\) Tj/);
  assert.match(source, /\(2 \/ 2\) Tj/);
  assert.match(source, /xref\n0 9\n/);
  assert.match(source, /%%EOF\n$/);
});

test('浏览器导出器使用画布生成 PDF 文件而不是调用打印', () => {
  assert.equal(fs.existsSync(pdfClientPath), true, '浏览器 PDF 下载器应存在');
  const source = fs.readFileSync(pdfClientPath, 'utf8');

  assert.match(source, /toCanvas/);
  assert.match(source, /buildImagePdf/);
  assert.match(source, /application\/pdf/);
  assert.match(source, /link\.download/);
  assert.match(source, /A4_PORTRAIT_WIDTH/);
  assert.match(source, /A4_PORTRAIT_HEIGHT/);
  assert.match(source, /data-pdf-breakpoint/);
  assert.doesNotMatch(source, /window\.print|print\(\)/);
});

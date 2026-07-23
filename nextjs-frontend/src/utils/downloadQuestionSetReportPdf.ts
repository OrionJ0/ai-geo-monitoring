import { toCanvas } from 'html-to-image';
import {
  buildImagePdf,
  createPdfPageSlices,
} from './questionSetReportPdf.cjs';

const A4_PORTRAIT_WIDTH = 595.28;
const A4_PORTRAIT_HEIGHT = 841.89;
const PAGE_MARGIN = 24;

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('无法生成报告图片'));
    }, 'image/jpeg', 0.92);
  });
}

export async function downloadQuestionSetReportPdf(
  element: HTMLElement,
  filename: string,
) {
  const pixelRatio = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
  const canvas = await toCanvas(element, {
    backgroundColor: '#ffffff',
    cacheBust: true,
    pixelRatio,
    filter: (node) => !(
      node instanceof HTMLElement
      && node.dataset.pdfExclude === 'true'
    ),
  });
  if (!canvas.width || !canvas.height) {
    throw new Error('报告内容为空，无法导出 PDF');
  }

  const contentWidth = A4_PORTRAIT_WIDTH - PAGE_MARGIN * 2;
  const contentHeight = A4_PORTRAIT_HEIGHT - PAGE_MARGIN * 2;
  const elementRect = element.getBoundingClientRect();
  const canvasScale = elementRect.height > 0 ? canvas.height / elementRect.height : 1;
  const breakpoints = Array.from(
    element.querySelectorAll<HTMLElement>('.ant-table-tbody > tr'),
  ).map((row) => (row.getBoundingClientRect().top - elementRect.top) * canvasScale);
  const slices = createPdfPageSlices({
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    contentWidth,
    contentHeight,
    breakpoints,
  });
  const pages = [];

  for (const slice of slices) {
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = slice.sourceHeight;
    const context = pageCanvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建 PDF 画布');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(
      canvas,
      0,
      slice.sourceY,
      canvas.width,
      slice.sourceHeight,
      0,
      0,
      pageCanvas.width,
      pageCanvas.height,
    );
    const jpeg = await canvasToJpeg(pageCanvas);
    pages.push({
      jpeg: new Uint8Array(await jpeg.arrayBuffer()),
      width: pageCanvas.width,
      height: pageCanvas.height,
    });
  }

  const bytes = buildImagePdf({
    pages,
    pageWidth: A4_PORTRAIT_WIDTH,
    pageHeight: A4_PORTRAIT_HEIGHT,
    margin: PAGE_MARGIN,
  });
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

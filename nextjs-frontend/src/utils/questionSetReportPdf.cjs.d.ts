export type PdfPageSlice = {
  sourceY: number;
  sourceHeight: number;
  outputHeight: number;
};

export function createPdfPageSlices(input: {
  canvasWidth: number;
  canvasHeight: number;
  contentWidth: number;
  contentHeight: number;
  breakpoints?: number[];
}): PdfPageSlice[];

export function buildImagePdf(input: {
  pages: Array<{
    jpeg: Uint8Array;
    width: number;
    height: number;
  }>;
  pageWidth: number;
  pageHeight: number;
  margin: number;
}): Uint8Array;

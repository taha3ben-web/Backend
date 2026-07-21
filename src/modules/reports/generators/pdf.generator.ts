import PDFDocument from "pdfkit";
import * as fs from "fs";
import * as path from "path";

export interface PdfColumn {
  header: string;
  key: string;
  width: number;
}

export interface PdfTable {
  heading: string;
  columns: PdfColumn[];
  rows: Array<Record<string, unknown>>;
}

// خط عربي اختياري: ضع ملف TTF هنا لدعم العربية في PDF
const ARABIC_FONT_PATH = path.join(
  process.cwd(),
  "assets",
  "fonts",
  "NotoNaskhArabic-Regular.ttf",
);

/**
 * يولّد ملف PDF حقيقيًا (A4) بعنوان + جداول.
 * إن وُجد خط عربي في assets/fonts يُستخدم تلقائيًا؛ وإلا يستخدم Helvetica.
 */
export function buildPdf(title: string, tables: PdfTable[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const hasArabicFont = fs.existsSync(ARABIC_FONT_PATH);
      const font = hasArabicFont ? "Arabic" : "Helvetica";
      if (hasArabicFont) doc.registerFont("Arabic", ARABIC_FONT_PATH);

      // الرأس
      doc.font(font).fontSize(20).text(title, { align: "center" });
      doc
        .fontSize(9)
        .fillColor("#6b7280")
        .text(`flaminGO — ${new Date().toISOString()}`, { align: "center" });
      doc.moveDown(1).fillColor("#111827");

      for (const table of tables) {
        doc.moveDown(0.6).font(font).fontSize(13).text(table.heading);
        doc.moveDown(0.3);
        drawTable(doc, table, font);
      }

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function drawTable(
  doc: PDFKit.PDFDocument,
  table: PdfTable,
  font: string,
): void {
  const startX = doc.page.margins.left;
  const rowHeight = 20;
  let y = doc.y;

  const drawRow = (cells: string[], opts: { header?: boolean } = {}): void => {
    // صفحة جديدة عند الحاجة
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.y;
    }
    let x = startX;
    doc.font(font).fontSize(9);
    if (opts.header) doc.fillColor("#ffffff");
    else doc.fillColor("#111827");
    table.columns.forEach((col, i) => {
      if (opts.header) {
        doc.rect(x, y, col.width, rowHeight).fill("#111827");
        doc.fillColor("#ffffff");
      }
      doc.text(String(cells[i] ?? ""), x + 4, y + 6, {
        width: col.width - 8,
        height: rowHeight,
        ellipsis: true,
        lineBreak: false,
      });
      x += col.width;
    });
    y += rowHeight;
    doc.fillColor("#111827");
  };

  drawRow(
    table.columns.map((c) => c.header),
    { header: true },
  );
  for (const row of table.rows) {
    drawRow(table.columns.map((c) => formatCell(row[c.key])));
  }
  doc.y = y + 6;
  doc.x = startX;
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace("T", " ");
  return String(v);
}

import { Workbook } from "exceljs";

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
}

export interface ReportSheet {
  name: string;
  columns: SheetColumn[];
  rows: Array<Record<string, unknown>>;
}

/**
 * يولّد ملف Excel (.xlsx) حقيقي مدعوم للعربية ومنسّق (رأس ملوّن + تجميد الصف الأول).
 * يدعم عدة أوراق في مصنف واحد.
 */
export async function buildExcel(
  title: string,
  sheets: ReportSheet[],
): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = "NOVA Ride";
  wb.created = new Date();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name, {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    });
    ws.columns = sheet.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 20,
    }));
    ws.addRows(sheet.rows);

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF111827" },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 22;
  }

  // عنوان التقرير كخاصية
  wb.title = title;

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

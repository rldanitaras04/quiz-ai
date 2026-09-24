import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const THIN = { style: BorderStyle.SINGLE, size: 4, color: 'B0B0B0' } as const;

export function downloadDocx(doc: Document, filename: string): Promise<void> {
  return Packer.toBlob(doc).then((blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  });
}

export function safeDocxFilename(title: string, suffix: string): string {
  const base =
    title
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'assessment';
  return `${base}-${suffix}.docx`;
}

export function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2): Paragraph {
  return new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, bold: true })] });
}

export function paragraph(text: string, options?: { bold?: boolean; spacing?: { before?: number; after?: number } }): Paragraph {
  return new Paragraph({
    spacing: options?.spacing ?? { after: 120 },
    children: [new TextRun({ text, bold: options?.bold ?? false })],
  });
}

function cell(text: string | number, options?: { bold?: boolean; fill?: string; alignRight?: boolean }): TableCell {
  return new TableCell({
    shading: options?.fill ? { fill: options.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    borders: { top: THIN, bottom: THIN, left: THIN, right: THIN },
    children: [
      new Paragraph({
        alignment: options?.alignRight ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text: String(text), bold: options?.bold ?? false })],
      }),
    ],
  });
}

export function simpleTable(
  headers: string[],
  rows: (string | number)[][],
  options?: { headerFill?: string }
): Table {
  const fill = options?.headerFill ?? 'E8EEF7';
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) => cell(h, { bold: true, fill })),
  });
  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map((value, index) =>
          cell(value, { alignRight: index > 0 && typeof value === 'number' })
        ),
      })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  });
}

export function buildDocument(children: (Paragraph | Table)[]): Document {
  return new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });
}

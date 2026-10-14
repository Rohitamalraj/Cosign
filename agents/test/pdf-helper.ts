/** Builds a small, valid, text-only PDF for tests. Each entry is placed at an absolute position in points. */
export interface PdfText { text: string; x: number; y: number }

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export function makeTextPdf(items: PdfText[]): Uint8Array {
  const content = items.map((i) => `BT /F1 11 Tf ${i.x} ${i.y} Td (${esc(i.text)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

/** The case A invoice, laid out like a typical PDF: label/value lines and a table with column gaps. */
export function invoicePdf(over: Partial<Record<string, string>> = {}): Uint8Array {
  const v = { number: 'INV-1041', from: 'Northwind Design Co. <billing@northwinddesign.example>', issued: '2026-10-13', due: '2026-10-20', agreement: 'SOW-22', wallet: '0x71c4000000000000000000000000000000009ae2', total: '1250.00', rate: '125.00', ...over };
  return makeTextPdf([
    { text: `INVOICE ${v.number}`, x: 50, y: 790 },
    { text: `From: ${v.from}`, x: 50, y: 770 },
    { text: `Issued: ${v.issued}`, x: 50, y: 750 },
    { text: `Due: ${v.due}`, x: 50, y: 735 },
    { text: `Agreement: ${v.agreement}`, x: 50, y: 720 },
    { text: 'Currency: USDC', x: 50, y: 705 },
    { text: `Pay to wallet: ${v.wallet}`, x: 50, y: 690 },
    { text: 'Description', x: 50, y: 650 }, { text: 'Qty', x: 300, y: 650 }, { text: 'Rate', x: 360, y: 650 }, { text: 'Amount', x: 440, y: 650 },
    { text: 'Design hours - October sprint', x: 50, y: 632 }, { text: '10', x: 300, y: 632 }, { text: v.rate, x: 360, y: 632 }, { text: v.total, x: 440, y: 632 },
    { text: `Total: ${v.total} USDC`, x: 50, y: 600 },
    { text: 'Terms: Net 7', x: 50, y: 585 },
  ]);
}

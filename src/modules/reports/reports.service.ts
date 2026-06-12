import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

type ReportType = 'orders' | 'customers' | 'food-sales';
type ReportCell = string | number;
type ReportDefinition = {
  type: ReportType;
  title: string;
  sheetName: string;
  filenameBase: string;
  headers: string[];
  rows: ReportCell[][];
};

const revenueStatuses: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.OTP_VERIFICATION_PENDING,
  OrderStatus.COMPLETED,
];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async exportCsv(type: string) {
    const report = await this.buildReport(type);

    return {
      filename: `${report.filenameBase}-${dateStamp()}.csv`,
      content: toCsv(report.headers, report.rows),
    };
  }

  async exportXlsx(type: string) {
    const report = await this.buildReport(type);

    return {
      filename: `${report.filenameBase}-${dateStamp()}.xlsx`,
      content: toXlsx(report),
    };
  }

  private async buildReport(type: string): Promise<ReportDefinition> {
    const reportType = parseReportType(type);

    switch (reportType) {
      case 'orders':
        return this.buildOrdersReport();
      case 'customers':
        return this.buildCustomersReport();
      case 'food-sales':
        return this.buildFoodSalesReport();
    }
  }

  private async buildOrdersReport(): Promise<ReportDefinition> {
    const orders = await this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        orderNumber: true,
        status: true,
        placedAt: true,
        completedAt: true,
        totalAmount: true,
        subtotalAmount: true,
        taxAmount: true,
        discountAmount: true,
        coupon: {
          select: { code: true },
        },
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        items: {
          select: {
            name: true,
            quantity: true,
          },
        },
      },
    });

    return {
      type: 'orders',
      title: 'Crumb Stall Orders Report',
      sheetName: 'Orders',
      filenameBase: 'crumbstall-orders',
      headers: [
        'order_number',
        'status',
        'customer_name',
        'customer_email',
        'placed_at',
        'completed_at',
        'items',
        'subtotal',
        'tax',
        'discount',
        'coupon',
        'total',
      ],
      rows: orders.map((order) => [
        order.orderNumber,
        order.status,
        order.user.name ?? 'Customer',
        order.user.email,
        order.placedAt?.toISOString() ?? '',
        order.completedAt?.toISOString() ?? '',
        order.items.map((item) => `${item.quantity} x ${item.name}`).join('; '),
        order.subtotalAmount.toNumber(),
        order.taxAmount.toNumber(),
        order.discountAmount.toNumber(),
        order.coupon?.code ?? '',
        order.totalAmount.toNumber(),
      ]),
    };
  }

  private async buildCustomersReport(): Promise<ReportDefinition> {
    const users = await this.prisma.user.findMany({
      where: {
        role: UserRole.CUSTOMER,
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        name: true,
        email: true,
        isSuspended: true,
        createdAt: true,
        lastActivity: true,
        orders: {
          where: { status: { in: revenueStatuses } },
          select: {
            totalAmount: true,
            placedAt: true,
            createdAt: true,
          },
        },
      },
    });

    return {
      type: 'customers',
      title: 'Crumb Stall Customers Report',
      sheetName: 'Customers',
      filenameBase: 'crumbstall-customers',
      headers: [
        'customer_name',
        'email',
        'joined_at',
        'last_activity',
        'last_order_at',
        'paid_order_count',
        'total_spend',
        'average_order_value',
        'is_suspended',
      ],
      rows: users.map((user) => {
        const totalSpend = user.orders.reduce(
          (sum, order) => sum + order.totalAmount.toNumber(),
          0,
        );
        const lastOrderAt = user.orders
          .map((order) => order.placedAt ?? order.createdAt)
          .sort((first, second) => second.getTime() - first.getTime())[0];

        return [
          user.name ?? 'Customer',
          user.email,
          user.createdAt.toISOString(),
          user.lastActivity?.toISOString() ?? '',
          lastOrderAt?.toISOString() ?? '',
          user.orders.length,
          totalSpend,
          user.orders.length > 0 ? Math.round(totalSpend / user.orders.length) : 0,
          user.isSuspended ? 'yes' : 'no',
        ];
      }),
    };
  }

  private async buildFoodSalesReport(): Promise<ReportDefinition> {
    const items = await this.prisma.orderItem.findMany({
      where: {
        order: {
          status: { in: revenueStatuses },
        },
      },
      select: {
        foodItemId: true,
        name: true,
        quantity: true,
        totalPrice: true,
        foodItem: {
          select: {
            slug: true,
            category: {
              select: { name: true },
            },
          },
        },
      },
    });

    const totals = new Map<
      string,
      {
        name: string;
        slug: string;
        category: string;
        quantity: number;
        revenue: number;
      }
    >();

    for (const item of items) {
      const existing = totals.get(item.foodItemId) ?? {
        name: item.name,
        slug: item.foodItem.slug,
        category: item.foodItem.category.name,
        quantity: 0,
        revenue: 0,
      };

      existing.quantity += item.quantity;
      existing.revenue += item.totalPrice.toNumber();
      totals.set(item.foodItemId, existing);
    }

    return {
      type: 'food-sales',
      title: 'Crumb Stall Food Sales Report',
      sheetName: 'Food Sales',
      filenameBase: 'crumbstall-food-sales',
      headers: ['food_name', 'slug', 'category', 'quantity_sold', 'revenue'],
      rows: [...totals.values()]
        .sort(
          (first, second) =>
            second.quantity - first.quantity || second.revenue - first.revenue,
        )
        .map((item) => [
          item.name,
          item.slug,
          item.category,
          item.quantity,
          item.revenue,
        ]),
    };
  }
}

function parseReportType(type: string): ReportType {
  if (type === 'orders' || type === 'customers' || type === 'food-sales') {
    return type;
  }

  throw new BadRequestException('Unsupported report type.');
}

function toCsv(headers: string[], rows: ReportCell[][]) {
  return [headers, ...rows]
    .map((row) => row.map((value) => escapeCsv(String(value))).join(','))
    .join('\n');
}

function escapeCsv(value: string) {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function toXlsx(report: ReportDefinition) {
  const files = new Map<string, Buffer>();

  files.set('[Content_Types].xml', xmlBuffer(contentTypesXml()));
  files.set('_rels/.rels', xmlBuffer(rootRelsXml()));
  files.set('docProps/app.xml', xmlBuffer(appXml()));
  files.set('docProps/core.xml', xmlBuffer(coreXml(report.title)));
  files.set('xl/workbook.xml', xmlBuffer(workbookXml(report.sheetName)));
  files.set('xl/_rels/workbook.xml.rels', xmlBuffer(workbookRelsXml()));
  files.set('xl/styles.xml', xmlBuffer(stylesXml()));
  files.set('xl/worksheets/sheet1.xml', xmlBuffer(worksheetXml(report)));

  return zip(files);
}

function worksheetXml(report: ReportDefinition) {
  const columnCount = report.headers.length;
  const lastColumn = columnName(columnCount);
  const dataStartRow = 5;
  const lastRow = Math.max(dataStartRow, dataStartRow + report.rows.length - 1);
  const rows = [
    rowXml(1, [inlineCell(1, 1, report.title, 1)]),
    rowXml(2, [inlineCell(2, 1, `Generated ${new Date().toISOString()}`, 2)]),
    rowXml(4, report.headers.map((header, index) => inlineCell(4, index + 1, toTitle(header), 3))),
    ...report.rows.map((row, rowIndex) =>
      rowXml(
        dataStartRow + rowIndex,
        row.map((value, columnIndex) =>
          cellXml(dataStartRow + rowIndex, columnIndex + 1, value, rowIndex % 2 === 0 ? 4 : 5),
        ),
      ),
    ),
  ];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${report.headers.map((header, index) => `<col min="${index + 1}" max="${index + 1}" width="${columnWidth(header)}" customWidth="1"/>`).join('')}</cols>
  <sheetData>${rows.join('')}</sheetData>
  <autoFilter ref="A4:${lastColumn}${lastRow}"/>
  <mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells>
</worksheet>`;
}

function rowXml(index: number, cells: string[]) {
  return `<row r="${index}">${cells.join('')}</row>`;
}

function cellXml(row: number, column: number, value: ReportCell, style: number) {
  if (typeof value === 'number') {
    return `<c r="${columnName(column)}${row}" s="${style}"><v>${value}</v></c>`;
  }

  return inlineCell(row, column, value, style);
}

function inlineCell(row: number, column: number, value: string, style: number) {
  return `<c r="${columnName(column)}${row}" t="inlineStr" s="${style}"><is><t>${escapeXml(value)}</t></is></c>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE23744"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF171717"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF5F5"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFE5E7EB"/></left><right style="thin"><color rgb="FFE5E7EB"/></right><top style="thin"><color rgb="FFE5E7EB"/></top><bottom style="thin"><color rgb="FFE5E7EB"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function workbookXml(sheetName: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function workbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function appXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Crumb Stall</Application></Properties>`;
}

function coreXml(title: string) {
  const now = new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>Crumb Stall</dc:creator>
  <cp:lastModifiedBy>Crumb Stall</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function zip(files: Map<string, Buffer>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBuffer = Buffer.from(name);
    const crc = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;

  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }

  return crc >>> 0;
});

function xmlBuffer(value: string) {
  return Buffer.from(value.trim(), 'utf8');
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(column: number) {
  let name = '';
  let current = column;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - remainder) / 26);
  }

  return name;
}

function columnWidth(header: string) {
  return Math.max(14, Math.min(34, header.length + 6));
}

function toTitle(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

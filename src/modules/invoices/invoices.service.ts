import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ObjectStorageService } from '../../infrastructure/storage/object-storage.service';

const invoiceInclude = {
  order: {
    include: {
      user: {
        select: {
          name: true,
          email: true,
        },
      },
      coupon: {
        select: {
          code: true,
        },
      },
      items: true,
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceRecord = Prisma.InvoiceGetPayload<{
  include: typeof invoiceInclude;
}>;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorageService: ObjectStorageService,
  ) {}

  async findByInvoiceNumber(invoiceNumber: string) {
    const invoice = await this.ensureInvoice(invoiceNumber);

    return mapInvoice(invoice);
  }

  async generatePdf(invoiceNumber: string) {
    const invoiceRecord = await this.ensureInvoice(invoiceNumber);
    const invoice = mapInvoice(invoiceRecord);
    const buffer = createInvoicePdf(invoice);
    const invoiceUrl = await this.persistPdfIfConfigured(
      invoiceRecord.id,
      invoice.invoiceNumber,
      buffer,
      invoice.invoiceUrl,
    );

    return {
      buffer,
      filename: `${invoice.invoiceNumber}.pdf`,
      invoiceUrl,
    };
  }

  private async ensureInvoice(invoiceNumber: string) {
    const normalizedInvoiceNumber = normalizeInvoiceNumber(invoiceNumber);
    const existingInvoice = await this.prisma.invoice.findUnique({
      where: { invoiceNumber: normalizedInvoiceNumber },
      include: invoiceInclude,
    });

    if (existingInvoice) {
      return existingInvoice;
    }

    const orderNumber = getOrderNumberFromInvoiceNumber(
      normalizedInvoiceNumber,
    );
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: {
        invoice: {
          include: invoiceInclude,
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Invoice not found');
    }

    if (order.invoice) {
      return order.invoice;
    }

    return this.prisma.invoice.create({
      data: {
        orderId: order.id,
        invoiceNumber: normalizedInvoiceNumber,
      },
      include: invoiceInclude,
    });
  }

  private async persistPdfIfConfigured(
    invoiceId: string,
    invoiceNumber: string,
    buffer: Buffer,
    existingInvoiceUrl: string | null,
  ) {
    if (existingInvoiceUrl || !this.objectStorageService.isConfigured()) {
      return existingInvoiceUrl;
    }

    const key = `invoices/${dateFolder()}/${invoiceNumber}.pdf`;
    const invoiceUrl = `/api/uploads/objects/${key}`;

    try {
      await this.objectStorageService.upload({
        key,
        body: buffer,
        contentType: 'application/pdf',
      });
    } catch (error) {
      this.logger.warn(
        `Invoice PDF storage failed for ${invoiceNumber}. ${getErrorMessage(error)}`,
      );
      return null;
    }

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { invoiceUrl },
    });

    return invoiceUrl;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function dateFolder(date = new Date()) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');

  return `${year}/${month}`;
}

function normalizeInvoiceNumber(invoiceNumber: string) {
  const trimmed = invoiceNumber.trim().toUpperCase();
  return trimmed.startsWith('INV-') ? trimmed : `INV-${trimmed}`;
}

function getOrderNumberFromInvoiceNumber(invoiceNumber: string) {
  return invoiceNumber.startsWith('INV-')
    ? invoiceNumber.slice(4)
    : invoiceNumber;
}

function mapInvoice(invoice: InvoiceRecord) {
  const order = invoice.order;
  const payment = order.payments[0] ?? null;

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    generatedAt: invoice.generatedAt.toISOString(),
    invoiceUrl: invoice.invoiceUrl,
    orderNumber: order.orderNumber,
    orderStatus: order.status,
    placedAt: order.placedAt?.toISOString() ?? order.createdAt.toISOString(),
    pickupTime: order.pickupTime?.toISOString() ?? null,
    customer: {
      name: order.user.name,
      email: order.user.email,
    },
    items: order.items.map((item) => ({
      id: item.id,
      name: item.name,
      note: item.note,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toNumber(),
      totalPrice: item.totalPrice.toNumber(),
    })),
    subtotalAmount: order.subtotalAmount.toNumber(),
    taxAmount: order.taxAmount.toNumber(),
    discountAmount: order.discountAmount.toNumber(),
    totalAmount: order.totalAmount.toNumber(),
    couponCode: order.coupon?.code ?? null,
    payment: payment
      ? {
          provider: payment.provider,
          status: payment.status,
          paymentId: payment.providerPaymentId,
          providerOrderId: payment.providerOrderId,
          amount: payment.amount.toNumber(),
          currency: payment.currency,
        }
      : null,
  };
}

type InvoicePdfData = ReturnType<typeof mapInvoice>;

function createInvoicePdf(invoice: InvoicePdfData) {
  const content = buildInvoicePdfContent(invoice);

  return buildPdf(content);
}

function buildInvoicePdfContent(invoice: InvoicePdfData) {
  const commands: string[] = [];
  const paidStatus = invoice.payment?.status ?? 'Captured';

  commands.push(rect(0, 0, 595, 842, brand.background));
  commands.push(card(28, 38, 539, 766, 10));

  commands.push(text('Crumb Stall', 48, 760, 25, 'bold', brand.dark));
  commands.push(text('Scan. Order. Pickup.', 48, 742, 10, 'regular', brand.muted));
  commands.push(text('INVOICE', 454, 760, 11, 'bold', brand.red));
  commands.push(text(invoice.invoiceNumber, 366, 738, 18, 'bold', brand.dark));
  commands.push(text(`Generated ${formatDate(invoice.generatedAt)}`, 368, 720, 9, 'regular', brand.muted));
  commands.push(line(48, 700, 547, 700, brand.border));

  commands.push(roundedRect(48, 612, 499, 70, 8, brand.cream, brand.border));
  commands.push(text('ORDER', 66, 655, 8, 'bold', brand.red));
  commands.push(text(invoice.orderNumber, 66, 634, 14, 'bold', brand.dark));
  commands.push(text(formatStatus(invoice.orderStatus), 66, 619, 9, 'regular', brand.muted));
  commands.push(text('CUSTOMER', 226, 655, 8, 'bold', brand.red));
  commands.push(text(truncate(invoice.customer.name || 'Customer', 22), 226, 634, 13, 'bold', brand.dark));
  commands.push(text(truncate(invoice.customer.email, 28), 226, 619, 9, 'regular', brand.muted));
  commands.push(text('PAYMENT', 386, 655, 8, 'bold', brand.red));
  commands.push(text(paidStatus, 386, 634, 13, 'bold', brand.dark));
  commands.push(text(truncate(invoice.payment?.paymentId ?? 'Payment captured', 26), 386, 619, 9, 'regular', brand.muted));

  commands.push(text('Items', 48, 572, 18, 'bold', brand.dark));
  commands.push(roundedRect(48, 535, 499, 30, 6, brand.tableHeader, brand.tableHeader));
  commands.push(text('ITEM', 64, 546, 8, 'bold', brand.muted));
  commands.push(text('QTY', 334, 546, 8, 'bold', brand.muted));
  commands.push(text('RATE', 400, 546, 8, 'bold', brand.muted));
  commands.push(text('AMOUNT', 482, 546, 8, 'bold', brand.muted));

  let y = 512;
  const visibleItems = invoice.items.slice(0, 9);
  for (const item of visibleItems) {
    commands.push(text(truncate(item.name, 44), 64, y, 11, 'bold', brand.dark));
    commands.push(text(String(item.quantity), 338, y, 10, 'regular', brand.dark));
    commands.push(text(formatAmount(item.unitPrice), 394, y, 10, 'regular', brand.dark));
    commands.push(text(formatAmount(item.totalPrice), 476, y, 10, 'bold', brand.dark));
    y -= 15;

    if (item.note) {
      commands.push(
        text(`Note: ${truncate(item.note, 64)}`, 64, y, 8, 'regular', brand.muted),
      );
      y -= 12;
    }

    commands.push(line(64, y + 5, 531, y + 5, brand.border));
    y -= 12;
  }

  if (invoice.items.length > visibleItems.length) {
    commands.push(
      text(
        `+ ${invoice.items.length - visibleItems.length} more item(s) included in this order`,
        64,
        y,
        9,
        'bold',
        brand.muted,
      ),
    );
  }

  commands.push(roundedRect(48, 112, 260, 76, 8, brand.footer, brand.border));
  commands.push(text('Placed', 66, 162, 8, 'bold', brand.red));
  commands.push(text(formatDate(invoice.placedAt), 66, 145, 10, 'regular', brand.dark));
  commands.push(text('Pickup', 66, 126, 8, 'bold', brand.red));
  commands.push(text(formatDate(invoice.pickupTime), 66, 110, 10, 'regular', brand.dark));

  commands.push(roundedRect(330, 112, 217, 104, 8, brand.white, brand.border));
  totalRow('Subtotal', invoice.subtotalAmount, 350, 188, commands);
  if (invoice.discountAmount > 0) {
    totalRow(
      `Discount${invoice.couponCode ? ` (${invoice.couponCode})` : ''}`,
      -invoice.discountAmount,
      350,
      169,
      commands,
      brand.green,
    );
  }
  commands.push(line(350, 154, 527, 154, brand.border));
  totalRow('Tax', invoice.taxAmount, 350, 136, commands);
  commands.push(rect(330, 54, 217, 58, brand.red));
  commands.push(text('Total paid', 350, 84, 12, 'bold', brand.white));
  commands.push(text(formatAmount(invoice.totalAmount), 438, 84, 15, 'bold', brand.white));

  commands.push(text('Thank you for ordering from Crumb Stall.', 48, 78, 12, 'bold', brand.dark));
  commands.push(text('Keep this invoice for payment reference and pickup support.', 48, 60, 9, 'regular', brand.muted));

  return commands.join('\n');
}

function buildPdf(content: string) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  pdf += offsets
    .slice(1)
    .map((offset) => `${offset.toString().padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf);
}

function escapePdfText(value: string) {
  return value
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function formatAmount(value: number) {
  const sign = value < 0 ? '- ' : '';
  return `${sign}Rs ${Math.abs(value).toFixed(2)}`;
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Not set';
  }

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

type PdfColor = [number, number, number];

const brand = {
  background: [0.965, 0.965, 0.955],
  border: [0.91, 0.91, 0.88],
  cream: [1, 0.98, 0.949],
  dark: [0.09, 0.09, 0.09],
  footer: [0.985, 0.985, 0.973],
  green: [0.08, 0.4, 0.2],
  greenSoft: [0.925, 0.99, 0.95],
  muted: [0.39, 0.39, 0.36],
  red: [0.886, 0.216, 0.267],
  tableHeader: [0.965, 0.965, 0.955],
  white: [1, 1, 1],
} satisfies Record<string, PdfColor>;

function text(
  value: string,
  x: number,
  y: number,
  size = 10,
  weight: 'regular' | 'bold' = 'regular',
  color: PdfColor = brand.dark,
) {
  return `q ${rgb(color)} rg BT /${weight === 'bold' ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${escapePdfText(value)}) Tj ET Q`;
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  color: PdfColor,
) {
  return `q ${rgb(color)} rg ${x} ${y} ${width} ${height} re f Q`;
}

function line(x1: number, y1: number, x2: number, y2: number, color: PdfColor) {
  return `q ${rgb(color)} RG 1 w ${x1} ${y1} m ${x2} ${y2} l S Q`;
}

function card(x: number, y: number, width: number, height: number, radius = 6) {
  return roundedRect(x, y, width, height, radius, brand.white, brand.border);
}

function roundedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: PdfColor,
  stroke?: PdfColor,
) {
  const right = x + width;
  const top = y + height;
  const c = radius * 0.5522847498;
  const path = [
    `${x + radius} ${y} m`,
    `${right - radius} ${y} l`,
    `${right - radius + c} ${y} ${right} ${y + radius - c} ${right} ${y + radius} c`,
    `${right} ${top - radius} l`,
    `${right} ${top - radius + c} ${right - radius + c} ${top} ${right - radius} ${top} c`,
    `${x + radius} ${top} l`,
    `${x + radius - c} ${top} ${x} ${top - radius + c} ${x} ${top - radius} c`,
    `${x} ${y + radius} l`,
    `${x} ${y + radius - c} ${x + radius - c} ${y} ${x + radius} ${y} c`,
    'h',
  ].join(' ');
  const paint = stroke ? `B` : `f`;
  const strokeCommand = stroke ? `${rgb(stroke)} RG 1 w` : '';

  return `q ${rgb(fill)} rg ${strokeCommand} ${path} ${paint} Q`;
}

function pill(
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  background: PdfColor,
  color: PdfColor,
) {
  return [
    rect(x, y, width, height, background),
    text(truncate(label, 16), x + 12, y + 8, 9, 'bold', color),
  ].join('\n');
}

function totalRow(
  label: string,
  amount: number,
  x: number,
  y: number,
  commands: string[],
  color: PdfColor = brand.dark,
) {
  commands.push(text(truncate(label, 22), x, y, 10, 'regular', color));
  commands.push(text(formatAmount(amount), x + 110, y, 10, 'bold', color));
}

function rgb(color: PdfColor) {
  return color.map((value) => value.toFixed(3)).join(' ');
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 3))}...`
    : value;
}

function formatStatus(status: string) {
  return status
    .split('_')
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(' ');
}

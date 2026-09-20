import fs from 'fs';
import { query } from '../db/pool.js';
import { getAttachmentForUser, resolveAttachmentPath } from './attachment.js';
import { trackApiUsage } from './apiUsage.js';
import { getConfig } from './sysConfig.js';

const INVOICE_NO_PATTERNS = [
  /发票号码[：:\s]*([0-9]{8,20})/,
  /(?:Invoice\s*(?:No|Number)?[：:\s]*)([0-9]{8,20})/i,
  /No\.?\s*[：:]\s*([0-9]{8,20})/i,
];

function extractLooseText(buffer, maxLen = 500000) {
  return buffer.slice(0, maxLen).toString('latin1').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
}

function findInvoiceNoInText(text) {
  if (!text) return null;
  for (const pattern of INVOICE_NO_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return { invoiceNo: match[1], matchType: 'pattern' };
    }
  }
  const digitMatches = [...text.matchAll(/(?<![0-9])([0-9]{10,20})(?![0-9])/g)];
  if (!digitMatches.length) return null;
  const best = digitMatches.sort((a, b) => b[1].length - a[1].length)[0];
  return { invoiceNo: best[1], matchType: 'digits' };
}

function findInvoiceNoInFilename(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '');
  return findInvoiceNoInText(base);
}

export async function isDuplicateCheckEnabled() {
  return (await getConfig('invoice.duplicate_check', 'true')) === 'true';
}

export async function findDuplicateUsage(invoiceNo, invoiceCode, excludeReimbId = 0) {
  if (!invoiceNo) return null;

  const rows = await query(
    `SELECT r.id, r.bill_no AS billNo, r.status
     FROM invoice i
     JOIN reimbursement_item ri ON ri.invoice_id = i.id
     JOIN reimbursement r ON r.id = ri.reimbursement_id
     WHERE i.invoice_no = :no
       AND (i.invoice_code <=> :code)
       AND r.status NOT IN ('draft', 'rejected', 'cancelled')
       AND r.id != :excludeReimbId
     LIMIT 1`,
    { no: String(invoiceNo).trim(), code: invoiceCode ? String(invoiceCode).trim() : null, excludeReimbId },
  );
  return rows[0] || null;
}

export async function upsertInvoice(conn, { invoiceNo, invoiceCode, amount, userId }) {
  const no = String(invoiceNo).trim();
  const code = invoiceCode ? String(invoiceCode).trim() : null;

  const [rows] = await conn.query(
    'SELECT id FROM invoice WHERE invoice_no = ? AND (invoice_code <=> ?) LIMIT 1',
    [no, code],
  );

  if (rows[0]) {
    return rows[0].id;
  }

  const [result] = await conn.query(
    `INSERT INTO invoice (invoice_code, invoice_no, total_amount, status, uploaded_by)
     VALUES (?, ?, ?, 'pending', ?)`,
    [code, no, amount || null, userId],
  );
  return result.insertId;
}

export async function validateInvoicesForSubmit(reimbId) {
  if (!(await isDuplicateCheckEnabled())) return;

  const items = await query(
    `SELECT ri.invoice_id AS invoiceId, i.invoice_no AS invoiceNo, i.invoice_code AS invoiceCode
     FROM reimbursement_item ri
     LEFT JOIN invoice i ON i.id = ri.invoice_id
     WHERE ri.reimbursement_id = :id AND ri.invoice_id IS NOT NULL`,
    { id: reimbId },
  );

  const seen = new Set();
  for (const item of items) {
    const key = `${item.invoiceNo}::${item.invoiceCode || ''}`;
    if (seen.has(key)) {
      throw new Error(`发票号码 ${item.invoiceNo} 在本单中重复填写`);
    }
    seen.add(key);

    const dup = await findDuplicateUsage(item.invoiceNo, item.invoiceCode, reimbId);
    if (dup) {
      throw new Error(`发票 ${item.invoiceNo} 已在报销单 ${dup.billNo}（${dup.status}）中使用`);
    }
  }
}

export async function checkInvoiceDuplicate(invoiceNo, invoiceCode, excludeReimbId = 0) {
  if (!(await isDuplicateCheckEnabled()) || !invoiceNo) {
    return { duplicate: false };
  }
  const dup = await findDuplicateUsage(invoiceNo, invoiceCode, excludeReimbId);
  if (!dup) return { duplicate: false };
  return { duplicate: true, billNo: dup.billNo, status: dup.status };
}

/**
 * 本地 MVP：文件名 + 文件内可读文本正则，不依赖付费 OCR API。
 * invoice.verify_enabled=true 时预留第三方 hook（当前未接入）。
 */
export async function ocrInvoiceFromAttachment(fileId, userId) {
  const att = await getAttachmentForUser(fileId, userId);
  if (!att) {
    throw new Error('文件不存在或无权访问');
  }

  const fromFilename = findInvoiceNoInFilename(att.fileName);
  if (fromFilename) {
    return {
      invoiceNo: fromFilename.invoiceNo,
      invoiceCode: null,
      source: 'filename',
      confidence: fromFilename.matchType === 'pattern' ? 'medium' : 'low',
      message: '已从文件名识别发票号，请核对',
    };
  }

  const fullPath = resolveAttachmentPath(att.filePath);
  const buffer = fs.readFileSync(fullPath);
  const fromContent = findInvoiceNoInText(extractLooseText(buffer));
  if (fromContent) {
    return {
      invoiceNo: fromContent.invoiceNo,
      invoiceCode: null,
      source: 'content',
      confidence: fromContent.matchType === 'pattern' ? 'medium' : 'low',
      message: '已从文件内容文本识别（扫描件/图片准确度有限，请核对）',
    };
  }

  const verifyEnabled = (await getConfig('invoice.verify_enabled', 'false')) === 'true';
  if (verifyEnabled) {
    await trackApiUsage('invoice.ocr.external');
    return {
      invoiceNo: null,
      invoiceCode: null,
      source: 'external_stub',
      confidence: 'none',
      message: '第三方 OCR/验真已启用但未配置 API，请手动填写发票号',
    };
  }

  return {
    invoiceNo: null,
    invoiceCode: null,
    source: 'none',
    confidence: 'none',
    message: '未能识别发票号。可尝试文件名含号码（如 发票1234567890.jpg），或手动填写',
  };
}

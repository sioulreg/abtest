import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { runABTest } from '@/lib/stats';

interface ParsedData {
  visitorsA: number;
  conversionsA: number;
  visitorsB: number;
  conversionsB: number;
  labelA: string;
  labelB: string;
  metricName: string;
}

function detectCSVStructure(rows: Record<string, string>[]): ParsedData | null {
  if (rows.length === 0) return null;

  const headers = Object.keys(rows[0]).map((h) => h.toLowerCase().trim());

  // Try to find variant/group column
  const variantCols = ['variant', 'groupe', 'group', 'variation', 'branch', 'version', 'test'];
  const variantCol = headers.find((h) => variantCols.some((v) => h.includes(v)));

  // Try to find visitors/sessions column
  const visitorCols = ['visitors', 'sessions', 'visites', 'utilisateurs', 'users', 'impressions', 'exposed'];
  const visitorCol = headers.find((h) => visitorCols.some((v) => h.includes(v)));

  // Try to find conversions column
  const convCols = ['conversions', 'converted', 'clicks', 'clics', 'leads', 'orders', 'sales', 'signups'];
  const convCol = headers.find((h) => convCols.some((v) => h.includes(v)));

  // Try to find rate column
  const rateCols = ['rate', 'taux', 'cvr', 'cr', 'ratio'];
  const rateCol = headers.find((h) => rateCols.some((v) => h.includes(v)));

  // Case 1: rows are variants (variant col + visitors + conversions)
  if (variantCol && visitorCol && (convCol || rateCol) && rows.length >= 2) {
    const originalHeaders = Object.keys(rows[0]);
    const variantHeader = originalHeaders[headers.indexOf(variantCol)];
    const visitorHeader = originalHeaders[headers.indexOf(visitorCol)];

    const getNum = (row: Record<string, string>, col: string) => {
      const header = originalHeaders[headers.indexOf(col)];
      return parseFloat(String(row[header]).replace(/[^0-9.]/g, '')) || 0;
    };

    const rowA = rows[0];
    const rowB = rows[1];

    const visitorsA = getNum(rowA, visitorCol);
    const visitorsB = getNum(rowB, visitorCol);

    let conversionsA: number;
    let conversionsB: number;

    if (convCol) {
      conversionsA = getNum(rowA, convCol);
      conversionsB = getNum(rowB, convCol);
    } else if (rateCol) {
      const rateA = getNum(rowA, rateCol) / (getNum(rowA, rateCol) > 1 ? 100 : 1);
      const rateB = getNum(rowB, rateCol) / (getNum(rowB, rateCol) > 1 ? 100 : 1);
      conversionsA = Math.round(visitorsA * rateA);
      conversionsB = Math.round(visitorsB * rateB);
    } else {
      return null;
    }

    const convHeader = convCol || rateCol;
    return {
      visitorsA,
      conversionsA,
      visitorsB,
      conversionsB,
      labelA: String(rowA[variantHeader]) || 'Control',
      labelB: String(rowB[variantHeader]) || 'Variant',
      metricName: convHeader ? originalHeaders[headers.indexOf(convHeader!)] : 'Conversions',
    };
  }

  // Case 2: columns are A/B (control_visitors, variant_visitors, etc.)
  const controlVisitors = headers.find((h) => h.includes('control') && visitorCols.some((v) => h.includes(v)));
  const variantVisitors = headers.find((h) => (h.includes('variant') || h.includes('test')) && visitorCols.some((v) => h.includes(v)));
  const controlConv = headers.find((h) => h.includes('control') && convCols.some((v) => h.includes(v)));
  const variantConv = headers.find((h) => (h.includes('variant') || h.includes('test')) && convCols.some((v) => h.includes(v)));

  if (controlVisitors && variantVisitors && controlConv && variantConv && rows.length >= 1) {
    const originalHeaders = Object.keys(rows[0]);
    const getHeader = (col: string) => originalHeaders[headers.indexOf(col)];
    const getNum = (col: string) => parseFloat(String(rows[0][getHeader(col)]).replace(/[^0-9.]/g, '')) || 0;

    return {
      visitorsA: getNum(controlVisitors),
      conversionsA: getNum(controlConv),
      visitorsB: getNum(variantVisitors),
      conversionsB: getNum(variantConv),
      labelA: 'Control',
      labelB: 'Variant',
      metricName: 'Conversions',
    };
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const mode = formData.get('mode') as string;

    if (mode === 'manual') {
      const visitorsA = parseInt(formData.get('visitorsA') as string);
      const conversionsA = parseInt(formData.get('conversionsA') as string);
      const visitorsB = parseInt(formData.get('visitorsB') as string);
      const conversionsB = parseInt(formData.get('conversionsB') as string);
      const labelA = (formData.get('labelA') as string) || 'Control';
      const labelB = (formData.get('labelB') as string) || 'Variant';
      const metricName = (formData.get('metricName') as string) || 'Conversions';
      const alpha = parseFloat((formData.get('alpha') as string) || '0.05');

      if (
        isNaN(visitorsA) || isNaN(conversionsA) || isNaN(visitorsB) || isNaN(conversionsB) ||
        visitorsA <= 0 || visitorsB <= 0 || conversionsA < 0 || conversionsB < 0 ||
        conversionsA > visitorsA || conversionsB > visitorsB
      ) {
        return NextResponse.json({ error: 'Données invalides' }, { status: 400 });
      }

      const stats = runABTest(visitorsA, conversionsA, visitorsB, conversionsB, alpha);
      return NextResponse.json({ stats, labelA, labelB, metricName });
    }

    if (mode === 'csv') {
      const file = formData.get('file') as File;
      if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });

      const text = await file.text();
      const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
      });

      if (result.errors.length > 0 && result.data.length === 0) {
        return NextResponse.json({ error: 'Erreur de parsing CSV' }, { status: 400 });
      }

      const parsed = detectCSVStructure(result.data);
      if (!parsed) {
        return NextResponse.json(
          {
            error: 'Structure CSV non reconnue. Colonnes attendues : variant/group + visitors/sessions + conversions, ou une ligne par variante.',
            preview: result.data.slice(0, 3),
          },
          { status: 422 }
        );
      }

      const alpha = parseFloat((formData.get('alpha') as string) || '0.05');
      const stats = runABTest(
        parsed.visitorsA, parsed.conversionsA,
        parsed.visitorsB, parsed.conversionsB,
        alpha
      );

      return NextResponse.json({
        stats,
        labelA: parsed.labelA,
        labelB: parsed.labelB,
        metricName: parsed.metricName,
      });
    }

    return NextResponse.json({ error: 'Mode invalide' }, { status: 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

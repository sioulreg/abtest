import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: `Extrait les données de ce test A/B depuis cette image/screenshot.

Réponds UNIQUEMENT avec un JSON valide au format suivant (pas de markdown, pas d'explication) :
{
  "visitorsA": <nombre>,
  "conversionsA": <nombre>,
  "visitorsB": <nombre>,
  "conversionsB": <nombre>,
  "labelA": "<nom variante A>",
  "labelB": "<nom variante B>",
  "metricName": "<nom de la métrique>"
}

Si tu ne peux pas extraire les données avec certitude, réponds :
{"error": "Données non lisibles - raison courte"}`,
            },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text')?.text ?? '';

    try {
      const data = JSON.parse(text.trim());
      if (data.error) {
        return NextResponse.json({ error: data.error }, { status: 422 });
      }
      return NextResponse.json(data);
    } catch {
      return NextResponse.json(
        { error: 'Claude n\'a pas pu extraire les données de l\'image' },
        { status: 422 }
      );
    }
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

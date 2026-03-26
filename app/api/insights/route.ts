import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ABTestResult, formatPercent, formatPValue } from '@/lib/stats';

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { stats, labelA, labelB, metricName, context } = body as {
    stats: ABTestResult;
    labelA: string;
    labelB: string;
    metricName: string;
    context?: string;
  };

  const prompt = `Tu es un expert en expérimentation et growth. Analyse ce test A/B et fournis une analyse business en français.

## Résultats du test

- **Variante A (${labelA})** : ${stats.visitorsA.toLocaleString()} visiteurs → ${stats.conversionsA.toLocaleString()} ${metricName} → taux : ${formatPercent(stats.rateA)}
- **Variante B (${labelB})** : ${stats.visitorsB.toLocaleString()} visiteurs → ${stats.conversionsB.toLocaleString()} ${metricName} → taux : ${formatPercent(stats.rateB)}
- **Uplift relatif** : ${stats.relativeUplift >= 0 ? '+' : ''}${formatPercent(stats.relativeUplift)} (${labelB} vs ${labelA})
- **p-value** : ${formatPValue(stats.pValue)} (seuil α = ${formatPercent(1 - stats.confidenceLevel, 0)})
- **Significatif** : ${stats.significant ? 'OUI ✓' : 'NON ✗'}
- **Puissance observée** : ${formatPercent(stats.observedPower)}
${stats.sampleSizeNeeded ? `- **Taille d'échantillon recommandée** : ${stats.sampleSizeNeeded.toLocaleString()} par variante (~${stats.additionalSamplesNeeded?.toLocaleString()} visiteurs supplémentaires)` : ''}
${context ? `\n## Contexte métier\n${context}` : ''}

## Ta mission

Fournis une analyse structurée avec :

### 1. Verdict (2-3 phrases)
Un résumé clair de ce que signifient ces résultats pour le business. Sois direct.

### 2. Insights business
- Que révèle ce résultat sur le comportement utilisateur ?
- Si significatif : recommandation claire. Si non significatif : interpréter l'uplift observé et ce qu'il implique.
- Impact business estimé si on scale (ex: "+X% de conversions = Y leads/mois supplémentaires si on projette sur le volume total")

### 3. Métriques à surveiller en parallèle
En plus de "${metricName}", quelles guardrail metrics surveiller pour s'assurer qu'on ne gagne pas sur une métrique en en dégradant une autre ? Cite 3-4 métriques concrètes adaptées au contexte (ex: taux de rebond, durée session, taux de désinscription, NPS, LTV, AOV…). Explique brièvement pourquoi chacune.

### 4. Biais potentiels à surveiller
Liste les biais spécifiques à ce test :
- **Biais de sélection** : L'échantillon est-il représentatif ? (Simpson's paradox, seasonality, etc.)
- **Biais temporel** : Durée du test, jours de la semaine, événements externes
- **Novelty effect** : Les utilisateurs réagissent-ils à la nouveauté plutôt qu'à la valeur ?
- **SRM (Sample Ratio Mismatch)** : ${Math.abs(stats.visitorsA - stats.visitorsB) / Math.max(stats.visitorsA, stats.visitorsB) > 0.1 ? `⚠️ Attention : écart de ${formatPercent(Math.abs(stats.visitorsA - stats.visitorsB) / Math.max(stats.visitorsA, stats.visitorsB))} entre les groupes - possible SRM !` : 'Groupes bien équilibrés.'}
- Autres biais selon le contexte

### 5. Recommandations
- Prochaine étape concrète
- Si besoin de plus de data : objectif clair (quand continuer, quand stopper)
- Tests de suivi suggérés

Sois concis mais percutant. Utilise des **gras** pour les points clés.`;

  const stream = await client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  });
}

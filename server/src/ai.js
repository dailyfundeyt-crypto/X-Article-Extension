/*
 * AI-Helfer: OpenAI-kompatible Chat-Completions für Plan-Erstellung,
 * Artikel-Kategorisierung, Prompt-Weiterleitung und freien Chat.
 */

export const AI_PROVIDERS = {
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
  },
  perplexity: {
    url: "https://api.perplexity.ai/chat/completions",
    defaultModel: "sonar",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini",
  },
};

// Liest die AI-Konfiguration eines Nutzers aus seinen synchronisierten
// Einstellungen; SERVER_AI_KEY/SERVER_AI_PROVIDER dienen als Fallback.
export function aiConfigFor(settings) {
  const provider = settings.aiProvider || process.env.SERVER_AI_PROVIDER || "openai";
  const apiKey = settings.aiApiKey || process.env.SERVER_AI_KEY || "";
  const model =
    settings.aiModel || (AI_PROVIDERS[provider] || AI_PROVIDERS.openai).defaultModel;
  return { provider, apiKey, model };
}

export async function chatCompletion({ provider, apiKey, model }, messages, opts = {}) {
  if (!apiKey) throw new Error("Kein AI-API-Schlüssel hinterlegt");
  const p = AI_PROVIDERS[provider] || AI_PROVIDERS.openai;
  const res = await fetch(p.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || p.defaultModel,
      messages,
      temperature: opts.temperature ?? 0.4,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI-API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Leere Antwort der AI-API");
  return text;
}

/* ------------------------------------------------------------- Use-Cases */

export async function generatePlan(cfg, article, context = "") {
  return chatCompletion(cfg, [
    {
      role: "system",
      content:
        "Du bist ein strategischer Assistent. Der Nutzer hat einen Artikel von X " +
        "gespeichert. Erstelle einen kurzen, umsetzbaren Plan (nummerierte Liste, " +
        "3–7 Schritte): Was sollte der Nutzer jetzt konkret tun? Wenn ein " +
        "Unternehmenskontext angegeben ist, wende die Inhalte des Artikels direkt " +
        "auf dieses Unternehmen an. Antworte auf Deutsch.",
    },
    {
      role: "user",
      content:
        (context ? `Mein Unternehmen/Kontext: ${context}\n\n` : "") +
        `Artikel von ${article.author || article.handle || "unbekannt"}:\n` +
        `${(article.text || "").slice(0, 4000)}\n\nQuelle: ${article.url || "-"}`,
    },
  ]);
}

export async function categorizeArticle(cfg, article, existingFolders) {
  const folders = existingFolders.filter((f) => f && f !== "Inbox");
  const text = await chatCompletion(
    cfg,
    [
      {
        role: "system",
        content:
          "Ordne den folgenden Artikel einem Ordner zu. " +
          (folders.length
            ? `Bevorzugt einen dieser bestehenden Ordner: ${folders.join(", ")}. `
            : "") +
          "Wenn keiner passt, schlage einen neuen, kurzen Ordnernamen vor " +
          "(1–2 Wörter, Deutsch). Antworte NUR mit dem Ordnernamen, sonst nichts.",
      },
      {
        role: "user",
        content: `${article.title}\n\n${(article.text || "").slice(0, 1500)}`,
      },
    ],
    { temperature: 0.2 }
  );
  return text.split("\n")[0].replace(/["'`]/g, "").trim().slice(0, 40) || "Inbox";
}

export async function chatAboutArticles(cfg, question, articles) {
  const context = articles
    .map(
      (a, i) =>
        `[${i + 1}] „${a.title}" von ${a.author || a.handle || "?"} (${a.created_at})` +
        `${a.folder ? ` – Ordner: ${a.folder}` : ""}\n${(a.text || "").slice(0, 800)}`
    )
    .join("\n\n");
  return chatCompletion(cfg, [
    {
      role: "system",
      content:
        "Du bist der persönliche XCapture-Telegram-Agent des Nutzers. Du kennst " +
        "seine gespeicherten X-Artikel (unten als Kontext). Beantworte Fragen " +
        "dazu präzise und hilfreich auf Deutsch. Verweise auf Artikel mit ihrer " +
        "Nummer in eckigen Klammern.",
    },
    {
      role: "user",
      content: `Meine gespeicherten Artikel:\n\n${context}\n\nFrage: ${question}`,
    },
  ]);
}

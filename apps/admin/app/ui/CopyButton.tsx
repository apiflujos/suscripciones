"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copiar", copiedLabel = "Copiado" }: { text: string; label?: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="ghost" onClick={handleCopy}>
      {copied ? copiedLabel : label}
    </button>
  );
}

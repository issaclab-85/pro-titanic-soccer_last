import { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { ARCHITECTURE_SECTIONS } from '../data/blueprintDocs';

interface BlueprintModalProps {
  onClose: () => void;
}

export function BlueprintModal({ onClose }: BlueprintModalProps) {
  const [activeId, setActiveId] = useState(ARCHITECTURE_SECTIONS[0].id);
  const [copied, setCopied] = useState(false);

  const activeSection =
    ARCHITECTURE_SECTIONS.find((s) => s.id === activeId) || ARCHITECTURE_SECTIONS[0];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeSection.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/86 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-black text-white">
              Pro Titanic Soccer — Engine Architecture &amp; Scripts
            </h2>
            <p className="text-xs text-slate-400">
              Complete Godot 4 / Unity C# scene structure, LAN hotspot UDP discovery, and Outfield/GK input scripts.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-800 bg-slate-950/60 px-6 py-3">
          {ARCHITECTURE_SECTIONS.map((sec) => (
            <button
              key={sec.id}
              type="button"
              onClick={() => setActiveId(sec.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                sec.id === activeId
                  ? 'bg-amber-400 text-slate-950'
                  : 'border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
              }`}
            >
              {sec.title}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-extrabold text-white">{activeSection.title}</div>
              <div className="text-xs text-slate-400">{activeSection.subtitle}</div>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-amber-400"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy Script'}
            </button>
          </div>

          <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200">
            <code>{activeSection.code}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}

"use client";

import { BookOpen, Calendar, Compass, Orbit, Plus, Search, Sparkles, X } from "lucide-react";
import Modal from "@/components/ui/Modal";

interface ShortcutGroup {
  category: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUTS: ShortcutGroup[] = [
  {
    category: "Navigation & Views",
    shortcuts: [
      { keys: ["\\"], description: "Toggle navigation sidebar" },
      { keys: ["⌘", "B"], description: "Toggle navigation sidebar" },
      { keys: ["G"], description: "Return to Observatory Sky map" },
      { keys: ["J"], description: "Open Moments library" },
      { keys: ["/"], description: "Focus global moment search" },
      { keys: ["⌘", "K"], description: "Command search" },
    ],
  },
  {
    category: "Capturing & Reading",
    shortcuts: [
      { keys: ["N"], description: "Capture a new moment (open composer)" },
      { keys: ["⌘", "↵"], description: "Save moment draft" },
      { keys: ["←", "→"], description: "Previous / Next moment in reader" },
      { keys: ["Esc"], description: "Close reader, composer, or modal" },
    ],
  },
  {
    category: "Time & Constellations",
    shortcuts: [
      { keys: ["["], description: "Step one star backward in time" },
      { keys: ["]"], description: "Step one star forward in time" },
      { keys: ["?"], description: "Show keyboard shortcuts" },
    ],
  },
];

export default function KeyboardShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Observatory Keyboard Shortcuts"
      description="Navigate your sky and moments with quiet speed."
      className="shortcuts-modal max-w-lg"
    >
      <div className="space-y-6 pt-2">
        {SHORTCUTS.map(group => (
          <div key={group.category} className="space-y-2.5">
            <h3 className="font-mono text-[0.6875rem] font-medium uppercase tracking-widest text-[#8c92a4]">
              {group.category}
            </h3>
            <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-[#0c0e17]/70 backdrop-blur-md">
              {group.shortcuts.map(sc => (
                <div
                  key={sc.description}
                  className="flex items-center justify-between px-4 py-2.5 text-xs text-[#d8dbe2]"
                >
                  <span>{sc.description}</span>
                  <div className="flex items-center gap-1.5">
                    {sc.keys.map(k => (
                      <kbd
                        key={k}
                        className="inline-flex min-w-[22px] items-center justify-center rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium text-white shadow-sm"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

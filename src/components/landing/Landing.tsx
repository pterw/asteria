"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowDown, ArrowUpRight, Eye, Feather, History, Sparkle } from "lucide-react";
import AmbientStars from "@/components/landing/AmbientStars";
import SkyCanvas from "@/components/sky/SkyCanvas";
import { useJournalTime } from "@/components/sky/JournalTime";
import { census, MOOD_KEYS, MOODS, moodCounts, type StarDto } from "@/lib/astral";

const EASE = [0.22, 1, 0.36, 1] as const;

function Reveal({ children, delay = 0, y = 30, className = "" }: { children: React.ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y, filter: "blur(12px)" }} whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-70px" }} transition={{ duration: 1, delay, ease: EASE }} className={className}>
      {children}
    </motion.div>
  );
}
function HeroWord({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    // Mask depth must clear the Fraunces-italic descender of g/y, which paints ~0.12em
    // below the 0.98 line box (measured cut-free at 0.18em). pb is paired with -mb so the
    // h1's line layout is unchanged, and travel (130%) stays > mask depth (118.2% min) or
    // the word peeks above the mask before the reveal starts.
    <span className="inline-block overflow-hidden pb-[0.18em] -mb-[0.18em]">
      <motion.span className="inline-block will-change-transform" initial={{ y: "130%", rotate: 4 }} animate={{ y: "0%", rotate: 0 }} transition={{ duration: 1.15, delay, ease: EASE }}>
        {children}
      </motion.span>
    </span>
  );
}

const FRAGMENTS = [
  "golden hour on the floorboards", "the smell after rain", "someone remembered", "a fox at dawn", "3:47 am static",
  "warm bread, cold hands", "borrowed moonlight", "the long way home", "the first green shoot", "a voicemail kept", "snow erasing sound",
];

export default function Landing({ stars }: { stars: StarDto[] }) {
  const timeZone = useJournalTime();
  const c = census(stars, timeZone);
  const own = stars.filter(s => !s.isSample).length;
  const samples = stars.length - own;
  const counts = moodCounts(stars);
  const cta = own > 0 ? "Return to your sky" : "Enter your sky";
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 900], [0, 190]);
  const heroOpacity = useTransform(scrollY, [0, 620], [1, 0]);
  const navBg = useTransform(scrollY, [0, 120], [0, 1]);

  return (
    <div className="grain relative min-h-screen overflow-x-clip">
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-void" />
        <AmbientStars />
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_110%,rgba(11,16,34,0.9),transparent_60%)]" />
      </div>

      <header className="fixed inset-x-0 top-0 z-50">
        <motion.div style={{ opacity: navBg }} className="absolute inset-0 border-b border-white/5 bg-void/70 backdrop-blur-xl" />
        <nav className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="group flex items-center gap-3">
            <Sparkle className="h-4 w-4 text-luminous transition-transform duration-500 group-hover:rotate-90" />
            <span className="font-display text-lg tracking-[0.32em] uppercase">Asteria</span>
          </Link>
          <div className="flex items-center gap-6 text-[13px] text-mist sm:gap-8">
            <a href="#ritual" className="hidden transition-colors hover:text-starlight sm:inline">How it works</a>
            <a href="#yours" className="hidden transition-colors hover:text-starlight sm:inline">Your sky</a>
            <Link href="/sky" className="group flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-starlight transition-all duration-300 hover:border-luminous/60 hover:shadow-halo">
              {cta}
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>
        </nav>
      </header>

      <section className="relative flex min-h-svh flex-col items-center justify-center px-6 text-center">
        <motion.div style={{ y: heroY, opacity: heroOpacity }} className="relative">
          <h1 className="font-display text-[clamp(3.2rem,9.5vw,8.2rem)] leading-[0.98] font-light tracking-tight">
            <HeroWord delay={0.35}>Every</HeroWord> <HeroWord delay={0.44}>life</HeroWord> <HeroWord delay={0.53}>is</HeroWord>
            <br />
            <HeroWord delay={0.66}><em className="bg-gradient-to-r from-luminous via-starlight to-electric bg-clip-text text-transparent italic">a&nbsp;night&nbsp;sky.</em></HeroWord>
          </h1>
          <motion.p initial={{ opacity: 0, y: 24, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 1.1, delay: 1.05, ease: EASE }}
            className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-mist sm:text-lg">
            Write down one small moment a night. Asteria hangs it as a star. Moments that share a feeling thread into constellations —
            and you can wind time back and watch your sky form.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 1.25, ease: EASE }}
            className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/sky" className="shadow-ember hover:shadow-ember-hover group flex items-center gap-3 rounded-full bg-gradient-to-b from-white/12 to-white/4 px-8 py-4 font-mono text-sm tracking-[0.22em] text-starlight uppercase transition-transform duration-300 hover:scale-[1.03] active:scale-[0.98]">
              <Sparkle className="h-4 w-4 text-luminous" />{cta}
            </Link>
            <a href="#ritual" className="group flex items-center gap-3 rounded-full px-8 py-4 font-mono text-sm tracking-[0.22em] text-mist uppercase transition-colors hover:text-starlight">
              How it works<ArrowDown className="h-4 w-4 transition-transform duration-300 group-hover:translate-y-0.5" />
            </a>
          </motion.div>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.2, duration: 1 }} className="absolute bottom-8 flex flex-col items-center gap-3">
          <span className="font-mono text-[11px] tracking-[0.4em] text-dim uppercase">Scroll</span>
          <div className="h-12 w-px overflow-hidden bg-white/10">
            <motion.div className="h-1/2 w-full bg-gradient-to-b from-transparent via-luminous to-transparent" animate={{ y: [-24, 52] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} />
          </div>
        </motion.div>
      </section>

      <section className="relative border-y border-white/5 py-5" aria-hidden="true">
        <div className="flex w-max animate-marquee gap-10 whitespace-nowrap [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
          {[...FRAGMENTS, ...FRAGMENTS].map((f, i) => (
            <span key={i} className="flex items-center gap-10 font-mono text-xs tracking-[0.3em] text-dim uppercase">{f}<Sparkle className="h-2.5 w-2.5 text-electric/70" /></span>
          ))}
        </div>
      </section>

      <section id="ritual" className="relative mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <Reveal>
          <h2 className="max-w-2xl font-display text-4xl leading-[1.05] font-light sm:text-6xl">Three small acts,<br /><em className="text-shadow-glow italic">after dark.</em></h2>
        </Reveal>
        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/5 sm:grid-cols-3">
          {[
            { n: "01", icon: Eye, title: "Notice", body: "Some moment today was yours alone — a slant of light, a kind word that landed. Catch it before sleep washes it out.", tone: "text-serene" },
            { n: "02", icon: Feather, title: "Hang it", body: "Write it in a breath or two. Give it a colour of feeling and say how brightly it burned. It becomes a star, placed among the others that felt the same.", tone: "text-luminous" },
            { n: "03", icon: History, title: "Watch it grow", body: "Each new star threads to the nearest memory of its kind, and constellations take shape. Wind the timeline back to see how yours formed, then play it forward again.", tone: "text-electric" },
          ].map((step, i) => (
            <Reveal key={step.n} delay={0.12 * i} className="h-full">
              <div className="group relative h-full bg-void/90 p-9 transition-colors duration-500 hover:bg-haze/60">
                <span className="pointer-events-none absolute right-6 top-5 font-display text-7xl text-white/4 italic transition-colors duration-500 group-hover:text-white/8">{step.n}</span>
                <step.icon className={`h-5 w-5 ${step.tone} transition-transform duration-500 group-hover:-translate-y-1`} />
                <h3 className="mt-6 font-display text-2xl font-light italic">{step.title}</h3>
                <p className="mt-4 text-[15px] leading-relaxed text-mist">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="yours" className="relative mx-auto max-w-6xl px-6 pb-28 pt-8 sm:pb-36">
        <Reveal>
          <h2 className="max-w-2xl font-display text-4xl leading-[1.05] font-light sm:text-6xl">
            {c.stars.toLocaleString("en-US")} {c.stars === 1 ? "star" : "stars"}, across {c.nights} {c.nights === 1 ? "night" : "nights"}<br />
            <em className="text-shadow-glow italic">in {c.constellations} {c.constellations === 1 ? "constellation" : "constellations"}.</em>
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <div className="relative mt-12 h-[62svh] min-h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-[#07080f] shadow-[0_40px_120px_rgba(0,0,0,0.5)]">
            <div className="absolute inset-0 opacity-30 mix-blend-screen" style={{ backgroundImage: "url(/images/observatory.jpg)", backgroundSize: "cover", backgroundPosition: "center 42%", maskImage: "radial-gradient(75% 65% at 50% 45%, black 20%, transparent 78%)", WebkitMaskImage: "radial-gradient(75% 65% at 50% 45%, black 20%, transparent 78%)" }} />
            <SkyCanvas stars={stars} preview />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#07080f] to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-5 p-8 text-center sm:flex-row sm:justify-between sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-mist">
                {MOOD_KEYS.filter(m => counts[m] > 0).map(m => (
                  <span key={m} className="flex items-center gap-2"><i className="h-2 w-2 rounded-full" style={{ background: MOODS[m].hex, boxShadow: `0 0 10px ${MOODS[m].hex}` }} />{MOODS[m].constellation} <b className="font-mono text-xs text-dim">{counts[m]}</b></span>
                ))}
              </div>
              <Link href="/sky" className="shadow-ember hover:shadow-ember-hover group pointer-events-auto flex items-center gap-3 rounded-full bg-gradient-to-b from-white/14 to-white/5 px-8 py-4 font-mono text-sm tracking-[0.22em] text-starlight uppercase transition-transform duration-300 hover:scale-[1.03] active:scale-[0.98]">
                {cta}<ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            </div>
          </div>
          <p className="mt-6 text-center text-sm text-dim sm:text-left">
            {samples > 0 ? `${samples} of these are example moments, written to show the shape of the thing. Clear them from inside your sky whenever you like. ` : ""}
            Your sky is private to this browser, and everything in it can be exported as a plain file.
          </p>
        </Reveal>
      </section>

      <footer className="relative border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 py-10 sm:flex-row">
          <div className="flex items-center gap-3"><Sparkle className="h-3 w-3 text-luminous" /><span className="font-display text-sm tracking-[0.32em] uppercase">Asteria</span></div>
          <p className="font-mono text-[11px] tracking-[0.3em] text-dim uppercase">one moment a night</p>
          <Link href="/sky" className="text-sm text-mist transition-colors hover:text-starlight">{cta} →</Link>
        </div>
      </footer>
    </div>
  );
}

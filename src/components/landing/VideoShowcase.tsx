"use client";

/**
 * Landing-page intro video with a chapter list. The video only downloads
 * after the visitor presses play (preload="none" + poster), and each chapter
 * seeks the same player, so the page stays light until someone asks for it.
 */

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

const VIDEO_SRC = "/videos/gitdash-4-5-intro.mp4";
const POSTER_SRC = "/videos/gitdash-intro-poster.jpg";

const CHAPTERS = [
  { at: 0, title: "Your CI, made readable" },
  { at: 6, title: "What's wrong, first" },
  { at: 16, title: "Every repository at a glance" },
  { at: 24, title: "DORA per repository" },
  { at: 36, title: "Why a workflow fails" },
  { at: 48, title: "Healthy teams, not just fast ones" },
  { at: 58, title: "Spend, explained" },
  { at: 66, title: "Alerts in plain language" },
  { at: 74, title: "Built for the whole organization" },
];

function clock(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function VideoShowcase() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setTime(v.currentTime);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, []);

  const play = (at?: number) => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.getAttribute("src")) v.setAttribute("src", VIDEO_SRC);
    if (at !== undefined) v.currentTime = at;
    setStarted(true);
    v.play().catch(() => {}); // autoplay may be refused; controls stay available
  };

  // The chapter that contains the current playback position.
  const current = CHAPTERS.reduce((acc, c, i) => (time >= c.at ? i : acc), 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
      <div className="relative float-card overflow-hidden !rounded-[18px]">
        <video
          ref={videoRef}
          className="block w-full aspect-video bg-black"
          poster={POSTER_SRC}
          controls={started}
          playsInline
          preload="none"
          aria-label="GitDash product tour, 90 seconds"
        />
        {!started && (
          <button
            type="button"
            onClick={() => play()}
            className="group absolute inset-0 flex items-center justify-center bg-ground/35 hover:bg-ground/20 transition-colors duration-100"
            aria-label="Play the 90-second GitDash tour"
          >
            <span className="flex items-center gap-3 h-14 pl-5 pr-6 rounded-full bg-primary text-white text-[15px] font-semibold group-hover:brightness-110">
              <Play className="w-5 h-5 fill-current" aria-hidden="true" />
              Watch the tour · 1:30
            </span>
          </button>
        )}
      </div>

      <nav aria-label="Video chapters" className="card p-2">
        <p className="px-3 pt-2 pb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-faint">Chapters</p>
        <ol>
          {CHAPTERS.map((c, i) => {
            const active = started && i === current;
            return (
              <li key={c.at}>
                <button
                  type="button"
                  onClick={() => play(c.at)}
                  aria-current={active ? "true" : undefined}
                  className={`w-full flex items-center gap-3 px-3 h-10 rounded-control text-left text-[13px] transition-colors duration-100 ${
                    active ? "bg-raised text-fg" : "text-muted hover:bg-panel hover:text-fg"
                  }`}
                >
                  <span className={`font-mono text-xs w-9 shrink-0 ${active ? "text-brand-fg" : "text-faint"}`}>{clock(c.at)}</span>
                  <span className="truncate">{c.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}

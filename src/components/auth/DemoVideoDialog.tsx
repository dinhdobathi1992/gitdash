"use client";

/**
 * "Explore the demo" trigger + modal video player for the sign-in page.
 * Uses the native <dialog> (top layer, Esc to close, focus handling built in).
 * The video only loads when opened and stops when closed.
 */

import { useRef } from "react";
import Link from "next/link";
import { X } from "lucide-react";

const VIDEO_SRC = "/videos/gitdash-4-5-intro.mp4";

export function DemoVideoDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const open = () => {
    const video = videoRef.current;
    if (video && !video.getAttribute("src")) video.setAttribute("src", VIDEO_SRC);
    dialogRef.current?.showModal();
    video?.play().catch(() => {}); // autoplay may be refused; controls stay available
  };

  const close = () => dialogRef.current?.close();

  // Fires for Esc, the close button and backdrop clicks alike.
  const onClose = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
  };

  return (
    <>
      <button type="button" onClick={open} className="font-medium text-link hover:text-violet-200">
        Explore the demo →
      </button>
      <dialog
        ref={dialogRef}
        onClose={onClose}
        // A click on the dialog element itself (not its content) is a backdrop click.
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        aria-label="GitDash intro video"
        className="m-auto w-[min(1100px,calc(100vw-32px))] max-w-none p-0 bg-transparent backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <div className="float-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 h-12 border-b border-line">
            <span className="text-sm font-semibold text-fg">GitDash in 90 seconds</span>
            <div className="flex items-center gap-4">
              <Link href="/demo" className="text-[13px] font-medium text-link hover:text-violet-200">Open the live demo →</Link>
              <button
                type="button"
                onClick={close}
                aria-label="Close video"
                className="inline-flex items-center justify-center w-8 h-8 rounded-control text-muted hover:text-fg hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <video
            ref={videoRef}
            className="block w-full aspect-video bg-black"
            controls
            muted
            playsInline
            preload="none"
          />
        </div>
      </dialog>
    </>
  );
}

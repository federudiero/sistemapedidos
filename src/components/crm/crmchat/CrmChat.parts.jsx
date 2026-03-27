import React, { useEffect, useMemo, useRef, useState } from "react";
import { SIMPLE_EMOJIS, TAG_COLORS } from "./crmChatConstants";
import { formatTime, isOutgoing } from "./crmChatUtils";

export function MessageTicks({ status }) {
  const s = String(status || "").toLowerCase();
  if (!s) return null;
  if (s === "read") return <span className="text-[#53bdeb]">✓✓</span>;
  if (s === "delivered") return <span className="opacity-80">✓✓</span>;
  if (s === "sent") return <span className="opacity-80">✓</span>;
  if (s === "failed" || s === "error") {
    return <span className="font-semibold text-[#ff7676]">!</span>;
  }
  if (s === "sending" || s === "pending") {
    return <span className="opacity-60">🕓</span>;
  }
  return <span className="opacity-70">✓</span>;
}

function pickSupportedAudioMimeType() {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return "audio/webm";
  }

  const candidates = [
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
  ];

  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported?.(type)) return type;
    } catch (e) {
      console.error(e);
    }
  }

  return "audio/webm";
}

export function AudioRecorderButton({
  onRecorded,
  compact = false,
  disabled = false,
  busy = false,
}) {
  const [rec, setRec] = useState(false);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeTypeRef = useRef("audio/webm");

  const start = async () => {
    if (disabled || busy) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = pickSupportedAudioMimeType();
      const mr = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      mimeTypeRef.current = mr.mimeType || preferredMimeType || "audio/webm";
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const finalMimeType = mr.mimeType || mimeTypeRef.current || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: finalMimeType });
        onRecorded?.(blob);
      };

      mediaRef.current = mr;
      mr.start();
      setRec(true);
    } catch (e) {
      console.error(e);
      alert("No pude acceder al micrófono.");
    }
  };

  const stop = () => {
    try {
      mediaRef.current?.stop();
    } catch (e) {
      console.error(e);
    }
    setRec(false);
  };

  const busyLabel = busy ? "Enviando…" : rec ? "Detener" : "Audio";
  const busyIcon = busy ? "⏳" : rec ? "⏹" : "🎙️";

  const sharedClass = disabled || busy
    ? "opacity-60 cursor-not-allowed"
    : "hover:brightness-105";

  if (compact) {
    return (
      <button
        className={`inline-flex h-12 w-12 items-center justify-center rounded-full transition ${
          rec
            ? "bg-[#6d2323] text-white shadow-[0_1px_2px_rgba(0,0,0,.25)]"
            : "bg-[#00a884] text-white shadow-[0_1px_2px_rgba(0,0,0,.25)]"
        } ${sharedClass}`}
        onClick={rec ? stop : start}
        title={busy ? "Enviando audio" : rec ? "Detener grabación" : "Grabar audio"}
        type="button"
        disabled={(disabled || busy) && !rec}
      >
        <span className="text-lg">{busyIcon}</span>
      </button>
    );
  }

  return (
    <button
      className={`inline-flex h-12 items-center gap-2 rounded-full px-4 text-sm font-medium transition ${
        rec
          ? "bg-[#6d2323] text-white shadow-[0_1px_2px_rgba(0,0,0,.25)]"
          : "bg-[#00a884] text-white shadow-[0_1px_2px_rgba(0,0,0,.25)]"
      } ${sharedClass}`}
      onClick={rec ? stop : start}
      title={busy ? "Enviando audio" : rec ? "Detener grabación" : "Grabar audio"}
      type="button"
      disabled={(disabled || busy) && !rec}
    >
      <span>{busyIcon}</span>
      <span>{busyLabel}</span>
    </button>
  );
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function looksLikeUrl(value) {
  return typeof value === "string" && /^(https?:)?\/\//i.test(value.trim());
}

function pickUrl(...values) {
  for (const value of values) {
    if (!value) continue;

    if (typeof value === "string" && looksLikeUrl(value)) {
      return value.trim();
    }

    if (typeof value === "object") {
      const nested = pickUrl(
        value.url,
        value.link,
        value.href,
        value.src,
        value.downloadUrl,
        value.downloadURL,
        value.publicUrl,
        value.publicURL,
        value.mediaUrl,
        value.previewUrl,
        value.previewURL
      );
      if (nested) return nested;
    }
  }
  return "";
}

function getLocationData(m) {
  const lat = firstNumber(
    m?.location?.lat,
    m?.location?.latitude,
    m?.latitude,
    m?.lat,
    m?.coords?.latitude,
    m?.coords?.lat
  );

  const lng = firstNumber(
    m?.location?.lng,
    m?.location?.lon,
    m?.location?.long,
    m?.location?.longitude,
    m?.longitude,
    m?.lng,
    m?.lon,
    m?.long,
    m?.coords?.longitude,
    m?.coords?.lng,
    m?.coords?.lon
  );

  if (lat == null || lng == null) return null;

  return {
    lat,
    lng,
    name: firstString(m?.location?.name, m?.locationName),
    address: firstString(m?.location?.address, m?.address),
  };
}

function getMessageKind(m) {
  const raw = String(m?.type || m?.rawType || m?.media?.kind || m?.kind || "")
    .trim()
    .toLowerCase();

  if (raw === "media") {
    const nestedKind = String(m?.media?.kind || "").trim().toLowerCase();
    if (nestedKind) return nestedKind;
  }

  if (
    ["image", "video", "audio", "sticker", "location", "document", "file"].includes(
      raw
    )
  ) {
    return raw;
  }

  if (getLocationData(m)) return "location";
  if (pickUrl(m?.sticker, m?.stickerUrl)) return "sticker";
  if (pickUrl(m?.image, m?.imageUrl)) return "image";
  if (pickUrl(m?.video, m?.videoUrl)) return "video";
  if (pickUrl(m?.audio, m?.audioUrl, m?.voice, m?.voiceUrl)) return "audio";
  if (pickUrl(m?.document, m?.file, m?.documentUrl, m?.fileUrl)) return "document";

  const genericUrl = pickUrl(
    m?.media,
    m?.attachment,
    m?.asset,
    m?.payload,
    m?.url,
    m?.mediaUrl,
    m?.downloadUrl,
    m?.fileUrl
  );

  const mime = String(
    m?.mime ||
      m?.mimeType ||
      m?.media?.mime ||
      m?.media?.mimeType ||
      m?.image?.mime_type ||
      m?.video?.mime_type ||
      m?.audio?.mime_type ||
      m?.document?.mime_type ||
      ""
  ).toLowerCase();

  if (genericUrl) {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "document";
  }

  return "text";
}

function getMediaUrlByKind(m, kind) {
  if (kind === "image") {
    return pickUrl(
      m?.media?.kind === "image" ? m?.media : null,
      m?.image,
      m?.imageUrl,
      m?.attachment,
      m?.asset,
      m?.payload,
      m?.url,
      m?.mediaUrl,
      m?.downloadUrl,
      m?.fileUrl
    );
  }

  if (kind === "video") {
    return pickUrl(
      m?.media?.kind === "video" ? m?.media : null,
      m?.video,
      m?.videoUrl,
      m?.attachment,
      m?.asset,
      m?.payload,
      m?.url,
      m?.mediaUrl,
      m?.downloadUrl,
      m?.fileUrl
    );
  }

  if (kind === "audio") {
    return pickUrl(
      m?.audio,
      m?.audioUrl,
      m?.voice,
      m?.voiceUrl,
      m?.attachment,
      m?.asset,
      m?.payload,
      m?.url,
      m?.mediaUrl,
      m?.downloadUrl,
      m?.fileUrl
    );
  }

  if (kind === "sticker") {
    return pickUrl(
      m?.sticker,
      m?.stickerUrl,
      m?.image,
      m?.imageUrl,
      m?.attachment,
      m?.asset,
      m?.payload,
      m?.url,
      m?.mediaUrl,
      m?.downloadUrl,
      m?.fileUrl
    );
  }

  if (kind === "document" || kind === "file") {
    return pickUrl(
      m?.document,
      m?.file,
      m?.documentUrl,
      m?.fileUrl,
      m?.attachment,
      m?.asset,
      m?.payload,
      m?.url,
      m?.mediaUrl,
      m?.downloadUrl
    );
  }

  return "";
}

function getMimeType(m) {
  return firstString(
    m?.mime,
    m?.mimeType,
    m?.media?.mime,
    m?.media?.mimeType,
    m?.image?.mime,
    m?.image?.mime_type,
    m?.video?.mime,
    m?.video?.mime_type,
    m?.audio?.mime,
    m?.audio?.mime_type,
    m?.sticker?.mime,
    m?.sticker?.mime_type,
    m?.document?.mime,
    m?.document?.mime_type,
    m?.file?.mime,
    m?.file?.mime_type
  );
}

function getFileName(m) {
  return firstString(
    m?.document?.filename,
    m?.document?.name,
    m?.file?.filename,
    m?.file?.name,
    m?.media?.name,
    m?.name,
    m?.filename
  );
}

function getDisplayText(m, kind) {
  const text = firstString(m?.text, m?.caption, m?.body, m?.message);
  if (!text) return "";

  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  const placeholdersByKind = {
    image: ["imagen", "image", "foto", "photo"],
    video: ["video"],
    audio: ["audio", "voz", "voice", "nota de voz"],
    sticker: ["sticker"],
    location: ["ubicacion", "location"],
    document: ["archivo", "documento", "document", "file"],
    file: ["archivo", "documento", "document", "file"],
  };

  if ((placeholdersByKind[kind] || []).includes(normalized)) {
    return "";
  }

  return text;
}

function formatAudioClock(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function Waveform({ progress = 0, outgoing = false, onSeek }) {
  const wrapRef = useRef(null);

  const bars = useMemo(
    () => [
      8, 12, 10, 16, 11, 18, 13, 22, 15, 12,
      19, 14, 24, 16, 13, 20, 12, 18, 15, 23,
      14, 11, 17, 13, 21, 15, 10, 19, 12, 16,
    ],
    []
  );

  const handleSeek = (e) => {
    if (!wrapRef.current || !onSeek) return;
    const rect = wrapRef.current.getBoundingClientRect();
    if (!rect.width) return;
    const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
    const pct = x / rect.width;
    onSeek(pct);
  };

  return (
    <div
      ref={wrapRef}
      onClick={handleSeek}
      className="relative flex h-9 cursor-pointer items-center gap-[2px] overflow-hidden rounded-full px-1.5"
      style={{
        background: outgoing ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.05)",
      }}
    >
      {bars.map((h, i) => {
        const pct = ((i + 1) / bars.length) * 100;
        const active = pct <= progress;

        return (
          <span
            key={i}
            className="block w-[3px] rounded-full"
            style={{
              height: `${h}px`,
              background: active
                ? outgoing
                  ? "#dcf8c6"
                  : "#53bdeb"
                : outgoing
                ? "rgba(255,255,255,0.28)"
                : "rgba(255,255,255,0.20)",
              transition: "background-color .15s ease",
            }}
          />
        );
      })}

      <span
        className="absolute w-3 h-3 -translate-y-1/2 rounded-full shadow pointer-events-none top-1/2"
        style={{
          left: `calc(${Math.min(Math.max(progress, 0), 100)}% - 6px)`,
          background: outgoing ? "#dcf8c6" : "#53bdeb",
        }}
      />
    </div>
  );
}

function AudioWavePlayer({ src, outgoing }) {
  const audioRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onLoaded = () => {
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    };

    const onTime = () => {
      setCurrent(el.currentTime || 0);
    };

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
      try {
        el.currentTime = 0;
      } catch (e) {
        console.error(e);
      }
    };

    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = speed;
  }, [speed]);

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;

    try {
      if (el.paused) {
        await el.play();
      } else {
        el.pause();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const seekToPct = (pct) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    el.currentTime = duration * pct;
    setCurrent(el.currentTime || 0);
  };

  const progress = duration ? (current / duration) * 100 : 0;

  const speedBtnClass = (value) =>
    [
      "inline-flex h-7 min-w-[42px] items-center justify-center rounded-full px-2 text-[11px] font-medium transition",
      speed === value
        ? outgoing
          ? "bg-[#dcf8c6] text-[#0b141a]"
          : "bg-[#53bdeb] text-[#0b141a]"
        : outgoing
        ? "bg-white/8 text-white/85 hover:bg-white/12"
        : "bg-white/5 text-[#c7d1d6] hover:bg-white/10",
    ].join(" ");

  return (
    <div className="min-w-[240px] max-w-[320px] rounded-2xl">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-[0_1px_2px_rgba(0,0,0,.22)] transition hover:brightness-105"
          style={{
            background: outgoing ? "#dcf8c6" : "#53bdeb",
            color: "#0b141a",
          }}
          title={playing ? "Pausar audio" : "Reproducir audio"}
        >
          <span className="text-sm leading-none">{playing ? "❚❚" : "▶"}</span>
        </button>

        <div className="flex-1 min-w-0">
          <Waveform progress={progress} outgoing={outgoing} onSeek={seekToPct} />

          <div
            className={`mt-1 flex items-center justify-between gap-2 text-[11px] ${
              outgoing ? "text-[#d9fdd3]" : "text-[#9fb0b8]"
            }`}
          >
            <span className="tabular-nums">{formatAudioClock(current || 0)}</span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSpeed(1)}
                className={speedBtnClass(1)}
                title="Velocidad normal"
              >
                1x
              </button>

              <button
                type="button"
                onClick={() => setSpeed(1.5)}
                className={speedBtnClass(1.5)}
                title="Velocidad 1.5x"
              >
                1.5x
              </button>

              <button
                type="button"
                onClick={() => setSpeed(2)}
                className={speedBtnClass(2)}
                title="Velocidad 2x"
              >
                2x
              </button>
            </div>

            <span className="tabular-nums opacity-80">
              {formatAudioClock(duration || 0)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FallbackCard({ title, text, link, children }) {
  return (
    <div className="space-y-2">
      <div className="font-semibold">{title}</div>
      {children}
      {text ? (
        <div className="break-words whitespace-pre-wrap text-[14px] leading-relaxed">
          {text}
        </div>
      ) : null}
      {link ? (
        <a
          className="text-sm underline break-all underline-offset-2"
          href={link}
          target="_blank"
          rel="noreferrer"
        >
          Abrir archivo
        </a>
      ) : null}
    </div>
  );
}

function MediaCaption({ text }) {
  if (!text) return null;
  return (
    <div className="break-words whitespace-pre-wrap px-1 text-[14px] leading-relaxed">
      {text}
    </div>
  );
}

function MediaErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="rounded-xl border border-[#ff7676]/30 bg-[#ff7676]/10 px-2 py-1 text-xs text-[#ffd6d6]">
      {error}
    </div>
  );
}

export function MessageBubble({ m }) {
  const out = isOutgoing(m);

  const kind = getMessageKind(m);
  const mediaUrl = getMediaUrlByKind(m, kind);
  const displayText = getDisplayText(m, kind);
  const mimeType = getMimeType(m);
  const fileName = getFileName(m);
  const location = getLocationData(m);
  const mediaError =
    m?.media?.error ||
    m?.audio?.error ||
    m?.image?.error ||
    m?.video?.error ||
    m?.document?.error ||
    m?.sticker?.error ||
    "";

  const bubbleBaseText =
    "w-fit max-w-[86%] sm:max-w-[78%] xl:max-w-[68%] rounded-2xl px-3 py-2.5 shadow-[0_1px_1px_rgba(0,0,0,0.18)]";

  const bubbleBaseMedia =
    "w-fit max-w-[78%] sm:max-w-[60%] xl:max-w-[420px] rounded-2xl px-2 py-2 shadow-[0_1px_1px_rgba(0,0,0,0.18)]";

  const bubbleBaseAudio =
    "w-fit max-w-[88%] sm:max-w-[72%] xl:max-w-[430px] rounded-2xl px-2.5 py-2 shadow-[0_1px_1px_rgba(0,0,0,0.18)]";

  const bubbleOut =
    "bg-[#005c4b] text-[#e9edef] rounded-br-md border border-[#0b4f41]";
  const bubbleIn =
    "bg-[#202c33] text-[#e9edef] rounded-bl-md border border-[#24343d]";

  const bubbleBase =
    kind === "audio"
      ? bubbleBaseAudio
      : kind === "image" || kind === "video" || kind === "sticker"
      ? bubbleBaseMedia
      : bubbleBaseText;

  const renderContent = () => {
    if (kind === "image" && mediaUrl) {
      return (
        <div className="space-y-2">
          <img
            src={mediaUrl}
            alt={displayText || "imagen"}
            className="max-h-[260px] w-full max-w-[220px] rounded-xl border border-black/10 object-cover sm:max-h-[320px] sm:max-w-[280px] lg:max-w-[340px] xl:max-w-[360px]"
            loading="lazy"
          />
          <MediaCaption text={displayText} />
          <MediaErrorNote error={mediaError} />
        </div>
      );
    }

    if (kind === "video" && mediaUrl) {
      return (
        <div className="space-y-2">
          <video
            src={mediaUrl}
            controls
            preload="metadata"
            className="max-h-[260px] w-full max-w-[220px] rounded-xl border border-black/10 object-cover sm:max-h-[320px] sm:max-w-[280px] lg:max-w-[340px] xl:max-w-[360px]"
          />
          <MediaCaption text={displayText} />
          <MediaErrorNote error={mediaError} />
        </div>
      );
    }

    if (kind === "audio" && mediaUrl) {
      return (
        <div className="space-y-2">
          <AudioWavePlayer src={mediaUrl} outgoing={out} />
          <MediaCaption text={displayText} />
          <MediaErrorNote error={mediaError} />
        </div>
      );
    }

    if (kind === "sticker") {
      if (mediaUrl) {
        return (
          <div className="space-y-2">
            <img
              src={mediaUrl}
              alt="sticker"
              className="max-w-[120px] rounded-2xl sm:max-w-[150px] lg:max-w-[170px]"
              loading="lazy"
            />
            <MediaCaption text={displayText} />
            <MediaErrorNote error={mediaError} />
          </div>
        );
      }

      return <FallbackCard title="🏷️ Sticker recibido" text={displayText} />;
    }

    if ((kind === "document" || kind === "file") && mediaUrl) {
      return (
        <FallbackCard title="📎 Archivo" text={displayText} link={mediaUrl}>
          {fileName ? (
            <div className="text-sm font-medium break-all">{fileName}</div>
          ) : null}
          {mimeType ? <div className="text-xs opacity-70">{mimeType}</div> : null}
          <MediaErrorNote error={mediaError} />
        </FallbackCard>
      );
    }

    if (kind === "location" && location) {
      const link = `https://www.google.com/maps?q=${location.lat},${location.lng}`;
      return (
        <div className="space-y-2">
          <div className="p-3 border rounded-xl border-white/10 bg-black/10">
            <div className="font-semibold">📍 Ubicación</div>
            {location.name ? (
              <div className="mt-1 text-sm font-medium">{location.name}</div>
            ) : null}
            {location.address ? (
              <div className="text-sm opacity-80">{location.address}</div>
            ) : null}
            <a
              className="inline-flex mt-2 text-sm underline underline-offset-2"
              href={link}
              target="_blank"
              rel="noreferrer"
            >
              Abrir en Google Maps
            </a>
            <div className="mt-1 text-xs opacity-70">
              {Number(location.lat).toFixed(6)}, {Number(location.lng).toFixed(6)}
            </div>
          </div>
          <MediaCaption text={displayText} />
        </div>
      );
    }

    if (["image", "video", "audio", "document", "file"].includes(kind) && !mediaUrl) {
      const titleByKind = {
        image: "🖼 Imagen recibida",
        video: "🎥 Video recibido",
        audio: "🎤 Audio recibido",
        document: "📎 Archivo recibido",
        file: "📎 Archivo recibido",
      };

      return (
        <FallbackCard
          title={titleByKind[kind] || "📦 Archivo recibido"}
          text={displayText}
        >
          <div className="text-xs opacity-70">
            No hay URL pública guardada para mostrar este archivo todavía.
          </div>
          {fileName ? (
            <div className="text-sm font-medium break-all">{fileName}</div>
          ) : null}
          {mimeType ? <div className="text-xs opacity-70">{mimeType}</div> : null}
          <MediaErrorNote error={mediaError} />
        </FallbackCard>
      );
    }

    return (
      <div className="break-words whitespace-pre-wrap text-[14px] leading-relaxed">
        {displayText || ""}
      </div>
    );
  };

  return (
    <div className={`flex w-full ${out ? "justify-end" : "justify-start"}`}>
      <div className={`${bubbleBase} ${out ? bubbleOut : bubbleIn}`}>
        {renderContent()}

        <div
          className={`mt-1.5 flex items-center justify-end gap-1 text-[11px] ${
            out ? "text-[#d9fdd3]/75" : "text-[#9fb0b8]"
          }`}
        >
          <span>{formatTime(m.timestamp)}</span>
          {out && <MessageTicks status={m.status} />}
        </div>
      </div>
    </div>
  );
}

function ModalShell({
  children,
  onClose,
  z = "z-[95]",
  align = "items-end md:items-center",
}) {
  return (
    <div
      className={`fixed inset-0 ${z} flex ${align} justify-center bg-black/55 p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-3`}
      onClick={onClose}
    >
      {children}
    </div>
  );
}

export function EmojisModal({ open, onClose, onPick }) {
  if (!open) return null;

  return (
    <ModalShell onClose={onClose} z="z-[95]">
      <div
        className="w-full max-w-md p-3 border shadow-xl rounded-2xl border-base-300 bg-base-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Emojis</div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-8 gap-1 sm:grid-cols-10">
          {SIMPLE_EMOJIS.map((em) => (
            <button
              key={em}
              className="btn btn-ghost btn-sm"
              onClick={() => onPick?.(em)}
              title={em}
              type="button"
            >
              {em}
            </button>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}

export function AttachModal({
  open,
  onClose,
  onPickFiles,
  onSendLocation,
  sending = false,
  busyLabel = "",
}) {
  if (!open) return null;

  return (
    <ModalShell onClose={onClose} z="z-[96]">
      <div
        className="w-full max-w-md p-4 border shadow-xl rounded-2xl border-base-300 bg-base-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Adjuntar</div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <div className="grid gap-2">
          <label
            className={`btn btn-outline justify-start sm:justify-center ${
              sending ? "pointer-events-none opacity-60" : ""
            }`}
          >
            📷 / 🎥 Enviar imagen o video
            <input
              type="file"
              className="hidden"
              multiple
              accept="image/*,video/*"
              disabled={sending}
              onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                onPickFiles?.(files);
              }}
            />
          </label>

          <button
            className="justify-start btn btn-outline sm:justify-center"
            onClick={onSendLocation}
            type="button"
            disabled={sending}
          >
            📍 Enviar ubicación
          </button>
        </div>

        <div className="mt-3 text-xs opacity-70">
          {sending
            ? busyLabel || "Enviando…"
            : "Los envíos salen por backend real y se registran en la conversación."}
        </div>
      </div>
    </ModalShell>
  );
}

export function TemplatesModal({
  open,
  onClose,
  templates,
  templateDraft,
  setTemplateDraft,
  savingTemplate,
  onCreateTemplate,
  onDeleteTemplate,
  onUseTemplate,
  provinciaId,
}) {
  if (!open) return null;

  return (
    <ModalShell onClose={onClose} z="z-[97]" align="items-end md:items-center">
      <div
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-base-300">
          <div className="font-semibold">Plantillas</div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <div className="grid gap-4 p-4 overflow-y-auto">
          <div className="grid gap-2 p-3 border rounded-xl border-base-300">
            <div className="text-sm font-semibold">Crear plantilla</div>
            <input
              className="input input-bordered"
              placeholder="Título"
              value={templateDraft.title}
              onChange={(e) =>
                setTemplateDraft((p) => ({ ...p, title: e.target.value }))
              }
            />
            <textarea
              className="textarea textarea-bordered min-h-[120px]"
              placeholder="Texto de la plantilla..."
              value={templateDraft.text}
              onChange={(e) =>
                setTemplateDraft((p) => ({ ...p, text: e.target.value }))
              }
            />
            <div className="flex justify-end">
              <button
                className="btn btn-primary"
                onClick={onCreateTemplate}
                disabled={savingTemplate}
                type="button"
              >
                {savingTemplate ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-semibold">Tus plantillas</div>

            {templates.length === 0 ? (
              <div className="text-sm opacity-70">No hay plantillas todavía.</div>
            ) : (
              <div className="grid gap-2">
                {templates.map((t) => (
                  <div
                    key={`${t.scope || "private"}_${t.id}`}
                    className="p-3 border rounded-xl border-base-300"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold truncate">
                            {t.title || "Sin título"}
                          </div>
                          <span className="badge badge-outline badge-sm">
                            {t.scope === "legacy" ? "Legacy" : "Privada"}
                          </span>
                        </div>
                        <div className="mt-1 text-sm whitespace-pre-wrap opacity-80">
                          {t.text || ""}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <button
                          className="btn btn-sm btn-success"
                          onClick={() => onUseTemplate?.(t.text || "")}
                          type="button"
                        >
                          Usar ✅
                        </button>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => onDeleteTemplate?.(t)}
                          type="button"
                        >
                          Borrar 🗑
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs opacity-60">
            Se guardan en privado por usuario dentro de <b>provincias/{provinciaId}/crmUserTemplates</b>.
            Las plantillas antiguas del camino global siguen visibles como <b>Legacy</b> para no perderlas.
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

export function ProfileDrawer({
  open,
  onClose,
  displayName,
  displayPhone,
  clientDoc,
  onOpenClientModal,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[85] flex" onClick={onClose}>
      <div className="flex-1 bg-black/30" />
      <div
        className="w-full h-full max-w-md border-l shadow-2xl border-base-300 bg-base-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-base-300">
          <div className="font-semibold">Perfil</div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
            Cerrar
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="p-3 border rounded-xl border-base-300">
            <div className="text-xs opacity-70">Cliente</div>
            <div className="font-semibold">{displayName}</div>
            <div className="text-sm opacity-70">{displayPhone}</div>
            <div className="mt-2 text-xs opacity-70">
              {clientDoc ? "✅ Cliente registrado" : "⚠️ Cliente no registrado"}
            </div>
          </div>

          <div className="p-3 space-y-2 border rounded-xl border-base-300">
            <div className="text-xs opacity-70">Datos</div>
            <div className="text-sm">
              <b>Email:</b> {clientDoc?.email || "—"}
            </div>
            <div className="text-sm">
              <b>Dirección:</b> {clientDoc?.direccion || "—"}
            </div>
            <div className="text-sm">
              <b>Localidad:</b> {clientDoc?.localidad || "—"}
            </div>
            <div className="text-sm whitespace-pre-wrap">
              <b>Notas:</b> {clientDoc?.notas || "—"}
            </div>
          </div>

          <button
            className="w-full btn btn-primary"
            onClick={onOpenClientModal}
            type="button"
          >
            {clientDoc ? "Editar cliente" : "Dar de alta cliente"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClientModal({
  open,
  onClose,
  clientDoc,
  clientForm,
  setClientForm,
  savingClient,
  onSaveClient,
  provinciaId,
  clientId,
}) {
  if (!open) return null;

  return (
    <ModalShell onClose={onClose} z="z-[90]" align="items-end md:items-center">
      <div
        className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-base-300">
          <div className="font-semibold">
            {clientDoc ? "Editar cliente" : "Alta de cliente"}
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <div className="grid gap-3 p-4 overflow-y-auto">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="label">
                <span className="label-text">Nombre *</span>
              </label>
              <input
                className="w-full input input-bordered"
                value={clientForm.nombre}
                onChange={(e) =>
                  setClientForm((p) => ({ ...p, nombre: e.target.value }))
                }
                placeholder="Ej: Juan Pérez"
              />
            </div>

            <div>
              <label className="label">
                <span className="label-text">Teléfono</span>
              </label>
              <input
                className="w-full input input-bordered"
                value={clientForm.telefono}
                onChange={(e) =>
                  setClientForm((p) => ({ ...p, telefono: e.target.value }))
                }
                placeholder="+549351..."
              />
            </div>

            <div>
              <label className="label">
                <span className="label-text">Email</span>
              </label>
              <input
                className="w-full input input-bordered"
                value={clientForm.email}
                onChange={(e) =>
                  setClientForm((p) => ({ ...p, email: e.target.value }))
                }
                placeholder="cliente@mail.com"
              />
            </div>

            <div>
              <label className="label">
                <span className="label-text">Localidad</span>
              </label>
              <input
                className="w-full input input-bordered"
                value={clientForm.localidad}
                onChange={(e) =>
                  setClientForm((p) => ({ ...p, localidad: e.target.value }))
                }
                placeholder="Córdoba / Villa María / ..."
              />
            </div>
          </div>

          <div>
            <label className="label">
              <span className="label-text">Dirección</span>
            </label>
            <input
              className="w-full input input-bordered"
              value={clientForm.direccion}
              onChange={(e) =>
                setClientForm((p) => ({ ...p, direccion: e.target.value }))
              }
              placeholder="Calle, número, barrio…"
            />
          </div>

          <div>
            <label className="label">
              <span className="label-text">Notas</span>
            </label>
            <textarea
              className="textarea textarea-bordered min-h-[110px] w-full"
              value={clientForm.notas}
              onChange={(e) =>
                setClientForm((p) => ({ ...p, notas: e.target.value }))
              }
              placeholder="Preferencias, última compra, observaciones…"
            />
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button className="btn btn-ghost" onClick={onClose} type="button">
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              onClick={onSaveClient}
              disabled={savingClient}
              type="button"
            >
              {savingClient ? "Guardando…" : "Guardar"}
            </button>
          </div>

          <div className="text-xs opacity-60">
            Se guarda en: <b>provincias/{provinciaId}/crmClientes/{clientId}</b>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

export function TagsModal({
  labels,
  customSlugSet,
  activeSlugs,
  onClose,
  onToggle,
  onCreate,
  onDelete,
  onEdit,
}) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("badge-ghost");

  const [editingSlug, setEditingSlug] = useState(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("badge-ghost");

  const startEdit = (l) => {
    const slug = String(l?.slug || "").trim().toLowerCase();
    if (!slug) return;
    setEditingSlug(slug);
    setEditName(String(l?.name || slug));
    setEditColor(String(l?.color || "badge-ghost"));
  };

  const cancelEdit = () => {
    setEditingSlug(null);
    setEditName("");
    setEditColor("badge-ghost");
  };

  const saveEdit = async () => {
    try {
      if (!editingSlug) return;
      const name = String(editName || "").trim();
      if (!name) return alert("Poné un nombre.");
      await onEdit?.({ slug: editingSlug, name, color: editColor });
      cancelEdit();
    } catch (e) {
      console.error("edit label modal error:", e);
      alert(e?.message || "No se pudo editar la etiqueta.");
    }
  };

  if (!labels) return null;

  return (
    <ModalShell onClose={onClose} z="z-[80]" align="items-end md:items-center">
      <div
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-base-300">
          <div className="font-semibold">Etiquetas</div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <div className="grid gap-4 p-4 overflow-y-auto">
          <div className="grid gap-2 p-3 border rounded-xl border-base-300">
            <div className="text-sm font-semibold">Crear etiqueta</div>
            <div className="grid gap-2 md:grid-cols-3">
              <input
                className="input input-bordered"
                placeholder="Nombre"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <select
                className="select select-bordered"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
              >
                {TAG_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    const name = (newName || "").trim();
                    if (!name) return;
                    await onCreate?.({ name, color: newColor });
                    setNewName("");
                    setNewColor("badge-ghost");
                  } catch (e) {
                    console.error("create label modal error:", e);
                    alert(e?.message || "No se pudo crear la etiqueta.");
                  }
                }}
                type="button"
              >
                Crear ➕
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {labels.map((l) => {
              const slug = String(l.slug || "").trim().toLowerCase();
              const active = activeSlugs.includes(slug);
              const isCustom = customSlugSet?.has?.(slug);

              return (
                <div key={slug} className="flex gap-2">
                  <button
                    className={`btn flex-1 justify-start border ${
                      active ? "btn-primary" : "btn-ghost"
                    }`}
                    onClick={() => onToggle?.(slug)}
                    type="button"
                  >
                    <span className={`badge ${l.color} mr-2 border`}>{l.name}</span>
                    <span className="text-xs opacity-70">{slug}</span>
                  </button>

                  {isCustom && (
                    <button
                      className="btn btn-outline"
                      title="Editar etiqueta"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startEdit(l);
                      }}
                      type="button"
                    >
                      ✏️
                    </button>
                  )}

                  {isCustom && (
                    <button
                      className="btn btn-outline btn-error"
                      title="Eliminar etiqueta"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete?.(slug);
                      }}
                      type="button"
                    >
                      🗑
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {editingSlug && (
            <div className="grid gap-2 p-3 border rounded-xl border-base-300 bg-base-200/30">
              <div className="text-sm font-semibold">
                Editar etiqueta: <span className="opacity-70">{editingSlug}</span>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <input
                  className="input input-bordered"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Nombre"
                />
                <select
                  className="select select-bordered"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                >
                  {TAG_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <div className="flex justify-end gap-2">
                  <button className="btn btn-ghost" onClick={cancelEdit} type="button">
                    Cancelar
                  </button>
                  <button className="btn btn-success" onClick={saveEdit} type="button">
                    Guardar ✅
                  </button>
                </div>
              </div>

              <div className="text-xs opacity-60">
                Nota: el <b>slug</b> no cambia.
              </div>
            </div>
          )}

          <div className="text-xs opacity-60">
            *Las etiquetas preset no se eliminan ni se editan.
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

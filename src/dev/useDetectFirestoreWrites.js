// src/dev/useDetectFirestoreWrites.js
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

const FIRESTORE_MATCHERS = [
  "/google.firestore.v1.Firestore/Write/channel", // gRPC-web write stream
  "/google.firestore.v1.Firestore/Write",         // REST/batch write
  "/google.firestore.v1.Firestore/Commit",        // algunos caminos de commit
];

export default function useDetectFirestoreWrites({ writeLock = false } = {}) {
  const { pathname } = useLocation();
  const lastPingRef = useRef(0);

  useEffect(() => {
    const isFsWriteUrl = (url) => {
      if (!url) return false;
      const s = String(url);
      return FIRESTORE_MATCHERS.some((m) => s.includes(m));
    };

    // ---- patch XHR ----
    const OldOpen = window.XMLHttpRequest.prototype.open;
    const OldSend = window.XMLHttpRequest.prototype.send;

    function openPatched(method, url, ...rest) {
      try {
        if (isFsWriteUrl(url)) {
          const now = Date.now();
          if (now - lastPingRef.current > 200) {
            console.groupCollapsed(`%c[FS WRITE@XHR] ${pathname}`, "color:#eab308;font-weight:bold;");
            console.log("URL:", url);
            console.trace("Trace aproximada");
            console.groupEnd();
          }
          lastPingRef.current = now;
          if (writeLock) this.__blockedByWriteLock = true;
        }
      } catch (e){console.error(e)}
      return OldOpen.call(this, method, url, ...rest);
    }

    function sendPatched(body) {
      if (this.__blockedByWriteLock) {
        console.warn("[WRITE_LOCK] Bloqueando escritura XHR en", pathname);
        setTimeout(() => {
          try { this.readyState = 4; this.status = 200; this.onreadystatechange && this.onreadystatechange(); } catch (e){console.error(e)}
        }, 0);
        return;
      }
      return OldSend.call(this, body);
    }

    window.XMLHttpRequest.prototype.open = openPatched;
    window.XMLHttpRequest.prototype.send = sendPatched;

    // ---- patch fetch ----
    const oldFetch = window.fetch;
    async function fetchPatched(input, init = {}) {
      const url = typeof input === "string" ? input : input?.url;
      const method = (init?.method || "GET").toUpperCase();
      const isWrite = isFsWriteUrl(url) && ["POST", "PATCH"].includes(method);

      if (isWrite) {
        console.groupCollapsed(`%c[FS WRITE@fetch] ${pathname}`, "color:#eab308;font-weight:bold;");
        console.log("URL:", url, "method:", method);
        console.trace("Trace aproximada");
        console.groupEnd();

        if (writeLock) {
          console.warn("[WRITE_LOCK] Bloqueando escritura fetch en", pathname);
          return new Response(null, { status: 200, statusText: "blocked-by-write-lock" });
        }
      }
      return oldFetch(input, init);
    }
    window.fetch = fetchPatched;

    // ---- resource-exhausted context ----
    const onRejection = (ev) => {
      const msg = String(ev?.reason?.message || ev?.reason || "");
      const code = ev?.reason?.code || "";
      if (msg.includes("resource-exhausted") || code === "resource-exhausted") {
        console.error(`[FS QUOTA] resource-exhausted en ${pathname}`);
      }
    };
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      window.XMLHttpRequest.prototype.open = OldOpen;
      window.XMLHttpRequest.prototype.send = OldSend;
      window.fetch = oldFetch;
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [pathname, writeLock]);
}

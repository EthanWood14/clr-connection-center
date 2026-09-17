import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes, flushPendingEmails } from "./routes";
import { installTvDayRaceFeedEnrichment } from "./tv-day-race-feed";
import * as storageExtra from "./storage";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startRetailBonzoShotgunWatcher } from "./retail-bonzo-shotgun-watcher";

const DEFAULT_SESSION_SECRET = "clr-secret-2026";
if (process.env.NODE_ENV === "production") {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret === DEFAULT_SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET env var must be set to a non-default value in production",
    );
  }
}

const app = express();
const httpServer = createServer(app);
app.set("trust proxy", 1);

app.use("/api/webhooks/dialpad-sms", express.text({ type: ["text/plain", "application/jwt", "application/octet-stream", "application/json"], limit: "256kb" }));

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

const rateLimitMessage = { error: "Too many requests, please try again later." };

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});

// Office TVs + many desks can share one NAT IP; 200/min was tripping
// "Too many requests" on normal use. Keep login/register tight; loosen general.
const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
  skip: (req) => /\/api\/tv(?:\/|$)/.test(req.originalUrl || req.url || ""),
});

// TV signage polls the feed ~every 10s and pages ~every 30s. Separate budget
// so a busy floor NAT does not freeze the wall.
const tvApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/register", registerLimiter);
app.use("/api/invite/accept", registerLimiter);
app.use("/api/tv", tvApiLimiter);
app.use("/api", generalApiLimiter);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Surrogate-Control", "no-store");
  next();
});

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;
  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  const SENSITIVE_PATH = /\/credentials$|^\/api\/auth\b|^\/api\/checkin\b|^\/api\/lap\b|^\/api\/tv(?:\/|$)|^\/api\/training-test\b|\/import$|email-decision|welcome-login/;
  const SENSITIVE_KEY = /password|secret|token|api[_-]?key|apikey|credential|bonzo|mailbox|resend/i;
  const redact = (v: any): any => {
    if (!v || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(redact);
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : (typeof val === "object" ? redact(val) : val);
    }
    return out;
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && !SENSITIVE_PATH.test(path)) {
        logLine += ` :: ${JSON.stringify(redact(capturedJsonResponse))}`;
      }
      log(logLine);
    }
  });
  next();
});

(async () => {
  installTvDayRaceFeedEnrichment(app, () => storageExtra.getRawSqlite());
  await registerRoutes(httpServer, app);
  // Retail pool seat is never on daily CLR assignments — own always-on poll.
  startRetailBonzoShotgunWatcher();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ error: message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      ...(process.platform !== "win32" ? { reusePort: true } : {}),
    },
    () => {
      log(`serving on port ${port}`);
    },
  );

  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal} — flushing queued emails and shutting down`, "shutdown");
    try {
      const sends = flushPendingEmails();
      await Promise.race([
        Promise.allSettled(sends),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch (e: any) {
      console.error("[shutdown] flush failed:", e?.message ?? e);
    } finally {
      httpServer.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    }
  };
  process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.once("SIGINT", () => void gracefulShutdown("SIGINT"));
})();
